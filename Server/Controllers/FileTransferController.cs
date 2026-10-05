using System.Security.Cryptography;
using LteCar.Server.Configuration;
using LteCar.Server.Data;
using LteCar.Server.Hubs;
using LteCar.Shared;
using LteCar.Shared.FileTransfer;
using LteCar.Shared.HubClients;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace LteCar.Server.Controllers;

[ApiController]
[Route("api/filetransfer")]
public class FileTransferController : ControllerBase
{
    private readonly IHubContext<CarConnectionHub, IConnectionHubClient> _controlHub;
    private readonly IConfigurationService _config;
    private readonly ILogger<FileTransferController> _logger;

    public FileTransferController(
        LteCarContext context,
        IHubContext<CarConnectionHub, IConnectionHubClient> controlHub,
        IConfigurationService config,
        ILogger<FileTransferController> logger) : base(context)
    {
        _controlHub = controlHub;
        _config = config;
        _logger = logger;
    }

    private async Task<FileTransfer?> GetTransferByToken(string token)
    {
        return await _context.FileTransfers.FirstOrDefaultAsync(f => f.DownloadToken == token);
    }

    [HttpPost("{token}")]
    [RequestSizeLimit(1024 * 1024 * 1024)]
    public async Task<IActionResult> Upload(string token, IFormFile file)
    {
        var transfer = await GetTransferByToken(token);
        if (transfer == null)
            return NotFound();

        if (transfer.Status != FileTransferStatus.Uploading)
            return BadRequest($"Transfer is in status '{transfer.Status}', upload not accepted");

        var maxBytes = (long)_config.FileTransfer.MaxFileSizeMB * 1024 * 1024;
        if (file.Length > maxBytes)
            return BadRequest($"File exceeds maximum size of {_config.FileTransfer.MaxFileSizeMB} MB");

        var storagePath = Path.GetFullPath(_config.FileTransfer.StoragePath);
        Directory.CreateDirectory(storagePath);

        var diskFileName = $"{transfer.DownloadToken}{Path.GetExtension(transfer.FileName)}";
        var fullPath = Path.Combine(storagePath, diskFileName);
        transfer.StoragePath = fullPath;
        transfer.ContentType = file.ContentType;
        transfer.FileSizeBytes = file.Length;

        string hash;
        try
        {
            using var sha256 = SHA256.Create();
            await using var target = new FileStream(fullPath, FileMode.Create, FileAccess.Write, FileShare.None);
            await using var hashStream = new CryptoStream(target, sha256, CryptoStreamMode.Write);
            await file.CopyToAsync(hashStream);
            await hashStream.FlushFinalBlockAsync();
            hash = Convert.ToHexString(sha256.Hash!);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to write file for transfer {Token}", token);
            transfer.Status = FileTransferStatus.Failed;
            await _context.SaveChangesAsync();
            return StatusCode(500, "File upload failed");
        }

        transfer.Sha256Hash = hash;
        transfer.Status = FileTransferStatus.Ready;
        await _context.SaveChangesAsync();

        _logger.LogInformation("Transfer {Token}: file stored ({Size} bytes, SHA256 {Hash}), notifying car {CarId}",
            token, transfer.FileSizeBytes, hash, transfer.CarId);

        await _controlHub.Clients.Group($"Car-{transfer.CarId}").FileReady(new FileReadyNotification
        {
            Token = transfer.DownloadToken,
            FileName = transfer.FileName,
            FileSizeBytes = transfer.FileSizeBytes,
            Sha256Hash = hash
        });

        return Ok(new { sha256Hash = hash });
    }

    [HttpGet("{token}/download")]
    public async Task<IActionResult> Download(string token, [FromQuery] int? maxKBytesPerSecond = null)
    {
        var transfer = await GetTransferByToken(token);
        if (transfer == null)
            return NotFound();

        if (transfer.Status != FileTransferStatus.Ready && transfer.Status != FileTransferStatus.Downloading)
            return BadRequest($"Transfer is in status '{transfer.Status}', download not available");

        if (!System.IO.File.Exists(transfer.StoragePath))
        {
            _logger.LogError("Storage file missing for transfer {Token}: {Path}", token, transfer.StoragePath);
            return StatusCode(500, "File not found on server");
        }

        if (transfer.Status == FileTransferStatus.Ready)
        {
            transfer.Status = FileTransferStatus.Downloading;
            await _context.SaveChangesAsync();
        }

        var fileLength = new FileInfo(transfer.StoragePath).Length;
        long rangeStart = 0;
        long rangeEnd = fileLength - 1;

        if (Request.Headers.ContainsKey(HeaderNames.Range))
        {
            var rangeHeader = Request.GetTypedHeaders().Range;
            if (rangeHeader?.Ranges.Count == 1)
            {
                var range = rangeHeader.Ranges.First();
                rangeStart = range.From ?? 0;
                rangeEnd = range.To ?? fileLength - 1;

                if (rangeStart >= fileLength || rangeEnd >= fileLength || rangeStart > rangeEnd)
                    return StatusCode(416);
            }
        }

        var contentLength = rangeEnd - rangeStart + 1;
        var isPartial = rangeStart > 0 || rangeEnd < fileLength - 1;

        Response.Headers[HeaderNames.AcceptRanges] = "bytes";
        Response.Headers[HeaderNames.ContentLength] = contentLength.ToString();
        Response.ContentType = transfer.ContentType ?? "application/octet-stream";
        Response.Headers["X-FileTransfer-Hash"] = transfer.Sha256Hash;

        if (isPartial)
        {
            Response.StatusCode = 206;
            Response.Headers[HeaderNames.ContentRange] = $"bytes {rangeStart}-{rangeEnd}/{fileLength}";
        }

        var serverMax = _config.FileTransfer.ThrottleKBytesPerSecond;
        var effectiveRate = maxKBytesPerSecond.HasValue && maxKBytesPerSecond.Value > 0
            ? Math.Min(maxKBytesPerSecond.Value, serverMax)
            : serverMax;
        var throttleBytesPerSecond = effectiveRate * 1024;
        const int chunkSize = 4096;
        var intervalMs = (int)((double)chunkSize / throttleBytesPerSecond * 1000);
        if (intervalMs < 1) intervalMs = 1;

        await using var fs = new FileStream(transfer.StoragePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        fs.Seek(rangeStart, SeekOrigin.Begin);

        var buffer = new byte[chunkSize];
        var remaining = contentLength;

        while (remaining > 0)
        {
            var toRead = (int)Math.Min(buffer.Length, remaining);
            var bytesRead = await fs.ReadAsync(buffer.AsMemory(0, toRead), HttpContext.RequestAborted);
            if (bytesRead == 0)
                break;

            await Response.Body.WriteAsync(buffer.AsMemory(0, bytesRead), HttpContext.RequestAborted);
            await Response.Body.FlushAsync(HttpContext.RequestAborted);
            remaining -= bytesRead;

            if (remaining > 0)
                await Task.Delay(intervalMs, HttpContext.RequestAborted);
        }

        return new EmptyResult();
    }
}
