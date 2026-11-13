import type { JellyfinTranscodingInfoDto, StreamDetails, StreamInfo } from '../../jellyfin/playback';

/** Everything the playback info overlay shows at one moment. */
export interface PlaybackInfoSnapshot {
    type: 'audio' | 'video';
    /** Null for audio, and for video until Jellyfin answered. */
    stream: StreamInfo | null;
    /** `hls.js`, `native HLS` or `file`. */
    player: string;
    videoWidth: number;
    videoHeight: number;
    droppedFrames: number | null;
    totalFrames: number | null;
    /** Seconds buffered ahead of the playhead. */
    bufferAhead: number;
    /** Live ffmpeg state from Jellyfin's session; null while nothing is transcoded. */
    transcoding: JellyfinTranscodingInfoDto | null;
}

export function formatBitrate(bps: number | null | undefined): string {
    if (!bps || bps <= 0) return '';
    return bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mbps` : `${Math.round(bps / 1000)} kbps`;
}

/** `AudioCodecNotSupported` → `audio codec not supported`. */
export function humanizeReason(reason: string): string {
    return reason.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

const join = (parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(' · ');
const size = (w: number | null | undefined, h: number | null | undefined): string => (w && h ? `${w}×${h}` : '');

function describeVideo(video: StreamDetails): string {
    const range = video.range && video.range !== 'SDR' ? video.range : '';
    return join([[video.codec, video.profile].filter(Boolean).join(' '), range, size(video.width, video.height), formatBitrate(video.bitrate)]);
}

function describeAudio(audio: StreamDetails): string {
    return join([audio.codec, audio.channels ? `${audio.channels} ch` : '', audio.language, formatBitrate(audio.bitrate)]);
}

/** Label/value rows, compact enough for a phone held upright. */
export function formatPlaybackInfo(snapshot: PlaybackInfoSnapshot): [string, string][] {
    const { stream, transcoding: live } = snapshot;
    const rows: [string, string][] = [];

    if (snapshot.type === 'audio') rows.push(['Method', 'Direct play']);
    else if (!stream) rows.push(['Method', 'Asking Jellyfin…']);
    else rows.push(['Method', stream.method === 'direct' ? 'Direct play' : `Transcode · HLS (${snapshot.player})`]);

    if (stream?.reasons.length) rows.push(['Reason', stream.reasons.map(humanizeReason).join(', ')]);
    if (stream) {
        const target = stream.method === 'transcode' ? ` → ${live?.Container ?? 'hls'}` : '';
        rows.push(['Container', `${join([stream.container, formatBitrate(stream.bitrate)]) || '?'}${target}`]);
    }
    if (stream?.video) {
        const to = !live ? '' : live.IsVideoDirect ? ' → copy' : ` → ${join([live.VideoCodec, size(live.Width, live.Height)])}`;
        rows.push(['Video', `${describeVideo(stream.video)}${to}`]);
    }
    if (stream?.audio) {
        const to = !live ? '' : live.IsAudioDirect ? ' → copy' : ` → ${join([live.AudioCodec, live.AudioChannels ? `${live.AudioChannels} ch` : ''])}`;
        rows.push(['Audio', `${describeAudio(stream.audio)}${to}`]);
    }
    if (live) {
        rows.push(['Encoder', join([
            live.Framerate ? `${Math.round(live.Framerate)} fps` : '',
            live.CompletionPercentage != null ? `${live.CompletionPercentage.toFixed(1)} %` : '',
            formatBitrate(live.Bitrate),
            live.HardwareAccelerationType && live.HardwareAccelerationType !== 'none' ? live.HardwareAccelerationType : 'software',
        ])]);
    }

    if (snapshot.type === 'video') {
        const frames = snapshot.totalFrames ? `${snapshot.droppedFrames ?? 0}/${snapshot.totalFrames} dropped` : '';
        rows.push(['Output', join([size(snapshot.videoWidth, snapshot.videoHeight) || 'no frames yet', frames])]);
    }
    rows.push(['Buffer', `${snapshot.bufferAhead.toFixed(1)} s`]);
    return rows;
}
