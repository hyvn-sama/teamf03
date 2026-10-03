// Upstash Redis REST 호출 (Vercel Marketplace에서 연결하면 환경변수가 자동으로 들어옴)
const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasStorage = Boolean(URL && TOKEN);

async function cmd(...args) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(args),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

// 안내장은 문서 하나, 참가자는 해시(참가자 1명 = 필드 1개)로 따로 저장 → 동시 응답이 서로 덮어쓰지 않음
const eventKey = (id) => `event:${id}`;
const peopleKey = (id) => `event:${id}:p`;

export async function getEvent(id) {
  const raw = await cmd('GET', eventKey(id));
  return raw ? JSON.parse(raw) : null;
}

export async function putEvent(event) {
  await cmd('SET', eventKey(event.id), JSON.stringify(event));
}

export async function createEventIfAbsent(event) {
  return (await cmd('SET', eventKey(event.id), JSON.stringify(event), 'NX')) === 'OK';
}

export async function getParticipants(id) {
  const flat = (await cmd('HGETALL', peopleKey(id))) || [];
  const list = [];
  for (let i = 1; i < flat.length; i += 2) list.push(JSON.parse(flat[i]));
  return list.sort((a, b) => a.respondedAt.localeCompare(b.respondedAt));
}

export async function getParticipant(id, pid) {
  const raw = await cmd('HGET', peopleKey(id), pid);
  return raw ? JSON.parse(raw) : null;
}

export async function putParticipant(id, p) {
  await cmd('HSET', peopleKey(id), p.id, JSON.stringify(p));
}
