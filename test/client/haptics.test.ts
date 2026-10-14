import test from 'node:test';
import assert from 'node:assert/strict';
import { assignableChannels, channelKey, channelLabel, parseChannelKey } from '../../src/shared/haptics';

const TAG = '[shared:haptics]';

test(`${TAG} the Auto channel is assignable only while the plugin generates Auto scripts`, () => {
    const keys = (auto: boolean) => assignableChannels([], auto).map(channelKey);
    assert.deepEqual(keys(false), ['stroker', 'buttplug', 'vibrator', 'estim', 'machine', 'unknown']);
    assert.deepEqual(keys(true), ['stroker', 'buttplug', 'vibrator', 'estim', 'machine', 'unknown', 'auto']);
});

test(`${TAG} subcategories of the current track are added once`, () => {
    const channels = assignableChannels([{ type: 'estim', sub: 'nipples' }, { type: 'estim', sub: 'nipples' }, { type: 'auto' }], true);
    assert.deepEqual(channels.map(channelKey).slice(-2), ['auto', 'estim:nipples']);
});

test(`${TAG} the Auto channel has a key and a label`, () => {
    assert.deepEqual(parseChannelKey('auto'), { type: 'auto' });
    assert.equal(channelLabel({ type: 'auto' }), 'Auto');
});
