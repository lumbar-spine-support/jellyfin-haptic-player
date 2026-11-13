/**
 * Jellyfin device profile from what this browser can decode. Jellyfin compares it with each file:
 * a file that fits a direct play profile plays as is (`static=true`), anything else is remuxed or
 * transcoded to HLS. A Blu-ray rip in MKV with TrueHD, DTS or AC-3 audio, which browsers play
 * silently, so gets its audio converted while the video is usually copied.
 */

/** The browser's answers; a plain object in tests. */
export interface MediaProbe {
    /** `HTMLMediaElement.canPlayType`. */
    canPlayType(type: string): string;
    /** `MediaSource.isTypeSupported`; false where MSE is missing. */
    isTypeSupported(type: string): boolean;
    /** The browser plays Matroska files, which `canPlayType` does not always admit (Chromium). */
    matroska: boolean;
}

/** Dynamic ranges the profile may accept; Jellyfin copies only streams whose `VideoRangeType` is listed. */
const HDR_RANGES = ['HDR10', 'HDR10Plus', 'HLG'];
const DOLBY_VISION_RANGES = ['DOVI', 'DOVIWithHDR10', 'DOVIWithHLG', 'DOVIWithSDR', 'DOVIWithHDR10Plus'];
/** Subtitle formats Jellyfin can hand out as WebVTT. Image subtitles (PGS, VobSub, DVB) are left out, so Jellyfin burns them in. */
const TEXT_SUBTITLES = ['vtt', 'webvtt', 'srt', 'subrip', 'ass', 'ssa', 'mov_text', 'ttml', 'microdvd', 'sub'];

/** MIME types that tell whether a codec decodes; one hit is enough. */
const VIDEO_CODECS: Record<string, string[]> = {
    h264: ['video/mp4; codecs="avc1.640029"', 'video/mp4; codecs="avc1.42E01E"'],
    hevc: ['video/mp4; codecs="hvc1.1.6.L120.90"', 'video/mp4; codecs="hev1.1.6.L120.90"', 'video/mp4; codecs="hvc1.2.4.L153.B0"'],
    vp9: ['video/webm; codecs="vp9"', 'video/mp4; codecs="vp09.00.10.08"'],
    av1: ['video/mp4; codecs="av01.0.05M.08"', 'video/webm; codecs="av01.0.05M.08"'],
    vp8: ['video/webm; codecs="vp8"'],
};

const AUDIO_CODECS: Record<string, string[]> = {
    aac: ['audio/mp4; codecs="mp4a.40.2"'],
    mp3: ['audio/mpeg', 'audio/mp4; codecs="mp3"'],
    opus: ['audio/webm; codecs="opus"', 'audio/mp4; codecs="opus"'],
    flac: ['audio/flac', 'audio/mp4; codecs="flac"'],
    vorbis: ['audio/webm; codecs="vorbis"'],
    ac3: ['audio/mp4; codecs="ac-3"'],
    eac3: ['audio/mp4; codecs="ec-3"'],
    dts: ['audio/mp4; codecs="dtsc"', 'audio/mp4; codecs="dtse"'],
    alac: ['audio/mp4; codecs="alac"'],
};

/** Codecs HLS output can carry in fMP4 segments, best first. */
const HLS_VIDEO = ['hevc', 'h264'];
const HLS_AUDIO = ['aac', 'ac3', 'eac3', 'mp3', 'opus', 'flac'];

/** Jellyfin's ceiling for direct play, so large remuxes are never refused for size. */
const MAX_STATIC_BITRATE = 1_000_000_000;
const MAX_STREAMING_BITRATE = 120_000_000;

function supported(probe: MediaProbe, types: readonly string[]): boolean {
    return types.some((type) => probe.isTypeSupported(type) || probe.canPlayType(type).replace(/^no$/, '') !== '');
}

/** Codec names (Jellyfin spelling) this browser decodes, from `table`. */
function decodable(probe: MediaProbe, table: Record<string, string[]>): string[] {
    return Object.entries(table).filter(([, types]) => supported(probe, types)).map(([codec]) => codec);
}

/**
 * Limits within a codec, as Jellyfin's own web client declares them. Without them Jellyfin would
 * also copy Dolby Vision or 10-bit H.264 streams, which browsers fail to parse or decode.
 */
function codecProfiles(probe: MediaProbe): object[] {
    const condition = (Condition: string, Property: string, Value: string): object => ({ Condition, Property, Value, IsRequired: false });
    const main10 = supported(probe, ['video/mp4; codecs="hvc1.2.4.L153.B0"', 'video/mp4; codecs="hev1.2.4.L153.B0"']);
    const dolbyVision = supported(probe, ['video/mp4; codecs="dvh1.05.06"', 'video/mp4; codecs="dvhe.05.06"']);
    const ranges = ['SDR', ...(main10 ? HDR_RANGES : []), ...(dolbyVision ? DOLBY_VISION_RANGES : [])].join('|');
    return [
        { Type: 'Video', Codec: 'h264', Conditions: [
            condition('EqualsAny', 'VideoProfile', 'high|main|baseline|constrained baseline'),
            condition('LessThanEqual', 'VideoBitDepth', '8'),
            condition('EqualsAny', 'VideoRangeType', 'SDR'),
        ] },
        { Type: 'Video', Codec: 'hevc', Conditions: [
            condition('EqualsAny', 'VideoProfile', main10 ? 'main|main 10' : 'main'),
            condition('EqualsAny', 'VideoRangeType', ranges),
        ] },
        { Type: 'Video', Codec: 'av1', Conditions: [
            condition('EqualsAny', 'VideoRangeType', ['SDR', ...(main10 ? HDR_RANGES : [])].join('|')),
        ] },
        { Type: 'Video', Codec: 'vp9', Conditions: [
            condition('EqualsAny', 'VideoRangeType', ['SDR', ...(main10 ? HDR_RANGES : [])].join('|')),
        ] },
    ];
}

export function buildDeviceProfile(probe: MediaProbe): object {
    const video = decodable(probe, VIDEO_CODECS);
    const audio = decodable(probe, AUDIO_CODECS);
    const list = (codecs: readonly string[], allowed: readonly string[]): string =>
        codecs.filter((codec) => allowed.includes(codec)).join(',');

    const directPlay: object[] = [];
    // Jellyfin reads an empty codec list as "any codec", so a container without a decodable
    // video and audio codec gets no direct play profile at all.
    const addVideo = (container: string, videoCodecs: string, audioCodecs: string): void => {
        if (videoCodecs && audioCodecs) directPlay.push({ Container: container, Type: 'Video', VideoCodec: videoCodecs, AudioCodec: audioCodecs });
    };
    addVideo('mp4,m4v,mov', list(video, ['h264', 'hevc', 'av1', 'vp9']), list(audio, ['aac', 'mp3', 'opus', 'flac', 'ac3', 'eac3', 'alac', 'dts']));
    addVideo('webm', list(video, ['vp8', 'vp9', 'av1']), list(audio, ['opus', 'vorbis']));
    if (probe.matroska) addVideo('mkv', video.join(','), audio.join(','));
    for (const codec of audio) {
        const container = { aac: 'm4a,m4b,aac', mp3: 'mp3', opus: 'opus,ogg,webm', flac: 'flac', vorbis: 'ogg,webm', alac: 'm4a' }[codec as string];
        if (container) directPlay.push({ Container: container, Type: 'Audio', AudioCodec: codec });
    }

    return {
        Name: 'HAPPY',
        MaxStreamingBitrate: MAX_STREAMING_BITRATE,
        MaxStaticBitrate: MAX_STATIC_BITRATE,
        DirectPlayProfiles: directPlay,
        TranscodingProfiles: [{
            Container: 'mp4',
            Type: 'Video',
            Protocol: 'hls',
            Context: 'Streaming',
            VideoCodec: list(HLS_VIDEO, video) || 'h264',
            AudioCodec: list(HLS_AUDIO, audio) || 'aac',
            MaxAudioChannels: '6',
            MinSegments: 1,
            BreakOnNonKeyFrames: true,
        }],
        ContainerProfiles: [],
        CodecProfiles: codecProfiles(probe),
        SubtitleProfiles: TEXT_SUBTITLES.map((format) => ({ Format: format, Method: 'External' })),
    };
}

/** This browser's answers. */
export function browserProbe(): MediaProbe {
    const element = document.createElement('video');
    const mse = (globalThis as { MediaSource?: { isTypeSupported(type: string): boolean } }).MediaSource
        ?? (globalThis as { ManagedMediaSource?: { isTypeSupported(type: string): boolean } }).ManagedMediaSource;
    const brands = (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
    const chromium = brands.some(({ brand }) => brand === 'Chromium');
    return {
        canPlayType: (type) => element.canPlayType(type),
        isTypeSupported: (type) => mse?.isTypeSupported(type) ?? false,
        matroska: chromium || element.canPlayType('video/x-matroska') !== '' || element.canPlayType('video/mkv') !== '',
    };
}
