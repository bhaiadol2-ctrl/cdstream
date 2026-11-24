import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPaletteFromRGB,
  buildVideoShieldPreset,
  calculateUploadChunks,
  computeProgressPercent,
  formatFileSize,
  formatTimeMMSS,
  formatUptimeHHMMSS,
  getNextLoopIndex,
  getPreviousLoopIndex,
  isDirectCopyCompatibleVideo,
  isLikelyVideoFile,
  isVideoShieldActive,
  maskStreamKey,
  reorderTracks,
  sanitizeWatermarkText,
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

test('formatFileSize formats MB and GB cleanly', () => {
  assert.equal(formatFileSize(0), '0 MB');
  assert.equal(formatFileSize(5.5 * 1024 * 1024), '5.5 MB');
  assert.equal(formatFileSize(250 * 1024 * 1024), '250 MB');
  assert.equal(formatFileSize(1.5 * 1024 * 1024 * 1024), '1.50 GB');
});

test('isDirectCopyCompatibleVideo detects H.264 + AAC streams accurately', () => {
  assert.equal(
    isDirectCopyCompatibleVideo({ videoCodec: 'h264', audioCodec: 'aac', hasAudio: true }),
    true
  );
  assert.equal(
    isDirectCopyCompatibleVideo({ videoCodec: 'vp9', audioCodec: 'opus', hasAudio: true }),
    false
  );
  assert.equal(
    isDirectCopyCompatibleVideo({ videoCodec: 'h264', audioCodec: '', hasAudio: false }),
    false
  );
});

test('calculateUploadChunks splits large files into bounded chunk slices', () => {
  assert.deepEqual(calculateUploadChunks(0, 1024), []);
  const slices = calculateUploadChunks(12 * 1024 * 1024 + 500, 5 * 1024 * 1024);
  assert.equal(slices.length, 3);
  assert.deepEqual(slices[0], { index: 0, start: 0, end: 5 * 1024 * 1024, size: 5 * 1024 * 1024 });
  assert.deepEqual(slices[1], {
    index: 1,
    start: 5 * 1024 * 1024,
    end: 10 * 1024 * 1024,
    size: 5 * 1024 * 1024,
  });
  assert.deepEqual(slices[2], {
    index: 2,
    start: 10 * 1024 * 1024,
    end: 12 * 1024 * 1024 + 500,
    size: 2 * 1024 * 1024 + 500,
  });
});

test('isLikelyVideoFile recognizes standard and mobile video formats', () => {
  assert.equal(isLikelyVideoFile('movie.MKV', ''), true);
  assert.equal(isLikelyVideoFile('clip.3gp', 'application/octet-stream'), true);
  assert.equal(isLikelyVideoFile('stream.mp4', 'video/mp4'), true);
  assert.equal(isLikelyVideoFile('photo.jpg', 'image/jpeg'), false);
});

test('buildVideoShieldPreset and isVideoShieldActive toggle transform states accurately', () => {
  const stealth = buildVideoShieldPreset('movie-stealth', '@CinemaLive');
  assert.equal(stealth.mirrorFlip, true);
  assert.equal(stealth.zoomPulse, true);
  assert.equal(stealth.bassBoomDb, 6);
  assert.equal(stealth.watermarkText, '@CinemaLive');
  assert.equal(isVideoShieldActive(stealth), true);

  const raw = buildVideoShieldPreset('original');
  assert.equal(raw.mirrorFlip, false);
  assert.equal(raw.zoomPulse, false);
  assert.equal(raw.bassBoomDb, 0);
  assert.equal(isVideoShieldActive(raw), false);
});

test('sanitizeWatermarkText strips unsafe FFmpeg filter characters', () => {
  assert.equal(sanitizeWatermarkText("  @MovieLive:24/7;'[test]  "), '@MovieLive24/7test');
  assert.equal(sanitizeWatermarkText('Channel\nLine2'), 'ChannelLine2');
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
