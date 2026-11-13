import { fetchMediaTranscodingInfo } from '../../api';
import type { JellyfinTranscodingInfoDto } from '../../jellyfin/playback';
import { storedSetting } from '../../utils/storedSetting';
import type { PlaybackSession } from './session';
import { formatPlaybackInfo, type PlaybackInfoSnapshot } from './playbackInfoFormat';

const REFRESH_MS = 1000;
/** Jellyfin's session list is heavier than the element's own numbers, so it is asked less often. */
const TRANSCODING_REFRESH_MS = 3000;

function bufferAhead(media: HTMLVideoElement): number {
    const { buffered, currentTime } = media;
    for (let i = 0; i < buffered.length; i++) {
        if (buffered.start(i) <= currentTime && currentTime <= buffered.end(i)) return buffered.end(i) - currentTime;
    }
    return 0;
}

function render(overlay: HTMLElement, rows: [string, string][]): void {
    const list = document.createElement('dl');
    for (const [label, value] of rows) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        list.append(dt, dd);
    }
    const previous = overlay.querySelector('dl');
    if (previous) previous.replaceWith(list);
    else overlay.appendChild(list);
}

/**
 * The *Playback info* item of each player's settings menu shows a small overlay with how the
 * video reaches the browser (direct play or Jellyfin's transcode, and why), the source and target
 * codecs, ffmpeg's progress and the element's own frame and buffer numbers. The choice is kept per
 * browser and applies to both player slots.
 */
export function mountPlaybackInfo(session: PlaybackSession): void {
    const setting = storedSetting('happy-playback-info', false);
    let enabled = setting.get();
    let transcoding: JellyfinTranscodingInfoDto | null = null;
    let transcodingAsked = 0;
    let transcodingSession: string | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    const players = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('video-player')];

    const refresh = (): void => {
        for (const player of players()) {
            const overlay = player.querySelector<HTMLElement>('.media-playback-info');
            const state = player.querySelector<HTMLElement>('[data-playback-info-state]');
            if (state) state.textContent = enabled ? 'On' : 'Off';
            if (!overlay) continue;
            overlay.hidden = !enabled;
            const media = player.querySelector('video');
            // `<video-player>` is `display: contents` and has no box; the overlay's own visibility
            // tells whether this slot is on screen.
            if (!enabled || !media || !overlay.checkVisibility()) continue;

            const stream = session.streamOf(player);
            const info = stream?.info() ?? null;
            // A new transcode (other audio, a fallback) must not show the last one's live numbers.
            if (info?.playSessionId !== transcodingSession) {
                transcodingSession = info?.playSessionId ?? null;
                transcoding = null;
                transcodingAsked = 0;
            }
            if (info?.method === 'transcode' && Date.now() - transcodingAsked > TRANSCODING_REFRESH_MS) {
                transcodingAsked = Date.now();
                void fetchMediaTranscodingInfo().then((live) => { transcoding = live; });
            }
            const quality = media.getVideoPlaybackQuality?.();
            const snapshot: PlaybackInfoSnapshot = {
                type: player.classList.contains('audio-only') ? 'audio' : 'video',
                stream: info,
                player: stream?.hls() ? 'hls.js' : 'native HLS',
                videoWidth: media.videoWidth,
                videoHeight: media.videoHeight,
                droppedFrames: quality?.droppedVideoFrames ?? null,
                totalFrames: quality?.totalVideoFrames ?? null,
                bufferAhead: bufferAhead(media),
                transcoding: info?.method === 'transcode' ? transcoding : null,
            };
            render(overlay, formatPlaybackInfo(snapshot));
        }
    };

    const apply = (): void => {
        clearInterval(timer);
        timer = enabled ? setInterval(refresh, REFRESH_MS) : undefined;
        if (!enabled) transcoding = null;
        refresh();
    };

    const toggle = (): void => {
        enabled = !enabled;
        setting.set(enabled);
        apply();
    };

    for (const player of players()) {
        player.addEventListener('select', (event) => {
            if ((event.target as Element | null)?.closest?.('[data-playback-info-toggle]')) toggle();
        });
        player.addEventListener('click', (event) => {
            if ((event.target as Element | null)?.closest?.('[data-playback-info-close]')) toggle();
        });
    }
    apply();
}
