import type { PlaylistEntry, PlaylistInfo } from '../../../shared/types';

export interface DraftEntry {
    /** A playlist can hold the same track twice, so nothing addresses entries by track id. */
    uid: number;
    entry: PlaylistEntry;
}

/** What Save sends: only what differs from the stored playlist. */
export interface PlaylistChanges {
    name?: string;
    trackIds?: string[];
}

/**
 * The playlist page's edit mode: order, selection and name as the user left them.
 * Nothing here reaches Jellyfin until `changes` is saved, and dropping the draft
 * drops the edits.
 */
export class PlaylistDraft {
    name: string;
    entries: DraftEntry[];
    private readonly selected = new Set<number>();
    private readonly savedName: string;
    private readonly savedTrackIds: string[];

    constructor(playlist: PlaylistInfo) {
        this.name = playlist.name;
        this.savedName = playlist.name;
        this.entries = playlist.entries.map((entry, uid) => ({ uid, entry }));
        this.savedTrackIds = playlist.entries.map((entry) => entry.trackId);
    }

    get trackIds(): string[] {
        return this.entries.map(({ entry }) => entry.trackId);
    }

    get hasSelection(): boolean {
        return this.selected.size > 0;
    }

    private get nameChanged(): boolean {
        return this.name.trim() !== this.savedName;
    }

    private get orderChanged(): boolean {
        const ids = this.trackIds;
        return ids.length !== this.savedTrackIds.length || ids.some((id, index) => id !== this.savedTrackIds[index]);
    }

    get changed(): boolean {
        return this.nameChanged || this.orderChanged;
    }

    /** HAPPY hides empty playlists, so emptying one would strand it in Jellyfin. */
    get canSave(): boolean {
        return this.changed && this.entries.length > 0 && this.name.trim().length > 0;
    }

    get changes(): PlaylistChanges {
        return {
            ...(this.nameChanged ? { name: this.name.trim() } : {}),
            ...(this.orderChanged ? { trackIds: this.trackIds } : {}),
        };
    }

    indexOf(uid: number): number {
        return this.entries.findIndex((item) => item.uid === uid);
    }

    select(uid: number, selected: boolean): void {
        if (selected) this.selected.add(uid);
        else this.selected.delete(uid);
    }

    /** Resolves to whether the entry moved; a target outside the list leaves it where it is. */
    move(from: number, to: number): boolean {
        if (from === to || from < 0 || to < 0 || from >= this.entries.length || to >= this.entries.length) return false;
        const [item] = this.entries.splice(from, 1);
        this.entries.splice(to, 0, item);
        return true;
    }

    removeSelected(): void {
        this.entries = this.entries.filter((item) => !this.selected.has(item.uid));
        this.selected.clear();
    }
}
