import test from 'node:test';
import assert from 'node:assert/strict';
import {
    albumHasFavorite,
    albumMatchesActiveTags,
    applyAlbumDisplay,
    artistTagValue,
    countMediaMatches,
    filterAvailableTags,
    groupedTrackIds,
    isAlbumDisplayMode,
    isArtistTag,
    makeArtistTag,
    playlistMatchesActiveTags,
    reachableTags,
    sortLibraryItems,
    splitActiveTags,
    trackMatchesActiveTags,
} from '../../src/shared/libraryFiltering';

const TAG = '[shared:libraryFiltering]';

function item(title: string, overrides: Partial<{ typeLabel: string; artist: string; year: string; durationSeconds: number }> = {}) {
    return { title, typeLabel: 'Audio', artist: '', year: '', durationSeconds: 0, ...overrides };
}

test(`${TAG} sortLibraryItems mixes media types into one order`, () => {
    const items = [
        item('Beta', { typeLabel: 'Album' }),
        item('alpha', { typeLabel: 'Video' }),
        item('Track 10'),
        item('Track 2', { typeLabel: 'Playlist' }),
    ];
    assert.deepEqual(sortLibraryItems(items, 'title', true).map((i) => i.title), ['alpha', 'Beta', 'Track 2', 'Track 10']);
    assert.deepEqual(sortLibraryItems(items, 'title', false).map((i) => i.title), ['Track 10', 'Track 2', 'Beta', 'alpha']);
});

test(`${TAG} sortLibraryItems puts empty values last in both directions`, () => {
    const items = [item('A', { year: '' }), item('B', { year: '2001' }), item('C', { year: '1999' })];
    assert.deepEqual(sortLibraryItems(items, 'year', true).map((i) => i.title), ['C', 'B', 'A']);
    assert.deepEqual(sortLibraryItems(items, 'year', false).map((i) => i.title), ['B', 'C', 'A']);
});

test(`${TAG} sortLibraryItems sorts duration numerically with title as tie-breaker`, () => {
    const items = [item('B', { durationSeconds: 90 }), item('A', { durationSeconds: 90 }), item('C', { durationSeconds: 5 })];
    assert.deepEqual(sortLibraryItems(items, 'duration', true).map((i) => i.title), ['C', 'A', 'B']);
    assert.deepEqual(sortLibraryItems(items, 'duration', false).map((i) => i.title), ['A', 'B', 'C']);
});

test(`${TAG} artist tag helpers round-trip`, () => {
    assert.equal(makeArtistTag('Kinkyshibby'), 'artist:Kinkyshibby');
    assert.equal(isArtistTag('artist:Kinkyshibby'), true);
    assert.equal(isArtistTag('Artist:Kinkyshibby'), true);
    assert.equal(isArtistTag('kinky'), false);
    assert.equal(artistTagValue('artist:Kinkyshibby'), 'Kinkyshibby');
    assert.equal(artistTagValue('kinky'), 'kinky');
});

test(`${TAG} filterAvailableTags excludes selected and artist tags and applies query`, () => {
    const all = ['ASMR', 'artist:Foo', 'sfw', 'story'];
    assert.deepEqual(filterAvailableTags(all, ['asmr'], ''), ['sfw', 'story']);
    assert.deepEqual(filterAvailableTags(all, [], 'S'), ['ASMR', 'sfw', 'story']);
    assert.deepEqual(filterAvailableTags(all, [], 'st'), ['story']);
});

test(`${TAG} countMediaMatches counts per media type and ignores artist entries`, () => {
    const track = (id: string, tags: string[]) => ({ id, tags, artist: 'A', funscripts: [] }) as never;
    const library = {
        tracks: [track('t1', ['asmr']), track('t2', ['sfw'])],
        videos: [track('v1', ['asmr'])],
        albums: [{ trackIds: ['t1'] }, { trackIds: ['t2'] }] as never[],
        playlists: [{ entries: [{ trackId: 't2' }] }] as never[],
    };
    assert.deepEqual(countMediaMatches(library, []), { albums: 2, tracks: 2, playlists: 1, videos: 1 });
    assert.deepEqual(countMediaMatches(library, ['asmr', 'artist:Nobody']), { albums: 1, tracks: 1, playlists: 0, videos: 1 });
});

test(`${TAG} reachableTags keeps only tags that still leave a match`, () => {
    const track = (id: string, tags: string[]) => ({ id, tags, artist: 'A', funscripts: [] }) as never;
    const library = {
        tracks: [track('t1', ['Anal', 'asmr']), track('t2', ['no anal', 'asmr']), track('t3', ['sfw'])],
        videos: [track('v1', ['anal', 'story'])],
        albums: [{ trackIds: ['t1', 't3'] }],
        playlists: [],
    };
    assert.deepEqual([...reachableTags(library, [])].sort(), ['anal', 'asmr', 'no anal', 'sfw', 'story']);
    // 'no anal' never appears together with 'anal'; 'sfw' does through the album t1 + t3.
    assert.deepEqual([...reachableTags(library, ['anal'])].sort(), ['anal', 'asmr', 'sfw', 'story']);
    assert.deepEqual([...reachableTags(library, ['anal', 'asmr', 'artist:Nobody'])].sort(), ['anal', 'asmr', 'sfw']);
    assert.deepEqual([...reachableTags(library, ['missing'])], []);
});

test(`${TAG} splitActiveTags separates artists from plain tags`, () => {
    assert.deepEqual(splitActiveTags(['asmr', 'artist:Kinkyshibby', 'sfw']), {
        tags: ['asmr', 'sfw'],
        artists: ['Kinkyshibby'],
    });
});

test(`${TAG} trackMatchesActiveTags honours artist filters case-insensitively`, () => {
    assert.equal(trackMatchesActiveTags(['asmr'], ['artist:kinkyshibby'], 'Kinkyshibby'), true);
    assert.equal(trackMatchesActiveTags(['asmr'], ['artist:kinkyshibby'], 'Someone Else'), false);
    assert.equal(trackMatchesActiveTags(['asmr'], ['artist:Kinkyshibby', 'asmr'], 'Kinkyshibby'), true);
    assert.equal(trackMatchesActiveTags(['asmr'], ['artist:Kinkyshibby', 'sfw'], 'Kinkyshibby'), false);
});

test(`${TAG} multiple artist filters are OR-ed`, () => {
    const filters = ['artist:A', 'artist:B'];
    assert.equal(trackMatchesActiveTags([], filters, 'A'), true);
    assert.equal(trackMatchesActiveTags([], filters, 'B'), true);
    assert.equal(trackMatchesActiveTags([], filters, 'C'), false);
});

test(`${TAG} albumMatchesActiveTags matches on album or member track artist`, () => {
    const tracksById = new Map([['t1', { tags: ['asmr'], funscripts: [], artist: 'Track Artist' }]]);
    const album = { trackIds: ['t1'], artist: 'Kinkyshibby' };
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Kinkyshibby']), true);
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Track Artist']), true);
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Nobody']), false);
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Kinkyshibby', 'asmr']), true);
    assert.equal(albumMatchesActiveTags(album, tracksById, ['artist:Kinkyshibby', 'sfw']), false);
});

test(`${TAG} playlistMatchesActiveTags matches on entry artist`, () => {
    const tracksById = new Map([['t1', { tags: ['asmr'], funscripts: [], artist: 'Track Artist' }]]);
    const playlist = { entries: [{ trackId: 't1', artist: 'Entry Artist' }] } as any;
    assert.equal(playlistMatchesActiveTags(playlist, tracksById, ['artist:Entry Artist']), true);
    assert.equal(playlistMatchesActiveTags(playlist, tracksById, ['artist:Track Artist']), true);
    assert.equal(playlistMatchesActiveTags(playlist, tracksById, ['artist:Nobody']), false);
});

test(`${TAG} an album is a favorite when any of its tracks is`, () => {
    const tracksById = new Map([['t1', { isFavorite: false }], ['t2', { isFavorite: true }]]);
    assert.equal(albumHasFavorite({ trackIds: ['t1', 't2'] }, tracksById), true);
    assert.equal(albumHasFavorite({ trackIds: ['t1', 'missing'] }, tracksById), false);
    assert.equal(albumHasFavorite({ trackIds: [] }, tracksById), false);
});

const DISPLAY_ALBUMS = [
    { id: 'album-ab', trackIds: ['a', 'b'] },
    { id: 'album-c', trackIds: ['c'] },
];
const DISPLAY_TRACKS = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
const ids = (items: { id: string }[]) => items.map((entry) => entry.id);

test(`${TAG} groupedTrackIds only counts albums of more than one track`, () => {
    assert.deepEqual([...groupedTrackIds(DISPLAY_ALBUMS)], ['a', 'b']);
});

test(`${TAG} applyAlbumDisplay shows albums and tracks by default`, () => {
    const result = applyAlbumDisplay('albums-tracks', DISPLAY_ALBUMS, DISPLAY_TRACKS, DISPLAY_ALBUMS);
    assert.deepEqual(ids(result.albums), ['album-ab', 'album-c']);
    assert.deepEqual(ids(result.tracks), ['a', 'b', 'c', 'd']);
});

test(`${TAG} applyAlbumDisplay 'albums' hides the tracks of grouping albums`, () => {
    const result = applyAlbumDisplay('albums', DISPLAY_ALBUMS, DISPLAY_TRACKS, DISPLAY_ALBUMS);
    assert.deepEqual(ids(result.albums), ['album-ab', 'album-c']);
    assert.deepEqual(ids(result.tracks), ['c', 'd']);
});

test(`${TAG} applyAlbumDisplay 'albums' hides grouped tracks even when their album is filtered out`, () => {
    const result = applyAlbumDisplay('albums', [], DISPLAY_TRACKS, DISPLAY_ALBUMS);
    assert.deepEqual(ids(result.tracks), ['c', 'd']);
});

test(`${TAG} applyAlbumDisplay 'tracks' hides grouping albums but keeps all tracks`, () => {
    const result = applyAlbumDisplay('tracks', DISPLAY_ALBUMS, DISPLAY_TRACKS, DISPLAY_ALBUMS);
    assert.deepEqual(ids(result.albums), ['album-c']);
    assert.deepEqual(ids(result.tracks), ['a', 'b', 'c', 'd']);
});

test(`${TAG} isAlbumDisplayMode accepts only known modes`, () => {
    assert.ok(isAlbumDisplayMode('albums'));
    assert.ok(!isAlbumDisplayMode('both'));
});
