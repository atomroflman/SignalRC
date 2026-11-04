using System.Globalization;

namespace SignalRC.Server.Overlay.Expressions;

// Lexer and parser of the overlay expression language
// (Shared/Overlay/expression/README.md §1, §2). Port of the client's parser.ts;
// offsets are UTF-16 code units, i.e. plain C# string indices.

public abstract record Node(int Start);

public sealed record NumberNode(double Value, int Start) : Node(Start);

public sealed record TextNode(string Value, int Start) : Node(Start);

public sealed record BoolNode(bool Value, int Start) : Node(Start);

/// <summary>Op is "-" or "!".</summary>
public sealed record UnaryNode(string Op, Node Operand, int Start) : Node(Start);

/// <summary>Op is one of + - * / &amp;&amp; || == != &lt; &lt;= &gt; &gt;=.</summary>
public sealed record BinaryNode(string Op, Node Left, Node Right, int Start) : Node(Start);

public sealed record CallNode(string Name, IReadOnlyList<Node> Args, int Start) : Node(Start);

public sealed class ExpressionSyntaxException(int offset, string message) : Exception(message)
{
    public int Offset { get; } = offset;
}

public static class Parser
{
    private enum TokenType { Number, Text, Ident, Op, End, Error }

    private sealed record Token(TokenType Type, int Start, double Number = 0, string Value = "");

    // Longest operators first, so "<=" wins over "<".
    private static readonly string[] Operators = ["&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "!", "<", ">", "(", ")", ","];

    private static bool IsDigit(char c) => c is >= '0' and <= '9';
    private static bool IsIdentStart(char c) => c is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or '_';
    private static bool IsIdentPart(char c) => IsIdentStart(c) || IsDigit(c);

    /// <summary>
    /// Tokens up to and including the first lexical error, which becomes an error
    /// token: the parser reports it only if it gets there, so an earlier syntax
    /// error wins (first error in source order).
    /// </summary>
    private static List<Token> Tokenize(string source)
    {
        var tokens = new List<Token>();
        var i = 0;
        while (true)
        {
            while (i < source.Length && source[i] is ' ' or '\t' or '\r' or '\n') i++;
            if (i >= source.Length)
            {
                tokens.Add(new Token(TokenType.End, i));
                return tokens;
            }
            var start = i;
            var c = source[i];
            if (IsDigit(c))
            {
                i = ScanNumber(source, i);
                // Overflowing literals parse to infinity, like JavaScript's Number().
                var value = double.Parse(source.AsSpan(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture);
                if (!double.IsFinite(value))
                {
                    tokens.Add(new Token(TokenType.Error, start, Value: "Zahl ist nicht endlich"));
                    return tokens;
                }
                tokens.Add(new Token(TokenType.Number, start, Number: value));
            }
            else if (c == '"')
            {
                var value = new System.Text.StringBuilder();
                i++;
                while (true)
                {
                    if (i >= source.Length || source[i] is '\n' or '\r')
                    {
                        tokens.Add(new Token(TokenType.Error, start, Value: "Text nicht abgeschlossen"));
                        return tokens;
                    }
                    if (source[i] == '"') break;
                    if (source[i] == '\\')
                    {
                        if (i + 1 >= source.Length || source[i + 1] is not ('"' or '\\'))
                        {
                            tokens.Add(new Token(TokenType.Error, i, Value: "nur \\\" und \\\\ sind erlaubt"));
                            return tokens;
                        }
                        value.Append(source[i + 1]);
                        i += 2;
                    }
                    else
                    {
                        value.Append(source[i++]);
                    }
                }
                i++;
                tokens.Add(new Token(TokenType.Text, start, Value: value.ToString()));
            }
            else if (IsIdentStart(c))
            {
                while (i < source.Length && IsIdentPart(source[i])) i++;
                tokens.Add(new Token(TokenType.Ident, start, Value: source[start..i]));
            }
            else
            {
                var op = Operators.FirstOrDefault(o => source.AsSpan(i).StartsWith(o, StringComparison.Ordinal));
                if (op == null)
                {
                    tokens.Add(new Token(TokenType.Error, start, Value: $"unerwartetes Zeichen {c}"));
                    return tokens;
                }
                tokens.Add(new Token(TokenType.Op, start, Value: op));
                i += op.Length;
            }
        }
    }

    /// <summary>End of <c>[0-9]+ ("." [0-9]+)? ([eE] [+-]? [0-9]+)?</c> starting at a digit.</summary>
    private static int ScanNumber(string s, int i)
    {
        while (i < s.Length && IsDigit(s[i])) i++;
        if (i + 1 < s.Length && s[i] == '.' && IsDigit(s[i + 1]))
        {
            i += 2;
            while (i < s.Length && IsDigit(s[i])) i++;
        }
        if (i < s.Length && s[i] is 'e' or 'E')
        {
            var j = i + 1;
            if (j < s.Length && s[j] is '+' or '-') j++;
            if (j < s.Length && IsDigit(s[j]))
            {
                while (j < s.Length && IsDigit(s[j])) j++;
                i = j;
            }
        }
        return i;
    }

    private sealed class State(List<Token> tokens)
    {
        private int _index;

        private Token Peek()
        {
            var token = tokens[_index];
            if (token.Type == TokenType.Error) throw new ExpressionSyntaxException(token.Start, token.Value);
            return token;
        }

        private Token Next()
        {
            var token = Peek();
            _index++;
            return token;
        }

        private bool IsOp(params string[] ops)
        {
            var token = Peek();
            return token.Type == TokenType.Op && ops.Contains(token.Value);
        }

        private ExpressionSyntaxException Fail(string message) => new(Peek().Start, message);

        private void ExpectOp(string op)
        {
            if (!IsOp(op)) throw Fail($"{op} erwartet");
            _index++;
        }

        public Node Parse()
        {
            var node = Or();
            if (Peek().Type != TokenType.End) throw Fail("unerwartetes Zeichen");
            return node;
        }

        private Node Chain(Func<Node> next, string[] ops)
        {
            var left = next();
            while (IsOp(ops))
            {
                var op = Next();
                left = new BinaryNode(op.Value, left, next(), left.Start);
            }
            return left;
        }

        private Node Or() => Chain(And, ["||"]);
        private Node And() => Chain(Equality, ["&&"]);

        /// <summary>Non-associative level: a second operator of the same level is a syntax error.</summary>
        private Node Single(Func<Node> next, string[] ops)
        {
            var left = next();
            if (!IsOp(ops)) return left;
            var op = Next();
            var node = new BinaryNode(op.Value, left, next(), left.Start);
            if (IsOp(ops)) throw Fail("Vergleiche lassen sich nicht verketten");
            return node;
        }

        private Node Equality() => Single(Comparison, ["==", "!="]);
        private Node Comparison() => Single(Additive, ["<", "<=", ">", ">="]);
        private Node Additive() => Chain(Multiplicative, ["+", "-"]);
        private Node Multiplicative() => Chain(Unary, ["*", "/"]);

        private Node Unary()
        {
            if (IsOp("-", "!"))
            {
                var op = Next();
                return new UnaryNode(op.Value, Unary(), op.Start);
            }
            return Primary();
        }

        private Node Primary()
        {
            var token = Peek();
            switch (token.Type)
            {
                case TokenType.Number:
                    _index++;
                    return new NumberNode(token.Number, token.Start);
                case TokenType.Text:
                    _index++;
                    return new TextNode(token.Value, token.Start);
                case TokenType.Ident:
                {
                    _index++;
                    if (token.Value is "true" or "false") return new BoolNode(token.Value == "true", token.Start);
                    // Look at the raw next token: a lexical error after the identifier is
                    // later in the source and must not hide this one.
                    var next = tokens[_index];
                    if (next.Type != TokenType.Op || next.Value != "(") throw new ExpressionSyntaxException(token.Start, $"{token.Value} ist keine Funktion");
                    _index++;
                    var args = new List<Node>();
                    if (!IsOp(")"))
                    {
                        args.Add(Or());
                        while (IsOp(","))
                        {
                            _index++;
                            args.Add(Or());
                        }
                    }
                    ExpectOp(")");
                    return new CallNode(token.Value, args, token.Start);
                }
                case TokenType.Op when token.Value == "(":
                {
                    _index++;
                    var inner = Or();
                    ExpectOp(")");
                    return inner;
                }
                default:
                    throw Fail("Ausdruck erwartet");
            }
        }
    }

    /// <exception cref="ExpressionSyntaxException">At the first syntax error in source order.</exception>
    public static Node Parse(string source) => new State(Tokenize(source)).Parse();

    /// <summary>AST depth: every operator and call level counts, a literal is 1; parentheses add nothing.</summary>
    public static int Depth(Node node) => node switch
    {
        UnaryNode u => 1 + Depth(u.Operand),
        BinaryNode b => 1 + Math.Max(Depth(b.Left), Depth(b.Right)),
        CallNode c => 1 + c.Args.Select(Depth).DefaultIfEmpty(0).Max(),
        _ => 1,
    };
}
