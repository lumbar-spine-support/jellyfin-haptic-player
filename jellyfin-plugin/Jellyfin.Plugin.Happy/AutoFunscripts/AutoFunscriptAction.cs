using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.Happy.AutoFunscripts;

/// <summary>
/// One point of a generated funscript.
/// </summary>
/// <param name="At">Time in milliseconds.</param>
/// <param name="Pos">Position, 0–100.</param>
public sealed record AutoFunscriptAction(
    [property: JsonPropertyName("at")] long At,
    [property: JsonPropertyName("pos")] int Pos);
