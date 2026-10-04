// Upstash Redis REST 호출 (Vercel Marketplace에서 연결하면 환경변수가 자동으로 들어옴)
const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasStorage = Boolean(URL && TOKEN);

// 마지막 수정 후 120일 지나면 자동 삭제 (심사 기간 10/30까지 충분, 스팸 데이터가 영원히 쌓이지 않게)
const TTL_SECONDS = 60 * 60 * 24 * 120;
const MAX_RETRY = 5;

async function cmd(...args) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

// 읽은 값이 그대로일 때만 덮어씀 (그 사이 누가 썼으면 0 → 다시 읽고 다시 적용)
const CAS_STRING = `if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]) return 1 end return 0`;
const CAS_HASH = `if redis.call('HGET', KEYS[1], ARGV[1]) == ARGV[2] then
  redis.call('HSET', KEYS[1], ARGV[1], ARGV[3]) redis.call('EXPIRE', KEYS[1], ARGV[4]) return 1 end return 0`;

export class ConflictError extends Error {}

// 안내장은 문서 하나, 참가자는 해시(참가자 1명 = 필드 1개)로 따로 저장
const eventKey = (id) => `event:${id}`;
const peopleKey = (id) => `event:${id}:p`;

export async function getEvent(id) {
  const raw = await cmd('GET', eventKey(id));
  return raw ? JSON.parse(raw) : null;
}

export async function createEventIfAbsent(event) {
  return (await cmd('SET', eventKey(event.id), JSON.stringify(event), 'EX', TTL_SECONDS, 'NX')) === 'OK';
}

// fn(현재 값) → 새 값. 동시에 다른 요청이 고쳤으면 최신 값으로 fn을 다시 실행한다.
export async function updateEvent(id, fn) {
  for (let i = 0; i < MAX_RETRY; i++) {
    const raw = await cmd('GET', eventKey(id));
    if (!raw) return null;
    const next = await fn(JSON.parse(raw));
    if ((await cmd('EVAL', CAS_STRING, 1, eventKey(id), raw, JSON.stringify(next), TTL_SECONDS)) === 1) return next;
  }
  throw new ConflictError('동시에 수정 중이에요. 잠시 후 다시 시도해주세요.');
}

export async function getParticipants(id) {
  const flat = (await cmd('HGETALL', peopleKey(id))) || [];
  const list = [];
  for (let i = 1; i < flat.length; i += 2) list.push(JSON.parse(flat[i]));
  return list.sort((a, b) => a.respondedAt.localeCompare(b.respondedAt));
}

export async function addParticipant(id, p) {
  await cmd('HSET', peopleKey(id), p.id, JSON.stringify(p));
  await cmd('EXPIRE', peopleKey(id), TTL_SECONDS);
}

export async function updateParticipant(id, pid, fn) {
  for (let i = 0; i < MAX_RETRY; i++) {
    const raw = await cmd('HGET', peopleKey(id), pid);
    if (!raw) return null;
    const next = await fn(JSON.parse(raw));
    if ((await cmd('EVAL', CAS_HASH, 1, peopleKey(id), pid, raw, JSON.stringify(next), TTL_SECONDS)) === 1) return next;
  }
  throw new ConflictError('동시에 수정 중이에요. 잠시 후 다시 시도해주세요.');
}

// ── 로그인: 사용자·세션·로그인 실패 횟수·내 모임
const SESSION_TTL = 60 * 60 * 24 * 30;
const USER_TTL = 60 * 60 * 24 * 365;
const FAIL_WINDOW = 60 * 15;

export async function getUser(phone) {
  const raw = await cmd('GET', `user:${phone}`);
  return raw ? JSON.parse(raw) : null;
}

export async function createUserIfAbsent(user) {
  return (await cmd('SET', `user:${user.phone}`, JSON.stringify(user), 'EX', USER_TTL, 'NX')) === 'OK';
}

export const setSession = (token, phone) => cmd('SET', `session:${token}`, phone, 'EX', SESSION_TTL);
export const getSession = (token) => cmd('GET', `session:${token}`);
export const deleteSession = (token) => cmd('DEL', `session:${token}`);

export async function failCount(phone) {
  return Number((await cmd('GET', `loginfail:${phone}`)) || 0);
}

export async function addFail(phone) {
  const n = await cmd('INCR', `loginfail:${phone}`);
  if (n === 1) await cmd('EXPIRE', `loginfail:${phone}`, FAIL_WINDOW);
  return n;
}

export const clearFail = (phone) => cmd('DEL', `loginfail:${phone}`);

// 내 모임: eventId → { role: 'host'|'guest', pid?, at }. 주최자가 응답해도 role은 host 유지
export async function getUserEvents(phone) {
  const flat = (await cmd('HGETALL', `user:${phone}:events`)) || [];
  const out = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
  return out;
}

export async function addUserEvent(phone, eventId, info) {
  const key = `user:${phone}:events`;
  const prevRaw = await cmd('HGET', key, eventId);
  const prev = prevRaw ? JSON.parse(prevRaw) : {};
  const next = {
    ...prev,
    ...info,
    role: prev.role === 'host' || info.role === 'host' ? 'host' : 'guest',
    at: prev.at || new Date().toISOString(),
  };
  await cmd('HSET', key, eventId, JSON.stringify(next));
  await cmd('EXPIRE', key, USER_TTL);
  return next;
}

export async function getParticipant(id, pid) {
  const raw = await cmd('HGET', peopleKey(id), pid);
  return raw ? JSON.parse(raw) : null;
}

export const deleteParticipant = (id, pid) => cmd('HDEL', peopleKey(id), pid);

// 안내장 삭제: 안내장 문서와 참가자 해시를 함께 지운다
export async function deleteEvent(id) {
  await cmd('DEL', eventKey(id));
  await cmd('DEL', peopleKey(id));
}

export const removeUserEvent = (phone, eventId) => cmd('HDEL', `user:${phone}:events`, eventId);
