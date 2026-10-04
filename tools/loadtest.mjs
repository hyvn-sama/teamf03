// 부하 테스트: 시연처럼 N명이 같은 안내장을 열고, 응답하고, 화면을 켜 둔 상황을 흉내 낸다.
// 실행: node tools/loadtest.mjs https://teamf03.vercel.app 400 60
//        (주소, 인원, 지속 초) — 테스트 안내장 1개와 참가자 N명이 실제 저장소에 생긴다 (120일 뒤 자동 삭제)
const [base = 'https://teamf03.vercel.app', people = '400', seconds = '60'] = process.argv.slice(2);
const N = Number(people);
const DURATION = Number(seconds) * 1000;
const POLL_MS = 60000 / 4; // 실제 참석자는 60초, 여기서는 더 가혹하게 15초

const stats = { ok: 0, fail: 0, status: {}, cache: {}, ms: [] };

async function req(method, path, body) {
  const t = performance.now();
  try {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    stats.ms.push(performance.now() - t);
    stats.status[res.status] = (stats.status[res.status] || 0) + 1;
    const cache = res.headers.get('x-vercel-cache');
    if (cache) stats.cache[cache] = (stats.cache[cache] || 0) + 1;
    res.ok ? stats.ok++ : stats.fail++;
    return json;
  } catch (err) {
    stats.fail++;
    stats.status.network = (stats.status.network || 0) + 1;
    return {};
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => arr.sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))] || 0;

const ping = await req('GET', '/api/events?ping=1');
if (!ping.storage) {
  console.error('서버 저장소가 연결되지 않았어요 (storage:false). Upstash 연결 후 다시 실행하세요.');
  process.exit(1);
}

const created = await req('POST', '/api/events', {
  action: 'create',
  data: { title: '[부하 테스트] 삭제 예정', date: '2026-12-31', startTime: '19:00', placeName: '테스트 장소', supplies: '간식, 음료' },
});
const id = created.event && created.event.id;
if (!id) {
  console.error('테스트 안내장을 만들지 못했어요.', created);
  process.exit(1);
}
console.log(`테스트 안내장 ${id} — ${N}명, ${seconds}초`);

const end = Date.now() + DURATION;
async function guest(i) {
  await sleep(Math.random() * 10000); // 10초에 걸쳐 링크를 엶
  await req('GET', `/api/events?id=${id}`);
  const r = await req('POST', '/api/events', { action: 'rsvp', id, data: { name: `손님${i}`, rsvp: i % 5 ? 'yes' : 'maybe' } });
  if (r.participantToken && i % 3 === 0 && i % 5) { // 준비물 담당은 참석자만 (미정은 거절됨)
    await req('POST', '/api/events', { action: 'self', id, pid: r.participant.id, ptoken: r.participantToken, data: { brings: ['간식'] } });
  }
  while (Date.now() < end) {
    await sleep(POLL_MS * (0.8 + Math.random() * 0.4));
    await req('GET', `/api/events?id=${id}`);
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: N }, (_, i) => guest(i)));
const final = await req('GET', `/api/events?id=${id}&_=${Date.now()}`);

console.log({
  요청: stats.ok + stats.fail,
  성공: stats.ok,
  실패: stats.fail,
  상태코드: stats.status,
  CDN캐시: stats.cache,
  응답시간ms: { p50: Math.round(pct(stats.ms, 0.5)), p95: Math.round(pct(stats.ms, 0.95)), max: Math.round(pct(stats.ms, 1)) },
  저장된참가자: (final.participants || []).length,
  걸린초: Math.round((Date.now() - started) / 1000),
});
