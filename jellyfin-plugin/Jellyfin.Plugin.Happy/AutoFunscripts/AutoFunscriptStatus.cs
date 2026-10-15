namespace Jellyfin.Plugin.Happy.AutoFunscripts;

/// <summary>
/// Where the Auto funscript of a media file stands.
/// </summary>
public enum AutoFunscriptState
{
    /// <summary>The script is cached.</summary>
    Ready,

    /// <summary>The script is being generated or waits for another file to finish.</summary>
    Pending,

    /// <summary>The file could not be analysed, e.g. because it has no audio.</summary>
    Failed,
}

/// <summary>
/// The state of an Auto funscript and, once ready, the path of its cached file.
/// </summary>
/// <param name="State">The state.</param>
/// <param name="Path">The cached file when <see cref="AutoFunscriptState.Ready"/>.</param>
public sealed record AutoFunscriptStatus(AutoFunscriptState State, string? Path = null)
{
    /// <summary>
    /// Gets the status of a file that cannot be analysed.
    /// </summary>
    public static AutoFunscriptStatus Failed { get; } = new(AutoFunscriptState.Failed);

    /// <summary>
    /// Gets the status of a script still being generated.
    /// </summary>
    public static AutoFunscriptStatus Pending { get; } = new(AutoFunscriptState.Pending);
}
