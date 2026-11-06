import { FALLBACK_ART_DATA_URI, renderTrackArt } from '../../api';
import { renderHapticIcons } from '../haptic/icons';
import { formatHoursMinutes } from '../../utils/formatTime';
import type { TrackInfo } from '../../../shared/types';
import { mediaRowHtml } from './templates';
import { createFavoriteButton, type FavoriteItem } from './favorites';
import { createQueueMenu } from './queueMenu';

export type MediaType = 'audio' | 'video' | 'album' | 'playlist';

/** One icon per kind of item, for cards, list rows and the media filter. */
export const MEDIA_TYPE_ICONS: Record<MediaType, string> = {
    album: 'bi bi-vinyl',
    audio: 'bi bi-music-note',
    playlist: 'bi bi-music-note-list',
    video: 'bi bi-play-btn',
};

const MEDIA_TYPE_LABELS: Record<MediaType, string> = { album: 'Album', audio: 'Audio', playlist: 'Playlist', video: 'Video' };

/** The type column's icon and its accessible name. */
export function mediaTypeCell(type: MediaType): { typeIcon: string; typeLabel: string } {
    return { typeIcon: MEDIA_TYPE_ICONS[type], typeLabel: MEDIA_TYPE_LABELS[type] };
}

/** What the last cell of a row offers: a heart for Jellyfin items (not client-side albums) and the queue menu. */
export interface MediaRowActions {
    item: FavoriteItem | null;
    trackIds: () => string[];
    label: string;
    deletablePlaylistId?: string;
}

/** The columns every row shares; the caller adds what the row offers. */
function createRow(values: Parameters<typeof mediaRowHtml>[0], onClick: () => void): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', onClick);
    tr.innerHTML = mediaRowHtml(values);
    return tr;
}

function actionCell(content: HTMLElement): HTMLTableCellElement {
    const td = document.createElement('td');
    td.className = 'align-middle text-end pe-2 favorite-cell';
    td.appendChild(content);
    return td;
}

/**
 * One row of a `.media-table`: the library's list view and the album/playlist pages
 * share the same columns, so they share the same rows.
 */
export function createMediaRow(values: Parameters<typeof mediaRowHtml>[0], onClick: () => void, actions: MediaRowActions): HTMLTableRowElement {
    const tr = createRow(values, onClick);
    const group = document.createElement('span');
    group.className = 'd-inline-flex align-items-center gap-3';
    if (actions.item) group.appendChild(createFavoriteButton(actions.item));
    group.appendChild(createQueueMenu(actions.trackIds, actions.label, actions.deletablePlaylistId));
    tr.appendChild(actionCell(group));
    return tr;
}

function trackRowValues(track: TrackInfo): Parameters<typeof mediaRowHtml>[0] {
    return {
        artSrc: renderTrackArt(track),
        fallbackArt: FALLBACK_ART_DATA_URI,
        title: track.title,
        artist: track.artist,
        ...mediaTypeCell(track.type === 'video' ? 'video' : 'audio'),
        year: track.year,
        duration: formatHoursMinutes(track.durationSeconds),
        hapticIcons: renderHapticIcons(track.funscripts.map((f) => f.type)),
    };
}

/** A row for one audio file or video. */
export function createTrackRow(track: TrackInfo, onClick: () => void): HTMLTableRowElement {
    return createMediaRow(trackRowValues(track), onClick, { item: track, trackIds: () => [track.id], label: track.title });
}

export interface EditRowActions {
    onSelect(selected: boolean): void;
    onDragStart(event: PointerEvent): void;
    /** Alt+↑/↓: move the row one place. */
    onStep(delta: -1 | 1): void;
}

/**
 * A row of a playlist in edit mode: a drag handle in front, and a round checkbox
 * in place of the heart and queue menu. Clicking the row selects it.
 */
export function createEditTrackRow(track: TrackInfo, actions: EditRowActions): HTMLTableRowElement {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-check-input rounded-circle playlist-edit-check d-block m-0 ms-auto';
    checkbox.setAttribute('aria-label', `Select ${track.title}`);
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', () => {
        tr.classList.toggle('table-active', checkbox.checked);
        actions.onSelect(checkbox.checked);
    });

    const tr = createRow(trackRowValues(track), () => checkbox.click());
    tr.classList.add('playlist-edit-row');
    tr.addEventListener('keydown', (event) => {
        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        event.preventDefault();
        actions.onStep(event.key === 'ArrowUp' ? -1 : 1);
    });

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'btn btn-link btn-sm lh-1 playlist-edit-handle';
    handle.setAttribute('aria-label', `Move ${track.title} (Alt+Arrow keys)`);
    handle.innerHTML = '<i class="bi bi-grip-vertical" aria-hidden="true"></i>';
    handle.addEventListener('click', (event) => event.stopPropagation());
    handle.addEventListener('pointerdown', (event) => actions.onDragStart(event));
    const handleCell = document.createElement('td');
    handleCell.className = 'align-middle ps-2 pe-0';
    handleCell.style.width = '1%';
    handleCell.appendChild(handle);
    tr.prepend(handleCell);

    tr.appendChild(actionCell(checkbox));
    return tr;
}
