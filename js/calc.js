// 계산 규칙 — 콘텐츠 데이터 구성 '처리 규칙'을 그대로 옮긴 순수 함수 모음.
// 저장하지 않고 화면마다 여기서 계산한다. (브라우저·서버 공용)

export const FIELD_LABELS = {
  title: '모임명',
  date: '날짜',
  startTime: '시작 시간',
  endTime: '종료 시간',
  placeName: '장소명',
  address: '주소',
  expectedCount: '예상 인원',
  fee: '참가비',
  supplies: '준비물',
  notes: '유의사항',
  hostName: '주최자',
  hostPhone: '주최자 연락처',
};
export const EDIT_FIELDS = Object.keys(FIELD_LABELS);

// 받침에 따라 조사 붙이기: josa('모임명', '을', '를') → '모임명을'
export function josa(word, withBatchim, without) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return `${word}${code >= 0 && code <= 11171 && code % 28 ? withBatchim : without}`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayStr(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

// D-Day = 모임 날짜 - 현재 날짜
export function daysUntil(dateStr, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parseDate(dateStr) - today) / 86400000);
}

export function ddayLabel(dateStr, now = new Date()) {
  const n = daysUntil(dateStr, now);
  if (n > 0) return `D-${n}`;
  if (n === 0) return 'D-DAY';
  return `${-n}일 전 종료`;
}

export const isToday = (event, now) => daysUntil(event.date, now) === 0;
export const isPast = (event, now) => daysUntil(event.date, now) < 0;

export function formatDate(dateStr, { year = true } = {}) {
  const d = parseDate(dateStr);
  const md = `${d.getMonth() + 1}. ${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
  return year ? `${d.getFullYear()}. ${md}` : md;
}

export function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h < 12 ? '오전' : '오후'} ${h12}:${String(m).padStart(2, '0')}`;
}

export function timeRange(e) {
  return e.endTime ? `${formatTime(e.startTime)} ~ ${formatTime(e.endTime)}` : formatTime(e.startTime);
}

// 모임 시작까지 남은 시간 (당일 모드) — 지났으면 null
export function timeLeft(e, now = new Date()) {
  const [h, m] = e.startTime.split(':').map(Number);
  const start = parseDate(e.date);
  start.setHours(h, m, 0, 0);
  const mins = Math.floor((start - now) / 60000);
  if (mins <= 0) return null;
  const hh = Math.floor(mins / 60);
  return hh ? `${hh}시간 ${mins % 60}분` : `${mins}분`;
}

export const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;

// 참석 인원·전체 응답 인원 자동 집계
export function countRsvp(ps) {
  const c = { total: ps.length, yes: 0, maybe: 0, no: 0 };
  for (const p of ps) c[p.rsvp]++;
  return c;
}

// 참석 → 미정산, 미정·불참 → 정산 제외
export const defaultSettle = (rsvp) => (rsvp === 'yes' ? 'unpaid' : 'excluded');

// 1인당 금액 = 총 비용 ÷ 정산 인원 (1원 단위 올림)
export const perPerson = (total, count) => (count > 0 ? Math.ceil(total / count) : 0);

export function amountFor(settlement, pid) {
  const base = perPerson(settlement.total, settlement.count);
  if (settlement.mode === 'custom' && settlement.custom && settlement.custom[pid] != null) {
    return settlement.custom[pid];
  }
  return base;
}

export function settleSummary(ps, settlement) {
  const targets = ps.filter((p) => p.settle !== 'excluded');
  const unpaidList = targets.filter((p) => p.settle === 'unpaid');
  const remaining = settlement ? unpaidList.reduce((sum, p) => sum + amountFor(settlement, p.id), 0) : 0;
  return {
    targets: targets.length,
    done: targets.length - unpaidList.length,
    unpaid: unpaidList.length,
    remaining,
  };
}

const norm = (v) => (v == null ? '' : String(v));

// 바뀐 항목만 {field, label, before, after}
export function diffEvent(before, after) {
  return EDIT_FIELDS.filter((f) => norm(before[f]) !== norm(after[f])).map((f) => ({
    field: f,
    label: FIELD_LABELS[f],
    before: before[f] ?? '',
    after: after[f] ?? '',
  }));
}

// 변경 항목을 사람이 읽는 값으로
export function displayValue(field, v) {
  if (v === '' || v == null) return '(없음)';
  if (field === 'date') return formatDate(v);
  if (field === 'startTime' || field === 'endTime') return formatTime(v);
  if (field === 'fee') return won(v);
  if (field === 'expectedCount') return `${v}명`;
  return String(v);
}

export function seenCount(ps, version) {
  return { seen: ps.filter((p) => (p.seenVersion || 0) >= version).length, total: ps.length };
}

// 종료 시각: 없으면 시작 + 2시간, 시작보다 이르면 자정을 넘긴 다음 날
function eventEnd(e) {
  if (e.endTime) return { date: e.endTime <= e.startTime ? addDays(e.date, 1) : e.date, time: e.endTime };
  const [h, m] = e.startTime.split(':').map(Number);
  const total = h * 60 + m + 120;
  const time = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return { date: total >= 1440 ? addDays(e.date, 1) : e.date, time };
}

// 구글 캘린더 "일정 추가" 화면으로 바로 연결 (카톡 안 브라우저에서도 파일 다운로드 없이 동작)
export function googleCalendarUrl(e, link = '') {
  const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
  const end = eventEnd(e);
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${stamp(e.date, e.startTime)}/${stamp(end.date, end.time)}`,
    ctz: 'Asia/Seoul',
    location: [e.placeName, e.address].filter(Boolean).join(' '),
    details: [e.supplies && `준비물: ${e.supplies}`, e.notes, link && `모임 알림장: ${link}`].filter(Boolean).join('\n\n'),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// 준비물: 쉼표·줄바꿈으로 나눈 항목
export function supplyItems(e) {
  return [...new Set(String(e.supplies || '').split(/[,，\n]/).map((s) => s.trim()).filter(Boolean))];
}

// 준비물별 상태 — each: 모두 각자 챙김, bringers: 가져오겠다고 한 참석자, needed: 담당자가 필요한데 아무도 없음
export function supplyStatus(e, ps) {
  const each = new Set(e.supplyEach || []);
  return supplyItems(e).map((name) => {
    const bringers = ps.filter((p) => p.rsvp === 'yes' && (p.brings || []).includes(name));
    return { name, each: each.has(name), bringers, needed: !each.has(name) && bringers.length === 0 };
  });
}

// 늦는다고 알린 참석자 (많이 늦는 순)
export function lateList(ps) {
  return ps.filter((p) => p.rsvp === 'yes' && p.late && p.late.minutes > 0).sort((a, b) => b.late.minutes - a.late.minutes);
}

const CHANGE_GROUP = {
  date: '일정', startTime: '시간', endTime: '시간', placeName: '장소', address: '장소',
  title: '모임명', expectedCount: '인원', fee: '참가비', supplies: '준비물', notes: '유의사항',
  hostName: '연락처', hostPhone: '연락처',
};

// sinceVersion 이후의 변경을 항목별로 합침: 처음 before, 마지막 after (되돌려서 같아지면 제외)
export function pendingChanges(e, sinceVersion = 0) {
  const byField = new Map();
  for (const c of e.changes || []) {
    if ((c.version ?? e.changeVersion) <= sinceVersion) continue;
    const prev = byField.get(c.field);
    byField.set(c.field, prev ? { ...prev, after: c.after, at: c.at } : { ...c });
  }
  return [...byField.values()].filter((c) => norm(c.before) !== norm(c.after));
}

// 가장 최근 수정에서 바뀐 항목
export const latestChanges = (e) => pendingChanges(e, (e.changeVersion || 0) - 1);

// 최근 변경 요약: "장소" / "시간·장소"
export function changeSummary(e) {
  return [...new Set(latestChanges(e).map((c) => CHANGE_GROUP[c.field] || c.label))].join('·');
}

// 데이터의 마지막 변경 시각 — CDN 캐시로 받은 옛 데이터인지 구분할 때 씀
export function dataStamp(event, ps) {
  let stamp = event.updatedAt || '';
  for (const p of ps) {
    const t = p.updatedAt || p.respondedAt || '';
    if (t > stamp) stamp = t;
  }
  return stamp;
}

// 정산 대상 = 참석자 중 '정산 제외'가 아닌 사람
export const settleTargets = (ps) => ps.filter((p) => p.rsvp === 'yes' && p.settle !== 'excluded');

// 정산 등록 때 인원과 지금 정산 대상 수가 다르면 알려줌
export function settleCountMismatch(ps, settlement) {
  if (!settlement) return null;
  const current = settleTargets(ps).length;
  return current === settlement.count ? null : { registered: settlement.count, current };
}
