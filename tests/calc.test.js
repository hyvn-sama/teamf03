import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysUntil, ddayLabel, formatDate, formatTime, timeRange, countRsvp, defaultSettle,
  perPerson, amountFor, settleSummary, diffEvent, seenCount, googleCalendarUrl, won, supplyItems, supplyStatus, lateList,
  pendingChanges, changeSummary, settleTargets, settleCountMismatch, settleReminder,
} from '../js/calc.js';

test('settleReminder: 미입금 참석자 이름·금액·계좌로 다시 알림 문구', () => {
  const ps = [
    { id: 'a', name: '김하나', rsvp: 'yes', settle: 'unpaid' },
    { id: 'b', name: '이둘', rsvp: 'yes', settle: 'done' },
    { id: 'c', name: '박셋', rsvp: 'yes', settle: 'unpaid' },
    { id: 'd', name: '최넷', rsvp: 'yes', settle: 'excluded' },
    { id: 'e', name: '정다섯', rsvp: 'no', settle: 'excluded' },
  ];
  const e = { title: '가을 모임', settlement: { total: 30000, count: 3, mode: 'equal', accountNo: '국민 123', accountHolder: '홍길동' } };
  const text = settleReminder(e, ps);
  assert.match(text, /^\[정산 다시 알림\] 가을 모임/);
  assert.match(text, /김하나, 박셋님/);
  assert.doesNotMatch(text, /이둘|최넷|정다섯/);
  assert.match(text, /1인 10,000원/);
  assert.match(text, /국민 123 \(홍길동\)/);

  const custom = settleReminder({ ...e, settlement: { ...e.settlement, mode: 'custom', custom: { a: 12000, c: 8000 } } }, ps);
  assert.match(custom, /· 김하나 12,000원\n· 박셋 8,000원/);

  assert.equal(settleReminder({ title: 'x' }, ps), null); // 정산 등록 전
  assert.equal(settleReminder(e, ps.map((p) => ({ ...p, settle: p.settle === 'unpaid' ? 'done' : p.settle }))), null); // 모두 입금
});

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

test('googleCalendarUrl: 구글 캘린더 일정 추가 화면으로 바로 연결', () => {
  const url = new URL(googleCalendarUrl({ title: '가을 & 모임', date: '2026-10-31', startTime: '17:00', endTime: '', placeName: '라운지', address: '서울', supplies: '컵', notes: '주차 가능' }, 'https://teamf03.vercel.app/#/e/abc'));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.equal(url.searchParams.get('text'), '가을 & 모임');
  assert.equal(url.searchParams.get('dates'), '20261031T170000/20261031T190000'); // 종료 없으면 2시간
  assert.equal(url.searchParams.get('ctz'), 'Asia/Seoul');
  assert.equal(url.searchParams.get('location'), '라운지 서울');
  assert.match(url.searchParams.get('details'), /준비물: 컵[\s\S]*주차 가능[\s\S]*teamf03\.vercel\.app/);
});

test('won: 금액 표시', () => {
  assert.equal(won(224000), '224,000원');
});

test('supplyItems / supplyStatus: 쉼표로 나눈 준비물별 각자·담당자', () => {
  const e = { supplies: '개인 컵, 간단한 간식,보드게임\n블루투스 스피커', supplyEach: ['개인 컵', '없어진 물건'] };
  assert.deepEqual(supplyItems(e), ['개인 컵', '간단한 간식', '보드게임', '블루투스 스피커']);
  const ps = [
    { id: 'a', name: '박지연', rsvp: 'yes', brings: ['간단한 간식'] },
    { id: 'b', name: '최지훈', rsvp: 'yes', brings: ['간단한 간식', '옛날 물건'] },
    { id: 'c', name: '강도현', rsvp: 'no', brings: ['보드게임'] }, // 불참자는 담당에서 빠짐
  ];
  const s = supplyStatus(e, ps);
  assert.deepEqual(s.map((x) => [x.name, x.each, x.bringers.map((p) => p.name)]), [
    ['개인 컵', true, []],
    ['간단한 간식', false, ['박지연', '최지훈']],
    ['보드게임', false, []],
    ['블루투스 스피커', false, []],
  ]);
  assert.equal(s.filter((x) => x.needed).length, 2);
  assert.deepEqual(supplyStatus({ supplies: '' }, ps), []);
});

test('lateList: 참석자 중 늦는다고 알린 사람', () => {
  const ps = [
    { name: 'a', rsvp: 'yes', late: { minutes: 20 } },
    { name: 'b', rsvp: 'yes', late: null },
    { name: 'c', rsvp: 'no', late: { minutes: 10 } },
  ];
  assert.deepEqual(lateList(ps).map((p) => p.name), ['a']);
});

test('googleCalendarUrl: 자정을 넘기는 모임은 종료가 다음 날', () => {
  const url = new URL(googleCalendarUrl({ title: 't', date: '2026-10-10', startTime: '22:00', endTime: '01:00', placeName: 'p' }));
  assert.equal(url.searchParams.get('dates'), '20261010T220000/20261011T010000');
});

test('pendingChanges: 아직 확인 안 한 변경을 항목별로 합침 (처음 before, 마지막 after)', () => {
  const e = {
    changeVersion: 3,
    changes: [
      { version: 1, field: 'startTime', label: '시작 시간', before: '18:30', after: '19:00' },
      { version: 2, field: 'notes', label: '유의사항', before: '', after: '2차 자율' },
      { version: 3, field: 'startTime', label: '시작 시간', before: '19:00', after: '19:30' },
    ],
  };
  assert.deepEqual(pendingChanges(e, 0).map((c) => [c.field, c.before, c.after]), [['startTime', '18:30', '19:30'], ['notes', '', '2차 자율']]);
  assert.deepEqual(pendingChanges(e, 2).map((c) => [c.field, c.before, c.after]), [['startTime', '19:00', '19:30']]);
  assert.deepEqual(pendingChanges(e, 3), []);
  // 되돌려서 같아지면 빼기
  const back = { changeVersion: 2, changes: [{ version: 1, field: 'fee', before: 1, after: 2 }, { version: 2, field: 'fee', before: 2, after: 1 }] };
  assert.deepEqual(pendingChanges(back, 0), []);
  assert.equal(changeSummary(e), '시간');
});

test('settleTargets / settleCountMismatch: 정산 대상 = 참석 중 정산 제외가 아닌 사람', () => {
  const list = [
    { id: 'a', rsvp: 'yes', settle: 'done' }, { id: 'b', rsvp: 'yes', settle: 'excluded' },
    { id: 'c', rsvp: 'yes', settle: 'unpaid' }, { id: 'd', rsvp: 'no', settle: 'excluded' },
  ];
  assert.deepEqual(settleTargets(list).map((p) => p.id), ['a', 'c']);
  assert.equal(settleCountMismatch(list, { count: 2 }), null);
  assert.deepEqual(settleCountMismatch(list, { count: 3 }), { registered: 3, current: 2 });
  assert.equal(settleCountMismatch(list, null), null);
});
