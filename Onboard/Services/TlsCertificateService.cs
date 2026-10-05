using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard;

// ponytail: generates and caches a self-signed TLS certificate in the
// configDir so the Onboard can serve the SSH-key DL endpoint over HTTPS
// without exposing it through the public-internet Server. Browser users
// (Firefox only) accept the cert permanently once; thereafter fetch()
// works because the page (https://...) and the resource (https://...)
// match scheme, so only the untrusted-CA warning blocks, not mixed-content.
//
// LAN-only contract: this cert is bound to the Onboard's current IPv4
// addresses + localhost via Subject Alternative Names. If the vehicle
// changes WiFi (new IP), the cert's SAN no longer matches and the user
// has to re-accept the new fingerprint in Firefox. We deliberately do
// NOT regenerate on every start -- that would invalidate Firefox's
// stored exception on every boot. Manual regeneration only happens when
// the file is missing or the cert is within 30 days of expiry.
public class TlsCertificateService
{
    private readonly ConfigLoader _configLoader;
    private readonly ILogger<TlsCertificateService> _logger;

    public TlsCertificateService(ConfigLoader configLoader, ILogger<TlsCertificateService> logger)
    {
        _configLoader = configLoader;
        _logger = logger;
    }

    private string PfxPath => Path.Combine(_configLoader.ConfigDir, "ssh_tls.pfx");

    public X509Certificate2 GetOrCreateCertificate()
    {
        if (File.Exists(PfxPath))
        {
            try
            {
                var existing = X509CertificateLoader.LoadPkcs12FromFile(PfxPath, "", X509KeyStorageFlags.Exportable);
                if (existing.NotAfter > DateTime.UtcNow.AddDays(30))
                {
                    _logger.LogInformation($"Loaded existing TLS cert from {PfxPath} (expires {existing.NotAfter:yyyy-MM-dd})");
                    return existing;
                }
                _logger.LogInformation($"TLS cert at {PfxPath} is expiring soon, regenerating");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, $"Failed to load TLS cert from {PfxPath}, regenerating");
            }
        }
        return GenerateCertificate();
    }

    private X509Certificate2 GenerateCertificate()
    {
        var sanBuilder = new SubjectAlternativeNameBuilder();
        sanBuilder.AddDnsName("localhost");
        try
        {
            var hostName = Dns.GetHostName();
            if (!string.IsNullOrEmpty(hostName))
                sanBuilder.AddDnsName(hostName);
        }
        catch { }
        foreach (var ip in GetLocalIPv4Addresses())
        {
            sanBuilder.AddIpAddress(ip);
        }

        using var rsa = RSA.Create(2048);
        var req = new CertificateRequest("CN=ltecar-vehicle", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        req.CertificateExtensions.Add(sanBuilder.Build());

        var cert = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(1));
        File.WriteAllBytes(PfxPath, cert.Export(X509ContentType.Pfx, ""));

        var san = string.Join(", ", GetLocalIPv4Addresses().Select(ip => ip.ToString()).Append("localhost"));
        _logger.LogInformation($"Generated self-signed TLS cert at {PfxPath} (expires {cert.NotAfter:yyyy-MM-dd}, SAN: {san})");

        return cert;
    }

    private static IEnumerable<IPAddress> GetLocalIPv4Addresses()
    {
        try
        {
            return Dns.GetHostAddresses(Dns.GetHostName())
                .Where(a => a.AddressFamily == AddressFamily.InterNetwork)
                .ToArray();
        }
        catch
        {
            return Array.Empty<IPAddress>();
        }
    }
}
