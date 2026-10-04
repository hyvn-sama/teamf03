// 서버 함수(api/events.js)를 가짜 Redis로 실행해 보는 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.KV_REST_API_URL = 'https://fake-redis.test';
process.env.KV_REST_API_TOKEN = 'test-token';

const strings = new Map();
const hashes = new Map();
let beforeEval = null; // 테스트에서 "그 사이 다른 요청이 썼다"를 흉내 내는 훅
globalThis.fetch = async (url, { body }) => {
  const parsed = JSON.parse(body);
  if (parsed[0] === 'EVAL') {
    if (beforeEval) { const hook = beforeEval; beforeEval = null; await hook(); }
    const [, script, , key, ...args] = parsed;
    let result = 0;
    if (script.includes('HGET')) {
      const h = hashes.get(key);
      if (h && h.get(args[0]) === args[1]) { h.set(args[0], args[2]); result = 1; }
    } else if (strings.get(key) === args[0]) {
      strings.set(key, args[1]);
      result = 1;
    }
    return { json: async () => ({ result }) };
  }
  const [cmd, key, ...rest] = parsed;
  let result = null;
  if (cmd === 'EXPIRE') result = 1;
  if (cmd === 'GET') result = strings.get(key) ?? null;
  if (cmd === 'SET') {
    if (rest.includes('NX') && strings.has(key)) result = null;
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
  const headers = {};
  const res = {
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    status(s) { status = s; return this; },
    json(j) { json = j; return this; },
  };
  await handler({ method, query, body }, res);
  return { status, json, headers };
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
  const ptoken = r1.json.participantToken;
  assert.ok(ptoken, '응답하면 본인 확인용 토큰을 받음');
  assert.equal(r1.json.participants[0].tokenHash, undefined, '토큰 해시는 공개되지 않음');
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
  const paid = await call('POST', { body: { action: 'self', id, pid, ptoken, data: { paid: true, seen: true } } });
  assert.equal(paid.json.participant.settle, 'done');
  assert.equal(paid.json.participant.seenVersion, 1);

  const host = await call('POST', { body: { action: 'host', id, token: editToken, pid: r2.json.participant.id, data: { rsvp: 'yes' } } });
  assert.equal(host.json.participants.find((p) => p.name === '이준호').settle, 'unpaid');

  const each = await call('POST', { body: { action: 'each', id, token: editToken, data: { item: '개인 컵', on: true } } });
  assert.equal(each.status, 400, '준비물이 없으면 거절');

  const late = await call('POST', { body: { action: 'self', id, pid, ptoken, data: { late: 10 } } });
  assert.equal(late.json.participant.late.minutes, 10);

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

test('리뷰 01: 남의 참가자 id만으로는 본인 행세 불가', async () => {
  const { json } = await call('POST', { body: { action: 'create', data: input } });
  const id = json.event.id;
  const victim = await call('POST', { body: { action: 'rsvp', id, data: { name: '강도현', rsvp: 'yes' } } });
  const pid = victim.json.participant.id;
  assert.equal((await call('POST', { body: { action: 'self', id, pid, data: { rsvp: 'no' } } })).status, 403);
  assert.equal((await call('POST', { body: { action: 'self', id, pid, ptoken: 'guess', data: { paid: true } } })).status, 403);
  const ok = await call('POST', { body: { action: 'self', id, pid, ptoken: victim.json.participantToken, data: { rsvp: 'maybe' } } });
  assert.equal(ok.json.participant.rsvp, 'maybe');
});

test('리뷰 05: 같은 참가자를 동시에 고쳐도 두 변경이 모두 남음', async () => {
  const { json } = await call('POST', { body: { action: 'create', data: input } });
  const { id } = json.event;
  const token = json.editToken;
  await call('POST', { body: { action: 'settle', id, token, data: { total: 10000, count: 1, accountNo: 'a', accountHolder: 'b' } } });
  const r = await call('POST', { body: { action: 'rsvp', id, data: { name: '지각생', rsvp: 'yes' } } });
  const { id: pid } = r.json.participant;
  // 참가자가 "늦어요"를 저장하기 직전에 주최자가 정산 완료로 바꿈
  beforeEval = () => call('POST', { body: { action: 'host', id, token, pid, data: { settle: 'done' } } });
  await call('POST', { body: { action: 'self', id, pid, ptoken: r.json.participantToken, data: { late: 20 } } });
  const got = (await call('GET', { query: { id } })).json.participants[0];
  assert.equal(got.settle, 'done');
  assert.equal(got.late.minutes, 20);
});

test('잘못된 요청 본문은 400', async () => {
  assert.equal((await call('POST', { body: '{깨진 json' })).status, 400);
  assert.equal((await call('POST', { body: { action: 'create', data: null } })).status, 400);
  assert.equal((await call('POST', { body: null })).status, 400);
});

test('안내장 조회는 CDN에 5초 캐시, 쓰기·ping·오류는 캐시 안 함', async () => {
  const { json } = await call('POST', { body: { action: 'create', data: input } });
  const got = await call('GET', { query: { id: json.event.id } });
  assert.match(got.headers['cache-control'], /s-maxage=5/);
  assert.match((await call('GET', { query: { ping: '1' } })).headers['cache-control'], /no-store/);
  assert.match((await call('GET', { query: { id: 'zzzzzzzz' } })).headers['cache-control'], /no-store/);
  assert.match((await call('POST', { body: { action: 'rsvp', id: json.event.id, data: { name: 'a', rsvp: 'yes' } } })).headers['cache-control'], /no-store/);
});

test('응답마다 stamp(마지막 변경 시각)가 붙어 옛 캐시를 구분할 수 있음', async () => {
  const { json } = await call('POST', { body: { action: 'create', data: input } });
  const id = json.event.id;
  const s1 = (await call('GET', { query: { id } })).json.stamp;
  await new Promise((r) => setTimeout(r, 5));
  const r = await call('POST', { body: { action: 'rsvp', id, data: { name: 'a', rsvp: 'yes' } } });
  assert.ok(r.json.stamp > s1);
});
