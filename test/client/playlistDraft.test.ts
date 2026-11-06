import test from 'node:test';
import assert from 'node:assert/strict';
import { PlaylistDraft } from '../../src/client/components/library/playlistDraft';
import type { PlaylistInfo } from '../../src/shared/types';

const TAG = '[client:playlistDraft]';

function playlist(...trackIds: string[]): PlaylistInfo {
    return {
        id: 'p', name: 'Mix', year: '', durationSeconds: 0, isFavorite: false, canDelete: true,
        entries: trackIds.map((trackId, order) => ({ order, trackId, title: trackId, artist: '', album: '' })),
    };
}

test(`${TAG} an untouched draft has nothing to save`, () => {
    const draft = new PlaylistDraft(playlist('a', 'b'));
    assert.equal(draft.changed, false);
    assert.equal(draft.canSave, false);
    assert.deepEqual(draft.changes, {});
});

test(`${TAG} moving an entry changes the order and moving it back undoes that`, () => {
    const draft = new PlaylistDraft(playlist('a', 'b', 'c'));
    assert.equal(draft.move(0, 2), true);
    assert.deepEqual(draft.trackIds, ['b', 'c', 'a']);
    assert.deepEqual(draft.changes, { trackIds: ['b', 'c', 'a'] });
    draft.move(2, 0);
    assert.equal(draft.changed, false);
});

test(`${TAG} a move outside the list or to the same place does nothing`, () => {
    const draft = new PlaylistDraft(playlist('a', 'b'));
    assert.equal(draft.move(0, 0), false);
    assert.equal(draft.move(0, -1), false);
    assert.equal(draft.move(1, 2), false);
    assert.deepEqual(draft.trackIds, ['a', 'b']);
});

test(`${TAG} a track held twice is removed one entry at a time`, () => {
    const draft = new PlaylistDraft(playlist('a', 'b', 'a'));
    draft.select(draft.entries[2].uid, true);
    assert.equal(draft.hasSelection, true);
    draft.removeSelected();
    assert.deepEqual(draft.trackIds, ['a', 'b']);
    assert.equal(draft.hasSelection, false);
});

test(`${TAG} swapping two copies of a track is no change`, () => {
    const draft = new PlaylistDraft(playlist('a', 'a', 'b'));
    draft.move(0, 1);
    assert.equal(draft.changed, false);
});

test(`${TAG} deselecting takes an entry out of the removal`, () => {
    const draft = new PlaylistDraft(playlist('a', 'b'));
    const { uid } = draft.entries[0];
    draft.select(uid, true);
    draft.select(uid, false);
    assert.equal(draft.hasSelection, false);
    draft.removeSelected();
    assert.deepEqual(draft.trackIds, ['a', 'b']);
});

test(`${TAG} a rename saves only the trimmed name`, () => {
    const draft = new PlaylistDraft(playlist('a'));
    draft.name = '  Evening  ';
    assert.deepEqual(draft.changes, { name: 'Evening' });
    assert.equal(draft.canSave, true);
    draft.name = ' Mix ';
    assert.equal(draft.changed, false);
});

test(`${TAG} a blank name or an emptied playlist cannot be saved`, () => {
    const draft = new PlaylistDraft(playlist('a'));
    draft.name = '   ';
    assert.equal(draft.canSave, false);
    draft.name = 'Mix';
    draft.select(draft.entries[0].uid, true);
    draft.removeSelected();
    assert.equal(draft.changed, true);
    assert.equal(draft.canSave, false);
});
