// 서버 API — 하나의 경로(/api/events)에서 action으로 나눠 처리
//   GET  ?ping=1           저장소 연결 여부
//   GET  ?id=              모임장 + 참가자
//   GET  ?ics=             일정 파일(.ics) — 아이폰 기본 캘린더에 추가
//   POST {action, ...}     signup | login | logout | whoami | mine | me | claim  (로그인: session)
//                          create(로그인 필수) | edit | settle | host | drop | each | delete   (주최자: token 또는 만든 사람 session)
//                          rsvp | self                                       (참가자: pid + ptoken 또는 본인 session)
import { createHash } from 'node:crypto';
import {
  InputError, createEvent, editEvent, cleanSettlement, newParticipant, selfUpdate, hostUpdate, setSupplyEach, newId,
} from '../js/ops.js';
import { dataStamp, icsText } from '../js/calc.js';
import { cleanSignup, normalizePhone } from '../js/auth.js';
import { hashPassword, verifyPassword } from './_auth.js';
import * as db from './_store.js';

const hash = (token) => createHash('sha256').update(String(token)).digest('hex');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const notFound = () => new HttpError(404, '모임장을 찾을 수 없어요.');

// 공개 응답에서 비밀값과 전화번호는 뺀다
function publicEvent(e) {
  const { editTokenHash, ownerPhone, ...rest } = e;
  return rest;
}

function publicParticipant(p) {
  const { tokenHash, userPhone, ...rest } = p;
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
// 주최자: 관리 토큰(관리 링크) 또는 로그인한 만든 사람
const canHost = (event, token, user) => isHost(event, token) || Boolean(user && event.ownerPhone === user.phone);
// 참가자 본인: 응답 때 받은 토큰 또는 로그인한 본인
const ownsParticipant = (p, ptoken, user) =>
  Boolean((ptoken && p.tokenHash && hash(ptoken) === p.tokenHash) || (user && p.userPhone && p.userPhone === user.phone));

async function loadAsHost(id, token, user) {
  const event = await load(id);
  if (!canHost(event, token, user)) throw new HttpError(403, '주최자만 할 수 있어요.');
  return event;
}

// 주최자 전용 모임장 수정: 최신 값에 다시 적용하며 저장 (동시 수정 시 재시도)
async function updateAsHost(id, token, user, fn) {
  checkId(id);
  const updated = await db.updateEvent(id, (event) => {
    if (!canHost(event, token, user)) throw new HttpError(403, '주최자만 할 수 있어요.');
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
  return {
    event: publicEvent(event),
    participants: participants.map(publicParticipant),
    stamp: dataStamp(event, participants),
  };
}

// 같은 모임장을 수백 명이 열어도 서버·Redis에는 5초에 한 번만 가도록 CDN이 대신 응답
// (브라우저에는 s-maxage가 전달되지 않음. 방금 내가 바꾼 내용은 클라이언트가 캐시를 건너뛰어 받음)
const CDN_CACHE = 'public, s-maxage=5, stale-while-revalidate=10';

// ── 로그인
const MAX_FAILS = 10;
const publicUser = (u) => ({ phone: u.phone, name: u.name });

async function sessionUser(session) {
  if (!session || typeof session !== 'string' || session.length > 64) return null;
  const phone = await db.getSession(session);
  if (!phone) return null;
  const u = await db.getUser(phone);
  return u ? publicUser(u) : null;
}

function needUser(user) {
  if (!user) throw new HttpError(401, '로그인이 필요해요.');
  return user;
}

async function startSession(u) {
  const session = newId(32);
  await db.setSession(session, u.phone);
  return { session, user: publicUser(u) };
}

// 이 브라우저에 있던 주최(관리 토큰)·응답(참가자 토큰) 기록을 로그인한 계정으로 옮긴다
async function claim(u, body) {
  const list = (v) => (Array.isArray(v) ? v.slice(0, 100) : []);
  const validId = (x) => /^[a-z0-9]{8}$/.test(String(x));
  let hosted = 0;
  let joined = 0;
  for (const h of list(body.hosted)) {
    if (!h || !validId(h.id)) continue;
    const event = await db.getEvent(h.id);
    if (!event || !isHost(event, h.token)) continue;
    // 다른 계정이 만든 모임은 옮기지 않는다 (같은 기기에 앞사람의 관리 토큰이 남아 있던 경우)
    if (event.ownerPhone && event.ownerPhone !== u.phone) continue;
    if (!event.ownerPhone) await db.updateEvent(h.id, (e) => (e.ownerPhone ? e : { ...e, ownerPhone: u.phone }));
    await db.addUserEvent(u.phone, h.id, { role: 'host' });
    hosted++;
  }
  for (const j of list(body.joined)) {
    if (!j || !validId(j.id) || !j.ptoken) continue;
    // 이 모임에 이미 계정 응답이 있으면 새로 연결하지 않고 하나로 합친다 (같은 사람이 두 명으로 세어지지 않게)
    const linked = (await db.getUserEvents(u.phone))[j.id];
    if (linked && linked.pid && linked.pid !== String(j.pid)) {
      if (await mergeInto(j, linked.pid)) joined++;
      continue;
    }
    const p = await db.updateParticipant(j.id, String(j.pid), (cur) => {
      if (hash(j.ptoken) !== cur.tokenHash) throw new HttpError(403, '토큰 불일치');
      return cur.userPhone ? cur : { ...cur, userPhone: u.phone };
    }).catch(() => null);
    if (!p || p.userPhone !== u.phone) continue;
    await db.addUserEvent(u.phone, j.id, { role: 'guest', pid: p.id });
    joined++;
  }
  return { hosted, joined };
}

// 익명 응답(j)을 계정 응답(keepPid)에 합치고 익명 응답은 지운다. 더 최근에 바뀐 쪽의 응답 내용을 남긴다
async function mergeInto(j, keepPid) {
  const anon = await db.getParticipant(j.id, String(j.pid));
  if (!anon || hash(j.ptoken) !== anon.tokenHash || anon.userPhone) return false;
  const kept = await db.updateParticipant(j.id, keepPid, (cur) => {
    if ((anon.updatedAt || '') <= (cur.updatedAt || '')) return cur;
    const { rsvp, settle, paidAt, brings, late } = anon;
    return { ...cur, rsvp, settle, paidAt, brings, late, seenVersion: Math.max(cur.seenVersion || 0, anon.seenVersion || 0), updatedAt: anon.updatedAt };
  });
  if (!kept) return false;
  await db.deleteParticipant(j.id, anon.id);
  return true;
}

async function handlePost(body) {
  const { action, id, token, pid, ptoken } = body;
  const data = body.data && typeof body.data === 'object' ? body.data : null;
  const needData = () => {
    if (!data) throw new HttpError(400, '요청 내용이 비어 있어요.');
    return data;
  };
  const now = new Date();
  const user = await sessionUser(body.session);
  // 세션을 보냈는데 만료·로그아웃된 경우: 익명으로 처리하면 응답이 중복되므로 401로 알려 다시 로그인하게 한다
  if (body.session && !user && !['signup', 'login', 'logout'].includes(action)) {
    throw new HttpError(401, '로그인이 만료됐어요. 다시 로그인해주세요.');
  }

  if (action === 'signup') {
    const input = cleanSignup(body);
    const { hash: passHash, salt } = await hashPassword(input.password);
    const created = await db.createUserIfAbsent({ phone: input.phone, name: input.name, passHash, salt, createdAt: now.toISOString() });
    if (!created) throw new HttpError(409, '이미 가입된 번호예요. 로그인해주세요.');
    return startSession({ phone: input.phone, name: input.name });
  }

  if (action === 'login') {
    const phone = normalizePhone(body.phone);
    if ((await db.failCount(phone)) >= MAX_FAILS) throw new HttpError(429, '비밀번호를 여러 번 틀렸어요. 15분 뒤에 다시 시도해주세요.');
    const found = await db.getUser(phone);
    const pw = String(body.password ?? '');
    if (!found || pw.length < 4 || pw.length > 30 || !(await verifyPassword(pw, found))) {
      await db.addFail(phone);
      throw new HttpError(401, '전화번호 또는 비밀번호가 맞지 않아요.');
    }
    await db.clearFail(phone);
    return startSession(found);
  }

  if (action === 'logout') {
    if (typeof body.session === 'string') await db.deleteSession(body.session);
    return { ok: true };
  }

  if (action === 'whoami') return { user: needUser(user) };

  if (action === 'mine') {
    const u = needUser(user);
    const entries = Object.entries(await db.getUserEvents(u.phone))
      .sort((a, b) => b[1].at.localeCompare(a[1].at))
      .slice(0, 50);
    const items = [];
    for (const [eventId, info] of entries) {
      const event = await db.getEvent(eventId);
      if (!event) continue;
      // 주최 표시는 실제로 만든 사람일 때만 (예전에 잘못 옮겨진 다른 계정의 모임은 응답했으면 참여로, 아니면 숨김)
      const role = info.role === 'host' && event.ownerPhone && event.ownerPhone !== u.phone ? (info.pid ? 'guest' : null) : info.role;
      if (role) items.push({ role, pid: info.pid || null, ...(await bundle(event)) });
    }
    return { items };
  }

  if (action === 'claim') return claim(needUser(user), body);

  if (action === 'me') {
    const event = await load(id);
    if (!user) return { isHost: isHost(event, token), participant: null };
    const info = (await db.getUserEvents(user.phone))[id];
    const p = info && info.pid ? (await db.getParticipants(id)).find((x) => x.id === info.pid) : null;
    return { isHost: canHost(event, token, user), participant: p ? publicParticipant(p) : null };
  }

  if (action === 'create') {
    const owner = needUser(user);
    const input = needData();
    const editToken = newId(24);
    for (let i = 0; i < 3; i++) {
      const event = { ...createEvent(input, now), editTokenHash: hash(editToken), ownerPhone: owner.phone };
      if (await db.createEventIfAbsent(event)) {
        await db.addUserEvent(owner.phone, event.id, { role: 'host' });
        return { ...(await bundle(event)), editToken };
      }
    }
    throw new HttpError(500, '잠시 후 다시 시도해주세요.');
  }

  if (action === 'edit') {
    const input = needData();
    let changes = [];
    const updated = await updateAsHost(id, token, user, (event) => {
      const result = editEvent(event, input, now);
      changes = result.changes;
      return result.event;
    });
    return { ...(await bundle(updated)), changes };
  }

  if (action === 'settle') {
    const input = needData();
    const participants = await db.getParticipants(id);
    const updated = await updateAsHost(id, token, user, (event) => ({
      ...event, settlement: cleanSettlement(input, participants, now), updatedAt: now.toISOString(),
    }));
    return bundle(updated);
  }

  if (action === 'each') {
    const input = needData();
    return bundle(await updateAsHost(id, token, user, (event) => setSupplyEach(event, input, now)));
  }

  if (action === 'delete') {
    const event = await loadAsHost(id, token, user);
    const participants = await db.getParticipants(id);
    // 만든 사람·로그인해서 응답한 사람의 내 모임장에서도 뺀다
    const phones = new Set([event.ownerPhone, ...participants.map((p) => p.userPhone)].filter(Boolean));
    for (const phone of phones) await db.removeUserEvent(phone, id);
    await db.deleteEvent(id);
    return { ok: true, id };
  }

  if (action === 'host') {
    const input = needData();
    const event = await loadAsHost(id, token, user);
    await updatePerson(id, pid, (p) => hostUpdate(p, input, event, now));
    return bundle(event);
  }

  // 주최자: 참석자 명단에서 한 사람 삭제
  if (action === 'drop') {
    const event = await loadAsHost(id, token, user);
    const p = await db.getParticipant(id, String(pid));
    if (!p) throw new HttpError(404, '참가자 정보를 찾을 수 없어요.');
    await db.deleteParticipant(id, p.id);
    if (p.userPhone) {
      // 로그인해서 응답한 사람의 내 모임장에서도 뺀다 (주최자 본인이면 주최 기록은 남기고 응답만 끊음)
      const info = (await db.getUserEvents(p.userPhone))[id];
      if (info && info.role === 'host') await db.addUserEvent(p.userPhone, id, { role: 'host', pid: null });
      else if (info) await db.removeUserEvent(p.userPhone, id);
    }
    return bundle(event);
  }

  if (action === 'rsvp') {
    const event = await load(id);
    const input = needData();
    if (user) {
      // 같은 계정은 한 모임에 한 번만: 이미 응답했으면 그 응답을 고친다
      const info = (await db.getUserEvents(user.phone))[id];
      if (info && info.pid) {
        const p = await db.updateParticipant(id, info.pid, (cur) => selfUpdate(cur, { name: input.name, rsvp: input.rsvp }, event, now));
        if (p) return { ...(await bundle(event)), participant: publicParticipant(p), participantToken: null };
      }
    }
    const participantToken = newId(24);
    const p = {
      ...newParticipant(input, event, now),
      tokenHash: hash(participantToken),
      ...(user ? { userPhone: user.phone } : {}),
    };
    await db.addParticipant(id, p);
    if (user) await db.addUserEvent(user.phone, id, { role: 'guest', pid: p.id });
    return { ...(await bundle(event)), participant: publicParticipant(p), participantToken };
  }

  if (action === 'self') {
    const input = needData();
    const event = await load(id);
    const p = await updatePerson(id, pid, (cur) => {
      // 참가자 id는 공개 정보라, 응답 때 받은 비밀 토큰이나 로그인으로 본인인지 확인한다
      if (!ownsParticipant(cur, ptoken, user)) throw new HttpError(403, '본인만 바꿀 수 있어요.');
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
    if (req.method === 'GET' && req.query.ics) {
      // 아이폰 Safari는 text/calendar 응답을 받으면 "캘린더에 추가" 화면을 바로 띄운다
      const event = await load(req.query.ics);
      const host = req.headers && req.headers.host;
      const link = host ? `${req.headers['x-forwarded-proto'] || 'https'}://${host}/#/e/${event.id}` : '';
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', `inline; filename="moim-${event.id}.ics"`);
      res.setHeader('Cache-Control', CDN_CACHE);
      return res.status(200).send(icsText(event, link));
    }
    if (req.method === 'GET') {
      const body = await bundle(await load(req.query.id));
      res.setHeader('Cache-Control', CDN_CACHE);
      return res.status(200).json(body);
    }
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
