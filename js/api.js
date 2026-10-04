// 데이터 저장·불러오기 창구. 화면은 이 파일만 쓰고, 저장 위치는 여기서 결정한다.
//   server: Vercel 서버 함수 + Redis (여러 기기에서 공유)
//   local : 브라우저 저장소 (서버 저장소가 없을 때 체험용, 이 기기에서만 보임)
import { dataStamp } from './calc.js';
import {
  createEvent, editEvent, cleanSettlement, newParticipant, selfUpdate, hostUpdate, setSupplyEach, newId,
} from './ops.js';
import { cleanSignup, normalizePhone } from './auth.js';
import { session, clearSession, hostedList, hostToken, allMyself } from './store.js';

let mode = 'local';
// 마지막으로 내가 저장한 시각 — 직후 조회는 CDN 캐시(최대 5초 전 데이터)를 건너뛴다
let lastWrite = 0;
const FRESH_AFTER_WRITE_MS = 20000;
export const getMode = () => mode;

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export async function init() {
  try {
    // 서버가 너무 늦게 답하면 기다리지 않고 체험 모드로 (빈 화면 방지)
    const res = await fetch('/api/events?ping=1', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const json = res.ok ? await res.json() : null;
    mode = json && json.storage ? 'server' : 'local';
  } catch {
    mode = 'local';
  }
  return mode;
}

// 로그인이 끊겼으면(만료·로그아웃) 이 브라우저의 로그인 정보를 지우고 화면에 알린다
function onUnauthorized(err) {
  if (err.status === 401 && session()) {
    clearSession();
    window.dispatchEvent(new Event('moim:logout'));
  }
}

async function serverCall(method, { id, body, fresh } = {}) {
  const bust = fresh || Date.now() - lastWrite < FRESH_AFTER_WRITE_MS ? `&_=${Date.now()}` : '';
  const url = method === 'GET' ? `/api/events?id=${encodeURIComponent(id)}${bust}` : '/api/events';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('인터넷 연결을 확인해주세요.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error || '요청을 처리하지 못했어요.', res.status);
  if (method !== 'GET') lastWrite = Date.now();
  return json;
}

// ── 로컬 모드: 서버(api/events.js)와 같은 규칙을 브라우저 저장소에 적용
const DB_KEY = 'moim.db';
const emptyDb = () => ({ events: {}, people: {}, users: {}, sessions: {}, userEvents: {} });

function readDb() {
  try {
    return { ...emptyDb(), ...(JSON.parse(localStorage.getItem(DB_KEY)) || {}) };
  } catch {
    return emptyDb();
  }
}

function writeDb(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    throw new ApiError('브라우저 저장 공간을 쓸 수 없어요.');
  }
}

function localBundle(db, id) {
  const { editTokenHash, ownerPhone, ...event } = db.events[id];
  const participants = Object.values(db.people[id] || {})
    .sort((a, b) => a.respondedAt.localeCompare(b.respondedAt))
    .map(({ tokenHash, userPhone, ...p }) => p);
  return { event, participants, stamp: dataStamp(event, participants) };
}

const pub = ({ tokenHash, userPhone, ...p }) => p;

function addUserEvent(db, phone, eventId, info) {
  const mine = db.userEvents[phone] || (db.userEvents[phone] = {});
  const prev = mine[eventId] || {};
  mine[eventId] = {
    ...prev,
    ...info,
    role: prev.role === 'host' || info.role === 'host' ? 'host' : 'guest',
    at: prev.at || new Date().toISOString(),
  };
}

function localCall(action, { id, token, pid, ptoken, session: sess, data = {}, ...rest }) {
  const db = readDb();
  const now = new Date();
  const fail = (msg, status) => { throw new ApiError(msg, status); };
  // 체험 모드 전용: 비밀번호를 이 브라우저 안에만 그대로 보관 (서버 모드는 scrypt 해시)
  const userPhone = sess && db.sessions[sess];
  const user = userPhone && db.users[userPhone] ? { phone: userPhone, name: db.users[userPhone].name } : null;
  const needUser = () => user || fail('로그인이 필요해요.', 401);
  // 만료·로그아웃된 세션은 익명으로 처리하지 않고 401 (서버와 같은 규칙)
  if (sess && !user && !['signup', 'login', 'logout'].includes(action)) fail('로그인이 만료됐어요. 다시 로그인해주세요.', 401);
  const need = () => db.events[id] || fail('안내장을 찾을 수 없어요.', 404);
  const canHost = (e) => e.editTokenHash === token || Boolean(user && e.ownerPhone === user.phone);
  const needHost = () => {
    const e = need();
    return canHost(e) ? e : fail('주최자만 할 수 있어요.', 403);
  };
  const needPerson = () => (db.people[id] && db.people[id][pid]) || fail('참가자 정보를 찾을 수 없어요.', 404);
  const needSelf = () => {
    const p = needPerson();
    const owns = (ptoken && p.tokenHash === ptoken) || (user && p.userPhone === user.phone);
    return owns ? p : fail('본인만 바꿀 수 있어요.', 403);
  };
  const startSession = (u) => {
    const s = newId(32);
    db.sessions[s] = u.phone;
    return { session: s, user: { phone: u.phone, name: u.name } };
  };

  try {
    let out;
    if (action === 'signup') {
      const input = cleanSignup(rest);
      if (db.users[input.phone]) fail('이미 가입된 번호예요. 로그인해주세요.', 409);
      db.users[input.phone] = { phone: input.phone, name: input.name, pass: input.password };
      out = startSession(input);
    } else if (action === 'login') {
      const phone = normalizePhone(rest.phone);
      const u = db.users[phone];
      if (!u || u.pass !== String(rest.password ?? '')) fail('전화번호 또는 비밀번호가 맞지 않아요.', 401);
      out = startSession(u);
    } else if (action === 'logout') {
      if (sess) delete db.sessions[sess];
      out = { ok: true };
    } else if (action === 'whoami') {
      out = { user: needUser() };
    } else if (action === 'mine') {
      const u = needUser();
      const roleOf = (eventId, info) => {
        const owner = db.events[eventId].ownerPhone;
        return info.role === 'host' && owner && owner !== u.phone ? (info.pid ? 'guest' : null) : info.role;
      };
      const items = Object.entries(db.userEvents[u.phone] || {})
        .sort((a, b) => b[1].at.localeCompare(a[1].at))
        .filter(([eventId, info]) => db.events[eventId] && roleOf(eventId, info))
        .map(([eventId, info]) => ({ role: roleOf(eventId, info), pid: info.pid || null, ...localBundle(db, eventId) }));
      out = { items };
    } else if (action === 'me') {
      const e = need();
      const info = user && (db.userEvents[user.phone] || {})[id];
      const p = info && info.pid && db.people[id] && db.people[id][info.pid];
      out = { isHost: canHost(e), participant: p ? pub(p) : null };
    } else if (action === 'claim') {
      const u = needUser();
      let hosted = 0;
      let joined = 0;
      for (const h of rest.hosted || []) {
        const e = db.events[h.id];
        if (!e || e.editTokenHash !== h.token) continue;
        if (e.ownerPhone && e.ownerPhone !== u.phone) continue; // 다른 계정이 만든 모임은 옮기지 않음
        if (!e.ownerPhone) e.ownerPhone = u.phone;
        addUserEvent(db, u.phone, h.id, { role: 'host' });
        hosted++;
      }
      for (const j of rest.joined || []) {
        const p = db.people[j.id] && db.people[j.id][j.pid];
        if (!p || p.tokenHash !== j.ptoken || (p.userPhone && p.userPhone !== u.phone)) continue;
        const linked = (db.userEvents[u.phone] || {})[j.id];
        const kept = linked && linked.pid && linked.pid !== j.pid && db.people[j.id][linked.pid];
        if (kept) {
          // 이미 계정 응답이 있으면 하나로 합침 (더 최근 응답 내용 유지)
          if ((p.updatedAt || '') > (kept.updatedAt || '')) {
            const { rsvp, settle, paidAt, brings, late, updatedAt } = p;
            Object.assign(kept, { rsvp, settle, paidAt, brings, late, updatedAt, seenVersion: Math.max(kept.seenVersion || 0, p.seenVersion || 0) });
          }
          delete db.people[j.id][j.pid];
          joined++;
          continue;
        }
        p.userPhone = u.phone;
        addUserEvent(db, u.phone, j.id, { role: 'guest', pid: p.id });
        joined++;
      }
      out = { hosted, joined };
    } else if (action === 'delete') {
      needHost();
      delete db.events[id];
      delete db.people[id];
      Object.values(db.userEvents).forEach((mine) => { delete mine[id]; });
      out = { ok: true, id };
    }
    if (out) {
      writeDb(db);
      return out;
    }

    let extra = {};
    if (action === 'get') {
      need();
    } else if (action === 'create') {
      const owner = needUser();
      const editToken = newId(24);
      const event = { ...createEvent(data, now), editTokenHash: editToken, ownerPhone: owner.phone };
      db.events[event.id] = event;
      id = event.id;
      addUserEvent(db, owner.phone, id, { role: 'host' });
      extra = { editToken };
    } else if (action === 'edit') {
      const { event, changes } = editEvent(needHost(), data, now);
      db.events[id] = event;
      extra = { changes };
    } else if (action === 'settle') {
      const e = needHost();
      db.events[id] = { ...e, settlement: cleanSettlement(data, Object.values(db.people[id] || {}), now) };
    } else if (action === 'host') {
      const e = needHost();
      db.people[id][pid] = hostUpdate(needPerson(), data, e, now);
    } else if (action === 'each') {
      db.events[id] = setSupplyEach(needHost(), data, now);
    } else if (action === 'rsvp') {
      const e = need();
      const info = user && (db.userEvents[user.phone] || {})[id];
      const prev = info && info.pid && db.people[id] && db.people[id][info.pid];
      if (prev) {
        // 같은 계정은 한 모임에 한 번만: 기존 응답을 고친다
        const p = selfUpdate(prev, { name: data.name, rsvp: data.rsvp }, e, now);
        db.people[id][p.id] = p;
        extra = { participant: pub(p), participantToken: null };
      } else {
        const participantToken = newId(24);
        const p = { ...newParticipant(data, e, now), tokenHash: participantToken, ...(user ? { userPhone: user.phone } : {}) };
        db.people[id] = { ...(db.people[id] || {}), [p.id]: p };
        if (user) addUserEvent(db, user.phone, id, { role: 'guest', pid: p.id });
        extra = { participant: pub(p), participantToken };
      }
    } else if (action === 'self') {
      const p = selfUpdate(needSelf(), data, need(), now);
      db.people[id][pid] = p;
      extra = { participant: pub(p) };
    }
    writeDb(db);
    return { ...localBundle(db, id), ...extra };
  } catch (err) {
    throw err instanceof ApiError ? err : new ApiError(err.message, 400);
  }
}

// 로그인 상태면 모든 요청에 세션을 붙인다 (anonymous: 일부러 익명으로 보내야 할 때)
async function call(action, args, { anonymous = false } = {}) {
  const s = !anonymous && session();
  const withSession = s ? { ...args, session: s.token } : args;
  try {
    if (mode === 'local') return await Promise.resolve().then(() => localCall(action, withSession));
    if (action === 'get') return await serverCall('GET', { id: args.id, fresh: args.fresh });
    return await serverCall('POST', { body: { action, ...withSession } });
  } catch (err) {
    onUnauthorized(err);
    throw err;
  }
}

export const api = {
  // fresh: 주최자 화면처럼 항상 최신이 필요할 때 CDN 캐시를 건너뜀
  get: (id, { fresh = false } = {}) => call('get', { id, fresh }),
  create: (data) => call('create', { data }),
  edit: (id, token, data) => call('edit', { id, token, data }),
  settle: (id, token, data) => call('settle', { id, token, data }),
  host: (id, token, pid, data) => call('host', { id, token, pid, data }),
  each: (id, token, data) => call('each', { id, token, data }),
  remove: (id, token) => call('delete', { id, token }),
  rsvp: (id, data, { anonymous = false } = {}) => call('rsvp', { id, data }, { anonymous }),
  self: (id, me, data) => call('self', { id, pid: me.pid, ptoken: me.token, data }),
  // 로그인
  signup: (data) => call('signup', data, { anonymous: true }),
  login: (data) => call('login', data, { anonymous: true }),
  logout: () => call('logout', {}),
  whoami: () => call('whoami', {}),
  me: (id) => call('me', { id, token: hostToken(id) }),
  mine: () => call('mine', {}),
  claim: () => call('claim', { hosted: hostedList(), joined: allMyself() }),
};
