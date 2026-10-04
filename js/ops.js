// 데이터 처리 — 입력 검증과 상태 변경 규칙. 브라우저(로컬 모드)와 서버(api/)가 같이 쓴다.
import { EDIT_FIELDS, FIELD_LABELS, defaultSettle, diffEvent, josa, supplyItems, settleTargets } from './calc.js';

export class InputError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const RSVP = ['yes', 'maybe', 'no'];
const LATE_MINUTES = [0, 10, 20, 30];
const SETTLE = ['done', 'unpaid', 'excluded'];
const MAX_LEN = {
  title: 60, placeName: 80, address: 120, supplies: 300, notes: 600,
  hostName: 30, hostPhone: 30, name: 20, accountNo: 60, accountHolder: 30,
};

export function newId(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

const LABELS = { ...FIELD_LABELS, name: '이름', accountNo: '계좌번호', accountHolder: '예금주' };

function text(raw, field, required) {
  const v = String(raw ?? '').trim();
  const label = LABELS[field] || field;
  if (required && !v) throw new InputError(`${josa(label, '을', '를')} 입력해주세요.`);
  if (v.length > (MAX_LEN[field] || 100)) throw new InputError(`${josa(label, '이', '가')} 너무 길어요. (최대 ${MAX_LEN[field]}자)`);
  return v;
}

function int(raw, field, { min = 0, max = 100000000, required = false } = {}) {
  const label = LABELS[field] || field;
  if (raw === '' || raw == null) {
    if (required) throw new InputError(`${josa(label, '을', '를')} 입력해주세요.`);
    return null;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new InputError(`${label} 값이 올바르지 않아요.`);
  return n;
}

function cleanEventInput(raw) {
  const e = {
    title: text(raw.title, 'title', true),
    date: String(raw.date ?? ''),
    startTime: String(raw.startTime ?? ''),
    endTime: String(raw.endTime ?? ''),
    placeName: text(raw.placeName, 'placeName', true),
    address: text(raw.address, 'address'),
    expectedCount: int(raw.expectedCount, 'expectedCount', { max: 10000 }),
    fee: int(raw.fee, 'fee', { max: 10000000 }),
    supplies: text(raw.supplies, 'supplies'),
    notes: text(raw.notes, 'notes'),
    hostName: text(raw.hostName, 'hostName'),
    hostPhone: text(raw.hostPhone, 'hostPhone'),
  };
  if (!isRealDate(e.date)) throw new InputError('날짜를 선택해주세요.');
  if (!isTime(e.startTime)) throw new InputError('시작 시간을 선택해주세요.');
  if (e.endTime && !isTime(e.endTime)) throw new InputError('종료 시간이 올바르지 않아요.');
  // 종료가 시작보다 이르면 자정을 넘기는 모임으로 본다 (22:00 ~ 01:00)
  return e;
}

function isRealDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const MAX_HISTORY = 50;

export function createEvent(raw, now = new Date()) {
  const at = now.toISOString();
  return {
    id: newId(8),
    ...cleanEventInput(raw),
    changeVersion: 0,
    changes: [],
    supplyEach: [],
    settlement: null,
    createdAt: at,
    updatedAt: at,
  };
}

// 수정: 바뀐 항목이 있으면 이력에 남기고 changeVersion +1 (참석자에게 변경 배너)
export function editEvent(event, raw, now = new Date()) {
  const next = cleanEventInput(raw);
  const version = (event.changeVersion || 0) + 1;
  const changes = diffEvent(event, next).map((c) => ({ ...c, version, at: now.toISOString() }));
  if (!changes.length) return { event, changes };
  const updated = { ...event };
  for (const f of EDIT_FIELDS) updated[f] = next[f];
  updated.changeVersion = version;
  // 이력을 쌓아 둬야 앞선 변경을 아직 못 본 참석자에게도 보여줄 수 있다
  updated.changes = [...(event.changes || []), ...changes].slice(-MAX_HISTORY);
  updated.updatedAt = now.toISOString();
  return { event: updated, changes };
}

export function cleanSettlement(raw, participants, now = new Date()) {
  const s = {
    total: int(raw.total, '총 비용', { min: 1, required: true }),
    count: int(raw.count, '정산 인원', { min: 1, max: 10000, required: true }),
    mode: raw.mode === 'custom' ? 'custom' : 'equal',
    custom: {},
    accountNo: text(raw.accountNo, 'accountNo', true),
    accountHolder: text(raw.accountHolder, 'accountHolder', true),
    sentAt: now.toISOString(),
  };
  if (s.mode === 'custom') {
    const targets = new Set(settleTargets(participants).map((p) => p.id));
    for (const [pid, v] of Object.entries(raw.custom || {})) {
      if (targets.has(pid)) s.custom[pid] = int(v, '개인별 금액', { required: true });
    }
    const sum = Object.values(s.custom).reduce((a, b) => a + b, 0);
    if (sum !== s.total) throw new InputError('개인별 금액의 합계가 총 비용과 같아야 해요.');
  }
  return s;
}

export function newParticipant(raw, event, now = new Date()) {
  const rsvp = raw.rsvp;
  if (!RSVP.includes(rsvp)) throw new InputError('참석 여부를 선택해주세요.');
  return {
    id: `p_${newId(8)}`,
    name: text(raw.name, 'name', true),
    rsvp,
    settle: defaultSettle(rsvp),
    seenVersion: event.changeVersion || 0,
    respondedAt: now.toISOString(),
    paidAt: null,
    brings: [],
    late: null,
  };
}

function withRsvp(p, rsvp) {
  if (!RSVP.includes(rsvp)) throw new InputError('참석 여부가 올바르지 않아요.');
  if (rsvp === p.rsvp) return p;
  // 이미 입금한 사람이 다시 참석으로 바꾸면 정산 완료를 되살린다
  const settle = rsvp === 'yes' && p.paidAt ? 'done' : defaultSettle(rsvp);
  return { ...p, rsvp, settle };
}

// 참가자 본인: 응답 변경 / 변경사항 확인 / 입금했어요
export function selfUpdate(p, raw, event, now = new Date()) {
  let next = { ...p };
  if (raw.name != null) next.name = text(raw.name, 'name', true);
  if (raw.rsvp != null) next = withRsvp(next, raw.rsvp);
  if (raw.seen) next.seenVersion = event.changeVersion || 0;
  if (raw.paid) {
    if (!event.settlement) throw new InputError('아직 정산 안내가 등록되지 않았어요.');
    if (next.rsvp !== 'yes') throw new InputError('참석자만 정산할 수 있어요.');
    next.settle = 'done';
    next.paidAt = now.toISOString();
  }
  if (raw.brings != null) {
    if (next.rsvp !== 'yes') throw new InputError('참석자만 준비물을 맡을 수 있어요.');
    if (!Array.isArray(raw.brings)) throw new InputError('준비물 정보가 올바르지 않아요.');
    const items = supplyItems(event);
    next.brings = [...new Set(raw.brings.map(String))].filter((b) => items.includes(b));
  }
  if (raw.late != null) {
    const minutes = Number(raw.late);
    if (!LATE_MINUTES.includes(minutes)) throw new InputError('늦는 시간이 올바르지 않아요.');
    if (minutes && next.rsvp !== 'yes') throw new InputError('참석자만 늦는다고 알릴 수 있어요.');
    next.late = minutes ? { minutes, at: now.toISOString() } : null;
  }
  return next;
}

// 주최자: 모두 각자 챙기는 준비물 표시
export function setSupplyEach(event, raw, now = new Date()) {
  const item = String(raw.item ?? '');
  if (!supplyItems(event).includes(item)) throw new InputError('준비물을 찾을 수 없어요.');
  const rest = (event.supplyEach || []).filter((x) => x !== item);
  return { ...event, supplyEach: raw.on ? [...rest, item] : rest, updatedAt: now.toISOString() };
}

// 주최자: 참석·정산 상태 직접 변경
export function hostUpdate(p, raw, event, now = new Date()) {
  let next = { ...p };
  if (raw.rsvp != null) next = withRsvp(next, raw.rsvp);
  if (raw.settle != null && raw.settle !== next.settle) {
    if (!SETTLE.includes(raw.settle)) throw new InputError('정산 상태가 올바르지 않아요.');
    if (raw.settle !== 'excluded' && next.rsvp !== 'yes') throw new InputError('참석자만 정산 대상이에요.');
    if (raw.settle === 'done' && !event.settlement) throw new InputError('정산을 먼저 등록해주세요.');
    next.settle = raw.settle;
    if (raw.settle === 'done') next.paidAt = next.paidAt || now.toISOString();
    if (raw.settle === 'unpaid') next.paidAt = null;
  }
  return next;
}
