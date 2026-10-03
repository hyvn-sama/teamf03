// 서버 함수(api/events.js)를 가짜 Redis로 실행해 보는 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const strings = new Map();
const hashes = new Map();
globalThis.fetch = async (url, { body }) => {
  const [cmd, key, ...rest] = JSON.parse(body);
  let result = null;
  if (cmd === 'GET') result = strings.get(key) ?? null;
  if (cmd === 'SET') {
    if (rest[1] === 'NX' && strings.has(key)) result = null;
    else { strings.set(key, rest[0]); result = 'OK'; }
  }
  if (cmd === 'HSET') { (hashes.get(key) || hashes.set(key, new Map()).get(key)).set(rest[0], rest[1]); result = 1; }
  if (cmd === 'HGET') result = hashes.get(key)?.get(rest[0]) ?? null;
  if (cmd === 'HGETALL') result = [...(hashes.get(key) || new Map())].flat();
  return { json: async () => ({ result }) };
};

const { default: handler } = await import('../api/events.js');

async function call(method, { query = {}, body } = {}) {
  let status = 0;
  let json = null;
  const res = {
    setHeader() {},
    status(s) { status = s; return this; },
    json(j) { json = j; return this; },
  };
  await handler({ method, query, body }, res);
  return { status, json };
}

const input = { title: '가을 동아리 모임', date: '2026-10-31', startTime: '17:00', placeName: '하이브 라운지 3층' };

test('ping: 저장소 연결 여부', async () => {
  assert.deepEqual((await call('GET', { query: { ping: '1' } })).json, { ok: true, storage: true });
});

test('생성 → 조회 → 응답 → 수정 → 정산 → 입금 전체 흐름', async () => {
  const created = await call('POST', { body: { action: 'create', data: input } });
  assert.equal(created.status, 200);
  const { editToken } = created.json;
  const { id } = created.json.event;
  assert.equal(created.json.event.editTokenHash, undefined, '토큰 해시는 응답에 없어야 함');

  const r1 = await call('POST', { body: { action: 'rsvp', id, data: { name: '송다은', rsvp: 'yes' } } });
  const r2 = await call('POST', { body: { action: 'rsvp', id, data: { name: '이준호', rsvp: 'maybe' } } });
  assert.equal(r2.json.participants.length, 2);

  const denied = await call('POST', { body: { action: 'edit', id, token: 'wrong', data: input } });
  assert.equal(denied.status, 403);

  const edited = await call('POST', { body: { action: 'edit', id, token: editToken, data: { ...input, placeName: '역삼 모임공간 B 4층' } } });
  assert.equal(edited.json.event.changeVersion, 1);
  assert.equal(edited.json.changes[0].field, 'placeName');

  const settled = await call('POST', { body: { action: 'settle', id, token: editToken, data: { total: 32000, count: 2, accountNo: '[은행] 000', accountHolder: '김민지' } } });
  assert.equal(settled.json.event.settlement.total, 32000);

  const pid = r1.json.participant.id;
  const paid = await call('POST', { body: { action: 'self', id, pid, data: { paid: true, seen: true } } });
  assert.equal(paid.json.participant.settle, 'done');
  assert.equal(paid.json.participant.seenVersion, 1);

  const host = await call('POST', { body: { action: 'host', id, token: editToken, pid: r2.json.participant.id, data: { rsvp: 'yes' } } });
  assert.equal(host.json.participants.find((p) => p.name === '이준호').settle, 'unpaid');

  const got = await call('GET', { query: { id } });
  assert.equal(got.json.event.placeName, '역삼 모임공간 B 4층');
  assert.equal(got.json.participants.length, 2);
});

test('잘못된 입력·없는 안내장', async () => {
  assert.equal((await call('POST', { body: { action: 'create', data: { ...input, title: '' } } })).status, 400);
  assert.equal((await call('GET', { query: { id: 'zzzzzzzz' } })).status, 404);
  assert.equal((await call('GET', { query: { id: '../etc' } })).status, 404);
  assert.equal((await call('POST', { body: { action: 'nope' } })).status, 400);
});
