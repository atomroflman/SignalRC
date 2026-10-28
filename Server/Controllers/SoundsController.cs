using System.Security.Cryptography;
using SignalRC.Server.Data;
using SignalRC.Server.Services;
using SignalRC.Shared.Audio;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;

namespace SignalRC.Server.Controllers;

// Sound library of a car: files that SoundPlayer control channels play on the vehicle speaker.
// Every change is pushed to the connected Onboard, which keeps a local copy.
[ApiController]
[Route("api/cars/{carId:int}/sounds")]
public class SoundsController : ControllerBase
{
    private static readonly FileExtensionContentTypeProvider ContentTypes = new();

    private readonly CarAudioService _carAudio;
    private readonly ILogger<SoundsController> _logger;

    public SoundsController(SignalRCContext context, CarAudioService carAudio, ILogger<SoundsController> logger) : base(context)
    {
        _carAudio = carAudio;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> List(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var files = await _context.CarSoundFiles.AsNoTracking()
            .Where(f => f.CarId == carId)
            .OrderBy(f => f.FileName)
            .Select(f => new { name = f.FileName, sizeBytes = f.SizeBytes, sha256 = f.Sha256, uploadedAt = f.UploadedAt })
            .ToListAsync();
        return Ok(files);
    }

    [HttpPost]
    [RequestSizeLimit(SoundFileInfo.MaxFileBytes + 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = SoundFileInfo.MaxFileBytes + 1024 * 1024)]
    public async Task<IActionResult> Upload(int carId, IFormFile file)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound("Car not found");
        if (file == null || file.Length == 0) return BadRequest("No file");
        if (file.Length > SoundFileInfo.MaxFileBytes)
            return BadRequest($"File exceeds {SoundFileInfo.MaxFileBytes / 1024 / 1024} MB");

        var name = SanitizeName(file.FileName);
        if (!SoundFileInfo.IsValidName(name))
            return BadRequest($"Unsupported file. Allowed: {string.Join(", ", SoundFileInfo.AllowedExtensions)}");

        byte[] data;
        await using (var stream = file.OpenReadStream())
        using (var buffer = new MemoryStream((int)file.Length))
        {
            await stream.CopyToAsync(buffer);
            data = buffer.ToArray();
        }

        var entity = await _context.CarSoundFiles.FirstOrDefaultAsync(f => f.CarId == carId && f.FileName == name);
        if (entity == null)
        {
            entity = new CarSoundFile { CarId = carId, FileName = name };
            _context.CarSoundFiles.Add(entity);
        }
        entity.Data = data;
        entity.SizeBytes = data.Length;
        entity.Sha256 = Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
        entity.ContentType = ContentTypes.TryGetContentType(name, out var type) ? type : "application/octet-stream";
        entity.UploadedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
        _logger.LogInformation("Sound '{Name}' ({Size} bytes) uploaded for car {CarId} by {User}", name, data.Length, carId, user.LoginName);

        await _carAudio.OnSoundFilesChangedAsync(carId);
        return Ok(new { name, sizeBytes = entity.SizeBytes, sha256 = entity.Sha256, uploadedAt = entity.UploadedAt });
    }

    // Preview in the browser.
    [HttpGet("{name}")]
    public async Task<IActionResult> Download(int carId, string name)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var entity = await _context.CarSoundFiles.AsNoTracking().FirstOrDefaultAsync(f => f.CarId == carId && f.FileName == name);
        if (entity == null) return NotFound();
        return File(entity.Data, entity.ContentType ?? "application/octet-stream", enableRangeProcessing: true);
    }

    [HttpDelete("{name}")]
    public async Task<IActionResult> Delete(int carId, string name)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var deleted = await _context.CarSoundFiles.Where(f => f.CarId == carId && f.FileName == name).ExecuteDeleteAsync();
        if (deleted == 0) return NotFound();
        _logger.LogInformation("Sound '{Name}' deleted for car {CarId} by {User}", name, carId, user.LoginName);
        await _carAudio.OnSoundFilesChangedAsync(carId);
        return NoContent();
    }

    // Keeps letters, digits and a few separators; everything else becomes '_' so names from any
    // OS end up as valid, path-free library names.
    private static string SanitizeName(string fileName)
    {
        var name = Path.GetFileName(fileName.Replace('\\', '/')).Trim();
        var chars = name.Select(c => char.IsAsciiLetterOrDigit(c) || c is ' ' or '.' or '_' or '-' or '(' or ')' ? c : '_').ToArray();
        name = new string(chars).TrimStart('.');
        return name.Length > 100 ? name[^100..] : name;
    }
}
