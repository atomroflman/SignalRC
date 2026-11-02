using System.Text;
using System.Xml;

namespace SignalRC.Server.Overlay.Assets;

internal abstract class SvgNode
{
    public abstract SvgNode Clone();
}

internal sealed class SvgTextNode(string text) : SvgNode
{
    public string Text { get; set; } = text;
    public override SvgNode Clone() => new SvgTextNode(Text);
}

/// <summary>Minimal mutable element tree; only attributes without namespace plus <c>href</c> are kept.</summary>
internal sealed class SvgElement(string name) : SvgNode
{
    public string Name { get; set; } = name;
    public List<KeyValuePair<string, string>> Attributes { get; } = [];
    public List<SvgNode> Children { get; } = [];

    /// <summary>The id the element carried in the source (null for use clones).</summary>
    public string? SourceId { get; set; }
    /// <summary>Created by expanding a use; never a part of its own.</summary>
    public bool IsClone { get; set; }
    public string? PartId { get; set; }
    public string? RefId { get; set; }
    /// <summary>Local geometry box (shapes, text), before the own transform.</summary>
    public SvgBox? Box { get; set; }
    public SvgMatrix Matrix { get; set; } = SvgMatrix.Identity;
    /// <summary>Path and point coordinates counted for the limit.</summary>
    public int Points { get; set; }

    public IEnumerable<SvgElement> Elements => Children.OfType<SvgElement>();

    public string? Get(string attribute)
    {
        foreach (var (key, value) in Attributes) if (key == attribute) return value;
        return null;
    }

    public void Set(string attribute, string value)
    {
        var index = Attributes.FindIndex(a => a.Key == attribute);
        if (index >= 0) Attributes[index] = new(attribute, value);
        else Attributes.Add(new(attribute, value));
    }

    public bool Remove(string attribute) => Attributes.RemoveAll(a => a.Key == attribute) > 0;

    public override SvgNode Clone()
    {
        var copy = new SvgElement(Name) { SourceId = SourceId, IsClone = IsClone };
        copy.Attributes.AddRange(Attributes);
        foreach (var child in Children) copy.Children.Add(child.Clone());
        return copy;
    }

    public IEnumerable<SvgElement> Descendants()
    {
        var stack = new Stack<SvgElement>();
        for (var i = Children.Count - 1; i >= 0; i--) if (Children[i] is SvgElement e) stack.Push(e);
        while (stack.Count > 0)
        {
            var element = stack.Pop();
            yield return element;
            for (var i = element.Children.Count - 1; i >= 0; i--) if (element.Children[i] is SvgElement e) stack.Push(e);
        }
    }
}

/// <summary>
/// Decodes and parses the raw file without DTD processing or any resolver;
/// elements of foreign namespaces are skipped here.
/// </summary>
internal static class SvgParser
{
    public const string SvgNamespace = "http://www.w3.org/2000/svg";
    private const string XlinkNamespace = "http://www.w3.org/1999/xlink";
    private const string XmlNamespace = "http://www.w3.org/XML/1998/namespace";
    private const string XmlnsNamespace = "http://www.w3.org/2000/xmlns/";

    public static string Decode(ReadOnlySpan<byte> raw)
    {
        try
        {
            if (raw.StartsWith((ReadOnlySpan<byte>)[0xEF, 0xBB, 0xBF])) return Strict(new UTF8Encoding(false, true), raw[3..]);
            if (raw.StartsWith((ReadOnlySpan<byte>)[0xFF, 0xFE])) return Strict(new UnicodeEncoding(false, false, true), raw[2..]);
            if (raw.StartsWith((ReadOnlySpan<byte>)[0xFE, 0xFF])) return Strict(new UnicodeEncoding(true, false, true), raw[2..]);
            return Strict(new UTF8Encoding(false, true), raw);
        }
        catch (DecoderFallbackException)
        {
            throw new SvgRejectedException(SvgReportCodes.RejectedParse, "encoding");
        }
    }

    private static string Strict(Encoding encoding, ReadOnlySpan<byte> bytes) => encoding.GetString(bytes);

    public static SvgElement Parse(string text, SvgReport report)
    {
        var settings = new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Prohibit,
            XmlResolver = null,
            IgnoreComments = true,
            IgnoreProcessingInstructions = true,
            MaxCharactersFromEntities = 0,
            MaxCharactersInDocument = SvgLimits.MaxRawBytes,
            CloseInput = true,
        };
        try
        {
            using var reader = XmlReader.Create(new StringReader(text), settings);
            return Read(reader, report);
        }
        catch (XmlException e)
        {
            // DtdProcessing.Prohibit throws on any DOCTYPE; the text tells it apart from other errors.
            if (text.Contains("<!DOCTYPE", StringComparison.Ordinal)) throw new SvgRejectedException(SvgReportCodes.RejectedDoctype, "DOCTYPE");
            throw new SvgRejectedException(SvgReportCodes.RejectedParse, $"line {e.LineNumber}");
        }
    }

    private static SvgElement Read(XmlReader reader, SvgReport report)
    {
        SvgElement? root = null;
        string? svgNamespace = null;
        var stack = new Stack<SvgElement>();
        var count = 0;
        // After Skip() the reader already stands on the next node.
        var advance = true;
        while (advance ? reader.Read() : !reader.EOF)
        {
            advance = true;
            switch (reader.NodeType)
            {
                case XmlNodeType.Element:
                {
                    if (root == null)
                    {
                        // A root without namespace is accepted as SVG; its descendants then share it.
                        if (reader.LocalName != "svg" || (reader.NamespaceURI != SvgNamespace && reader.NamespaceURI != ""))
                        {
                            throw new SvgRejectedException(SvgReportCodes.RejectedParse, $"root <{reader.Name}>");
                        }
                        svgNamespace = reader.NamespaceURI;
                    }
                    else if (reader.NamespaceURI != svgNamespace)
                    {
                        report.Add(SvgReportCodes.MetadataRemoved, reader.Name);
                        reader.Skip();
                        advance = false;
                        break;
                    }
                    if (++count > SvgLimits.MaxRawElements) throw new SvgRejectedException(SvgReportCodes.RejectedLimit, $"elements > {SvgLimits.MaxRawElements}");
                    var element = new SvgElement(reader.LocalName);
                    var empty = reader.IsEmptyElement;
                    ReadAttributes(reader, element, report);
                    if (root == null) root = element;
                    else stack.Peek().Children.Add(element);
                    if (!empty)
                    {
                        stack.Push(element);
                        if (stack.Count > SvgLimits.MaxRawDepth) throw new SvgRejectedException(SvgReportCodes.RejectedLimit, $"depth > {SvgLimits.MaxRawDepth}");
                    }
                    break;
                }
                case XmlNodeType.EndElement:
                    stack.Pop();
                    break;
                case XmlNodeType.Text or XmlNodeType.CDATA or XmlNodeType.Whitespace or XmlNodeType.SignificantWhitespace:
                    if (stack.Count > 0) AppendText(stack.Peek(), reader.Value);
                    break;
            }
        }
        return root ?? throw new SvgRejectedException(SvgReportCodes.RejectedParse, "no root");
    }

    private static void AppendText(SvgElement parent, string text)
    {
        if (parent.Children.Count > 0 && parent.Children[^1] is SvgTextNode last) last.Text += text;
        else parent.Children.Add(new SvgTextNode(text));
    }

    private static void ReadAttributes(XmlReader reader, SvgElement element, SvgReport report)
    {
        if (!reader.MoveToFirstAttribute()) return;
        do
        {
            var ns = reader.NamespaceURI;
            if (ns == XmlnsNamespace) continue;
            if (ns == "")
            {
                element.Set(reader.LocalName, reader.Value);
            }
            else if (ns == XlinkNamespace && reader.LocalName == "href")
            {
                // SVG 2: a plain href wins over xlink:href.
                if (element.Get("href") == null) element.Set("href", reader.Value);
            }
            else if (ns == XmlNamespace)
            {
                if (reader.LocalName == "base") report.Add(SvgReportCodes.ExternalReference, "xml:base");
                // xml:space and xml:lang carry no rendering information that survives normalization.
            }
            else
            {
                report.Add(SvgReportCodes.MetadataRemoved, reader.Name);
            }
        } while (reader.MoveToNextAttribute());
        reader.MoveToElement();
    }
}
