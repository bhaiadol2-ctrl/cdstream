import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaletteFromRGB,
  computeProgressPercent,
  formatTimeMMSS,
  formatUptimeHHMMSS,
  getNextLoopIndex,
  getPreviousLoopIndex,
  maskStreamKey,
  reorderTracks,
  validateRtmpTarget,
} from './phonkLogic';

test('formatTimeMMSS formats minutes, seconds, hours, and edge values', () => {
  assert.equal(formatTimeMMSS(0), '00:00');
  assert.equal(formatTimeMMSS(-5), '00:00');
  assert.equal(formatTimeMMSS(Number.NaN), '00:00');
  assert.equal(formatTimeMMSS(9), '00:09');
  assert.equal(formatTimeMMSS(125), '02:05');
  assert.equal(formatTimeMMSS(3661), '01:01:01');
});

test('formatUptimeHHMMSS formats broadcast duration cleanly', () => {
  assert.equal(formatUptimeHHMMSS(0), '00:00:00');
  assert.equal(formatUptimeHHMMSS(75), '00:01:15');
  assert.equal(formatUptimeHHMMSS(3723), '01:02:03');
});

test('computeProgressPercent clamps between 0 and 100', () => {
  assert.equal(computeProgressPercent(30, 60), 50);
  assert.equal(computeProgressPercent(90, 60), 100);
  assert.equal(computeProgressPercent(-10, 60), 0);
  assert.equal(computeProgressPercent(10, 0), 0);
});

test('getNextLoopIndex cycles sequentially 1..N..1 and handles shuffle without repeating', () => {
  assert.equal(getNextLoopIndex(0, 0, false), -1);
  assert.equal(getNextLoopIndex(0, 1, false), 0);
  assert.equal(getNextLoopIndex(0, 3, false), 1);
  assert.equal(getNextLoopIndex(1, 3, false), 2);
  assert.equal(getNextLoopIndex(2, 3, false), 0);

  // When rng picks same index, advances by 1
  assert.equal(getNextLoopIndex(1, 3, true, () => 0.4), 2);
  assert.equal(getNextLoopIndex(1, 3, true, () => 0.05), 0);
});

test('getPreviousLoopIndex wraps cleanly around playlist boundaries', () => {
  assert.equal(getPreviousLoopIndex(0, 3), 2);
  assert.equal(getPreviousLoopIndex(2, 3), 1);
  assert.equal(getPreviousLoopIndex(0, 0), -1);
});

test('reorderTracks moves items without mutating original array', () => {
  const input = ['a', 'b', 'c', 'd'];
  const moved = reorderTracks(input, 0, 2);
  assert.deepEqual(moved, ['b', 'c', 'a', 'd']);
  assert.deepEqual(input, ['a', 'b', 'c', 'd']);
  assert.deepEqual(reorderTracks(input, 1, 99), ['a', 'b', 'c', 'd']);
});

test('buildPaletteFromRGB derives vivid glassmorphic palette and contrast text', () => {
  const crimson = buildPaletteFromRGB(210, 30, 48);
  assert.match(crimson.primary, /^#[0-9a-f]{6}$/);
  assert.match(crimson.accent, /^#[0-9a-f]{6}$/);
  assert.ok(crimson.glassBgRgba.startsWith('rgba('));
  assert.ok(crimson.glassBorderRgba.startsWith('rgba('));
  assert.ok(crimson.textOnAccent === '#ffffff' || crimson.textOnAccent === '#090a0f');

  const brightYellow = buildPaletteFromRGB(245, 220, 40);
  assert.equal(brightYellow.textOnAccent, '#090a0f');
});

test('maskStreamKey hides sensitive prefix and keeps last 4 characters', () => {
  assert.equal(maskStreamKey(''), '');
  assert.equal(maskStreamKey('abc'), '••••');
  assert.equal(maskStreamKey('abcd-efgh-1234-wxyz'), '••••-••••-wxyz');
});

test('validateRtmpTarget enforces protocol, key hygiene, and SSRF protection', () => {
  assert.equal(validateRtmpTarget('rtmp://a.rtmp.youtube.com/live2', '', false).valid, false);
  assert.equal(validateRtmpTarget('rtmp://a.rtmp.youtube.com/live2', '', true).valid, true);
  assert.equal(validateRtmpTarget('http://youtube.com/live2', 'abcd-1234', false).valid, false);
  assert.equal(validateRtmpTarget('rtmp://127.0.0.1/live', 'abcd-1234', false).valid, false);
  assert.equal(
    validateRtmpTarget('rtmp://a.rtmp.youtube.com/live2', 'abcd-1234;rm -rf', false).valid,
    false
  );
  const ok = validateRtmpTarget('rtmp://a.rtmp.youtube.com/live2', 'abcd-1234-efgh-5678', false);
  assert.equal(ok.valid, true);
  assert.equal(ok.sanitizedHost, 'a.rtmp.youtube.com');

  const okRtmps = validateRtmpTarget('rtmps://a.rtmps.youtube.com:443/live2', 'abcd-1234-efgh-5678', false);
  assert.equal(okRtmps.valid, true);
  assert.equal(okRtmps.sanitizedHost, 'a.rtmps.youtube.com');
});
