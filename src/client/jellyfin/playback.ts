import type { TrackInfo } from '../../shared/types';
import type { JellyfinApi } from './library';
import { streamUrl, type JellyfinEndpoint } from './urls';

/** One stream of a media source, as `POST /Items/{id}/PlaybackInfo` describes it. */
export interface JellyfinMediaStreamDto {
    Type?: string | null;
    Codec?: string | null;
    Profile?: string | null;
    Width?: number | null;
    Height?: number | null;
    BitRate?: number | null;
    Channels?: number | null;
    Language?: string | null;
    VideoRangeType?: string | null;
    IsDefault?: boolean | null;
    IsTextSubtitleStream?: boolean | null;
    /** Jellyfin's label, e.g. `English - Dolby TrueHD 5.1 - Default`; what its own player lists. */
    DisplayTitle?: string | null;
    Index?: number | null;
}

export interface JellyfinMediaSourceDto {
    Id?: string | null;
    Container?: string | null;
    Bitrate?: number | null;
    SupportsDirectPlay?: boolean | null;
    TranscodingUrl?: string | null;
    TranscodingSubProtocol?: string | null;
    MediaStreams?: JellyfinMediaStreamDto[] | null;
    DefaultAudioStreamIndex?: number | null;
    DefaultSubtitleStreamIndex?: number | null;
}

export interface JellyfinPlaybackInfoDto {
    MediaSources?: JellyfinMediaSourceDto[] | null;
    PlaySessionId?: string | null;
    ErrorCode?: string | null;
}

/** `Session.TranscodingInfo`: what Jellyfin's ffmpeg is doing right now for this device. */
export interface JellyfinTranscodingInfoDto {
    AudioCodec?: string | null;
    VideoCodec?: string | null;
    Container?: string | null;
    IsVideoDirect?: boolean | null;
    IsAudioDirect?: boolean | null;
    Bitrate?: number | null;
    Framerate?: number | null;
    CompletionPercentage?: number | null;
    Width?: number | null;
    Height?: number | null;
    AudioChannels?: number | null;
    HardwareAccelerationType?: string | null;
    TranscodeReasons?: string[] | null;
}

/** A stream of the source file, reduced to what the playback info overlay shows. */
export interface StreamDetails {
    codec: string;
    profile: string | null;
    width: number | null;
    height: number | null;
    bitrate: number | null;
    channels: number | null;
    language: string | null;
    range: string | null;
}

/** An audio or subtitle stream the user can pick, labelled as Jellyfin's own player lists it. */
export interface TrackOption {
    /** Jellyfin's stream index, passed back as `AudioStreamIndex` / `SubtitleStreamIndex`. */
    index: number;
    label: string;
    /** Subtitles only: text (sent as WebVTT) rather than images (burnt in by a transcode). */
    isText: boolean;
}

/** How a video reaches the browser, and why. */
export interface StreamInfo {
    /** `direct`: the original file (`static=true`). `transcode`: Jellyfin's HLS, remuxed and/or re-encoded by ffmpeg. */
    method: 'direct' | 'transcode';
    container: string;
    bitrate: number | null;
    video: StreamDetails | null;
    /** The audio stream that plays. */
    audio: StreamDetails | null;
    /** Jellyfin's `TranscodeReasons`, e.g. `AudioCodecNotSupported`; empty for direct play. */
    reasons: string[];
    /** Identifies the transcode on the server; null for direct play. */
    playSessionId: string | null;
    /** Needed for subtitle URLs; equals the item id for single-version items. */
    mediaSourceId: string;
    audioTracks: TrackOption[];
    subtitleTracks: TrackOption[];
    /** The audio stream that plays; null when the file has none. */
    audioIndex: number | null;
    /** The audio stream Jellyfin picks by default (the user's language preference, else the flagged default). */
    defaultAudioIndex: number | null;
    /** Jellyfin's default subtitle (forced, or by the user's preference); -1 for none. */
    defaultSubtitleIndex: number;
}

/** Where to load a video from. */
export interface PlaybackSource {
    url: string;
    /** The URL is an HLS playlist (needs hls.js or native HLS). */
    hls: boolean;
    info: StreamInfo;
}

/** What to ask Jellyfin for besides its defaults. */
export interface PlaybackOptions {
    /** Audio stream to play; Jellyfin's default when absent. */
    audioStreamIndex?: number;
    /** An image subtitle to burn in; text subtitles never need this. */
    burnSubtitleIndex?: number;
    /** False forces Jellyfin's stream (HLS), e.g. for an audio stream other than the file's default. */
    allowDirectPlay?: boolean;
    /** False re-encodes the video too, for streams the browser fails on despite the profile. */
    allowVideoCopy?: boolean;
}

/** Upper bound Jellyfin may stream at: LAN-sized, like Jellyfin's own web client. */
const MAX_STREAMING_BITRATE = 120_000_000;

function details(stream: JellyfinMediaStreamDto | undefined): StreamDetails | null {
    if (!stream?.Codec) return null;
    return {
        codec: stream.Codec,
        profile: stream.Profile ?? null,
        width: stream.Width ?? null,
        height: stream.Height ?? null,
        bitrate: stream.BitRate ?? null,
        channels: stream.Channels ?? null,
        language: stream.Language ?? null,
        range: stream.VideoRangeType ?? null,
    };
}

function streamsOf(source: JellyfinMediaSourceDto | undefined, type: string): JellyfinMediaStreamDto[] {
    return (source?.MediaStreams ?? []).filter((s) => s.Type === type && typeof s.Index === 'number');
}

/** The audio stream Jellyfin plays by default: `DefaultAudioStreamIndex`, else the flagged default, else the first. */
function defaultAudio(source: JellyfinMediaSourceDto | undefined): JellyfinMediaStreamDto | undefined {
    const audio = streamsOf(source, 'Audio');
    return audio.find((s) => s.Index === source?.DefaultAudioStreamIndex) ?? audio.find((s) => s.IsDefault) ?? audio[0];
}

function option(stream: JellyfinMediaStreamDto, fallback: string): TrackOption {
    return {
        index: stream.Index!,
        label: stream.DisplayTitle?.trim() || stream.Language || `${fallback} ${stream.Index}`,
        isText: stream.IsTextSubtitleStream !== false,
    };
}

/** Jellyfin's URL with the token as `ApiKey`, which media elements, `<track>` and hls.js can send. */
function withApiKey(endpoint: JellyfinEndpoint, path: string): string {
    const url = new URL(path, `${endpoint.serverUrl}/`);
    url.searchParams.delete('api_key');
    url.searchParams.set('ApiKey', endpoint.token);
    return url.toString();
}

/** A text subtitle stream converted to WebVTT by Jellyfin, for a `<track>` element. */
export function subtitleUrl(endpoint: JellyfinEndpoint, itemId: string, mediaSourceId: string, index: number): string {
    return withApiKey(endpoint,
        `/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(mediaSourceId)}/Subtitles/${index}/0/Stream.vtt`);
}

/**
 * Turns Jellyfin's answer into a source: the original file when the browser can play it (or when
 * Jellyfin offers nothing else), otherwise Jellyfin's HLS stream.
 */
export function toPlaybackSource(
    endpoint: JellyfinEndpoint,
    track: Pick<TrackInfo, 'id' | 'type'>,
    result: JellyfinPlaybackInfoDto,
    audioStreamIndex?: number,
): PlaybackSource {
    const source = result.MediaSources?.[0];
    const audio = streamsOf(source, 'Audio');
    const byDefault = defaultAudio(source);
    const playing = audio.find((s) => s.Index === audioStreamIndex) ?? byDefault;
    const base = {
        container: source?.Container ?? '',
        bitrate: source?.Bitrate ?? null,
        video: details(streamsOf(source, 'Video')[0]),
        audio: details(playing),
        mediaSourceId: source?.Id ?? track.id,
        audioTracks: audio.map((s) => option(s, 'Audio')),
        subtitleTracks: streamsOf(source, 'Subtitle').map((s) => option(s, 'Subtitle')),
        audioIndex: playing?.Index ?? null,
        defaultAudioIndex: byDefault?.Index ?? null,
        defaultSubtitleIndex: source?.DefaultSubtitleStreamIndex ?? -1,
    };
    const direct: PlaybackSource = {
        url: streamUrl(endpoint, track),
        hls: false,
        info: { method: 'direct', ...base, reasons: [], playSessionId: null },
    };
    if (!source || source.SupportsDirectPlay !== false || !source.TranscodingUrl) return direct;

    const url = withApiKey(endpoint, source.TranscodingUrl);
    const reasons = new URL(url).searchParams.get('TranscodeReasons')?.split(',').filter(Boolean) ?? [];
    return {
        url,
        hls: source.TranscodingSubProtocol === 'hls' || /\.m3u8(\?|$)/.test(new URL(url).pathname),
        info: { method: 'transcode', ...base, reasons, playSessionId: result.PlaySessionId ?? null },
    };
}

/**
 * Asks Jellyfin how this browser should play a video, given what it can decode (`deviceProfile`).
 * Subtitles stay out of the stream unless an image subtitle is to be burnt in: text subtitles come
 * as separate WebVTT, so they never force a video transcode.
 */
export async function resolvePlayback(
    api: JellyfinApi,
    endpoint: JellyfinEndpoint,
    track: Pick<TrackInfo, 'id' | 'type'>,
    deviceProfile: object,
    options: PlaybackOptions = {},
): Promise<PlaybackSource> {
    const allowDirectPlay = options.allowDirectPlay !== false && options.burnSubtitleIndex === undefined;
    const res = await api.request(
        `/Items/${encodeURIComponent(track.id)}/PlaybackInfo?userId=${encodeURIComponent(api.userId)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                UserId: api.userId,
                DeviceProfile: deviceProfile,
                MaxStreamingBitrate: MAX_STREAMING_BITRATE,
                StartTimeTicks: 0,
                ...(options.audioStreamIndex !== undefined ? { AudioStreamIndex: options.audioStreamIndex } : {}),
                SubtitleStreamIndex: options.burnSubtitleIndex ?? -1,
                EnableDirectPlay: allowDirectPlay,
                EnableDirectStream: allowDirectPlay,
                EnableTranscoding: true,
                AllowVideoStreamCopy: options.allowVideoCopy !== false,
                AllowAudioStreamCopy: true,
                AutoOpenLiveStream: false,
            }),
        });
    if (!res.ok) throw new Error(`PlaybackInfo failed with HTTP ${res.status}`);
    return toPlaybackSource(endpoint, track, await res.json() as JellyfinPlaybackInfoDto, options.audioStreamIndex);
}

/** Ends the server's ffmpeg job of a transcode; `keepalive` lets it run while the page unloads. */
export async function stopTranscode(api: JellyfinApi, deviceId: string, playSessionId: string, keepalive = false): Promise<void> {
    const query = new URLSearchParams({ deviceId, playSessionId });
    await api.request(`/Videos/ActiveEncodings?${query}`, { method: 'DELETE', keepalive });
}

/** Keeps a paused transcode from being reaped as abandoned. */
export async function pingTranscode(api: JellyfinApi, playSessionId: string): Promise<void> {
    await api.request(`/Sessions/Playing/Ping?playSessionId=${encodeURIComponent(playSessionId)}`, { method: 'POST' });
}

/** What ffmpeg is doing for this device, or null when nothing is being transcoded. */
export async function fetchTranscodingInfo(api: JellyfinApi, deviceId: string): Promise<JellyfinTranscodingInfoDto | null> {
    const res = await api.request(`/Sessions?deviceId=${encodeURIComponent(deviceId)}`);
    if (!res.ok) return null;
    const sessions = await res.json() as { TranscodingInfo?: JellyfinTranscodingInfoDto | null }[];
    return sessions.find((session) => session.TranscodingInfo)?.TranscodingInfo ?? null;
}
