// 데이터 저장·불러오기 창구. 화면은 이 파일만 쓰고, 저장 위치는 여기서 결정한다.
//   server: Vercel 서버 함수 + Redis (여러 기기에서 공유)
//   local : 브라우저 저장소 (서버 저장소가 없을 때 체험용, 이 기기에서만 보임)
import { dataStamp } from './calc.js';
import {
  createEvent, editEvent, cleanSettlement, newParticipant, selfUpdate, hostUpdate, setSupplyEach, newId,
} from './ops.js';

let mode = 'local';
// 마지막으로 내가 저장한 시각 — 직후 조회는 CDN 캐시(최대 5초 전 데이터)를 건너뛴다
let lastWrite = 0;
const FRESH_AFTER_WRITE_MS = 20000;
export const getMode = () => mode;

export class ApiError extends Error {}

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
  if (!res.ok) throw new ApiError(json.error || '요청을 처리하지 못했어요.');
  if (method !== 'GET') lastWrite = Date.now();
  return json;
}

// ── 로컬 모드: 서버(api/events.js)와 같은 규칙을 브라우저 저장소에 적용
const DB_KEY = 'moim.db';

function readDb() {
  try {
    return JSON.parse(localStorage.getItem(DB_KEY)) || { events: {}, people: {} };
  } catch {
    return { events: {}, people: {} };
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
  const { editTokenHash, ...event } = db.events[id];
  const participants = Object.values(db.people[id] || {})
    .sort((a, b) => a.respondedAt.localeCompare(b.respondedAt))
    .map(({ tokenHash, ...p }) => p);
  return { event, participants, stamp: dataStamp(event, participants) };
}

function localCall(action, { id, token, pid, ptoken, data = {} }) {
  const db = readDb();
  const now = new Date();
  const need = () => {
    if (!db.events[id]) throw new ApiError('안내장을 찾을 수 없어요.');
    return db.events[id];
  };
  const needHost = () => {
    const e = need();
    if (e.editTokenHash !== token) throw new ApiError('주최자만 할 수 있어요.');
    return e;
  };
  const needPerson = () => {
    const p = db.people[id] && db.people[id][pid];
    if (!p) throw new ApiError('참가자 정보를 찾을 수 없어요.');
    return p;
  };
  const needSelf = () => {
    const p = needPerson();
    if (!ptoken || p.tokenHash !== ptoken) throw new ApiError('본인만 바꿀 수 있어요.');
    return p;
  };

  try {
    let extra = {};
    if (action === 'get') {
      need();
    } else if (action === 'create') {
      const editToken = newId(24);
      const event = { ...createEvent(data, now), editTokenHash: editToken };
      db.events[event.id] = event;
      id = event.id;
      extra = { editToken };
    } else if (action === 'edit') {
      const { event, changes } = editEvent(needHost(), data, now);
      db.events[id] = event;
      extra = { changes };
    } else if (action === 'settle') {
      const e = needHost();
      db.events[id] = { ...e, settlement: cleanSettlement(data, Object.values(db.people[id] || {}), now) };
    } else if (action === 'host') {
      needHost();
      db.people[id][pid] = hostUpdate(needPerson(), data, needHost(), now);
    } else if (action === 'each') {
      db.events[id] = setSupplyEach(needHost(), data, now);
    } else if (action === 'rsvp') {
      const participantToken = newId(24);
      const p = newParticipant(data, need(), now);
      db.people[id] = { ...(db.people[id] || {}), [p.id]: { ...p, tokenHash: participantToken } };
      extra = { participant: p, participantToken };
    } else if (action === 'self') {
      const p = selfUpdate(needSelf(), data, need(), now);
      db.people[id][pid] = p;
      const { tokenHash, ...pub } = p;
      extra = { participant: pub };
    }
    writeDb(db);
    return { ...localBundle(db, id), ...extra };
  } catch (err) {
    throw err instanceof ApiError ? err : new ApiError(err.message);
  }
}

function call(action, args) {
  if (mode === 'local') return Promise.resolve().then(() => localCall(action, args));
  if (action === 'get') return serverCall('GET', { id: args.id, fresh: args.fresh });
  return serverCall('POST', { body: { action, ...args } });
}

export const api = {
  // fresh: 주최자 화면처럼 항상 최신이 필요할 때 CDN 캐시를 건너뜀
  get: (id, { fresh = false } = {}) => call('get', { id, fresh }),
  create: (data) => call('create', { data }),
  edit: (id, token, data) => call('edit', { id, token, data }),
  settle: (id, token, data) => call('settle', { id, token, data }),
  host: (id, token, pid, data) => call('host', { id, token, pid, data }),
  each: (id, token, data) => call('each', { id, token, data }),
  rsvp: (id, data) => call('rsvp', { id, data }),
  self: (id, me, data) => call('self', { id, pid: me.pid, ptoken: me.token, data }),
};
