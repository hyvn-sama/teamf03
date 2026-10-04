// 시연용 샘플 모임 (앱 예시화면 데이터). 날짜는 오늘 기준으로 만든다.
import { addDays, todayStr } from './calc.js';

const HOST = { hostName: '김민지', hostPhone: '010-0000-0000' };

// [이름, 참석, 정산완료여부]
const AUTUMN = [
  ['김민지', 'yes', true], ['이준호', 'maybe'], ['박지연', 'yes', false], ['최지훈', 'yes', true],
  ['정서윤', 'yes', true], ['강도현', 'yes', false], ['윤하은', 'no'], ['임재원', 'yes', true],
  ['한예린', 'yes', true], ['오승민', 'maybe'], ['서지아', 'yes', false], ['신우진', 'yes', true],
  ['배소율', 'yes', true], ['조현우', 'no'], ['홍나연', 'yes', true], ['문태윤', 'maybe'],
  ['장유나', 'yes', false], ['권시우', 'yes', true], ['송다은', 'yes', true],
];
const NAMES = AUTUMN.map((p) => p[0]).concat(['정하람', '유채원', '노은찬', '백서진', '안도윤']);

const people = (yes, maybe = 0, no = 0, unpaid = 0, offset = 0) => {
  const list = [];
  for (let i = 0; i < yes + maybe + no; i++) {
    const rsvp = i < yes ? 'yes' : i < yes + maybe ? 'maybe' : 'no';
    list.push([NAMES[(i + offset) % NAMES.length], rsvp, rsvp === 'yes' ? i >= unpaid : undefined]);
  }
  return list;
};

function samples() {
  const t = todayStr();
  // 오늘 모임은 지금부터 약 1~2시간 뒤 (자정을 넘기면 23:59)
  const now = new Date();
  const h = now.getHours() + 2;
  const soon = h > 23 ? '23:59' : `${String(h).padStart(2, '0')}:00`;
  return [
    {
      data: { title: '스터디 정기모임 4회차', date: t, startTime: soon, endTime: '', placeName: '강남역 스터디카페 2층', address: '서울시 강남구 강남대로 [상세 주소]', expectedCount: 8, fee: '', supplies: '노트북, 4장 과제 출력본', notes: '입장할 때 QR 체크인이 필요해요.\n늦으면 단톡방에 미리 알려주세요.', ...HOST },
      people: people(6, 1, 1, 6, 3),
      late: { 0: 20, 2: 10 },
    },
    {
      data: { title: '신입 환영 저녁', date: addDays(t, 3), startTime: '18:30', endTime: '21:00', placeName: '역삼역 한식당', address: '서울시 강남구 역삼로 [상세 주소]', expectedCount: 15, fee: 25000, supplies: '', notes: '2차는 자율 참석이에요.', ...HOST },
      people: people(11, 2, 2, 11, 5),
      edit: { startTime: '19:00' },
      seen: 13,
    },
    {
      data: { title: '원데이 도자기 클래스', date: addDays(t, 9), startTime: '14:00', endTime: '16:00', placeName: '성수동 흙빛 공방', address: '서울시 성동구 성수이로 [상세 주소]', expectedCount: 6, fee: 45000, supplies: '앞치마 (공방에서도 빌려줘요)', notes: '손톱이 길면 작업이 어려워요.', ...HOST },
      people: people(5, 1, 0, 5, 8),
    },
    {
      data: { title: '가을 동아리 모임', date: addDays(t, 28), startTime: '17:00', endTime: '20:00', placeName: '하이브 라운지 3층', address: '서울시 강남구 테헤란로 123', expectedCount: 20, fee: 16000, supplies: '개인 컵, 간단한 간식, 보드게임, 블루투스 스피커', notes: '주차 2시간 지원돼요.\n늦으면 단톡방에 미리 알려주세요.', ...HOST },
      people: AUTUMN,
      edit: { placeName: '역삼 모임공간 B 4층', address: '서울시 강남구 테헤란로 456' },
      seen: 14,
      each: ['개인 컵'],
      brings: { 박지연: ['간단한 간식'], 최지훈: ['간단한 간식'], 강도현: ['보드게임'] },
      settlement: { total: 224000, count: 14, mode: 'equal', accountNo: '[은행명] 000-0000-0000', accountHolder: '김민지' },
    },
    {
      data: { title: '9월 정기 스터디', date: addDays(t, -6), startTime: '19:00', endTime: '21:00', placeName: '강남역 스터디카페 2층', address: '', expectedCount: 8, fee: 10000, supplies: '', notes: '', ...HOST },
      people: people(8, 0, 1, 0, 2),
      settlement: { total: 80000, count: 8, mode: 'equal', accountNo: '[은행명] 000-0000-0000', accountHolder: '김민지' },
    },
    {
      data: { title: '여름 MT 사진 공유회', date: addDays(t, -20), startTime: '18:30', endTime: '', placeName: '역삼 모임공간 B', address: '', expectedCount: 20, fee: '', supplies: '', notes: '', ...HOST },
      people: people(18, 0, 2, 2, 0),
      settlement: { total: 270000, count: 18, mode: 'equal', accountNo: '[은행명] 000-0000-0000', accountHolder: '김민지' },
    },
  ];
}

async function seedOne(api, s) {
  const { event, editToken } = await api.create(s.data);
  const id = event.id;
  const created = await Promise.all(s.people.map(([name, rsvp]) => api.rsvp(id, { name, rsvp }, { anonymous: true })));
  const ps = created.map((r) => ({ ...r.participant, me: { pid: r.participant.id, token: r.participantToken } }));

  if (s.edit) await api.edit(id, editToken, { ...event, ...s.edit });
  if (s.seen) await Promise.all(ps.slice(0, s.seen).map((p) => api.self(id, p.me, { seen: true })));
  if (s.settlement) await api.settle(id, editToken, s.settlement);
  for (const item of s.each || []) await api.each(id, editToken, { item, on: true });
  await Promise.all(ps.map((p) => (s.brings && s.brings[p.name] ? api.self(id, p.me, { brings: s.brings[p.name] }) : null)));
  await Promise.all(Object.entries(s.late || {}).map(([i, late]) => api.self(id, ps[i].me, { late })));
  await Promise.all(ps.map((p, i) => (s.people[i][2] ? api.host(id, editToken, p.id, { settle: 'done' }) : null)));
  return { id, token: editToken };
}

export async function seedSamples(api) {
  const out = [];
  for (const s of samples()) out.push(await seedOne(api, s));
  return out;
}
