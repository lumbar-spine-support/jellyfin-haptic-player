import { applyPlaylistCover } from '../../api';
import { qs } from '../../utils/html';
import { bindFavoriteButton } from './favorites';
import { createEditTrackRow, createTrackRow } from './mediaRows';
import { PlaylistDraft, type PlaylistChanges } from './playlistDraft';
import { startRowDrag } from '@/components/videojs/ui/row-drag';
import type { AlbumInfo, PlaylistEntry, PlaylistInfo, QueueSource, TrackInfo } from '../../../shared/types';

/** Drag zone at the page's bottom edge: tall enough to clear the fixed player bar. */
const PAGE_DRAG_EDGE_PX = 96;

type DetailContext =
    | { type: 'playlist'; playlist: PlaylistInfo }
    | { type: 'album'; album: AlbumInfo };

interface DetailRow {
    trackId: string;
    onClick: () => void;
}

export interface DetailViewOptions {
    allMedia(): TrackInfo[];
    /** `index` is the row's position in `source`, so a playlist holding a track twice starts at that row. */
    openTrack(trackId: string, source: QueueSource, autoplay: boolean, index: number): void;
    playCollection(source: QueueSource, shuffle: boolean): void;
    enqueue(trackIds: string[]): void;
    /** Resolves once Jellyfin stored the changes or refused them; the app tells the user which. */
    savePlaylist(playlist: PlaylistInfo, changes: PlaylistChanges): Promise<void>;
}

/** Header, track rows and buttons of the playlist/album page, and the playlist's edit mode. */
export class DetailView {
    private readonly list = qs<HTMLElement>('#detail-list');
    private readonly title = qs<HTMLElement>('#detail-title');
    private readonly subtitle = qs<HTMLElement>('#detail-subtitle');
    private readonly typeLabel = qs<HTMLElement>('#detail-type-label');
    private readonly playBtn = qs<HTMLButtonElement>('#btn-detail-play');
    private readonly shuffleBtn = qs<HTMLButtonElement>('#btn-detail-shuffle');
    private readonly enqueueBtn = qs<HTMLButtonElement>('#btn-detail-enqueue');
    private readonly cover = qs<HTMLImageElement>('#detail-cover');
    private readonly favoriteBtn = qs<HTMLButtonElement>('#btn-detail-favorite');
    private readonly view = qs<HTMLElement>('#detail-view');
    private readonly titleInput = qs<HTMLInputElement>('#detail-title-input');
    private readonly editBtn = qs<HTMLButtonElement>('#btn-detail-edit');
    private readonly renameBtn = qs<HTMLButtonElement>('#btn-detail-rename');
    private readonly removeBtn = qs<HTMLButtonElement>('#btn-detail-remove');
    private readonly saveBtn = qs<HTMLButtonElement>('#btn-detail-save');
    private context: DetailContext | null = null;
    /** Set while the playlist page is in edit mode; nothing reaches Jellyfin until Save. */
    private draft: PlaylistDraft | null = null;
    /** Edit rows by entry uid: moving one keeps its element, and with it the selection and loaded art. */
    private readonly editRows = new Map<number, HTMLTableRowElement>();
    private saving = false;
    /** The draft's name when the name field opened; Escape goes back to it. */
    private renameStart = '';
    /** The entries the cover shows, to rebuild it only when they change. */
    private editCoverKey = '';

    constructor(private readonly options: DetailViewOptions) {
        this.cover?.addEventListener('load', () => this.fitCover());
        this.playBtn?.addEventListener('click', () => this.play(false));
        this.shuffleBtn?.addEventListener('click', () => this.play(true));
        this.enqueueBtn?.addEventListener('click', () => {
            const ids = this.trackIds();
            if (ids.length) this.options.enqueue(ids);
        });
        this.editBtn?.addEventListener('click', () => this.toggleEditing());
        this.renameBtn?.addEventListener('click', () => this.startRename());
        this.removeBtn?.addEventListener('click', () => this.removeSelected());
        this.saveBtn?.addEventListener('click', () => void this.save());
        this.titleInput?.addEventListener('input', () => {
            if (this.draft && this.titleInput) this.draft.name = this.titleInput.value;
            this.renderEditButtons();
        });
        this.titleInput?.addEventListener('blur', () => this.finishRename());
        this.titleInput?.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== 'Escape') return;
            event.preventDefault();
            if (event.key === 'Escape' && this.draft && this.titleInput) {
                this.draft.name = this.renameStart;
                this.titleInput.value = this.renameStart;
                this.renderEditButtons();
            }
            this.titleInput?.blur();
        });
    }

    clear(): void {
        this.context = null;
        this.stopEditing();
    }

    isShowing(playlistId: string): boolean {
        return this.context?.type === 'playlist' && this.context.playlist.id === playlistId;
    }

    showPlaylist(playlist: PlaylistInfo): void {
        this.context = { type: 'playlist', playlist };
        this.stopEditing();
        const source: QueueSource = { type: 'playlist', id: playlist.id };
        this.renderPlaylistHeader(playlist.name, playlist.entries);
        this.renderRows(playlist.entries.map((entry, index) => ({
            trackId: entry.trackId,
            onClick: () => this.options.openTrack(entry.trackId, source, true, index),
        })));
        this.setButtonsEnabled(playlist.entries.length > 0);
        if (this.favoriteBtn) bindFavoriteButton(this.favoriteBtn, playlist);
        // As with "Delete playlist": offered on the user's own playlists. Jellyfin has the last word on Save.
        this.editBtn?.classList.toggle('d-none', !playlist.canDelete);
    }

    showAlbum(album: AlbumInfo): void {
        this.context = { type: 'album', album };
        this.stopEditing();
        this.editBtn?.classList.add('d-none');
        const source: QueueSource = { type: 'album', id: album.id };
        this.renderHeader('Album', album.title, album.artist || 'Unknown artist', [album.coverTrackId]);
        this.renderRows(album.trackIds.map((trackId, index) => ({
            trackId,
            onClick: () => this.options.openTrack(trackId, source, false, index),
        })));
        this.setButtonsEnabled(album.trackIds.length > 0);
        // Albums are grouped client-side; Jellyfin has no item to mark.
        if (this.favoriteBtn) bindFavoriteButton(this.favoriteBtn, null);
    }

    private get source(): QueueSource | null {
        const context = this.context;
        if (!context) return null;
        return context.type === 'playlist'
            ? { type: 'playlist', id: context.playlist.id }
            : { type: 'album', id: context.album.id };
    }

    private trackIds(): string[] {
        const context = this.context;
        if (!context) return [];
        return context.type === 'playlist' ? context.playlist.entries.map((entry) => entry.trackId) : [...context.album.trackIds];
    }

    private play(shuffle: boolean): void {
        const source = this.source;
        if (source) this.options.playCollection(source, shuffle);
    }

    private setButtonsEnabled(enabled: boolean): void {
        for (const button of [this.playBtn, this.shuffleBtn, this.enqueueBtn]) {
            if (button) button.disabled = !enabled;
        }
    }

    private renderPlaylistHeader(name: string, entries: PlaylistEntry[]): void {
        const artists = [...new Set(entries.map((entry) => entry.artist).filter(Boolean))];
        this.renderHeader('Playlist', name, artists.join(', ') || 'Unknown artist', entries.map((entry) => entry.trackId));
    }

    private renderHeader(type: string, title: string, subtitle: string, coverTrackIds: (string | null | undefined)[]): void {
        if (this.typeLabel) this.typeLabel.textContent = type;
        if (this.title) this.title.textContent = title;
        if (this.subtitle) this.subtitle.textContent = subtitle;
        this.renderCover(coverTrackIds);
    }

    private renderCover(trackIds: (string | null | undefined)[]): void {
        if (!this.cover) return;
        const media = this.options.allMedia();
        applyPlaylistCover(this.cover, trackIds.map((id) => media.find((item) => item.id === id)));
        this.cover.style.display = '';
        this.fitCover();
    }

    /** Album covers keep their aspect ratio; playlist covers (and a cover still loading) stay square. */
    private fitCover(): void {
        const cover = this.cover;
        if (!cover) return;
        const { naturalWidth: w, naturalHeight: h } = cover;
        const fit = this.context?.type === 'album' && cover.complete && w > 0 && h > 0;
        cover.classList.toggle('cover-portrait', fit && h > w);
        cover.classList.toggle('cover-landscape', fit && w > h);
    }

    /** The library's list rows; a row whose media HAPPY does not know is left out. */
    private renderRows(rows: DetailRow[]): void {
        if (!this.list) return;
        const tracksById = new Map(this.options.allMedia().map((track) => [track.id, track]));
        this.list.replaceChildren(...rows.flatMap((row) => {
            const track = tracksById.get(row.trackId);
            return track ? [createTrackRow(track, row.onClick)] : [];
        }));
    }

    private toggleEditing(): void {
        if (this.draft) {
            if (!this.draft.changed || window.confirm('Discard your changes to this playlist?')) this.leaveEditing();
            return;
        }
        if (this.context?.type !== 'playlist') return;
        this.draft = new PlaylistDraft(this.context.playlist);
        this.editCoverKey = this.draft.trackIds.slice(0, 4).join('|');
        this.view?.setAttribute('data-editing', '');
        this.editBtn?.setAttribute('aria-pressed', 'true');
        this.setEditButtonLabel('Stop editing');
        this.renderEditRows();
        this.renderEditButtons();
    }

    /** Back to the playlist as it was saved. */
    private leaveEditing(): void {
        if (this.context?.type === 'playlist') this.showPlaylist(this.context.playlist);
    }

    /** Drops the draft, so leaving the page or reopening a playlist discards unsaved edits. */
    private stopEditing(): void {
        this.draft = null;
        this.editRows.clear();
        this.view?.removeAttribute('data-editing');
        this.editBtn?.setAttribute('aria-pressed', 'false');
        this.setEditButtonLabel('Edit playlist');
        this.titleInput?.classList.add('d-none');
        this.title?.classList.remove('d-none');
    }

    private setEditButtonLabel(label: string): void {
        if (!this.editBtn) return;
        this.editBtn.title = label;
        this.editBtn.setAttribute('aria-label', label);
    }

    private renderEditRows(): void {
        const draft = this.draft;
        if (!this.list || !draft) return;
        const tracksById = new Map(this.options.allMedia().map((track) => [track.id, track]));
        this.list.replaceChildren(...draft.entries.flatMap(({ uid, entry }) => {
            const track = tracksById.get(entry.trackId);
            if (!track) return [];
            let row = this.editRows.get(uid);
            if (!row) {
                row = createEditTrackRow(track, {
                    onSelect: (selected) => {
                        draft.select(uid, selected);
                        this.renderEditButtons();
                    },
                    onDragStart: (event) => this.dragRow(event, uid),
                    onStep: (delta) => this.stepRow(uid, delta),
                });
                this.editRows.set(uid, row);
            }
            return [row];
        }));
    }

    private dragRow(event: PointerEvent, uid: number): void {
        const draft = this.draft;
        const list = this.list;
        if (!draft || !list) return;
        const rows = draft.entries.flatMap((item) => this.editRows.get(item.uid) ?? []);
        const from = draft.indexOf(uid);
        startRowDrag({
            event,
            rows,
            from,
            edge: PAGE_DRAG_EDGE_PX,
            onEnd: (to) => {
                // The rows already show the new order: drop their offsets without sliding them again.
                for (const row of rows) {
                    row.style.transition = 'none';
                    row.style.transform = '';
                }
                this.moveRow(from, to);
                void list.offsetHeight;
                for (const row of rows) row.style.transition = '';
            },
        });
    }

    private stepRow(uid: number, delta: -1 | 1): void {
        const draft = this.draft;
        if (!draft) return;
        const from = draft.indexOf(uid);
        this.moveRow(from, from + delta);
        // Moving a row in the DOM takes the focus from its handle.
        this.editRows.get(uid)?.querySelector<HTMLElement>('.playlist-edit-handle')?.focus();
    }

    private moveRow(from: number, to: number): void {
        if (!this.draft?.move(from, to)) return;
        this.renderEditRows();
        this.renderEditChange();
    }

    private removeSelected(): void {
        this.draft?.removeSelected();
        this.renderEditRows();
        this.renderEditChange();
    }

    /** Header and buttons follow the draft, so the cover shows what Save will store. */
    private renderEditChange(): void {
        const draft = this.draft;
        if (!draft) return;
        const artists = [...new Set(draft.entries.map(({ entry }) => entry.artist).filter(Boolean))];
        if (this.subtitle) this.subtitle.textContent = artists.join(', ') || 'Unknown artist';
        // The cover only shows the first four entries; rebuilding it for other moves would make it flicker.
        const coverKey = draft.trackIds.slice(0, 4).join('|');
        if (coverKey !== this.editCoverKey) this.renderCover(draft.trackIds);
        this.editCoverKey = coverKey;
        this.setButtonsEnabled(draft.entries.length > 0);
        this.renderEditButtons();
    }

    private renderEditButtons(): void {
        const draft = this.draft;
        if (!draft) return;
        if (this.removeBtn) this.removeBtn.disabled = !draft.hasSelection;
        if (this.saveBtn) {
            this.saveBtn.disabled = this.saving || !draft.canSave;
            const empty = draft.entries.length === 0;
            this.saveBtn.title = empty ? 'A playlist needs at least one file' : 'Save changes';
        }
    }

    private startRename(): void {
        const { draft, titleInput, title } = this;
        if (!draft || !titleInput) return;
        this.renameStart = draft.name;
        titleInput.value = draft.name;
        titleInput.classList.remove('d-none');
        title?.classList.add('d-none');
        titleInput.focus();
        titleInput.select();
    }

    private finishRename(): void {
        const { draft, titleInput, title } = this;
        if (!draft || !titleInput || titleInput.classList.contains('d-none')) return;
        if (!draft.name.trim()) draft.name = this.renameStart;
        if (title) title.textContent = draft.name.trim();
        titleInput.classList.add('d-none');
        title?.classList.remove('d-none');
        this.renderEditButtons();
    }

    private async save(): Promise<void> {
        const context = this.context;
        const draft = this.draft;
        if (context?.type !== 'playlist' || !draft?.canSave || this.saving) return;
        this.saving = true;
        this.renderEditButtons();
        try {
            await this.options.savePlaylist(context.playlist, draft.changes);
        } finally {
            this.saving = false;
            this.renderEditButtons();
        }
    }
}
