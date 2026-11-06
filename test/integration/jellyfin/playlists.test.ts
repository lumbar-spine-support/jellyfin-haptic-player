import test from 'node:test';
import assert from 'node:assert/strict';

import { login, skip, type JellyfinSession } from './session';
import { loadLibrary } from '../../../src/client/jellyfin/library';
import { toPlaylist } from '../../../src/client/jellyfin/mapper';
import { canOverwritePlaylist, createPlaylist, deletePlaylist, loadPlaylist, updatePlaylist } from '../../../src/client/jellyfin/playlists';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../../../src/shared/funscriptNames';
import type { TrackInfo } from '../../../src/shared/types';

let session: JellyfinSession;
let media: TrackInfo[];
const created: string[] = [];

/**
 * Jellyfin finishes creating a playlist after `POST /Playlists` returns; a delete that
 * arrives before that is undone and leaves an ownerless playlist only an admin can remove.
 * An update arriving that early is undone too.
 */
const settle = () => new Promise((resolve) => setTimeout(resolve, 2000));

async function playlistIds(): Promise<string[]> {
    const res = await session.request(`/Items?userId=${session.userId}&Recursive=true&IncludeItemTypes=Playlist`);
    return ((await res.json()) as { Items: { Id: string }[] }).Items.map((item) => item.Id);
}

test.before(async () => {
    if (skip) return;
    session = await login('playlists');
    const library = await loadLibrary(session, {
        funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES,
        chapterSourcePriority: ['embedded'],
    });
    // Audio first, then video: a saved queue may mix both.
    media = [...library.tracks.slice(0, 2), ...library.videos.slice(0, 1)];
});

test.after(async () => {
    // Saved queues are real playlists of the test user; never leave one behind.
    if (created.length) await settle();
    for (const id of created) await deletePlaylist(session, id);
    await session?.logout();
});

test('[jellyfin-playlists] a queue saves as a playlist and can be written back', { skip }, async (t) => {
    if (media.length < 2) {
        t.skip('needs at least two playable items');
        return;
    }
    const ids = media.map((track) => track.id);
    // The same item twice, as a queue may hold it.
    const queued = [...ids, ids[0]];
    const tracksById = new Map(media.map((track) => [track.id, track]));

    const id = await createPlaylist(session, 'HAPPY integration test queue', queued);
    created.push(id);
    assert.match(id, /^[0-9a-f]{32}$/);

    const saved = toPlaylist(await loadPlaylist(session, id), tracksById);
    assert.equal(saved.id, id);
    assert.deepEqual(saved.entries.map((entry) => entry.trackId), queued, 'keeps order, duplicates and media types');

    const visibility = await (await session.request(`/Playlists/${id}`)).json() as { OpenAccess?: boolean };
    assert.equal(visibility.OpenAccess, false, 'saved queues are private');

    assert.equal(await canOverwritePlaylist(session, id, queued), true, 'the owner may write back what HAPPY loaded');
    assert.equal(await canOverwritePlaylist(session, id, queued.slice(1)), false,
        'a playlist that differs from what HAPPY loaded is left alone');

    // Updates that land before the playlist settled are undone as well, name and entries alike.
    await settle();
    const reordered = [...queued].reverse().slice(1);
    await updatePlaylist(session, id, { itemIds: reordered });
    const rewritten = toPlaylist(await loadPlaylist(session, id), tracksById);
    assert.deepEqual(rewritten.entries.map((entry) => entry.trackId), reordered);

    await updatePlaylist(session, id, { name: 'HAPPY integration test renamed' });
    const renamed = toPlaylist(await loadPlaylist(session, id), tracksById);
    assert.equal(renamed.name, 'HAPPY integration test renamed');
    assert.deepEqual(renamed.entries.map((entry) => entry.trackId), reordered, 'renaming leaves the entries alone');

    const both = [...reordered].reverse();
    await updatePlaylist(session, id, { name: 'HAPPY integration test both', itemIds: both });
    const edited = toPlaylist(await loadPlaylist(session, id), tracksById);
    assert.equal(edited.name, 'HAPPY integration test both');
    assert.deepEqual(edited.entries.map((entry) => entry.trackId), both);
    const unshared = await (await session.request(`/Playlists/${id}`)).json() as { OpenAccess?: boolean };
    assert.equal(unshared.OpenAccess, false, 'an edit keeps the playlist private');
});

test('[jellyfin-playlists] the owner can delete a saved playlist', { skip }, async (t) => {
    if (!media.length) {
        t.skip('needs a playable item');
        return;
    }
    const id = await createPlaylist(session, 'HAPPY integration test delete', [media[0].id]);
    const item = await (await session.request(`/Items/${id}?userId=${session.userId}&Fields=CanDelete`)).json() as { CanDelete?: boolean };
    assert.equal(item.CanDelete, true, 'the menu offers Delete for the owner');

    await settle();
    await deletePlaylist(session, id);
    await settle();
    assert.equal((await playlistIds()).includes(id), false, 'it stays deleted');
});
