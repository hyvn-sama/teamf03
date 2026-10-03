import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysUntil, ddayLabel, formatDate, formatTime, timeRange, countRsvp, defaultSettle,
  perPerson, amountFor, settleSummary, diffEvent, seenCount, toICS, won,
} from '../js/calc.js';

const now = new Date(2026, 9, 3, 17, 51); // 2026-10-03 17:51 (토)

test('daysUntil / ddayLabel: 모임 날짜 - 오늘', () => {
  assert.equal(daysUntil('2026-10-31', now), 28);
  assert.equal(ddayLabel('2026-10-31', now), 'D-28');
  assert.equal(ddayLabel('2026-10-03', now), 'D-DAY');
  assert.equal(ddayLabel('2026-09-27', now), '6일 전 종료');
});

test('formatDate / formatTime / timeRange', () => {
  assert.equal(formatDate('2026-10-31'), '2026. 10. 31 (토)');
  assert.equal(formatTime('17:00'), '오후 5:00');
  assert.equal(formatTime('00:30'), '오전 12:30');
  assert.equal(formatTime('12:05'), '오후 12:05');
  assert.equal(timeRange({ startTime: '17:00', endTime: '20:00' }), '오후 5:00 ~ 오후 8:00');
  assert.equal(timeRange({ startTime: '17:00', endTime: '' }), '오후 5:00');
});

const ps = [
  { id: 'a', rsvp: 'yes', settle: 'done' },
  { id: 'b', rsvp: 'yes', settle: 'unpaid' },
  { id: 'c', rsvp: 'maybe', settle: 'excluded' },
  { id: 'd', rsvp: 'no', settle: 'excluded' },
];

test('countRsvp: 참석/미정/불참/전체 자동 집계', () => {
  assert.deepEqual(countRsvp(ps), { total: 4, yes: 2, maybe: 1, no: 1 });
});

test('defaultSettle: 참석 → 미정산, 미정·불참 → 정산 제외', () => {
  assert.equal(defaultSettle('yes'), 'unpaid');
  assert.equal(defaultSettle('maybe'), 'excluded');
  assert.equal(defaultSettle('no'), 'excluded');
});

test('perPerson: 총 비용 ÷ 정산 인원, 1원 단위 올림', () => {
  assert.equal(perPerson(224000, 14), 16000);
  assert.equal(perPerson(100000, 3), 33334);
  assert.equal(perPerson(1000, 0), 0);
});

test('amountFor: 개인별 조정 금액 우선, 없으면 균등 금액', () => {
  const s = { total: 30000, count: 2, mode: 'custom', custom: { a: 20000 } };
  assert.equal(amountFor(s, 'a'), 20000);
  assert.equal(amountFor(s, 'b'), 15000);
  assert.equal(amountFor({ ...s, mode: 'equal' }, 'a'), 15000);
});

test('settleSummary: 정산 대상·완료·미정산·남은 금액', () => {
  const s = { total: 32000, count: 2, mode: 'equal' };
  assert.deepEqual(settleSummary(ps, s), { targets: 2, done: 1, unpaid: 1, remaining: 16000 });
  assert.deepEqual(settleSummary(ps, null), { targets: 2, done: 1, unpaid: 1, remaining: 0 });
});

test('diffEvent: 바뀐 항목만 변경 전/후로', () => {
  const a = { title: '모임', startTime: '17:00', placeName: 'A', fee: 1000, notes: '' };
  const b = { title: '모임', startTime: '18:00', placeName: 'A', fee: 1000, notes: '' };
  assert.deepEqual(diffEvent(a, b), [{ field: 'startTime', label: '시작 시간', before: '17:00', after: '18:00' }]);
  assert.deepEqual(diffEvent(a, { ...a }), []);
});

test('seenCount: 최신 변경을 확인한 인원', () => {
  const list = [{ seenVersion: 2 }, { seenVersion: 1 }, { seenVersion: 2 }];
  assert.deepEqual(seenCount(list, 2), { seen: 2, total: 3 });
});

test('toICS: 캘린더 파일에 모임명·시간·장소', () => {
  const ics = toICS({ id: 'x', title: '가을, 모임', date: '2026-10-31', startTime: '17:00', endTime: '', placeName: '라운지', address: '서울' });
  assert.match(ics, /DTSTART:20261031T170000/);
  assert.match(ics, /DTEND:20261031T190000/); // 종료 시간 없으면 2시간
  assert.match(ics, /SUMMARY:가을\\, 모임/);
  assert.match(ics, /LOCATION:라운지 서울/);
});

test('won: 금액 표시', () => {
  assert.equal(won(224000), '224,000원');
});
