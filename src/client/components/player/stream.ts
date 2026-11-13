import type Hls from 'hls.js';
import type { PlaybackRequest } from '../../../shared/types';
import type { StreamInfo } from '../../jellyfin/playback';
import { keepMediaTranscodeAlive, resolveMediaSource, stopMediaTranscode } from '../../api';

/** A source attached to a player slot's `<video>`. */
export interface LoadedStream {
    /** Settles once the element has its source; playing earlier would play nothing. Never rejects. */
    readonly ready: Promise<void>;
    /** How the video reaches the browser; null for audio and until Jellyfin answered. */
    info(): StreamInfo | null;
    /** The hls.js instance when hls.js plays it, for its level and codec details. */
    hls(): Hls | null;
    /** Releases the source: destroys hls.js and ends the server's transcode. */
    detach(): void;
}

export type StreamLoader = (media: HTMLVideoElement, request: PlaybackRequest) => LoadedStream;

/** Sets `src` as is: what every slot did before transcoding existed; the tests use it too. */
export const directLoader: StreamLoader = (media, request) => {
    media.src = request.src;
    return { ready: Promise.resolve(), info: () => null, hls: () => null, detach: () => undefined };
};

/** Jellyfin reaps transcodes it has not heard of for a while; Jellyfin's web client pings this often. */
const PING_INTERVAL_MS = 30_000;
const HLS_SCRIPT = 'vendor/hls/hls.light.min.js';

let hlsLoading: Promise<typeof Hls | null> | null = null;

/** hls.js from `public/vendor`, loaded on first use; null when it fails to load. */
function loadHls(): Promise<typeof Hls | null> {
    hlsLoading ??= new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = HLS_SCRIPT;
        script.onload = () => resolve((window as unknown as { Hls?: typeof Hls }).Hls ?? null);
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
    });
    return hlsLoading;
}

/** Transcodes still running, ended when the page goes away. */
const liveTranscodes = new Set<string>();
addEventListener('pagehide', () => {
    for (const id of liveTranscodes) stopMediaTranscode(id, true);
});

/**
 * Asks Jellyfin how to play each video (see `resolveMediaSource`). Direct play keeps the
 * `static=true` URL; an HLS stream plays through hls.js, or natively where MSE is missing (iOS).
 * Audio is always played directly.
 */
export const jellyfinLoader: StreamLoader = (media, request) => {
    if (request.type !== 'video') return directLoader(media, request);

    let detached = false;
    let info: StreamInfo | null = null;
    let player: Hls | null = null;
    let ping: ReturnType<typeof setInterval> | undefined;
    // Without a source the element would keep showing the previous video until Jellyfin answers.
    media.removeAttribute('src');
    media.load();

    const ready = (async (): Promise<void> => {
        const source = await resolveMediaSource(request);
        if (detached) return;
        info = source?.info ?? null;
        if (!source?.hls) {
            media.src = source?.url ?? request.src;
            return;
        }
        const sessionId = source.info.playSessionId;
        if (sessionId) {
            liveTranscodes.add(sessionId);
            ping = setInterval(() => keepMediaTranscodeAlive(sessionId), PING_INTERVAL_MS);
        }
        const HlsClass = await loadHls();
        if (detached) return;
        if (HlsClass?.isSupported()) {
            player = new HlsClass({ startPosition: 0 });
            player.loadSource(source.url);
            player.attachMedia(media);
        } else {
            media.src = source.url;
        }
    })();

    return {
        ready,
        info: () => info,
        hls: () => player,
        detach: () => {
            detached = true;
            clearInterval(ping);
            player?.destroy();
            player = null;
            const sessionId = info?.playSessionId;
            if (sessionId && liveTranscodes.delete(sessionId)) stopMediaTranscode(sessionId);
        },
    };
};
