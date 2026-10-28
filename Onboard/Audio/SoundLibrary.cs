using System.Collections.Concurrent;
using System.Security.Cryptography;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Audio;

namespace SignalRC.Onboard.Audio;

/// <summary>
/// Local copy of the car's sound library. The server pushes the list (<see cref="Sync"/>); missing or
/// changed files are downloaded in chunks over the hub connection, files no longer listed are deleted.
/// Short clips are decoded once and kept in memory so a horn starts without ffmpeg start-up delay;
/// longer files are streamed through ffmpeg when played.
/// </summary>
public sealed class SoundLibrary
{
    // Clips up to this length (per playback range) are cached decoded: 30 s ≈ 5.8 MB.
    private const int MaxCachedValues = AudioFormat.SampleRate * AudioFormat.OutputChannels * 30;

    private readonly ILogger<SoundLibrary> _logger;
    private readonly ServerConnectionService _serverConnection;
    private readonly string _directory;
    private readonly SemaphoreSlim _syncLock = new(1, 1);
    private readonly ConcurrentDictionary<string, short[]> _clips = new();
    private readonly ConcurrentDictionary<string, byte> _uncacheable = new();
    private readonly ConcurrentDictionary<string, Task> _warming = new();
    // path → (length, mtime, sha) so unchanged files aren't hashed on every sync.
    private readonly ConcurrentDictionary<string, (long Length, DateTime Modified, string Sha)> _hashes = new();

    public SoundLibrary(ILogger<SoundLibrary> logger, ServerConnectionService serverConnection, ConfigLoader configLoader)
    {
        _logger = logger;
        _serverConnection = serverConnection;
        _directory = Path.Combine(configLoader.ConfigDir, "sounds");
    }

    /// <summary>Full path of a library file that exists locally, or null.</summary>
    public string? GetPath(string? name)
    {
        if (!SoundFileInfo.IsValidName(name))
            return null;
        var path = Path.Combine(_directory, name!);
        return File.Exists(path) ? path : null;
    }

    /// <summary>Brings the local copy in line with the server's list, in the background.</summary>
    public void Sync(SoundFileInfo[] files) => _ = Task.Run(() => SyncAsync(files));

    private async Task SyncAsync(SoundFileInfo[] files)
    {
        await _syncLock.WaitAsync();
        try
        {
            Directory.CreateDirectory(_directory);
            var wanted = files.Where(f => SoundFileInfo.IsValidName(f.Name)).ToDictionary(f => f.Name);
            var downloaded = 0;
            foreach (var file in wanted.Values)
            {
                var path = Path.Combine(_directory, file.Name);
                if (File.Exists(path) && string.Equals(HashOf(path), file.Sha256, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (await DownloadAsync(file, path))
                {
                    downloaded++;
                    Forget(file.Name);
                }
            }

            var removed = 0;
            foreach (var path in Directory.GetFiles(_directory))
            {
                var name = Path.GetFileName(path);
                if (wanted.ContainsKey(name))
                    continue;
                File.Delete(path);
                _hashes.TryRemove(path, out _);
                Forget(name);
                removed++;
            }
            _logger.LogInformation("Sound library synced: {Count} files, {Downloaded} downloaded, {Removed} removed.", wanted.Count, downloaded, removed);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Sound library sync failed.");
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task<bool> DownloadAsync(SoundFileInfo file, string path)
    {
        var partPath = path + ".part";
        try
        {
            var server = _serverConnection.GetProxy();
            await using (var output = File.Create(partPath))
            {
                for (long offset = 0; offset < file.SizeBytes;)
                {
                    var chunk = await server.GetSoundFileChunk(file.Name, offset, SoundFileInfo.MaxChunkBytes);
                    if (chunk == null || chunk.Length == 0)
                        throw new IOException($"server returned no data at offset {offset}");
                    await output.WriteAsync(chunk);
                    offset += chunk.Length;
                }
            }
            var sha = HashOf(partPath);
            if (!string.Equals(sha, file.Sha256, StringComparison.OrdinalIgnoreCase))
                throw new IOException($"hash mismatch (expected {file.Sha256}, got {sha})");
            File.Move(partPath, path, overwrite: true);
            _hashes.TryRemove(partPath, out _);
            _logger.LogInformation("Downloaded sound '{Name}' ({Size} bytes).", file.Name, file.SizeBytes);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Downloading sound '{Name}' failed: {Message}", file.Name, ex.Message);
            try
            {
                File.Delete(partPath);
            }
            catch
            {
                // nothing to clean up
            }
            return false;
        }
    }

    private string HashOf(string path)
    {
        var info = new FileInfo(path);
        if (_hashes.TryGetValue(path, out var known) && known.Length == info.Length && known.Modified == info.LastWriteTimeUtc)
            return known.Sha;
        using var stream = File.OpenRead(path);
        var sha = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        _hashes[path] = (info.Length, info.LastWriteTimeUtc, sha);
        return sha;
    }

    // -- playback ---------------------------------------------------------------------

    /// <summary>
    /// A reader for <paramref name="name"/> between <paramref name="startSeconds"/> and
    /// <paramref name="endSeconds"/> (0 = to the end): from memory when cached, else streamed (and the
    /// clip is cached in the background for next time). Null if the file isn't available locally.
    /// </summary>
    public ISoundReader? OpenReader(string name, double startSeconds, double endSeconds)
    {
        var path = GetPath(name);
        if (path == null)
            return null;
        var key = ClipKey(name, startSeconds, endSeconds);
        if (_clips.TryGetValue(key, out var samples))
            return new MemorySoundReader(samples);
        WarmUp(name, startSeconds, endSeconds);
        return new StreamingSoundReader(DecoderArgs(path, startSeconds, endSeconds), _logger);
    }

    /// <summary>Decodes a short clip into memory in the background (no-op if cached or too long).</summary>
    public void WarmUp(string name, double startSeconds, double endSeconds)
    {
        var path = GetPath(name);
        var key = ClipKey(name, startSeconds, endSeconds);
        if (path == null || _clips.ContainsKey(key) || _uncacheable.ContainsKey(key))
            return;
        _warming.GetOrAdd(key, k => Task.Run(() =>
        {
            try
            {
                var samples = DecodeToMemory(DecoderArgs(path, startSeconds, endSeconds));
                if (samples != null)
                    _clips[key] = samples;
                else
                    _uncacheable[key] = 0;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Decoding sound '{Name}' failed: {Message}", name, ex.Message);
                _uncacheable[key] = 0;
            }
            finally
            {
                _warming.TryRemove(key, out _);
            }
        }));
    }

    private short[]? DecodeToMemory(string args)
    {
        var process = AudioProcess.Start("ffmpeg", args, redirectInput: false, _logger, "sound decode");
        try
        {
            using var buffer = new MemoryStream();
            var chunk = new byte[64 * 1024];
            var output = process.StandardOutput.BaseStream;
            int read;
            while ((read = output.Read(chunk)) > 0)
            {
                if ((buffer.Length + read) / sizeof(short) > MaxCachedValues)
                    return null; // too long to keep in memory; it gets streamed
                buffer.Write(chunk, 0, read);
            }
            process.WaitForExit();
            if (process.ExitCode != 0)
                throw new IOException($"ffmpeg exited with {process.ExitCode}");
            var bytes = buffer.GetBuffer().AsSpan(0, (int)buffer.Length - (int)buffer.Length % (sizeof(short) * AudioFormat.OutputChannels));
            return System.Runtime.InteropServices.MemoryMarshal.Cast<byte, short>(bytes).ToArray();
        }
        finally
        {
            AudioProcess.Kill(process, _logger, "sound decode");
        }
    }

    private static string DecoderArgs(string path, double startSeconds, double endSeconds)
    {
        var seek = startSeconds > 0 ? FormattableString.Invariant($"-ss {startSeconds:0.###} ") : "";
        var duration = endSeconds > startSeconds ? FormattableString.Invariant($"-t {endSeconds - startSeconds:0.###} ") : "";
        return $"-hide_banner -loglevel error -nostdin {seek}-i \"{path}\" {duration}-vn " +
               $"-f s16le -ar {AudioFormat.SampleRate} -ac {AudioFormat.OutputChannels} pipe:1";
    }

    private static string ClipKey(string name, double start, double end) =>
        FormattableString.Invariant($"{name}|{start:0.###}|{end:0.###}");

    private void Forget(string name)
    {
        foreach (var key in _clips.Keys.Where(k => k.StartsWith(name + "|", StringComparison.Ordinal)))
            _clips.TryRemove(key, out _);
        foreach (var key in _uncacheable.Keys.Where(k => k.StartsWith(name + "|", StringComparison.Ordinal)))
            _uncacheable.TryRemove(key, out _);
    }
}
