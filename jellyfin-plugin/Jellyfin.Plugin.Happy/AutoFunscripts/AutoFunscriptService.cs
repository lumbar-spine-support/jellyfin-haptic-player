using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.MediaEncoding;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Happy.AutoFunscripts;

/// <summary>
/// Generates and caches the Auto funscript of media files from their audio.
/// </summary>
/// <remarks>
/// Jellyfin's own ffmpeg decodes the first audio stream to mono float PCM at
/// <see cref="AutoFunscriptSettings.SampleRate"/>, which <see cref="SpectrumAnalyzer"/> turns into actions.
/// Results live in <c>&lt;cache&gt;/happy/auto-funscripts/&lt;item id&gt;-&lt;hash&gt;.funscript</c>; the hash
/// covers the media path, size and modification time and the analysis settings, so a changed file or
/// setting generates a new script and replaces the old one. One file is analysed at a time; requests
/// meanwhile get <see cref="AutoFunscriptState.Pending"/>. Failures (e.g. a video without audio) are
/// remembered until Jellyfin restarts, so clients polling a broken file do not restart ffmpeg.
/// </remarks>
public sealed class AutoFunscriptService : IDisposable
{
    private const string Extension = ".funscript";

    private static readonly JsonSerializerOptions JsonOptions = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    private readonly IMediaEncoder _mediaEncoder;
    private readonly ILogger<AutoFunscriptService> _logger;
    private readonly string _cacheDir;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Lock _startLock = new();
    private readonly Dictionary<string, Task> _running = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, bool> _failed = new(StringComparer.Ordinal);

    /// <summary>
    /// Initializes a new instance of the <see cref="AutoFunscriptService"/> class.
    /// </summary>
    /// <param name="mediaEncoder">Instance of the <see cref="IMediaEncoder"/> interface, for the ffmpeg path.</param>
    /// <param name="applicationPaths">Instance of the <see cref="IApplicationPaths"/> interface, for the cache directory.</param>
    /// <param name="logger">Instance of the <see cref="ILogger{AutoFunscriptService}"/> interface.</param>
    public AutoFunscriptService(IMediaEncoder mediaEncoder, IApplicationPaths applicationPaths, ILogger<AutoFunscriptService> logger)
    {
        ArgumentNullException.ThrowIfNull(applicationPaths);
        _mediaEncoder = mediaEncoder;
        _logger = logger;
        _cacheDir = Path.Combine(applicationPaths.CachePath, "happy", "auto-funscripts");
    }

    /// <summary>
    /// Gets the cached Auto funscript of a media file, starting its generation when there is none.
    /// </summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="mediaPath">Path of the media file.</param>
    /// <param name="settings">The analysis settings.</param>
    /// <returns>The state, with the script's path once it is ready.</returns>
    public AutoFunscriptStatus Get(Guid itemId, string mediaPath, AutoFunscriptSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var media = new FileInfo(mediaPath);
        if (!media.Exists)
        {
            return AutoFunscriptStatus.Failed;
        }

        var key = CacheKey(itemId, media, settings);
        var path = Path.Combine(_cacheDir, key + Extension);
        if (File.Exists(path))
        {
            return new AutoFunscriptStatus(AutoFunscriptState.Ready, path);
        }

        if (_failed.ContainsKey(key))
        {
            return AutoFunscriptStatus.Failed;
        }

        lock (_startLock)
        {
            if (!_running.ContainsKey(key))
            {
                _running[key] = Task.Run(() => GenerateAsync(itemId, mediaPath, settings, key, path));
            }
        }

        return AutoFunscriptStatus.Pending;
    }

    /// <inheritdoc />
    public void Dispose() => _gate.Dispose();

    /// <summary>
    /// Builds the cache file name of a media file: its item id and a hash of everything that changes the script.
    /// </summary>
    /// <param name="itemId">The item id.</param>
    /// <param name="media">The media file.</param>
    /// <param name="settings">The analysis settings.</param>
    /// <returns>The cache key.</returns>
    internal static string CacheKey(Guid itemId, FileInfo media, AutoFunscriptSettings settings)
    {
        var source = string.Create(
            CultureInfo.InvariantCulture,
            $"{media.FullName}|{media.Length}|{media.LastWriteTimeUtc.Ticks}|{settings.Fingerprint}");
        var hash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(source)))[..16];
        return itemId.ToString("N", CultureInfo.InvariantCulture) + "-" + hash;
    }

    /// <summary>
    /// Serializes generated actions as a funscript.
    /// </summary>
    /// <param name="actions">The actions.</param>
    /// <param name="settings">The settings they were generated with.</param>
    /// <returns>The funscript JSON.</returns>
    internal static string ToFunscriptJson(IReadOnlyList<AutoFunscriptAction> actions, AutoFunscriptSettings settings)
        => JsonSerializer.Serialize(
            new GeneratedFunscript(
                "1.0",
                false,
                100,
                new GeneratedMetadata(
                    "HAPPY",
                    string.Create(CultureInfo.InvariantCulture, $"Generated from the {settings.MinFrequency}–{settings.MaxFrequency} Hz band of the audio")),
                actions),
            JsonOptions);

    private async Task GenerateAsync(Guid itemId, string mediaPath, AutoFunscriptSettings settings, string key, string path)
    {
        await _gate.WaitAsync().ConfigureAwait(false);
        try
        {
            var started = Stopwatch.GetTimestamp();
            var actions = await AnalyseAsync(mediaPath, settings).ConfigureAwait(false);
            Directory.CreateDirectory(_cacheDir);

            // Write next to the target and move, so a reader never sees half a file.
            var temp = path + ".tmp";
            await File.WriteAllTextAsync(temp, ToFunscriptJson(actions, settings)).ConfigureAwait(false);
            File.Move(temp, path, true);
            RemoveOutdated(itemId, path);
            _logger.LogInformation(
                "Generated the Auto funscript of {Path} ({ActionCount} actions, {ElapsedMs} ms)",
                mediaPath,
                actions.Count,
                (long)Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
#pragma warning disable CA1031 // A failure of one file must not escape the background task; it is logged and remembered.
        catch (Exception ex)
#pragma warning restore CA1031
        {
            _failed[key] = true;
            if (ex is NoAudioException)
            {
                _logger.LogInformation("{Path} has no audio, so it gets no Auto funscript", mediaPath);
            }
            else
            {
                _logger.LogWarning(ex, "Could not generate the Auto funscript of {Path}", mediaPath);
            }
        }
        finally
        {
            _gate.Release();
            lock (_startLock)
            {
                _running.Remove(key);
            }
        }
    }

    private async Task<IReadOnlyList<AutoFunscriptAction>> AnalyseAsync(string mediaPath, AutoFunscriptSettings settings)
    {
        var sampleRate = settings.SampleRate;
        var analyzer = new SpectrumAnalyzer(sampleRate, settings);
        var startInfo = new ProcessStartInfo(_mediaEncoder.EncoderPath)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var arg in new[]
        {
            "-v", "error", "-nostdin", "-i", mediaPath, "-map", "0:a:0", "-vn", "-sn", "-dn",
            "-ac", "1", "-ar", sampleRate.ToString(CultureInfo.InvariantCulture), "-f", "f32le", "pipe:1",
        })
        {
            startInfo.ArgumentList.Add(arg);
        }

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException("ffmpeg did not start");
        var stderr = process.StandardError.ReadToEndAsync();
        try
        {
            var stdout = process.StandardOutput.BaseStream;
            var buffer = new byte[1 << 16];
            var filled = 0;
            int read;
            while ((read = await stdout.ReadAsync(buffer.AsMemory(filled)).ConfigureAwait(false)) > 0)
            {
                filled += read;
                var usable = filled - (filled % sizeof(float));
                analyzer.Push(MemoryMarshal.Cast<byte, float>(buffer.AsSpan(0, usable)));
                buffer.AsSpan(usable, filled - usable).CopyTo(buffer);
                filled -= usable;
            }

            await process.WaitForExitAsync().ConfigureAwait(false);
        }
        catch
        {
            process.Kill(true);
            throw;
        }

        if (process.ExitCode != 0)
        {
            var error = (await stderr.ConfigureAwait(false)).Trim();

            // "-map 0:a:0" finds nothing in a file without an audio stream.
            if (error.Contains("matches no streams", StringComparison.Ordinal))
            {
                throw new NoAudioException();
            }

            throw new InvalidOperationException(string.Create(
                CultureInfo.InvariantCulture,
                $"ffmpeg exited with code {process.ExitCode}: {(error.Length > 500 ? error[..500] : error)}"));
        }

        return analyzer.Finish();
    }

    /// <summary>
    /// Drops scripts of the same item generated from an older file or other settings.
    /// </summary>
    private void RemoveOutdated(Guid itemId, string current)
    {
        var prefix = itemId.ToString("N", CultureInfo.InvariantCulture) + "-";
        foreach (var file in Directory.EnumerateFiles(_cacheDir, prefix + "*" + Extension))
        {
            if (!string.Equals(file, current, StringComparison.Ordinal))
            {
                File.Delete(file);
            }
        }
    }

    /// <summary>
    /// The media file has no audio stream to analyse.
    /// </summary>
#pragma warning disable CA1032, CA1064 // Private and never thrown out of this class.
    private sealed class NoAudioException : Exception;
#pragma warning restore CA1032, CA1064

    private sealed record GeneratedFunscript(
        [property: JsonPropertyName("version")] string Version,
        [property: JsonPropertyName("inverted")] bool Inverted,
        [property: JsonPropertyName("range")] int Range,
        [property: JsonPropertyName("metadata")] GeneratedMetadata Metadata,
        [property: JsonPropertyName("actions")] IReadOnlyList<AutoFunscriptAction> Actions);

    private sealed record GeneratedMetadata(
        [property: JsonPropertyName("creator")] string Creator,
        [property: JsonPropertyName("description")] string Description);
}
