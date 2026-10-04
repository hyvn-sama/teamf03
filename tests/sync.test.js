import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packSync, unpackSync, syncUrl } from '../js/sync.js';
import { newId } from '../js/ops.js';

const hosted = [{ id: newId(8), token: newId(24) }, { id: newId(8), token: newId(24) }];
const joined = [{ id: newId(8), pid: `p_${newId(8)}`, token: newId(24) }];

test('packSync / unpackSync: 만든 모임과 응답 기록이 그대로 돌아온다', () => {
  assert.deepEqual(unpackSync(packSync({ hosted, joined })), { hosted, joined });
  assert.deepEqual(unpackSync(packSync({})), { hosted: [], joined: [] });
});

test('packSync: 주소에 그대로 넣을 수 있는 문자만 쓴다', () => {
  const d = packSync({ hosted, joined });
  assert.match(d, /^[A-Za-z0-9_-]+$/);
});

test('syncUrl: #/sync?d= 경로로 만든다', () => {
  const url = syncUrl('https://example.com/', { hosted, joined });
  assert.ok(url.startsWith('https://example.com/#/sync?d='));
  const d = new URLSearchParams(url.split('?')[1]).get('d');
  assert.deepEqual(unpackSync(d), { hosted, joined });
});

test('unpackSync: 깨지거나 잘린 링크는 오류', () => {
  const d = packSync({ hosted, joined });
  assert.throws(() => unpackSync(''), /올바르지 않아요/);
  assert.throws(() => unpackSync('!!!'), /올바르지 않아요/);
  assert.throws(() => unpackSync(d.slice(0, d.length - 10)), /올바르지 않아요/);
  assert.throws(() => unpackSync(btoa(JSON.stringify({ v: 2, h: [], j: [] }))), /올바르지 않아요/);
});

test('unpackSync: 형식이 틀린 항목(이상한 아이디·토큰)은 버린다', () => {
  const d = btoa(JSON.stringify({
    v: 1,
    h: [[hosted[0].id, hosted[0].token], ['<script>', 'x'], ['abcdefgh', '']],
    j: [[joined[0].id, joined[0].pid, joined[0].token], ['abcdefgh', 'nope', 'abcdefghij']],
  }));
  assert.deepEqual(unpackSync(d), { hosted: [hosted[0]], joined: [joined[0]] });
});
