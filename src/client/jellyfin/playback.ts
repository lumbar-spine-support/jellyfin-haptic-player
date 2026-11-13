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

/** How a video reaches the browser, and why. */
export interface StreamInfo {
    /** `direct`: the original file (`static=true`). `transcode`: Jellyfin's HLS, remuxed and/or re-encoded by ffmpeg. */
    method: 'direct' | 'transcode';
    container: string;
    bitrate: number | null;
    video: StreamDetails | null;
    audio: StreamDetails | null;
    /** Jellyfin's `TranscodeReasons`, e.g. `AudioCodecNotSupported`; empty for direct play. */
    reasons: string[];
    /** Identifies the transcode on the server; null for direct play. */
    playSessionId: string | null;
}

/** Where to load a video from. */
export interface PlaybackSource {
    url: string;
    /** The URL is an HLS playlist (needs hls.js or native HLS). */
    hls: boolean;
    info: StreamInfo;
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

/** The audio stream Jellyfin plays by default: `DefaultAudioStreamIndex`, else the flagged default, else the first. */
function defaultAudio(source: JellyfinMediaSourceDto): JellyfinMediaStreamDto | undefined {
    const audio = (source.MediaStreams ?? []).filter((s) => s.Type === 'Audio');
    return audio.find((s) => s.Index === source.DefaultAudioStreamIndex) ?? audio.find((s) => s.IsDefault) ?? audio[0];
}

/** Jellyfin's transcoding URL with the token as `ApiKey`, which media elements and hls.js can send. */
function transcodingUrl(endpoint: JellyfinEndpoint, path: string): string {
    const url = new URL(path, `${endpoint.serverUrl}/`);
    url.searchParams.delete('api_key');
    url.searchParams.set('ApiKey', endpoint.token);
    return url.toString();
}

/**
 * Turns Jellyfin's answer into a source: the original file when the browser can play it (or when
 * Jellyfin offers nothing else), otherwise Jellyfin's HLS stream.
 */
export function toPlaybackSource(
    endpoint: JellyfinEndpoint,
    track: Pick<TrackInfo, 'id' | 'type'>,
    result: JellyfinPlaybackInfoDto,
): PlaybackSource {
    const source = result.MediaSources?.[0];
    const base = {
        container: source?.Container ?? '',
        bitrate: source?.Bitrate ?? null,
        video: details((source?.MediaStreams ?? []).find((s) => s.Type === 'Video')),
        audio: source ? details(defaultAudio(source)) : null,
    };
    const direct: PlaybackSource = {
        url: streamUrl(endpoint, track),
        hls: false,
        info: { method: 'direct', ...base, reasons: [], playSessionId: null },
    };
    if (!source || source.SupportsDirectPlay !== false || !source.TranscodingUrl) return direct;

    const url = transcodingUrl(endpoint, source.TranscodingUrl);
    const reasons = new URL(url).searchParams.get('TranscodeReasons')?.split(',').filter(Boolean) ?? [];
    return {
        url,
        hls: source.TranscodingSubProtocol === 'hls' || /\.m3u8(\?|$)/.test(new URL(url).pathname),
        info: { method: 'transcode', ...base, reasons, playSessionId: result.PlaySessionId ?? null },
    };
}

/**
 * Asks Jellyfin how this browser should play a video, given what it can decode (`deviceProfile`).
 * Subtitles are left off so Jellyfin never burns them in, which would force a full video transcode.
 */
export async function resolvePlayback(
    api: JellyfinApi,
    endpoint: JellyfinEndpoint,
    track: Pick<TrackInfo, 'id' | 'type'>,
    deviceProfile: object,
): Promise<PlaybackSource> {
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
                SubtitleStreamIndex: -1,
                EnableDirectPlay: true,
                EnableDirectStream: true,
                EnableTranscoding: true,
                AllowVideoStreamCopy: true,
                AllowAudioStreamCopy: true,
                AutoOpenLiveStream: false,
            }),
        });
    if (!res.ok) throw new Error(`PlaybackInfo failed with HTTP ${res.status}`);
    return toPlaybackSource(endpoint, track, await res.json() as JellyfinPlaybackInfoDto);
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
