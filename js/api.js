// 데이터 저장·불러오기 창구. 화면은 이 파일만 쓰고, 저장 위치는 여기서 결정한다.
//   server: Vercel 서버 함수 + Redis (여러 기기에서 공유)
//   local : 브라우저 저장소 (서버 저장소가 없을 때 체험용, 이 기기에서만 보임)
import {
  createEvent, editEvent, cleanSettlement, newParticipant, selfUpdate, hostUpdate, setSupplyEach, newId,
} from './ops.js';

let mode = 'local';
export const getMode = () => mode;

export class ApiError extends Error {}

export async function init() {
  try {
    const res = await fetch('/api/events?ping=1', { cache: 'no-store' });
    const json = res.ok ? await res.json() : null;
    mode = json && json.storage ? 'server' : 'local';
  } catch {
    mode = 'local';
  }
  return mode;
}

async function serverCall(method, { id, body } = {}) {
  const url = method === 'GET' ? `/api/events?id=${encodeURIComponent(id)}` : '/api/events';
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
  const participants = Object.values(db.people[id] || {}).sort((a, b) => a.respondedAt.localeCompare(b.respondedAt));
  return { event, participants };
}

function localCall(action, { id, token, pid, data = {} }) {
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
      db.people[id][pid] = hostUpdate(needPerson(), data);
    } else if (action === 'each') {
      db.events[id] = setSupplyEach(needHost(), data, now);
    } else if (action === 'rsvp') {
      const p = newParticipant(data, need(), now);
      db.people[id] = { ...(db.people[id] || {}), [p.id]: p };
      extra = { participant: p };
    } else if (action === 'self') {
      const p = selfUpdate(needPerson(), data, need(), now);
      db.people[id][pid] = p;
      extra = { participant: p };
    }
    writeDb(db);
    return { ...localBundle(db, id), ...extra };
  } catch (err) {
    throw err instanceof ApiError ? err : new ApiError(err.message);
  }
}

function call(action, args) {
  if (mode === 'local') return Promise.resolve().then(() => localCall(action, args));
  if (action === 'get') return serverCall('GET', { id: args.id });
  return serverCall('POST', { body: { action, ...args } });
}

export const api = {
  get: (id) => call('get', { id }),
  create: (data) => call('create', { data }),
  edit: (id, token, data) => call('edit', { id, token, data }),
  settle: (id, token, data) => call('settle', { id, token, data }),
  host: (id, token, pid, data) => call('host', { id, token, pid, data }),
  each: (id, token, data) => call('each', { id, token, data }),
  rsvp: (id, data) => call('rsvp', { id, data }),
  self: (id, pid, data) => call('self', { id, pid, data }),
};
