import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEvent, editEvent, cleanSettlement, newParticipant, selfUpdate, hostUpdate, setSupplyEach, InputError,
} from '../js/ops.js';

const now = new Date('2026-10-03T09:00:00Z');
const base = {
  title: ' 가을 동아리 모임 ', date: '2026-10-31', startTime: '17:00', endTime: '20:00',
  placeName: '하이브 라운지 3층', address: '', expectedCount: '20', fee: '16000',
  supplies: '개인 컵', notes: '', hostName: '김민지', hostPhone: '',
};

test('createEvent: 입력 정리, 숫자 변환, 기본값', () => {
  const e = createEvent(base, now);
  assert.equal(e.title, '가을 동아리 모임');
  assert.equal(e.expectedCount, 20);
  assert.equal(e.fee, 16000);
  assert.equal(e.changeVersion, 0);
  assert.deepEqual(e.changes, []);
  assert.equal(e.settlement, null);
  assert.match(e.id, /^[a-z0-9]{8}$/);
});

test('createEvent: 필수 항목·형식 검사', () => {
  assert.throws(() => createEvent({ ...base, title: '  ' }, now), InputError);
  assert.throws(() => createEvent({ ...base, date: '10/31' }, now), InputError);
  assert.throws(() => createEvent({ ...base, startTime: '' }, now), InputError);
  assert.throws(() => createEvent({ ...base, fee: '-5' }, now), InputError);
  assert.equal(createEvent({ ...base, fee: '' }, now).fee, null);
});

test('editEvent: 바뀐 항목만 기록하고 changeVersion 증가', () => {
  const e = createEvent(base, now);
  const { event, changes } = editEvent(e, { ...e, placeName: '역삼 모임공간 B 4층' }, now);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].before, '하이브 라운지 3층');
  assert.equal(event.changeVersion, 1);
  assert.equal(event.id, e.id);

  const again = editEvent(event, { ...event }, now);
  assert.equal(again.changes.length, 0);
  assert.equal(again.event.changeVersion, 1); // 그대로 저장하면 변경 없음
});

test('newParticipant: 참석 → 미정산, 현재 버전을 본 것으로', () => {
  const e = { ...createEvent(base, now), changeVersion: 2 };
  const p = newParticipant({ name: ' 송다은 ', rsvp: 'yes' }, e, now);
  assert.equal(p.name, '송다은');
  assert.equal(p.settle, 'unpaid');
  assert.equal(p.seenVersion, 2);
  assert.equal(newParticipant({ name: '이준호', rsvp: 'maybe' }, e, now).settle, 'excluded');
  assert.throws(() => newParticipant({ name: '', rsvp: 'yes' }, e, now), InputError);
  assert.throws(() => newParticipant({ name: 'x', rsvp: 'go' }, e, now), InputError);
});

test('selfUpdate: 응답 변경, 변경 확인, 입금했어요', () => {
  const e = { ...createEvent(base, now), changeVersion: 3, settlement: { total: 1, count: 1 } };
  let p = newParticipant({ name: '송다은', rsvp: 'maybe' }, { ...e, changeVersion: 1 }, now);
  assert.equal(p.settle, 'excluded');

  p = selfUpdate(p, { rsvp: 'yes' }, e, now);
  assert.equal(p.settle, 'unpaid');

  p = selfUpdate(p, { seen: true }, e, now);
  assert.equal(p.seenVersion, 3);

  p = selfUpdate(p, { paid: true }, e, now);
  assert.equal(p.settle, 'done');

  // 정산 완료 후 불참으로 바꾸면 정산 제외
  assert.equal(selfUpdate(p, { rsvp: 'no' }, e, now).settle, 'excluded');
});

test('selfUpdate: 정산 등록 전이거나 참석이 아니면 입금 불가', () => {
  const e = createEvent(base, now);
  const p = newParticipant({ name: 'a', rsvp: 'yes' }, e, now);
  assert.throws(() => selfUpdate(p, { paid: true }, e, now), InputError);
  const q = newParticipant({ name: 'b', rsvp: 'no' }, e, now);
  assert.throws(() => selfUpdate(q, { paid: true }, { ...e, settlement: { total: 1, count: 1 } }, now), InputError);
});

test('hostUpdate: 주최자가 참석·정산 상태 변경', () => {
  const e = createEvent(base, now);
  let p = newParticipant({ name: 'a', rsvp: 'yes' }, e, now);
  p = hostUpdate(p, { settle: 'done' });
  assert.equal(p.settle, 'done');
  p = hostUpdate(p, { rsvp: 'no' });
  assert.equal(p.settle, 'excluded');
  assert.throws(() => hostUpdate(p, { settle: 'done' }), InputError); // 불참자는 정산 대상 아님
});

test('cleanSettlement: 필수값, 개인별 금액은 참석자만', () => {
  const ps = [{ id: 'p1', rsvp: 'yes' }, { id: 'p2', rsvp: 'no' }];
  const s = cleanSettlement({
    total: '224000', count: '14', mode: 'custom', custom: { p1: '20000', p2: '5', zz: '1' },
    accountNo: '[국민] 000', accountHolder: '김민지',
  }, ps, now);
  assert.equal(s.total, 224000);
  assert.deepEqual(s.custom, { p1: 20000 });
  assert.throws(() => cleanSettlement({ total: '0', count: '1', accountNo: 'a', accountHolder: 'b' }, ps, now), InputError);
  assert.throws(() => cleanSettlement({ total: '10', count: '1', accountNo: '', accountHolder: 'b' }, ps, now), InputError);
});

test('selfUpdate: 준비물 담당(brings)과 늦어요(late)', () => {
  const e = { ...createEvent({ ...base, supplies: '개인 컵, 간식' }, now), supplyEach: [] };
  let p = newParticipant({ name: 'a', rsvp: 'yes' }, e, now);
  assert.deepEqual(p.brings, []);
  assert.equal(p.late, null);
  p = selfUpdate(p, { brings: ['간식', '간식', '없는 물건'] }, e, now);
  assert.deepEqual(p.brings, ['간식']);
  p = selfUpdate(p, { late: 20 }, e, now);
  assert.equal(p.late.minutes, 20);
  p = selfUpdate(p, { late: 0 }, e, now);
  assert.equal(p.late, null);
  assert.throws(() => selfUpdate(p, { late: 15 }, e, now), InputError);
  const no = newParticipant({ name: 'b', rsvp: 'no' }, e, now);
  assert.throws(() => selfUpdate(no, { brings: ['간식'] }, e, now), InputError);
  assert.throws(() => selfUpdate(no, { late: 10 }, e, now), InputError);
});

test('setSupplyEach: 각자 챙기는 준비물 켜고 끄기', () => {
  const e = createEvent({ ...base, supplies: '개인 컵, 간식' }, now);
  let next = setSupplyEach(e, { item: '개인 컵', on: true }, now);
  assert.deepEqual(next.supplyEach, ['개인 컵']);
  next = setSupplyEach(next, { item: '개인 컵', on: false }, now);
  assert.deepEqual(next.supplyEach, []);
  assert.throws(() => setSupplyEach(e, { item: '없는 물건', on: true }, now), InputError);
});
