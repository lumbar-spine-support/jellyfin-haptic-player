using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using Jellyfin.Plugin.Happy.AutoFunscripts;
using Jellyfin.Plugin.Happy.Configuration;
using Xunit;

namespace Jellyfin.Plugin.Happy.Tests;

public class AutoFunscriptTests
{
    private const int SampleRate = 8000;

    private static readonly AutoFunscriptSettings Band = new(20, 200, 0.05, 50, 2);

    [Fact]
    public void SettingsDefaultToTheBassBand()
    {
        var settings = AutoFunscriptSettings.From(new PluginConfiguration());

        Assert.False(new PluginConfiguration().AutoFunscriptEnabled);
        Assert.Equal(new AutoFunscriptSettings(20, 200, 0.05, 50, 2), settings);
        Assert.Equal(8000, settings.SampleRate);
    }

    [Fact]
    public void SettingsRepairInvalidValues()
    {
        var settings = AutoFunscriptSettings.From(new PluginConfiguration
        {
            AutoFunscriptMinFrequency = 500,
            AutoFunscriptMaxFrequency = -3,
            AutoFunscriptMinPower = 250,
            AutoFunscriptFrameMs = 0,
            AutoFunscriptMinPositionDelta = -1,
        });

        Assert.Equal(new AutoFunscriptSettings(1, 500, 1, 10, 0), settings);
    }

    [Theory]
    [InlineData(200, 8000)]
    [InlineData(4000, 10000)]
    [InlineData(20000, 48000)]
    public void SampleRateLeavesRoomAboveTheBand(int maxFrequency, int expected)
        => Assert.Equal(expected, (Band with { MaxFrequency = maxFrequency }).SampleRate);

    [Fact]
    public void FollowsTheLevelOfAToneInsideTheBand()
    {
        // 100 Hz swelling from silence to full level at 2.5 s and back to silence at 5 s, twice.
        var actions = Analyse(Tone(100, 10, Swell), Band);

        Assert.Equal(100, actions.Max(a => a.Pos));
        Assert.InRange(actions.First(a => a.Pos == 100).At, 2200, 2800);
        Assert.Equal(0, PositionAt(actions, 5000));
        Assert.InRange(PositionAt(actions, 6250), 35, 65);
    }

    [Fact]
    public void PositionsBelowTheMinimumPowerAreZero()
    {
        var actions = Analyse(Tone(100, 10, Swell), Band with { MinPower = 0.9, MinPositionDelta = 0 });

        Assert.All(actions, a => Assert.True(a.Pos == 0 || a.Pos >= 90, a.ToString()));
    }

    [Fact]
    public void IgnoresTonesOutsideTheBand()
    {
        var actions = Analyse(Tone(1000, 3, Steady), Band);

        Assert.All(actions, a => Assert.InRange(a.Pos, 0, 5));
    }

    [Fact]
    public void SilenceStaysAtZero()
    {
        var actions = Analyse(new float[SampleRate * 2], Band);

        Assert.NotEmpty(actions);
        Assert.All(actions, a => Assert.Equal(0, a.Pos));
    }

    [Fact]
    public void ChunkingDoesNotChangeTheResult()
    {
        var samples = Tone(80, 2, Swell).Concat(Tone(150, 2, Swell)).ToArray();

        var whole = Analyse(samples, Band);
        var analyzer = new SpectrumAnalyzer(SampleRate, Band);
        for (var offset = 0; offset < samples.Length; offset += 333)
        {
            analyzer.Push(samples.AsSpan(offset, Math.Min(333, samples.Length - offset)));
        }

        Assert.Equal(whole, analyzer.Finish());
    }

    [Fact]
    public void ActionsAreSortedAndThinned()
    {
        var actions = Analyse(Tone(100, 10, Swell), Band);

        Assert.True(actions.Zip(actions.Skip(1)).All(pair => pair.First.At < pair.Second.At));

        // Every turning point stays, but a coarser delta drops most points on the slopes.
        var coarse = Analyse(Tone(100, 10, Swell), Band with { MinPositionDelta = 10 });
        Assert.InRange(coarse.Length, 10, actions.Length / 2);
        Assert.Equal(100, coarse.Max(a => a.Pos));
    }

    [Fact]
    public void ShorterThanOneWindowGivesNoActions()
        => Assert.Empty(Analyse(Tone(100, 0.1, Steady), Band));

    [Fact]
    public void CacheKeyChangesWithFileAndSettings()
    {
        var path = Path.GetTempFileName();
        try
        {
            var id = Guid.NewGuid();
            var key = AutoFunscriptService.CacheKey(id, new FileInfo(path), Band);

            Assert.StartsWith(id.ToString("N") + "-", key, StringComparison.Ordinal);
            Assert.Equal(key, AutoFunscriptService.CacheKey(id, new FileInfo(path), Band));
            Assert.NotEqual(key, AutoFunscriptService.CacheKey(id, new FileInfo(path), Band with { MaxFrequency = 150 }));

            File.WriteAllText(path, "changed");
            Assert.NotEqual(key, AutoFunscriptService.CacheKey(id, new FileInfo(path), Band));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void WritesAFunscript()
    {
        var json = AutoFunscriptService.ToFunscriptJson([new AutoFunscriptAction(128, 0), new AutoFunscriptAction(178, 42)], Band);
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        Assert.Equal("1.0", root.GetProperty("version").GetString());
        Assert.Equal(2, root.GetProperty("actions").GetArrayLength());
        Assert.Equal(178, root.GetProperty("actions")[1].GetProperty("at").GetInt64());
        Assert.Equal(42, root.GetProperty("actions")[1].GetProperty("pos").GetInt32());
        Assert.Contains("20–200 Hz", root.GetProperty("metadata").GetProperty("description").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public void ClientSettingsTellWhetherTheFeatureIsOn()
    {
        Assert.False(ClientSettings.From(new PluginConfiguration()).AutoFunscriptEnabled);
        Assert.True(ClientSettings.From(new PluginConfiguration { AutoFunscriptEnabled = true }).AutoFunscriptEnabled);
    }

    private static AutoFunscriptAction[] Analyse(float[] samples, AutoFunscriptSettings settings)
    {
        var analyzer = new SpectrumAnalyzer(SampleRate, settings);
        analyzer.Push(samples);
        return analyzer.Finish().ToArray();
    }

    /// <summary>
    /// The position a player holding each point until the next one would be at.
    /// </summary>
    private static int PositionAt(AutoFunscriptAction[] actions, long at) => actions.Last(a => a.At <= at).Pos;

    private static double Steady(double t) => 1;

    /// <summary>
    /// Level rising from 0 to 1 and back every 5 seconds. Smooth, because a hard edge is broadband noise.
    /// </summary>
    private static double Swell(double t) => 0.5 - (0.5 * Math.Cos(2 * Math.PI * 0.2 * t));

    private static float[] Tone(double frequency, double seconds, Func<double, double> envelope)
        => Enumerable.Range(0, (int)(SampleRate * seconds))
            .Select(i => (double)i / SampleRate)
            .Select(t => (float)(envelope(t) * Math.Sin(2 * Math.PI * frequency * t)))
            .ToArray();
}
