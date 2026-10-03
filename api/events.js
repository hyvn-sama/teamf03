// 서버 API — 하나의 경로(/api/events)에서 action으로 나눠 처리
//   GET  ?ping=1           저장소 연결 여부
//   GET  ?id=              안내장 + 참가자
//   POST {action, ...}     create | edit | settle | host | rsvp | self
import { createHash } from 'node:crypto';
import {
  InputError, createEvent, editEvent, cleanSettlement, newParticipant, selfUpdate, hostUpdate, newId,
} from '../js/ops.js';
import * as db from './_store.js';

const hash = (token) => createHash('sha256').update(String(token)).digest('hex');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function publicEvent(e) {
  const { editTokenHash, ...rest } = e;
  return rest;
}

async function load(id) {
  if (!/^[a-z0-9]{8}$/.test(String(id))) throw new HttpError(404, '안내장을 찾을 수 없어요.');
  const event = await db.getEvent(id);
  if (!event) throw new HttpError(404, '안내장을 찾을 수 없어요.');
  return event;
}

async function loadAsHost(id, token) {
  const event = await load(id);
  if (!token || hash(token) !== event.editTokenHash) throw new HttpError(403, '주최자만 할 수 있어요.');
  return event;
}

async function loadParticipant(id, pid) {
  const p = await db.getParticipant(id, String(pid));
  if (!p) throw new HttpError(404, '참가자 정보를 찾을 수 없어요.');
  return p;
}

async function bundle(event) {
  return { event: publicEvent(event), participants: await db.getParticipants(event.id) };
}

async function handlePost(body) {
  const { action, id, token, pid, data = {} } = body;
  const now = new Date();

  if (action === 'create') {
    const editToken = newId(24);
    for (let i = 0; i < 3; i++) {
      const event = { ...createEvent(data, now), editTokenHash: hash(editToken) };
      if (await db.createEventIfAbsent(event)) return { ...(await bundle(event)), editToken };
    }
    throw new HttpError(500, '잠시 후 다시 시도해주세요.');
  }

  if (action === 'edit') {
    const event = await loadAsHost(id, token);
    const result = editEvent(event, data, now);
    if (result.changes.length) await db.putEvent(result.event);
    return { ...(await bundle(result.event)), changes: result.changes };
  }

  if (action === 'settle') {
    const event = await loadAsHost(id, token);
    const participants = await db.getParticipants(id);
    const updated = { ...event, settlement: cleanSettlement(data, participants, now), updatedAt: now.toISOString() };
    await db.putEvent(updated);
    return { event: publicEvent(updated), participants };
  }

  if (action === 'host') {
    const event = await loadAsHost(id, token);
    await db.putParticipant(id, hostUpdate(await loadParticipant(id, pid), data));
    return bundle(event);
  }

  if (action === 'rsvp') {
    const event = await load(id);
    const p = newParticipant(data, event, now);
    await db.putParticipant(id, p);
    return { ...(await bundle(event)), participant: p };
  }

  if (action === 'self') {
    const event = await load(id);
    const p = selfUpdate(await loadParticipant(id, pid), data, event, now);
    await db.putParticipant(id, p);
    return { ...(await bundle(event)), participant: p };
  }

  throw new HttpError(400, '알 수 없는 요청이에요.');
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
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      return res.status(200).json(await handlePost(body));
    }
    throw new HttpError(405, '지원하지 않는 요청이에요.');
  } catch (err) {
    const status = err instanceof InputError || err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return res.status(status).json({ error: status === 500 ? '서버 오류가 났어요. 잠시 후 다시 시도해주세요.' : err.message });
  }
}
