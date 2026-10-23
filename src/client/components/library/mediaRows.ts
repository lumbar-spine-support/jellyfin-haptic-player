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

/**
 * One row of a `.media-table`: the library's list view and the album/playlist pages
 * share the same columns, so they share the same rows.
 */
export function createMediaRow(values: Parameters<typeof mediaRowHtml>[0], onClick: () => void, actions: MediaRowActions): HTMLTableRowElement {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', onClick);
    tr.innerHTML = mediaRowHtml(values);
    const td = document.createElement('td');
    td.className = 'align-middle text-end pe-2 favorite-cell';
    const group = document.createElement('span');
    group.className = 'd-inline-flex align-items-center gap-3';
    if (actions.item) group.appendChild(createFavoriteButton(actions.item));
    group.appendChild(createQueueMenu(actions.trackIds, actions.label, actions.deletablePlaylistId));
    td.appendChild(group);
    tr.appendChild(td);
    return tr;
}

/** A row for one audio file or video. */
export function createTrackRow(track: TrackInfo, onClick: () => void): HTMLTableRowElement {
    return createMediaRow({
        artSrc: renderTrackArt(track),
        fallbackArt: FALLBACK_ART_DATA_URI,
        title: track.title,
        artist: track.artist,
        ...mediaTypeCell(track.type === 'video' ? 'video' : 'audio'),
        year: track.year,
        duration: formatHoursMinutes(track.durationSeconds),
        hapticIcons: renderHapticIcons(track.funscripts.map((f) => f.type)),
    }, onClick, { item: track, trackIds: () => [track.id], label: track.title });
}
