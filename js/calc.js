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

const icsText = (s) => String(s).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');

export function toICS(e) {
  const stamp = (date, time) => `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
  let endDate = e.date;
  let endTime = e.endTime;
  if (!endTime) {
    const [h, m] = e.startTime.split(':').map(Number);
    const total = h * 60 + m + 120;
    if (total >= 1440) endDate = addDays(e.date, 1);
    endTime = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }
  const location = [e.placeName, e.address].filter(Boolean).join(' ');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//moim-allimjang//KO',
    'BEGIN:VEVENT',
    `UID:${e.id}@moim-allimjang`,
    `DTSTAMP:${stamp(todayStr(), '00:00')}`,
    `DTSTART:${stamp(e.date, e.startTime)}`,
    `DTEND:${stamp(endDate, endTime)}`,
    `SUMMARY:${icsText(e.title)}`,
    `LOCATION:${icsText(location)}`,
    `DESCRIPTION:${icsText([e.supplies && `준비물: ${e.supplies}`, e.notes].filter(Boolean).join('\n'))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
