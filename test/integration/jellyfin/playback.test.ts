import test from 'node:test';
import assert from 'node:assert/strict';

import { login, skip, type JellyfinSession } from './session';
import { loadLibrary } from '../../../src/client/jellyfin/library';
import { resolvePlayback, stopTranscode, type PlaybackSource } from '../../../src/client/jellyfin/playback';
import { buildDeviceProfile, type MediaProbe } from '../../../src/client/utils/deviceProfile';
import { DEFAULT_FUNSCRIPT_SUFFIXES } from '../../../src/shared/funscriptNames';
import type { TrackInfo } from '../../../src/shared/types';

const DEVICE = 'playback';
let session: JellyfinSession;
let video: TrackInfo | undefined;

/** A desktop Chromium. */
const CHROMIUM: MediaProbe = {
    canPlayType: () => '',
    isTypeSupported: (type) => /avc1|hvc1|vp9|vp09|vp8|mp4a|opus|flac/.test(type),
    matroska: true,
};
/** A browser decoding no audio Jellyfin knows, so every video with sound must be transcoded. */
const NO_AUDIO: MediaProbe = { ...CHROMIUM, isTypeSupported: (type) => /avc1|hvc1/.test(type) };

const serverUrl = (): string => String(process.env.HAPPY_JELLYFIN_URL).replace(/\/+$/, '');
const endpoint = () => ({ serverUrl: serverUrl(), token: session.token });

test.before(async () => {
    if (skip) return;
    session = await login(DEVICE);
    const library = await loadLibrary(session, { funscriptSuffixes: DEFAULT_FUNSCRIPT_SUFFIXES, chapterSourcePriority: ['embedded'] });
    video = library.videos[0];
});

test.after(async () => {
    await session?.logout();
});

function assertStreams(source: PlaybackSource): void {
    assert.ok(source.info.container.length > 0);
    assert.ok(source.info.video === null || source.info.video.codec.length > 0);
    assert.ok(source.info.audio === null || source.info.audio.codec.length > 0);
}

test('[jellyfin-playback] PlaybackInfo answers with a playable source', { skip }, async (t) => {
    if (!video) return t.skip('no video in the library');
    const source = await resolvePlayback(session, endpoint(), video, buildDeviceProfile(CHROMIUM));
    assertStreams(source);
    if (source.info.method === 'direct') {
        assert.equal(source.hls, false);
        assert.ok(source.url.includes('static=true'));
        const res = await fetch(source.url, { headers: { Range: 'bytes=0-0' } });
        assert.ok(res.ok, `direct stream answers (HTTP ${res.status})`);
    }
});

test('[jellyfin-playback] audio the browser cannot decode is transcoded to an HLS stream that loads with ApiKey', { skip }, async (t) => {
    if (!video) return t.skip('no video in the library');
    const source = await resolvePlayback(session, endpoint(), video, buildDeviceProfile(NO_AUDIO));
    if (!source.info.audio) return t.skip('the first video has no audio');
    assert.equal(source.info.method, 'transcode');
    assert.equal(source.hls, true);
    assert.ok(source.info.reasons.length > 0, 'Jellyfin names its reasons');
    assert.ok(source.info.playSessionId);
    const url = new URL(source.url);
    assert.ok(url.pathname.endsWith('.m3u8'));
    assert.equal(url.searchParams.get('ApiKey'), session.token);

    // The token in the URL is all a media element or hls.js can send.
    const playlist = await fetch(source.url);
    assert.ok(playlist.ok, `master playlist answers (HTTP ${playlist.status})`);
    assert.match(await playlist.text(), /^#EXTM3U/);

    const deviceId = `happy-integration-tests-${DEVICE}`;
    await stopTranscode(session, deviceId, source.info.playSessionId!);
});
