import test from 'node:test';
import assert from 'node:assert/strict';
import type { JellyfinItemDto } from '../../src/client/jellyfin/dto';
import { buildLibrary, toTrack, type MapOptions } from '../../src/client/jellyfin/mapper';
import { buildAlbums, buildSeasons } from '../../src/shared/albums';
import { displayTitle, episodeCode } from '../../src/shared/episodes';
import { applyGroupDisplay, countMediaMatches, trackCategory } from '../../src/shared/libraryFiltering';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../../src/shared/funscriptNames';

const TAG = '[client:movies-tv]';

const OPTIONS: MapOptions = { funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES, chapterSourcePriority: ['embedded'] };

const MOVIE: JellyfinItemDto = {
    Id: 'm1',
    Name: 'A Film',
    Type: 'Movie',
    MediaType: 'Video',
    Path: '/media/movies/A Film (2020)/A Film.mkv',
    ProductionYear: 2020,
    People: [
        { Name: 'Actor One', Type: 'Actor' },
        { Name: 'Some Producer', Type: 'Producer' },
        { Name: 'First Director', Type: 'Director' },
        { Name: 'Second Director', Type: 'Director' },
        { Name: 'First Director', Type: 'Director' },
    ],
};

function episode(id: string, season: number, number: number, overrides: Partial<JellyfinItemDto> = {}): JellyfinItemDto {
    return {
        Id: id,
        Name: `Episode ${number}`,
        Type: 'Episode',
        MediaType: 'Video',
        Path: `/media/tv/Show/Season ${season}/Show S${season}E${number}.mkv`,
        SeriesName: 'Show',
        SeriesId: 'series1',
        SeriesPrimaryImageTag: 'poster-tag',
        SeasonId: `season${season}`,
        SeasonName: `Season ${season}`,
        ParentIndexNumber: season,
        IndexNumber: number,
        RunTimeTicks: 60 * 10_000_000,
        ImageTags: { Primary: `still-${id}` },
        People: [{ Name: `Director ${number}`, Type: 'Director' }],
        ...overrides,
    };
}

test(`${TAG} movies show their directors as artist, each once`, () => {
    const track = toTrack(MOVIE, undefined, OPTIONS)!;
    assert.equal(track.kind, 'movie');
    assert.equal(track.artist, 'First Director, Second Director');
    assert.equal(track.episode, undefined);
});

test(`${TAG} producers stand in when no director is listed; music artists win over both`, () => {
    const producersOnly = toTrack({ ...MOVIE, People: [{ Name: 'P', Type: 'Producer' }, { Name: 'A', Type: 'Actor' }] }, undefined, OPTIONS)!;
    assert.equal(producersOnly.artist, 'P');
    const nobody = toTrack({ ...MOVIE, People: [{ Name: 'A', Type: 'Actor' }] }, undefined, OPTIONS)!;
    assert.equal(nobody.artist, '');
    const music = toTrack({ ...MOVIE, Type: 'MusicVideo', AlbumArtist: 'Band' }, undefined, OPTIONS)!;
    assert.equal(music.artist, 'Band');
    assert.equal(music.kind, undefined);
});

test(`${TAG} episodes carry their series and season`, () => {
    const track = toTrack(episode('e1', 3, 9), undefined, OPTIONS)!;
    assert.equal(track.kind, 'episode');
    assert.deepEqual(track.episode, {
        seriesId: 'series1',
        seriesName: 'Show',
        seasonId: 'season3',
        seasonName: 'Season 3',
        season: 3,
        episode: 9,
        seriesArtworkTag: 'poster-tag',
    });
    assert.equal(track.trackNumber, 9);
});

test(`${TAG} seasons group episodes in episode order with the series poster`, () => {
    const library = buildLibrary(
        [episode('e2', 1, 2), episode('e1', 1, 1), episode('e3', 2, 1), MOVIE],
        {}, [], OPTIONS);
    const seasons = library.albums.filter((album) => album.kind === 'season');
    assert.deepEqual(seasons.map((s) => s.title), ['Show – Season 1', 'Show – Season 2']);
    assert.deepEqual(seasons[0].trackIds, ['e1', 'e2']);
    assert.equal(seasons[0].artist, 'Director 1, Director 2');
    assert.deepEqual(seasons[0].artwork, { itemId: 'series1', tag: 'poster-tag' });
    assert.equal(seasons[0].type, 'album');
    // Episodes and movies are not music albums, whatever album tag they carry.
    assert.equal(library.albums.filter((album) => album.kind !== 'season').length, 0);
});

test(`${TAG} episodes never join music albums, and seasons cap their artist list`, () => {
    const episodes = [1, 2, 3, 4].map((n) => ({ ...toTrack(episode(`e${n}`, 1, n), undefined, OPTIONS)!, album: 'Tagged' }));
    assert.deepEqual(buildAlbums(episodes), []);
    const [season] = buildSeasons(episodes);
    assert.equal(season.artist, 'Director 1, Director 2, Director 3, …');
});

test(`${TAG} episodes without a season item group by series and season number`, () => {
    const tracks = [episode('a', 0, 1), episode('b', 0, 2)].map((item) =>
        toTrack({ ...item, SeasonId: null, SeasonName: null }, undefined, OPTIONS)!);
    const seasons = buildSeasons(tracks);
    assert.equal(seasons.length, 1);
    assert.equal(seasons[0].title, 'Show – Season 0');
});

test(`${TAG} episode titles get their code and, optionally, the series name`, () => {
    const track = toTrack(episode('e1', 3, 9, { Name: 'The Rains' }), undefined, OPTIONS)!;
    assert.equal(displayTitle(track, true), 'S03E09 The Rains – Show');
    assert.equal(displayTitle(track, false), 'S03E09 The Rains');
    assert.equal(displayTitle({ title: 'Plain' }, true), 'Plain');
    assert.equal(episodeCode({ season: null, episode: 4 }), 'E04');
    assert.equal(episodeCode({ season: 12, episode: null }), 'S12');
    assert.equal(episodeCode({ season: null, episode: null }), '');
});

test(`${TAG} every track belongs to one media category`, () => {
    assert.equal(trackCategory({ type: 'audio' }), 'tracks');
    assert.equal(trackCategory({ type: 'video' }), 'videos');
    assert.equal(trackCategory({ type: 'video', kind: 'movie' }), 'movies');
    assert.equal(trackCategory({ type: 'video', kind: 'episode' }), 'series');
});

test(`${TAG} album and season display apply independently`, () => {
    const library = buildLibrary([episode('e1', 1, 1), episode('e2', 1, 2), MOVIE], {}, [], OPTIONS);
    const music = { id: 'al', trackIds: ['t1', 't2'] };
    const albums = [...library.albums, music];
    const tracks = [...library.videos, { id: 't1' }, { id: 't2' }];

    const seasonsOnly = applyGroupDisplay('albums-tracks', 'albums', albums, tracks, albums);
    assert.deepEqual(seasonsOnly.tracks.map((t) => t.id), ['m1', 't1', 't2']);
    assert.equal(seasonsOnly.albums.length, 2);

    const episodesOnly = applyGroupDisplay('albums', 'tracks', albums, tracks, albums);
    assert.deepEqual(episodesOnly.tracks.map((t) => t.id), ['m1', 'e1', 'e2']);
    assert.deepEqual(episodesOnly.albums, [music]);
});

test(`${TAG} counts split movies and TV episodes from other videos`, () => {
    const library = buildLibrary(
        [episode('e1', 1, 1), episode('e2', 1, 2), MOVIE, { ...MOVIE, Id: 'v1', Type: 'Video' }],
        {}, [], OPTIONS);
    assert.deepEqual(countMediaMatches(library, []), { albums: 0, tracks: 0, playlists: 0, videos: 1, movies: 1, series: 2 });
});
