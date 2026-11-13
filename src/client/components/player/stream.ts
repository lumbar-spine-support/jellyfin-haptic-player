import type Hls from 'hls.js';
import type { PlaybackRequest } from '../../../shared/types';
import type { PlaybackOptions, StreamInfo } from '../../jellyfin/playback';
import { keepMediaTranscodeAlive, resolveMediaSource, stopMediaTranscode, subtitleTrackUrl } from '../../api';

/** The audio and subtitle stream that play, as Jellyfin stream indexes; subtitle -1 is off. */
export interface StreamSelection {
    audio: number | null;
    subtitle: number;
}

/** A source attached to a player slot's `<video>`. */
export interface LoadedStream {
    /** Settles once the element has its first source; playing earlier would play nothing. Never rejects. */
    readonly ready: Promise<void>;
    /** How the video reaches the browser; null for audio and until Jellyfin answered. */
    info(): StreamInfo | null;
    /** The hls.js instance when hls.js plays it, for its level and codec details. */
    hls(): Hls | null;
    /** The playing audio and subtitle stream; null where there is no choice (audio files, direct `src`). */
    selection(): StreamSelection | null;
    /** Switches audio and/or subtitles, keeping the position and play state. */
    select(change: Partial<StreamSelection>): Promise<void>;
    /** Called whenever `info()` or `selection()` changes. */
    onChange(listener: () => void): () => void;
    /** Releases the source: destroys hls.js and ends the server's transcode. */
    detach(): void;
}

export type StreamLoader = (media: HTMLVideoElement, request: PlaybackRequest) => LoadedStream;

/** Sets `src` as is: what every slot did before transcoding existed; the tests use it too. */
export const directLoader: StreamLoader = (media, request) => {
    media.src = request.src;
    return {
        ready: Promise.resolve(),
        info: () => null,
        hls: () => null,
        selection: () => null,
        select: async () => undefined,
        onChange: () => () => undefined,
        detach: () => undefined,
    };
};

/** Jellyfin reaps transcodes it has not heard of for a while; Jellyfin's web client pings this often. */
const PING_INTERVAL_MS = 30_000;
const HLS_SCRIPT = 'vendor/hls/hls.light.min.js';
/** Marks the `<track>` of the chosen text subtitle, so it is replaced rather than piled up. */
const SUBTITLE_ATTRIBUTE = 'data-jellyfin-subtitle';

let hlsLoading: Promise<typeof Hls | null> | null = null;

/** hls.js from `public/vendor`, loaded on first use; null when it fails to load. */
function loadHls(): Promise<typeof Hls | null> {
    hlsLoading ??= new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = HLS_SCRIPT;
        script.onload = () => resolve((window as unknown as { Hls?: typeof Hls }).Hls ?? null);
        script.onerror = () => {
            console.error(`[playback] ${HLS_SCRIPT} failed to load; HLS streams fall back to the browser's own player`);
            resolve(null);
        };
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
 * One video of a player slot, played the way Jellyfin says: the original file (`static=true`) when
 * the browser decodes it, else Jellyfin's HLS through hls.js (or natively where MSE is missing).
 * Changing audio, burning in an image subtitle and recovering from a failed stream all ask Jellyfin
 * again and reload at the same position; text subtitles are only a `<track>`.
 */
class JellyfinStream implements LoadedStream {
    readonly ready: Promise<void>;
    private current: StreamInfo | null = null;
    private player: Hls | null = null;
    private ping: ReturnType<typeof setInterval> | undefined;
    private detached = false;
    private generation = 0;
    private recovering = false;
    /** The user's choice; undefined keeps Jellyfin's default. */
    private chosenAudio: number | undefined;
    private chosenSubtitle: number | undefined;
    /** The image subtitle burnt into the current stream. */
    private burnt: number | undefined;
    /** Direct play failed in this browser, so only Jellyfin's stream is used. */
    private directFailed = false;
    /** The copied video failed, so Jellyfin re-encodes it. */
    private videoCopyFailed = false;
    private playing = false;
    private readonly listeners = new Set<() => void>();
    private readonly abort = new AbortController();

    constructor(private readonly media: HTMLVideoElement, private readonly request: PlaybackRequest) {
        // Without a source the element would keep showing the previous video until Jellyfin answers.
        media.removeAttribute('src');
        media.load();
        const { signal } = this.abort;
        media.addEventListener('play', () => { this.playing = true; }, { signal });
        media.addEventListener('pause', () => { if (!media.error) this.playing = false; }, { signal });
        media.addEventListener('error', () => this.recover(), { signal });
        this.ready = this.load(0, false);
    }

    info(): StreamInfo | null {
        return this.current;
    }

    hls(): Hls | null {
        return this.player;
    }

    selection(): StreamSelection | null {
        const info = this.current;
        if (!info) return null;
        return { audio: info.audioIndex, subtitle: this.subtitleIndex() };
    }

    async select(change: Partial<StreamSelection>): Promise<void> {
        await this.ready;
        const before = this.selection();
        if (change.audio !== undefined) this.chosenAudio = change.audio ?? undefined;
        if (change.subtitle !== undefined) this.chosenSubtitle = change.subtitle;
        const reload = (change.audio !== undefined && change.audio !== before?.audio) || this.burnIndex() !== this.burnt;
        if (reload) {
            await this.load(this.media.currentTime, this.playing || !this.media.paused);
        } else {
            this.applySubtitle();
            this.emit();
        }
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    detach(): void {
        this.detached = true;
        this.abort.abort();
        this.release();
        this.media.querySelector(`track[${SUBTITLE_ATTRIBUTE}]`)?.remove();
        this.listeners.clear();
    }

    private subtitleIndex(): number {
        return this.chosenSubtitle ?? this.current?.defaultSubtitleIndex ?? -1;
    }

    /** The chosen subtitle when it is an image one, which only a transcode can show. */
    private burnIndex(): number | undefined {
        const index = this.subtitleIndex();
        const track = this.current?.subtitleTracks.find((t) => t.index === index);
        return track && !track.isText ? track.index : undefined;
    }

    private options(): PlaybackOptions {
        const audio = this.chosenAudio;
        return {
            ...(audio !== undefined ? { audioStreamIndex: audio } : {}),
            ...(this.burnIndex() !== undefined ? { burnSubtitleIndex: this.burnIndex() } : {}),
            // The file plays only its own default audio, so any other stream needs Jellyfin's.
            allowDirectPlay: !this.directFailed && (audio === undefined || audio === this.current?.defaultAudioIndex),
            allowVideoCopy: !this.videoCopyFailed,
        };
    }

    private async load(position: number, resume: boolean): Promise<void> {
        const generation = ++this.generation;
        const options = this.options();
        const source = await resolveMediaSource(this.request, options);
        if (this.detached || generation !== this.generation) return;
        this.release();
        this.current = source?.info ?? null;
        this.burnt = options.burnSubtitleIndex;
        const media = this.media;

        if (source?.hls) {
            const sessionId = source.info.playSessionId;
            if (sessionId) {
                liveTranscodes.add(sessionId);
                this.ping = setInterval(() => keepMediaTranscodeAlive(sessionId), PING_INTERVAL_MS);
            }
            const HlsClass = await loadHls();
            if (this.detached || generation !== this.generation) return;
            if (HlsClass?.isSupported()) {
                const player = new HlsClass({ startPosition: position });
                player.on(HlsClass.Events.ERROR, (_event, data) => {
                    if (data.fatal) this.recover();
                });
                player.loadSource(source.url);
                player.attachMedia(media);
                this.player = player;
            } else {
                media.src = source.url;
                if (position > 0) this.seekOnLoad(position);
            }
        } else {
            media.src = source?.url ?? this.request.src;
            if (position > 0) this.seekOnLoad(position);
        }
        this.recovering = false;
        this.applySubtitle();
        if (resume) media.play().catch(() => { /* autoplay refused; the user presses play */ });
        this.emit();
    }

    private seekOnLoad(position: number): void {
        this.media.addEventListener('loadedmetadata', () => { this.media.currentTime = position; },
            { once: true, signal: this.abort.signal });
    }

    /**
     * A source the browser cannot play despite the profile: direct play falls back to Jellyfin's
     * stream, a copied video to a re-encoded one. Each fallback is tried once.
     */
    private recover(): void {
        const info = this.current;
        if (this.detached || this.recovering || !info) return;
        if (info.method === 'direct' && !this.directFailed) this.directFailed = true;
        else if (info.method === 'transcode' && !this.videoCopyFailed) this.videoCopyFailed = true;
        else return;
        console.warn(`[playback] ${info.method === 'direct' ? 'Direct play' : 'The copied video stream'} failed; asking Jellyfin to ${info.method === 'direct' ? 'stream' : 're-encode'} it`,
            this.media.error?.message ?? '');
        this.recovering = true;
        void this.load(this.media.currentTime, this.playing);
    }

    /** Shows the chosen text subtitle as a WebVTT `<track>`; image subtitles are part of the stream. */
    private applySubtitle(): void {
        this.media.querySelector(`track[${SUBTITLE_ATTRIBUTE}]`)?.remove();
        const info = this.current;
        const index = this.subtitleIndex();
        const option = info?.subtitleTracks.find((t) => t.index === index);
        if (!info || !option?.isText) return;
        const track = document.createElement('track');
        track.setAttribute(SUBTITLE_ATTRIBUTE, '');
        track.kind = 'subtitles';
        track.label = option.label;
        track.default = true;
        track.src = subtitleTrackUrl(this.request.id, info.mediaSourceId, index);
        this.media.append(track);
        track.track.mode = 'showing';
    }

    /** Destroys hls.js and ends this stream's transcode on the server. */
    private release(): void {
        clearInterval(this.ping);
        this.ping = undefined;
        this.player?.destroy();
        this.player = null;
        const sessionId = this.current?.playSessionId;
        if (sessionId && liveTranscodes.delete(sessionId)) stopMediaTranscode(sessionId);
    }

    private emit(): void {
        for (const listener of this.listeners) listener();
    }
}

/** Videos go through Jellyfin's PlaybackInfo (see {@link JellyfinStream}); audio is always played directly. */
export const jellyfinLoader: StreamLoader = (media, request) =>
    request.type === 'video' ? new JellyfinStream(media, request) : directLoader(media, request);
