import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeviceProfile, type MediaProbe } from '../../src/client/utils/deviceProfile';
import { resolvePlayback, toPlaybackSource, type JellyfinPlaybackInfoDto } from '../../src/client/jellyfin/playback';
import type { JellyfinApi } from '../../src/client/jellyfin/library';
import { formatBitrate, formatPlaybackInfo, humanizeReason } from '../../src/client/components/player/playbackInfoFormat';

const TAG = '[client:playback]';
const ENDPOINT = { serverUrl: 'https://jellyfin.example.com', token: 'tok' };
const VIDEO = { id: 'item1', type: 'video' as const };

/** A desktop Chromium: H.264, HEVC, VP9, AAC, Opus, FLAC; no AC-3, DTS or TrueHD. */
const CHROMIUM: MediaProbe = {
    canPlayType: () => '',
    isTypeSupported: (type) => /avc1|hvc1|vp9|vp09|mp4a|opus|flac|vp8/.test(type),
    matroska: true,
};

type Profile = {
    DirectPlayProfiles: { Container: string; Type: string; VideoCodec?: string; AudioCodec: string }[];
    TranscodingProfiles: { Container: string; Protocol: string; VideoCodec: string; AudioCodec: string }[];
};

test(`${TAG} the profile only direct-plays audio codecs the browser decodes`, () => {
    const profile = buildDeviceProfile(CHROMIUM) as Profile;
    const mkv = profile.DirectPlayProfiles.find((p) => p.Container === 'mkv')!;
    assert.ok(mkv.VideoCodec!.split(',').includes('hevc'));
    assert.ok(mkv.AudioCodec.split(',').includes('aac'));
    for (const codec of ['ac3', 'eac3', 'dts', 'truehd']) assert.ok(!mkv.AudioCodec.split(',').includes(codec), codec);
    const [hls] = profile.TranscodingProfiles;
    assert.equal(hls.Protocol, 'hls');
    assert.equal(hls.Container, 'mp4');
    assert.equal(hls.VideoCodec, 'hevc,h264');
    assert.ok(hls.AudioCodec.startsWith('aac'));
});

test(`${TAG} without Matroska support MKV is never direct-played`, () => {
    const profile = buildDeviceProfile({ ...CHROMIUM, matroska: false }) as Profile;
    assert.equal(profile.DirectPlayProfiles.some((p) => p.Container === 'mkv'), false);
});

test(`${TAG} a container without decodable audio gets no profile, since an empty list means any codec`, () => {
    const profile = buildDeviceProfile({ ...CHROMIUM, isTypeSupported: (type) => /avc1|hvc1/.test(type) }) as Profile;
    assert.deepEqual(profile.DirectPlayProfiles.filter((p) => p.Type === 'Video'), []);
    for (const p of profile.DirectPlayProfiles) assert.ok(p.AudioCodec !== '');
    assert.equal(profile.TranscodingProfiles[0].AudioCodec, 'aac');
});

test(`${TAG} a browser that decodes AC-3 may direct-play and stream-copy it`, () => {
    const profile = buildDeviceProfile({ ...CHROMIUM, isTypeSupported: (type) => CHROMIUM.isTypeSupported(type) || type.includes('ac-3') }) as Profile;
    assert.ok(profile.DirectPlayProfiles.find((p) => p.Container === 'mkv')!.AudioCodec.split(',').includes('ac3'));
    assert.ok(profile.TranscodingProfiles[0].AudioCodec.split(',').includes('ac3'));
});

const MKV_SOURCE = {
    Container: 'mkv',
    Bitrate: 48_000_000,
    MediaStreams: [
        { Type: 'Video', Codec: 'hevc', Profile: 'Main 10', Width: 3840, Height: 2160, VideoRangeType: 'HDR10', Index: 0 },
        { Type: 'Audio', Codec: 'eac3', Channels: 6, Language: 'ger', Index: 1 },
        { Type: 'Audio', Codec: 'truehd', Channels: 8, Language: 'eng', Index: 2 },
    ],
    DefaultAudioStreamIndex: 2,
};

test(`${TAG} a directly playable source keeps the static URL`, () => {
    const source = toPlaybackSource(ENDPOINT, VIDEO, { MediaSources: [{ ...MKV_SOURCE, SupportsDirectPlay: true }] });
    assert.equal(source.hls, false);
    assert.match(source.url, /\/Videos\/item1\/stream\?static=true&ApiKey=tok$/);
    assert.equal(source.info.method, 'direct');
    assert.equal(source.info.audio?.codec, 'truehd');
    assert.equal(source.info.video?.range, 'HDR10');
});

test(`${TAG} anything else plays Jellyfin's HLS stream with ApiKey and the reasons`, () => {
    const result: JellyfinPlaybackInfoDto = {
        PlaySessionId: 'ps1',
        MediaSources: [{
            ...MKV_SOURCE,
            SupportsDirectPlay: false,
            TranscodingSubProtocol: 'hls',
            TranscodingUrl: '/videos/item1/master.m3u8?VideoCodec=hevc,h264&AudioCodec=aac&api_key=old&TranscodeReasons=AudioCodecNotSupported,ContainerNotSupported',
        }],
    };
    const source = toPlaybackSource(ENDPOINT, VIDEO, result);
    assert.equal(source.hls, true);
    const url = new URL(source.url);
    assert.equal(url.origin + url.pathname, 'https://jellyfin.example.com/videos/item1/master.m3u8');
    assert.equal(url.searchParams.get('ApiKey'), 'tok');
    assert.equal(url.searchParams.get('api_key'), null);
    assert.deepEqual(source.info.reasons, ['AudioCodecNotSupported', 'ContainerNotSupported']);
    assert.equal(source.info.playSessionId, 'ps1');
});

test(`${TAG} no media source or no transcoding URL falls back to the original file`, () => {
    assert.equal(toPlaybackSource(ENDPOINT, VIDEO, {}).info.method, 'direct');
    assert.equal(toPlaybackSource(ENDPOINT, VIDEO, { MediaSources: [{ SupportsDirectPlay: false }] }).hls, false);
});

test(`${TAG} resolvePlayback posts the profile and leaves subtitles off`, async () => {
    let sent: { path: string; body: Record<string, unknown> } | null = null;
    const api: JellyfinApi = {
        userId: 'u1',
        async request(path, init) {
            sent = { path, body: JSON.parse(String(init?.body)) };
            return new Response(JSON.stringify({ MediaSources: [{ SupportsDirectPlay: true }] }));
        },
    };
    const source = await resolvePlayback(api, ENDPOINT, VIDEO, { Name: 'p' });
    assert.equal(source.info.method, 'direct');
    assert.equal(sent!.path, '/Items/item1/PlaybackInfo?userId=u1');
    assert.equal(sent!.body.SubtitleStreamIndex, -1);
    assert.deepEqual(sent!.body.DeviceProfile, { Name: 'p' });
    assert.equal(sent!.body.AllowVideoStreamCopy, true);
});

test(`${TAG} the overlay names method, reasons, source and target codecs`, () => {
    const { info } = toPlaybackSource(ENDPOINT, VIDEO, {
        PlaySessionId: 'ps1',
        MediaSources: [{ ...MKV_SOURCE, SupportsDirectPlay: false, TranscodingUrl: '/videos/item1/master.m3u8?TranscodeReasons=AudioCodecNotSupported' }],
    });
    const rows = new Map(formatPlaybackInfo({
        type: 'video',
        stream: info,
        player: 'hls.js',
        videoWidth: 3840,
        videoHeight: 2160,
        droppedFrames: 2,
        totalFrames: 1000,
        bufferAhead: 12.34,
        transcoding: { IsVideoDirect: true, IsAudioDirect: false, AudioCodec: 'aac', AudioChannels: 6, Framerate: 140.4, CompletionPercentage: 12.5, Container: 'mp4', HardwareAccelerationType: 'none' },
    }));
    assert.equal(rows.get('Method'), 'Transcode · HLS (hls.js)');
    assert.equal(rows.get('Reason'), 'audio codec not supported');
    assert.equal(rows.get('Container'), 'mkv · 48.0 Mbps → mp4');
    assert.equal(rows.get('Video'), 'hevc Main 10 · HDR10 · 3840×2160 → copy');
    assert.equal(rows.get('Audio'), 'truehd · 8 ch · eng → aac · 6 ch');
    assert.equal(rows.get('Encoder'), '140 fps · 12.5 % · software');
    assert.equal(rows.get('Output'), '3840×2160 · 2/1000 dropped');
    assert.equal(rows.get('Buffer'), '12.3 s');
});

test(`${TAG} audio and pending videos get short overlays`, () => {
    const base = { player: 'file', videoWidth: 0, videoHeight: 0, droppedFrames: null, totalFrames: null, bufferAhead: 0, transcoding: null };
    assert.deepEqual(formatPlaybackInfo({ ...base, type: 'audio', stream: null }), [['Method', 'Direct play'], ['Buffer', '0.0 s']]);
    assert.equal(formatPlaybackInfo({ ...base, type: 'video', stream: null })[0][1], 'Asking Jellyfin…');
    assert.equal(formatBitrate(640_000), '640 kbps');
    assert.equal(formatBitrate(null), '');
    assert.equal(humanizeReason('VideoRangeTypeNotSupported'), 'video range type not supported');
});
