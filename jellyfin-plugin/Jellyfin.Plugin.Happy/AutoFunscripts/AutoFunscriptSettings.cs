using System;
using System.Globalization;
using Jellyfin.Plugin.Happy.Configuration;

namespace Jellyfin.Plugin.Happy.AutoFunscripts;

/// <summary>
/// Analysis settings of the Auto funscript, repaired from the plugin configuration.
/// </summary>
/// <param name="MinFrequency">Lower edge of the band in Hz.</param>
/// <param name="MaxFrequency">Upper edge of the band in Hz.</param>
/// <param name="MinPower">Band power (0–1 of its loudest moment) below which the position is 0.</param>
/// <param name="FrameMs">Time between two analysed frames in milliseconds.</param>
/// <param name="MinPositionDelta">Smallest position change (0–100) that adds a point.</param>
public sealed record AutoFunscriptSettings(int MinFrequency, int MaxFrequency, double MinPower, int FrameMs, int MinPositionDelta)
{
    /// <summary>
    /// Highest band edge; ffmpeg decodes to at most 48 kHz.
    /// </summary>
    internal const int MaxSupportedFrequency = 20000;

    /// <summary>
    /// Gets the sample rate ffmpeg decodes to: Nyquist clears the band's upper edge with room for the anti-alias filter.
    /// </summary>
    public int SampleRate => Math.Min(48000, Math.Max(8000, (int)Math.Ceiling(MaxFrequency * 2.5 / 1000) * 1000));

    /// <summary>
    /// Gets a stable text of every value that changes the result; part of the cache key.
    /// </summary>
    internal string Fingerprint => string.Create(
        CultureInfo.InvariantCulture,
        $"v1:{MinFrequency}:{MaxFrequency}:{MinPower:R}:{FrameMs}:{MinPositionDelta}");

    /// <summary>
    /// Builds the settings, clamping values the analysis could not use.
    /// </summary>
    /// <param name="config">The plugin configuration.</param>
    /// <returns>The settings.</returns>
    public static AutoFunscriptSettings From(PluginConfiguration config)
    {
        ArgumentNullException.ThrowIfNull(config);
        var min = Math.Clamp(config.AutoFunscriptMinFrequency, 1, MaxSupportedFrequency);
        var max = Math.Clamp(config.AutoFunscriptMaxFrequency, 1, MaxSupportedFrequency);
        return new AutoFunscriptSettings(
            Math.Min(min, max),
            Math.Max(min, max),
            Math.Clamp(config.AutoFunscriptMinPower, 0, 100) / 100.0,
            Math.Clamp(config.AutoFunscriptFrameMs, 10, 1000),
            Math.Clamp(config.AutoFunscriptMinPositionDelta, 0, 100));
    }
}
