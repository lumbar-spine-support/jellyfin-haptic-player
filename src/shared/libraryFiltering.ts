import type { AlbumInfo, FunscriptType, PlaylistInfo, TrackInfo } from './types';

export const LIBRARY_SORT_FIELDS = ['title', 'artist', 'year', 'duration', 'type'] as const;
export type LibrarySortField = typeof LIBRARY_SORT_FIELDS[number];

export interface SortableLibraryItem {
  typeLabel: string;
  title: string;
  artist: string;
  year: string;
  durationSeconds: number;
}

/**
 * How albums of more than one track appear in the library: as album and tracks, only as the album,
 * or only as their tracks. Albums of a single track are not a grouping and always show as the track only.
 */
export const ALBUM_DISPLAY_MODES = ['albums-tracks', 'albums', 'tracks'] as const;
export type AlbumDisplayMode = typeof ALBUM_DISPLAY_MODES[number];

export function isAlbumDisplayMode(value: unknown): value is AlbumDisplayMode {
  return (ALBUM_DISPLAY_MODES as readonly unknown[]).includes(value);
}

/** An album groups tracks only when it has more than one. */
export function isGroupingAlbum(album: Pick<AlbumInfo, 'trackIds'>): boolean {
  return album.trackIds.length > 1;
}

/** Ids of the tracks that belong to an album of more than one track. */
export function groupedTrackIds(albums: readonly Pick<AlbumInfo, 'trackIds'>[]): Set<string> {
  const ids = new Set<string>();
  for (const album of albums) {
    if (isGroupingAlbum(album)) for (const id of album.trackIds) ids.add(id);
  }
  return ids;
}

/**
 * Drops what `mode` hides: the tracks of grouping albums ('albums') or the grouping albums
 * themselves ('tracks'). Single-track albums are always dropped, in every mode, since their track
 * shows instead. `allAlbums` decides which tracks are grouped, so a track stays hidden even when
 * its album is filtered out.
 */
export function applyAlbumDisplay<A extends Pick<AlbumInfo, 'trackIds'>, T extends Pick<TrackInfo, 'id'>>(
  mode: AlbumDisplayMode,
  albums: readonly A[],
  tracks: readonly T[],
  allAlbums: readonly Pick<AlbumInfo, 'trackIds'>[],
): { albums: A[]; tracks: T[] } {
  if (mode === 'tracks') return { albums: [], tracks: [...tracks] };
  const grouping = albums.filter(isGroupingAlbum);
  if (mode === 'albums') {
    const grouped = groupedTrackIds(allAlbums);
    return { albums: grouping, tracks: tracks.filter((track) => !grouped.has(track.id)) };
  }
  return { albums: grouping, tracks: [...tracks] };
}

function sortValue(item: SortableLibraryItem, field: LibrarySortField): string | number {
  if (field === 'type') return item.typeLabel;
  if (field === 'duration') return item.durationSeconds;
  return item[field];
}

const isEmptySortValue = (value: string | number): boolean => value === '' || value === 0;

/** Sorts items by one field; empty values always go last and ties fall back to title. */
export function sortLibraryItems<T extends SortableLibraryItem>(
  items: readonly T[],
  field: LibrarySortField,
  asc: boolean,
): T[] {
  const compareText = (a: string, b: string): number =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return [...items].sort((a, b) => {
    const va = sortValue(a, field);
    const vb = sortValue(b, field);
    const emptyA = isEmptySortValue(va);
    const emptyB = isEmptySortValue(vb);
    if (emptyA !== emptyB) return emptyA ? 1 : -1;
    let cmp = 0;
    if (!emptyA) {
      cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : compareText(String(va), String(vb));
      if (!asc) cmp = -cmp;
    }
    return cmp !== 0 ? cmp : compareText(a.title, b.title);
  });
}

/** Prefix marking an active filter entry as an artist filter rather than a real file tag. */
export const ARTIST_TAG_PREFIX = 'artist:';

export function makeArtistTag(artist: string): string {
  return `${ARTIST_TAG_PREFIX}${artist}`;
}

export function isArtistTag(tag: string): boolean {
  return tag.toLowerCase().startsWith(ARTIST_TAG_PREFIX);
}

export function artistTagValue(tag: string): string {
  return isArtistTag(tag) ? tag.slice(ARTIST_TAG_PREFIX.length) : tag;
}

/** Splits a list of active filter entries into plain tags and artist names. */
export function splitActiveTags(activeTags: readonly string[]): { tags: string[]; artists: string[] } {
  const tags: string[] = [];
  const artists: string[] = [];
  for (const entry of activeTags) {
    if (isArtistTag(entry)) artists.push(artistTagValue(entry));
    else tags.push(entry);
  }
  return { tags, artists };
}

/** Tags not yet selected, excluding artist entries, narrowed by a case-insensitive query. */
export function filterAvailableTags(
  allTags: readonly string[],
  activeTags: readonly string[],
  query: string,
): string[] {
  const selected = new Set(activeTags.map((tag) => tag.toLowerCase()));
  const q = query.trim().toLowerCase();
  return allTags.filter((tag) =>
    !isArtistTag(tag) && !selected.has(tag.toLowerCase()) && (!q || tag.toLowerCase().includes(q)));
}

/**
 * Lower-cased tags that can still be added to the plain tags in `activeTags` with at least one
 * album, track, playlist or video left matching (the items `countMediaMatches` counts). Albums and
 * playlists carry the tags of all their tracks. Artist entries are ignored.
 */
export function reachableTags(
  library: {
    tracks: readonly TrackInfo[];
    videos: readonly TrackInfo[];
    albums: readonly Pick<AlbumInfo, 'trackIds'>[];
    playlists: readonly Pick<PlaylistInfo, 'entries'>[];
  },
  activeTags: readonly string[],
): Set<string> {
  const { tags } = splitActiveTags(activeTags);
  const required = tags.map((tag) => tag.toLowerCase());
  const tracksById = new Map([...library.tracks, ...library.videos].map((track) => [track.id, track]));
  const reachable = new Set<string>();
  const collect = (trackIds: Iterable<string>): void => {
    const itemTags = new Set<string>();
    for (const trackId of trackIds) {
      for (const tag of tracksById.get(trackId)?.tags ?? []) itemTags.add(tag.toLowerCase());
    }
    if (!required.every((tag) => itemTags.has(tag))) return;
    for (const tag of itemTags) reachable.add(tag);
  };
  for (const track of [...library.tracks, ...library.videos]) collect([track.id]);
  for (const album of library.albums) collect(album.trackIds);
  for (const playlist of library.playlists) collect(playlist.entries.map((entry) => entry.trackId));
  return reachable;
}

export type MediaCounts = { albums: number; tracks: number; playlists: number; videos: number };

/**
 * Counts items per media type matching the plain tags in `activeTags`; artist entries are ignored.
 * Single-track albums are not counted as albums, since the library shows them as their track.
 */
export function countMediaMatches(
  library: {
    tracks: readonly TrackInfo[];
    videos: readonly TrackInfo[];
    albums: readonly AlbumInfo[];
    playlists: readonly PlaylistInfo[];
  },
  activeTags: readonly string[],
): MediaCounts {
  const { tags } = splitActiveTags(activeTags);
  const tracksById = new Map([...library.tracks, ...library.videos].map((track) => [track.id, track]));
  return {
    albums: library.albums.filter((album) => isGroupingAlbum(album) && albumMatchesActiveTags(album, tracksById, tags)).length,
    tracks: library.tracks.filter((track) => trackMatchesActiveTags(track.tags, tags)).length,
    playlists: library.playlists.filter((playlist) => playlistMatchesActiveTags(playlist, tracksById, tags)).length,
    videos: library.videos.filter((video) => trackMatchesActiveTags(video.tags, tags)).length,
  };
}

/** Artist filters are OR-ed together, since a single item rarely has more than one artist. */
function matchesArtists(available: Iterable<string>, artists: readonly string[]): boolean {
  if (artists.length === 0) return true;
  const normalized = new Set<string>();
  for (const artist of available) normalized.add(artist.toLowerCase());
  return artists.some((artist) => normalized.has(artist.toLowerCase()));
}

export function trackMatchesActiveTags(
  trackTags: readonly string[],
  activeTags: readonly string[],
  trackArtist = '',
): boolean {
  if (activeTags.length === 0) return true;
  const { tags, artists } = splitActiveTags(activeTags);
  if (!matchesArtists([trackArtist], artists)) return false;
  const normalizedTrackTags = new Set(trackTags.map((tag) => tag.toLowerCase()));
  return tags.every((tag) => normalizedTrackTags.has(tag.toLowerCase()));
}

export function trackMatchesHapticFilters(
  track: Pick<TrackInfo, 'funscripts'>,
  allowedHapticTypes: readonly FunscriptType[],
): boolean {
  if (allowedHapticTypes.length === 0) return true;
  const available = new Set(track.funscripts.map((funscript) => funscript.type));
  return allowedHapticTypes.every((type) => available.has(type));
}

export function albumMatchesActiveTags(
  album: Pick<AlbumInfo, 'trackIds'> & { artist?: string },
  tracksById: Map<string, Pick<TrackInfo, 'tags' | 'funscripts'> & { artist?: string }>,
  activeTags: readonly string[],
): boolean {
  if (activeTags.length === 0) return true;
  const { tags, artists } = splitActiveTags(activeTags);
  const available = new Set<string>();
  const availableArtists = new Set<string>();
  if (album.artist) availableArtists.add(album.artist);
  for (const trackId of album.trackIds) {
    const track = tracksById.get(trackId);
    if (!track) continue;
    if (track.artist) availableArtists.add(track.artist);
    for (const tag of track.tags) {
      available.add(tag.toLowerCase());
    }
  }
  if (!matchesArtists(availableArtists, artists)) return false;
  return tags.every((tag) => available.has(tag.toLowerCase()));
}

export function albumMatchesHapticFilters(
  album: Pick<AlbumInfo, 'trackIds'>,
  tracksById: Map<string, Pick<TrackInfo, 'funscripts'>>,
  allowedHapticTypes: readonly FunscriptType[],
): boolean {
  if (allowedHapticTypes.length === 0) return true;
  const available = new Set<FunscriptType>();
  for (const trackId of album.trackIds) {
    const track = tracksById.get(trackId);
    if (!track) continue;
    for (const funscript of track.funscripts) {
      available.add(funscript.type);
    }
  }
  return allowedHapticTypes.every((type) => available.has(type));
}

export function playlistMatchesActiveTags(
  playlist: Pick<PlaylistInfo, 'entries'>,
  tracksById: Map<string, Pick<TrackInfo, 'tags' | 'funscripts'> & { artist?: string }>,
  activeTags: readonly string[],
): boolean {
  if (activeTags.length === 0) return true;
  const { tags, artists } = splitActiveTags(activeTags);
  const available = new Set<string>();
  const availableArtists = new Set<string>();
  for (const entry of playlist.entries) {
    if (entry.artist) availableArtists.add(entry.artist);
    const track = tracksById.get(entry.trackId);
    if (!track) continue;
    if (track.artist) availableArtists.add(track.artist);
    for (const tag of track.tags) {
      available.add(tag.toLowerCase());
    }
  }
  if (!matchesArtists(availableArtists, artists)) return false;
  return tags.every((tag) => available.has(tag.toLowerCase()));
}

export function playlistMatchesHapticFilters(
  playlist: Pick<PlaylistInfo, 'entries'>,
  tracksById: Map<string, Pick<TrackInfo, 'funscripts'>>,
  allowedHapticTypes: readonly FunscriptType[],
): boolean {
  if (allowedHapticTypes.length === 0) return true;
  const available = new Set<FunscriptType>();
  for (const entry of playlist.entries) {
    const track = tracksById.get(entry.trackId);
    if (!track) continue;
    for (const funscript of track.funscripts) {
      available.add(funscript.type);
    }
  }
  return allowedHapticTypes.every((type) => available.has(type));
}

/** Albums are grouped client-side and have no Jellyfin favorite of their own: one favorite track makes the album one. */
export function albumHasFavorite(
  album: Pick<AlbumInfo, 'trackIds'>,
  tracksById: Map<string, Pick<TrackInfo, 'isFavorite'>>,
): boolean {
  return album.trackIds.some((trackId) => tracksById.get(trackId)?.isFavorite === true);
}
