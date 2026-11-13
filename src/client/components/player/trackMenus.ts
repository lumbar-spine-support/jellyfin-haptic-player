import type { TrackOption } from '../../jellyfin/playback';
import type { PlaybackSession } from './session';
import type { LoadedStream, StreamSelection } from './stream';

type MenuKey = 'audio' | 'subtitles';

/** "Off" in the subtitle menu; Jellyfin's index for no subtitle. */
const SUBTITLES_OFF = -1;

/** The options of one submenu: Jellyfin's streams, plus "Off" for subtitles. */
export function menuOptions(key: MenuKey, tracks: { audio: TrackOption[]; subtitles: TrackOption[] }): { index: number; label: string }[] {
    if (key === 'audio') return tracks.audio.map(({ index, label }) => ({ index, label }));
    return [{ index: SUBTITLES_OFF, label: 'Off' }, ...tracks.subtitles.map(({ index, label }) => ({ index, label }))];
}

function selectedIndex(key: MenuKey, selection: StreamSelection): number | null {
    return key === 'audio' ? selection.audio : selection.subtitle;
}

function renderOptions(container: HTMLElement, key: MenuKey, options: { index: number; label: string }[], selected: number | null): void {
    container.replaceChildren(...options.map(({ index, label }) => {
        const item = document.createElement('media-menu-item');
        item.className = 'media-menu-item media-track-menu-option';
        item.dataset.trackChoice = key;
        item.dataset.index = String(index);
        item.setAttribute('aria-checked', String(index === selected));
        const text = document.createElement('span');
        text.className = 'media-track-menu-label';
        text.textContent = label;
        const check = document.createElement('i');
        check.className = 'bi bi-check2 media-track-menu-check';
        check.setAttribute('aria-hidden', 'true');
        item.append(text, check);
        return item;
    }));
}

/**
 * *Audio track* and *Subtitles* in each player's settings menu, for movies and episodes: the streams
 * Jellyfin's own player offers, under the same labels. Picking one goes to the slot's stream
 * (`LoadedStream.select`), which switches without losing the position.
 */
export function mountTrackMenus(session: PlaybackSession): void {
    for (const player of document.querySelectorAll<HTMLElement>('video-player')) {
        let bound: LoadedStream | null = null;
        let unsubscribe: () => void = () => undefined;

        const render = (): void => {
            const stream = session.streamOf(player);
            const info = stream?.info() ?? null;
            const selection = stream?.selection() ?? null;
            const offered = Boolean(session.requestOf(player)?.kind && info && selection);
            for (const key of ['audio', 'subtitles'] as const) {
                const trigger = player.querySelector<HTMLElement>(`[data-track-menu="${key}"]`);
                const container = player.querySelector<HTMLElement>(`[data-track-menu-options="${key}"]`);
                if (!trigger || !container) continue;
                const options = info && offered ? menuOptions(key, { audio: info.audioTracks, subtitles: info.subtitleTracks }) : [];
                // An audio menu needs a choice; subtitles always offer "Off" next to the streams.
                const show = key === 'audio' ? options.length > 0 : options.length > 1;
                trigger.style.display = show ? '' : 'none';
                if (!show || !selection) continue;
                const selected = selectedIndex(key, selection);
                renderOptions(container, key, options, selected);
                const value = trigger.querySelector('[data-track-menu-value]');
                if (value) value.textContent = options.find((o) => o.index === selected)?.label ?? '';
            }
        };

        // A slot gets a new stream with every track it loads.
        session.onChange(() => {
            const stream = session.streamOf(player);
            if (stream === bound) return;
            unsubscribe();
            bound = stream;
            unsubscribe = stream?.onChange(render) ?? (() => undefined);
            render();
        });

        player.addEventListener('select', (event) => {
            const item = (event.target as Element | null)?.closest?.<HTMLElement>('[data-track-choice]');
            if (!item) return;
            const index = Number(item.dataset.index);
            const change: Partial<StreamSelection> = item.dataset.trackChoice === 'audio' ? { audio: index } : { subtitle: index };
            void session.streamOf(player)?.select(change);
        });
    }
}
