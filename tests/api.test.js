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
  if (cmd === 'HDEL') { result = hashes.get(key)?.delete(rest[0]) ? 1 : 0; }
  if (cmd === 'DEL') { result = strings.delete(key) ? 1 : 0; hashes.delete(key); }
  if (cmd === 'INCR') { const n = Number(strings.get(key) || 0) + 1; strings.set(key, String(n)); result = n; }
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

let phoneSeq = 10000000;
async function signup(name = '김민지') {
  const phone = `010${phoneSeq++}`;
  const r = await call('POST', { body: { action: 'signup', phone, name, password: 'pw1234' } });
  return { phone, session: r.json.session, user: r.json.user, status: r.status };
}

// 기존 테스트용: 주최자 계정 하나를 만들어 재사용
let hostSessionCache = null;
async function hostSession() {
  if (!hostSessionCache) hostSessionCache = (await signup('주최자')).session;
  return hostSessionCache;
}

const input = { title: '가을 동아리 모임', date: '2026-10-31', startTime: '17:00', placeName: '하이브 라운지 3층' };

test('ping: 저장소 연결 여부', async () => {
  assert.deepEqual((await call('GET', { query: { ping: '1' } })).json, { ok: true, storage: true });
});

test('생성 → 조회 → 응답 → 수정 → 정산 → 입금 전체 흐름', async () => {
  const created = await call('POST', { body: { action: 'create', session: await hostSession(), data: input } });
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
  assert.equal((await call('POST', { body: { action: 'create', session: await hostSession(), data: { ...input, title: '' } } })).status, 400);
  assert.equal((await call('GET', { query: { id: 'zzzzzzzz' } })).status, 404);
  assert.equal((await call('GET', { query: { id: '../etc' } })).status, 404);
  assert.equal((await call('POST', { body: { action: 'nope' } })).status, 400);
});

test('리뷰 01: 남의 참가자 id만으로는 본인 행세 불가', async () => {
  const { json } = await call('POST', { body: { action: 'create', session: await hostSession(), data: input } });
  const id = json.event.id;
  const victim = await call('POST', { body: { action: 'rsvp', id, data: { name: '강도현', rsvp: 'yes' } } });
  const pid = victim.json.participant.id;
  assert.equal((await call('POST', { body: { action: 'self', id, pid, data: { rsvp: 'no' } } })).status, 403);
  assert.equal((await call('POST', { body: { action: 'self', id, pid, ptoken: 'guess', data: { paid: true } } })).status, 403);
  const ok = await call('POST', { body: { action: 'self', id, pid, ptoken: victim.json.participantToken, data: { rsvp: 'maybe' } } });
  assert.equal(ok.json.participant.rsvp, 'maybe');
});

test('리뷰 05: 같은 참가자를 동시에 고쳐도 두 변경이 모두 남음', async () => {
  const { json } = await call('POST', { body: { action: 'create', session: await hostSession(), data: input } });
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
  assert.equal((await call('POST', { body: { action: 'create', session: await hostSession(), data: null } })).status, 400);
  assert.equal((await call('POST', { body: null })).status, 400);
});

test('안내장 조회는 CDN에 5초 캐시, 쓰기·ping·오류는 캐시 안 함', async () => {
  const { json } = await call('POST', { body: { action: 'create', session: await hostSession(), data: input } });
  const got = await call('GET', { query: { id: json.event.id } });
  assert.match(got.headers['cache-control'], /s-maxage=5/);
  assert.match((await call('GET', { query: { ping: '1' } })).headers['cache-control'], /no-store/);
  assert.match((await call('GET', { query: { id: 'zzzzzzzz' } })).headers['cache-control'], /no-store/);
  assert.match((await call('POST', { body: { action: 'rsvp', id: json.event.id, data: { name: 'a', rsvp: 'yes' } } })).headers['cache-control'], /no-store/);
});

test('응답마다 stamp(마지막 변경 시각)가 붙어 옛 캐시를 구분할 수 있음', async () => {
  const { json } = await call('POST', { body: { action: 'create', session: await hostSession(), data: input } });
  const id = json.event.id;
  const s1 = (await call('GET', { query: { id } })).json.stamp;
  await new Promise((r) => setTimeout(r, 5));
  const r = await call('POST', { body: { action: 'rsvp', id, data: { name: 'a', rsvp: 'yes' } } });
  assert.ok(r.json.stamp > s1);
});

test('가입 → 로그인 → whoami → 로그아웃', async () => {
  const a = await signup();
  assert.equal(a.status, 200);
  assert.equal(a.user.name, '김민지');
  assert.equal((await call('POST', { body: { action: 'signup', phone: a.phone, name: 'x', password: 'pw1234' } })).status, 409);
  const login = await call('POST', { body: { action: 'login', phone: a.phone.replace(/(\d{3})(\d{4})/, '$1-$2-'), password: 'pw1234' } });
  assert.equal(login.status, 200);
  assert.equal((await call('POST', { body: { action: 'whoami', session: login.json.session } })).json.user.phone, a.phone);
  await call('POST', { body: { action: 'logout', session: login.json.session } });
  assert.equal((await call('POST', { body: { action: 'whoami', session: login.json.session } })).status, 401);
  assert.equal(JSON.stringify(login.json).includes('pw1234'), false);
});

test('비밀번호 10번 틀리면 15분 차단', async () => {
  const a = await signup();
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', { body: { action: 'login', phone: a.phone, password: 'wrong' } })).status, 401);
  assert.equal((await call('POST', { body: { action: 'login', phone: a.phone, password: 'pw1234' } })).status, 429);
});

test('로그인 없이 만들기 불가, 공개 응답에 전화번호 없음', async () => {
  assert.equal((await call('POST', { body: { action: 'create', data: input } })).status, 401);
  const a = await signup();
  const c = await call('POST', { body: { action: 'create', session: a.session, data: input } });
  assert.equal(c.status, 200);
  const got = await call('GET', { query: { id: c.json.event.id } });
  assert.equal(JSON.stringify(got.json).includes(a.phone), false);
});

test('주최자는 토큰 없이 세션만으로 수정, 다른 사용자는 403', async () => {
  const host = await signup(); const other = await signup('남');
  const { json } = await call('POST', { body: { action: 'create', session: host.session, data: input } });
  const id = json.event.id;
  assert.equal((await call('POST', { body: { action: 'edit', id, session: host.session, data: { ...input, placeName: '새 장소' } } })).status, 200);
  assert.equal((await call('POST', { body: { action: 'edit', id, session: other.session, data: input } })).status, 403);
  assert.equal((await call('POST', { body: { action: 'me', id, session: host.session } })).json.isHost, true);
  assert.equal((await call('POST', { body: { action: 'me', id, session: other.session } })).json.isHost, false);
});

test('로그인 응답: 계정당 한 번, 다른 기기에서도 본인 수정, mine에 표시', async () => {
  const host = await signup(); const guest = await signup('손님');
  const { json } = await call('POST', { body: { action: 'create', session: host.session, data: input } });
  const id = json.event.id;
  const r1 = await call('POST', { body: { action: 'rsvp', id, session: guest.session, data: { name: '손님', rsvp: 'maybe' } } });
  const r2 = await call('POST', { body: { action: 'rsvp', id, session: guest.session, data: { name: '손님', rsvp: 'yes' } } });
  assert.equal(r2.json.participants.length, 1);
  assert.equal(r2.json.participant.id, r1.json.participant.id);
  assert.equal(r2.json.participant.rsvp, 'yes');
  const pid = r1.json.participant.id;
  assert.equal((await call('POST', { body: { action: 'self', id, pid, session: guest.session, data: { late: 10 } } })).status, 200);
  assert.equal((await call('POST', { body: { action: 'self', id, pid, session: host.session, data: { late: 20 } } })).status, 403);
  const me = await call('POST', { body: { action: 'me', id, session: guest.session } });
  assert.equal(me.json.participant.id, pid);
  const mineGuest = await call('POST', { body: { action: 'mine', session: guest.session } });
  assert.deepEqual(mineGuest.json.items.map((x) => [x.role, x.event.id]), [['guest', id]]);
  const mineHost = await call('POST', { body: { action: 'mine', session: host.session } });
  assert.equal(mineHost.json.items[0].role, 'host');
  assert.equal((await call('POST', { body: { action: 'mine' } })).status, 401);
});

test('claim: 브라우저에 있던 응답 기록을 계정으로 (토큰 검증), 다른 계정이 만든 모임은 주최로 옮기지 않음', async () => {
  const a = await signup(); const b = await signup('b');
  const { json } = await call('POST', { body: { action: 'create', session: a.session, data: input } });
  const id = json.event.id;
  const r = await call('POST', { body: { action: 'rsvp', id, data: { name: '익명', rsvp: 'yes' } } });
  // 같은 기기에서 a가 만든 모임의 관리 토큰이 남아 있어도 b의 주최 모임이 되지 않는다
  const res = await call('POST', { body: { action: 'claim', session: b.session,
    hosted: [{ id, token: json.editToken }, { id, token: 'wrong' }],
    joined: [{ id, pid: r.json.participant.id, ptoken: r.json.participantToken }, { id, pid: r.json.participant.id, ptoken: 'x' }] } });
  assert.deepEqual(res.json, { hosted: 0, joined: 1 });
  const mine = await call('POST', { body: { action: 'mine', session: b.session } });
  assert.equal(mine.json.items[0].role, 'guest');
  assert.equal(mine.json.items[0].pid, r.json.participant.id);
  assert.equal((await call('POST', { body: { action: 'self', id, pid: r.json.participant.id, session: b.session, data: { late: 10 } } })).status, 200);
  assert.equal((await call('POST', { body: { action: 'edit', id, session: b.session, data: input } })).status, 403);
  // 만든 사람 본인은 그대로 옮겨짐
  const own = await call('POST', { body: { action: 'claim', session: a.session, hosted: [{ id, token: json.editToken }], joined: [] } });
  assert.deepEqual(own.json, { hosted: 1, joined: 0 });
});

test('mine: 예전에 잘못 옮겨진 다른 계정의 모임은 주최로 보이지 않음', async () => {
  const a = await signup(); const c = await signup('c');
  const { json } = await call('POST', { body: { action: 'create', session: a.session, data: input } });
  // 고치기 전 claim이 남긴 기록을 흉내: c의 내 모임에 a의 모임이 host로 들어가 있음
  const key = `user:${c.phone}:events`;
  (hashes.get(key) || hashes.set(key, new Map()).get(key)).set(json.event.id, JSON.stringify({ role: 'host', at: new Date().toISOString() }));
  const mine = await call('POST', { body: { action: 'mine', session: c.session } });
  assert.ok(!mine.json.items.some((x) => x.event.id === json.event.id));
});

test('리뷰 중요1: 만료·로그아웃된 세션으로 요청하면 401 (익명 처리하지 않음)', async () => {
  const host = await signup(); const guest = await signup('손님');
  const { json } = await call('POST', { body: { action: 'create', session: host.session, data: input } });
  const id = json.event.id;
  const r = await call('POST', { body: { action: 'rsvp', id, session: guest.session, data: { name: '손님', rsvp: 'yes' } } });
  await call('POST', { body: { action: 'logout', session: guest.session } });
  const stale = guest.session;
  assert.equal((await call('POST', { body: { action: 'rsvp', id, session: stale, data: { name: '손님', rsvp: 'no' } } })).status, 401);
  assert.equal((await call('POST', { body: { action: 'self', id, pid: r.json.participant.id, session: stale, data: { late: 10 } } })).status, 401);
  assert.equal((await call('POST', { body: { action: 'me', id, session: stale } })).status, 401);
  assert.equal((await call('POST', { body: { action: 'edit', id, session: 'nope', data: input } })).status, 401);
  assert.equal((await call('GET', { query: { id } })).json.participants.length, 1, '익명 참가자가 새로 생기지 않음');
  // 세션 없이(익명) 응답은 그대로 가능
  assert.equal((await call('POST', { body: { action: 'rsvp', id, data: { name: '익명', rsvp: 'yes' } } })).status, 200);
});

test('리뷰 중요4: 계정 응답이 있는데 다른 기기의 익명 응답을 옮기면 한 명으로 합침 (최신 응답 유지)', async () => {
  const host = await signup(); const guest = await signup('손님');
  const { json } = await call('POST', { body: { action: 'create', session: host.session, data: input } });
  const id = json.event.id;
  const p1 = (await call('POST', { body: { action: 'rsvp', id, session: guest.session, data: { name: '손님', rsvp: 'maybe' } } })).json.participant;
  await new Promise((r) => setTimeout(r, 5));
  const anon = await call('POST', { body: { action: 'rsvp', id, data: { name: '손님', rsvp: 'yes' } } });
  const res = await call('POST', { body: { action: 'claim', session: guest.session, hosted: [],
    joined: [{ id, pid: anon.json.participant.id, ptoken: anon.json.participantToken }] } });
  assert.deepEqual(res.json, { hosted: 0, joined: 1 });
  const ps = (await call('GET', { query: { id, _: 1 } })).json.participants;
  assert.equal(ps.length, 1, '참가자 한 명');
  assert.equal(ps[0].id, p1.id, '계정의 원래 참가자 유지');
  assert.equal(ps[0].rsvp, 'yes', '더 최근 익명 응답 내용으로');
  const mine = await call('POST', { body: { action: 'mine', session: guest.session } });
  assert.equal(mine.json.items[0].pid, p1.id);
});

test('삭제: 주최자만, 안내장·응답·내 알림장 목록에서 모두 사라짐', async () => {
  const host = await signup('주최자'); const guest = await signup('손님');
  const created = await call('POST', { body: { action: 'create', session: host.session, data: input } });
  const { id } = created.json.event;
  await call('POST', { body: { action: 'rsvp', id, session: guest.session, data: { name: '손님', rsvp: 'yes' } } });
  const anon = await call('POST', { body: { action: 'rsvp', id, data: { name: '익명', rsvp: 'yes' } } });

  // 참석자는 로그인했든 응답 토큰이 있든 삭제 불가
  assert.equal((await call('POST', { body: { action: 'delete', id, session: guest.session } })).status, 403);
  assert.equal((await call('POST', { body: { action: 'delete', id, token: anon.json.participantToken } })).status, 403);
  assert.equal((await call('GET', { query: { id, _: 1 } })).status, 200);

  assert.equal((await call('POST', { body: { action: 'delete', id, session: host.session } })).status, 200);
  assert.equal((await call('GET', { query: { id, _: 2 } })).status, 404);
  assert.equal((await call('POST', { body: { action: 'delete', id, session: host.session } })).status, 404);
  for (const s of [host.session, guest.session]) {
    const mine = await call('POST', { body: { action: 'mine', session: s } });
    assert.ok(!mine.json.items.some((x) => x.event.id === id), '내 알림장에서도 빠짐');
  }

  // 관리 링크(토큰)로도 삭제 가능
  const second = await call('POST', { body: { action: 'create', session: host.session, data: input } });
  const sid = second.json.event.id;
  assert.equal((await call('POST', { body: { action: 'delete', id: sid, token: second.json.editToken } })).status, 200);
  assert.equal((await call('GET', { query: { id: sid } })).status, 404);
});
