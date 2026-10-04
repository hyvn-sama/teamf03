// 서버 API — 하나의 경로(/api/events)에서 action으로 나눠 처리
//   GET  ?ping=1           저장소 연결 여부
//   GET  ?id=              안내장 + 참가자
//   POST {action, ...}     create | edit | settle | host | each  (주최자: token)
//                          rsvp | self                           (참가자: pid + ptoken)
import { createHash } from 'node:crypto';
import {
  InputError, createEvent, editEvent, cleanSettlement, newParticipant, selfUpdate, hostUpdate, setSupplyEach, newId,
} from '../js/ops.js';
import * as db from './_store.js';

const hash = (token) => createHash('sha256').update(String(token)).digest('hex');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const notFound = () => new HttpError(404, '안내장을 찾을 수 없어요.');

function publicEvent(e) {
  const { editTokenHash, ...rest } = e;
  return rest;
}

function publicParticipant(p) {
  const { tokenHash, ...rest } = p;
  return rest;
}

function checkId(id) {
  if (!/^[a-z0-9]{8}$/.test(String(id))) throw notFound();
}

async function load(id) {
  checkId(id);
  const event = await db.getEvent(id);
  if (!event) throw notFound();
  return event;
}

const isHost = (event, token) => Boolean(token) && hash(token) === event.editTokenHash;

async function loadAsHost(id, token) {
  const event = await load(id);
  if (!isHost(event, token)) throw new HttpError(403, '주최자만 할 수 있어요.');
  return event;
}

// 주최자 전용 안내장 수정: 최신 값에 다시 적용하며 저장 (동시 수정 시 재시도)
async function updateAsHost(id, token, fn) {
  checkId(id);
  const updated = await db.updateEvent(id, (event) => {
    if (!isHost(event, token)) throw new HttpError(403, '주최자만 할 수 있어요.');
    return fn(event);
  });
  if (!updated) throw notFound();
  return updated;
}

async function updatePerson(id, pid, fn) {
  const p = await db.updateParticipant(id, String(pid), fn);
  if (!p) throw new HttpError(404, '참가자 정보를 찾을 수 없어요.');
  return p;
}

async function bundle(event) {
  const participants = await db.getParticipants(event.id);
  return { event: publicEvent(event), participants: participants.map(publicParticipant) };
}

async function handlePost(body) {
  const { action, id, token, pid, ptoken } = body;
  const data = body.data && typeof body.data === 'object' ? body.data : null;
  const needData = () => {
    if (!data) throw new HttpError(400, '요청 내용이 비어 있어요.');
    return data;
  };
  const now = new Date();

  if (action === 'create') {
    const input = needData();
    const editToken = newId(24);
    for (let i = 0; i < 3; i++) {
      const event = { ...createEvent(input, now), editTokenHash: hash(editToken) };
      if (await db.createEventIfAbsent(event)) return { ...(await bundle(event)), editToken };
    }
    throw new HttpError(500, '잠시 후 다시 시도해주세요.');
  }

  if (action === 'edit') {
    const input = needData();
    let changes = [];
    const updated = await updateAsHost(id, token, (event) => {
      const result = editEvent(event, input, now);
      changes = result.changes;
      return result.event;
    });
    return { ...(await bundle(updated)), changes };
  }

  if (action === 'settle') {
    const input = needData();
    const participants = await db.getParticipants(id);
    const updated = await updateAsHost(id, token, (event) => ({
      ...event, settlement: cleanSettlement(input, participants, now), updatedAt: now.toISOString(),
    }));
    return bundle(updated);
  }

  if (action === 'each') {
    const input = needData();
    return bundle(await updateAsHost(id, token, (event) => setSupplyEach(event, input, now)));
  }

  if (action === 'host') {
    const input = needData();
    const event = await loadAsHost(id, token);
    await updatePerson(id, pid, (p) => hostUpdate(p, input, event, now));
    return bundle(event);
  }

  if (action === 'rsvp') {
    const event = await load(id);
    const participantToken = newId(24);
    const p = { ...newParticipant(needData(), event, now), tokenHash: hash(participantToken) };
    await db.addParticipant(id, p);
    return { ...(await bundle(event)), participant: publicParticipant(p), participantToken };
  }

  if (action === 'self') {
    const input = needData();
    const event = await load(id);
    const p = await updatePerson(id, pid, (cur) => {
      // 참가자 id는 공개 정보라, 응답할 때 받은 비밀 토큰으로 본인인지 확인한다
      if (!ptoken || !cur.tokenHash || hash(ptoken) !== cur.tokenHash) throw new HttpError(403, '본인만 바꿀 수 있어요.');
      return selfUpdate(cur, input, event, now);
    });
    return { ...(await bundle(event)), participant: publicParticipant(p) };
  }

  throw new HttpError(400, '알 수 없는 요청이에요.');
}

function parseBody(req) {
  if (typeof req.body !== 'string') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    throw new HttpError(400, '요청 형식이 올바르지 않아요.');
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET' && req.query.ping) {
      return res.status(200).json({ ok: true, storage: db.hasStorage });
    }
    if (!db.hasStorage) throw new HttpError(503, '서버 저장소가 연결되지 않았어요.');
    if (req.method === 'GET') return res.status(200).json(await bundle(await load(req.query.id)));
    if (req.method === 'POST') {
      const body = parseBody(req);
      if (!body || typeof body !== 'object') throw new HttpError(400, '요청 형식이 올바르지 않아요.');
      return res.status(200).json(await handlePost(body));
    }
    throw new HttpError(405, '지원하지 않는 요청이에요.');
  } catch (err) {
    let status = err instanceof InputError || err instanceof HttpError ? err.status : 500;
    if (err instanceof db.ConflictError) status = 409;
    if (status === 500) console.error(err);
    return res.status(status).json({ error: status === 500 ? '서버 오류가 났어요. 잠시 후 다시 시도해주세요.' : err.message });
  }
}
