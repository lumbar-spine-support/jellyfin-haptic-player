import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaClock, curvePoints, decimateCurve, heatColor, HEAT_MAX_SPEED } from '../../src/client/components/haptic/visualization/geometry';
import { prepareScript, type InterpolationMethod } from '../../src/shared/interpolation';

const TAG = '[client:vizGeometry]';
const actions = [
    { at: 0, pos: 0 },
    { at: 100, pos: 50 },
    { at: 200, pos: 100 },
];
const xy = (points: ReturnType<typeof curvePoints>): Array<[number, number]> => points.map((p) => [p.ms, p.pos]);
const prep = (method: InterpolationMethod) => prepareScript(actions, method);

test(`${TAG} none holds each position until the next action`, () => {
    assert.deepEqual(xy(curvePoints(prep('none'), 0, 200, 1)), [
        [0, 0], [100, 0], [100, 50], [200, 50], [200, 100],
    ]);
});

test(`${TAG} none starts mid-hold and clips to the window`, () => {
    assert.deepEqual(xy(curvePoints(prep('none'), 50, 150, 1)), [[50, 0], [100, 0], [100, 50], [150, 50]]);
});

test(`${TAG} linear curve clips segments at the window edges`, () => {
    assert.deepEqual(xy(curvePoints(prep('linear'), 50, 150, 1)), [[50, 25], [100, 50], [150, 75]]);
});

test(`${TAG} pchip curve is sampled at the requested resolution`, () => {
    const points = curvePoints(prep('pchip'), 0, 100, 25);
    assert.equal(points.length, 5);
    for (const p of points) assert.ok(Math.abs(p.pos - p.ms / 2) < 1e-9, 'straight data stays straight');
});

test(`${TAG} curve speed is the derivative in units per second`, () => {
    const [, first] = curvePoints(prep('linear'), 0, 100, 1);
    assert.ok(Math.abs(first!.speed - 500) < 1e-9);
});

test(`${TAG} curve is empty outside the script span`, () => {
    assert.deepEqual(curvePoints(prep('linear'), 250, 400, 1), []);
    assert.deepEqual(curvePoints(prep('none'), -100, -10, 1), []);
    assert.deepEqual(curvePoints(prepareScript([], 'pchip'), 0, 100, 1), []);
});

test(`${TAG} heatColor runs from blue to red and saturates`, () => {
    assert.equal(heatColor(0), 'hsl(240, 90%, 55%)');
    assert.equal(heatColor(HEAT_MAX_SPEED), 'hsl(0, 90%, 55%)');
    assert.equal(heatColor(HEAT_MAX_SPEED * 3), heatColor(HEAT_MAX_SPEED));
});

test(`${TAG} MediaClock extrapolates while playing and freezes when paused`, () => {
    let now = 1000;
    const clock = new MediaClock(() => now);
    clock.sync(10, false, 2);
    now += 500;
    assert.equal(clock.read(100), 11);
    clock.sync(10, false, 2);
    assert.equal(clock.read(100), 11, 'identical update keeps the anchor');
    clock.sync(11.2, true, 2);
    now += 1000;
    assert.equal(clock.read(100), 11.2);
    assert.equal(clock.read(11), 11, 'clamped to duration');
});

test(`${TAG} decimateCurve keeps first, min, max and last of each pixel column in order`, () => {
    const p = (ms: number, pos: number, speed = 0) => ({ ms, pos, speed });
    const points = [p(0, 50), p(1, 90, 10), p(2, 10, 20), p(3, 40, 300), p(4, 60, 5), p(10, 0, 7), p(11, 100, 8)];
    const out = decimateCurve(points, 0, 10);
    assert.deepEqual(out.map((q) => [q.ms, q.pos]), [[0, 50], [1, 90], [2, 10], [4, 60], [10, 0], [11, 100]]);
    assert.equal(out[3]!.speed, 300, 'a kept point carries the top speed of the points it replaces');
    assert.equal(out[2]!.speed, 20);
});

test(`${TAG} decimateCurve bounds a dense script to a few points per pixel`, () => {
    const dense = Array.from({ length: 100_000 }, (_, i) => ({ ms: i, pos: i % 2 ? 100 : 0, speed: 1 }));
    const out = decimateCurve(dense, 0, 100);
    assert.ok(out.length <= 4 * 1000, `${out.length} points`);
    assert.deepEqual(out[0], dense[0]);
    assert.deepEqual(out[out.length - 1], dense[dense.length - 1]);
    assert.ok(out.some((q) => q.pos === 0) && out.some((q) => q.pos === 100), 'extremes survive');
});

test(`${TAG} decimateCurve leaves sparse curves untouched`, () => {
    const sparse = curvePoints(prep('linear'), 0, 200, 1);
    assert.deepEqual(decimateCurve(sparse, 0, 1), sparse);
});
