import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mediaAlbumAt, mediaTime, mediaBytes } = require('../artifacts/tests/js/model/MediaModels.js');
const item = (id, extra = {}) => ({ id, chatId: '101', mediaKind: 'photo', mediaAlbumId: '9223372036854775806', outgoing: false, ...extra });
test('album grouping retains int64 identifiers and never joins across text, chats or senders', () => {
  const items = [item('1'), item('2', { mediaKind: 'video' }), item('3', { mediaKind: undefined }), item('4'), item('5', { chatId: '202' })];
  assert.deepEqual(mediaAlbumAt(items, 0).map(x => x.id), ['1', '2']);
  assert.deepEqual(mediaAlbumAt(items, 1), []); assert.deepEqual(mediaAlbumAt(items, 2), []);
  assert.deepEqual(mediaAlbumAt(items, 3).map(x => x.id), ['4']);
  assert.deepEqual(mediaAlbumAt([item('1'), item('2', { outgoing: true })], 0).map(x => x.id), ['1']);
  assert.deepEqual(mediaAlbumAt([item('1', { mediaAlbumId: '0' }), item('2', { mediaAlbumId: '0' })], 0).map(x => x.id), ['1']);
});
test('media labels tolerate absent or invalid metadata', () => {
  assert.equal(mediaTime(NaN), '0:00'); assert.equal(mediaTime(61.9), '1:01'); assert.equal(mediaTime(-5), '0:00');
  assert.equal(mediaBytes(0), ''); assert.equal(mediaBytes(1024 * 1024), '1.0 MB');
});
