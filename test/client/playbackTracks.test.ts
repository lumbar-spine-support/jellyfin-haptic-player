import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeviceProfile, type MediaProbe } from '../../src/client/utils/deviceProfile';
import { resolvePlayback, subtitleUrl, toPlaybackSource, type JellyfinMediaSourceDto } from '../../src/client/jellyfin/playback';
import type { JellyfinApi } from '../../src/client/jellyfin/library';
import { menuOptions } from '../../src/client/components/player/trackMenus';

const TAG = '[client:playback-tracks]';
const ENDPOINT = { serverUrl: 'https://jellyfin.example.com', token: 'tok' };
const VIDEO = { id: 'item1', type: 'video' as const };

const SOURCE: JellyfinMediaSourceDto = {
    Id: 'source1',
    Container: 'mkv',
    SupportsDirectPlay: true,
    DefaultAudioStreamIndex: 1,
    DefaultSubtitleStreamIndex: -1,
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc', Index: 0 },
        { Type: 'Audio', Codec: 'truehd', Language: 'eng', DisplayTitle: 'English - Dolby TrueHD 5.1 - Default', IsDefault: true, Index: 1 },
        { Type: 'Audio', Codec: 'aac', Language: 'ger', DisplayTitle: 'Kommentar - German - AAC - Stereo', Index: 2 },
        { Type: 'Subtitle', Codec: 'subrip', Language: 'eng', DisplayTitle: 'English - SUBRIP', IsTextSubtitleStream: true, Index: 3 },
        { Type: 'Subtitle', Codec: 'PGSSUB', Language: 'ger', DisplayTitle: 'German - PGSSUB', IsTextSubtitleStream: false, Index: 4 },
    ],
};

/** A desktop Chromium with HEVC Main 10 but no Dolby Vision. */
const CHROMIUM: MediaProbe = {
    canPlayType: () => '',
    isTypeSupported: (type) => /avc1|hvc1|vp9|vp09|mp4a|opus|flac/.test(type),
    matroska: true,
};

type CodecProfile = { Codec: string; Conditions: { Property: string; Value: string }[] };
const conditionOf = (profiles: CodecProfile[], codec: string, property: string): string | undefined =>
    profiles.find((p) => p.Codec === codec)?.Conditions.find((c) => c.Property === property)?.Value;

test(`${TAG} audio and subtitle streams are listed with Jellyfin's labels`, () => {
    const { info } = toPlaybackSource(ENDPOINT, VIDEO, { MediaSources: [SOURCE] });
    assert.deepEqual(info.audioTracks, [
        { index: 1, label: 'English - Dolby TrueHD 5.1 - Default', isText: true },
        { index: 2, label: 'Kommentar - German - AAC - Stereo', isText: true },
    ]);
    assert.deepEqual(info.subtitleTracks.map((t) => [t.index, t.isText]), [[3, true], [4, false]]);
    assert.equal(info.audioIndex, 1);
    assert.equal(info.defaultAudioIndex, 1);
    assert.equal(info.defaultSubtitleIndex, -1);
    assert.equal(info.mediaSourceId, 'source1');
});

test(`${TAG} a chosen audio stream is the one that plays, the default stays known`, () => {
    const { info } = toPlaybackSource(ENDPOINT, VIDEO, { MediaSources: [SOURCE] }, 2);
    assert.equal(info.audioIndex, 2);
    assert.equal(info.audio?.codec, 'aac');
    assert.equal(info.defaultAudioIndex, 1);
});

test(`${TAG} text subtitles come as WebVTT with the token`, () => {
    assert.equal(subtitleUrl(ENDPOINT, 'item1', 'source1', 3),
        'https://jellyfin.example.com/Videos/item1/source1/Subtitles/3/0/Stream.vtt?ApiKey=tok');
});

test(`${TAG} another audio stream or a burnt-in subtitle turns direct play off`, async () => {
    const bodies: Record<string, unknown>[] = [];
    const api: JellyfinApi = {
        userId: 'u1',
        async request(_path, init) {
            bodies.push(JSON.parse(String(init?.body)));
            return new Response(JSON.stringify({ MediaSources: [SOURCE] }));
        },
    };
    await resolvePlayback(api, ENDPOINT, VIDEO, {}, { audioStreamIndex: 2, allowDirectPlay: false });
    await resolvePlayback(api, ENDPOINT, VIDEO, {}, { burnSubtitleIndex: 4, allowVideoCopy: false });
    await resolvePlayback(api, ENDPOINT, VIDEO, {});
    assert.equal(bodies[0].AudioStreamIndex, 2);
    assert.equal(bodies[0].EnableDirectPlay, false);
    assert.equal(bodies[0].SubtitleStreamIndex, -1);
    assert.equal(bodies[1].SubtitleStreamIndex, 4);
    assert.equal(bodies[1].EnableDirectPlay, false);
    assert.equal(bodies[1].AllowVideoStreamCopy, false);
    assert.equal('AudioStreamIndex' in bodies[2], false);
    assert.equal(bodies[2].EnableDirectPlay, true);
    assert.equal(bodies[2].AllowVideoStreamCopy, true);
});

test(`${TAG} the profile keeps Dolby Vision and 10-bit H.264 from being copied`, () => {
    const profiles = (buildDeviceProfile(CHROMIUM) as { CodecProfiles: CodecProfile[] }).CodecProfiles;
    assert.equal(conditionOf(profiles, 'hevc', 'VideoRangeType'), 'SDR|HDR10|HDR10Plus|HLG');
    assert.equal(conditionOf(profiles, 'hevc', 'VideoProfile'), 'main|main 10');
    assert.equal(conditionOf(profiles, 'h264', 'VideoBitDepth'), '8');
    const withDolbyVision = (buildDeviceProfile({ ...CHROMIUM, isTypeSupported: (t) => CHROMIUM.isTypeSupported(t) || t.includes('dvh1') }) as { CodecProfiles: CodecProfile[] }).CodecProfiles;
    assert.match(conditionOf(withDolbyVision, 'hevc', 'VideoRangeType')!, /DOVIWithHDR10/);
    const main8Only = (buildDeviceProfile({ ...CHROMIUM, isTypeSupported: (t) => /avc1|hvc1\.1|mp4a/.test(t) }) as { CodecProfiles: CodecProfile[] }).CodecProfiles;
    assert.equal(conditionOf(main8Only, 'hevc', 'VideoRangeType'), 'SDR');
});

test(`${TAG} text subtitles are external, image subtitles are left to Jellyfin to burn in`, () => {
    const formats = (buildDeviceProfile(CHROMIUM) as { SubtitleProfiles: { Format: string; Method: string }[] }).SubtitleProfiles;
    assert.ok(formats.some((f) => f.Format === 'srt' && f.Method === 'External'));
    assert.ok(formats.some((f) => f.Format === 'ass'));
    for (const image of ['pgssub', 'pgs', 'dvdsub', 'vobsub', 'dvbsub']) assert.equal(formats.some((f) => f.Format === image), false, image);
});

test(`${TAG} the subtitle menu offers Off before the streams`, () => {
    const { info } = toPlaybackSource(ENDPOINT, VIDEO, { MediaSources: [SOURCE] });
    const tracks = { audio: info.audioTracks, subtitles: info.subtitleTracks };
    assert.deepEqual(menuOptions('subtitles', tracks).map((o) => o.index), [-1, 3, 4]);
    assert.equal(menuOptions('subtitles', tracks)[0].label, 'Off');
    assert.deepEqual(menuOptions('audio', tracks).map((o) => o.index), [1, 2]);
});
