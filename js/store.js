// 이 브라우저에만 남기는 정보: 내가 만든 안내장(수정 권한), 안내장별 "나"
const HOSTED = 'moim.hosted';
const meKey = (id) => `moim.me.${id}`;

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 저장이 막힌 브라우저(시크릿 모드 등)에서는 기억하지 못할 뿐 동작은 계속 */
  }
}

export const hostedList = () => read(HOSTED, []);

export function addHosted(id, token) {
  write(HOSTED, [{ id, token, addedAt: new Date().toISOString() }, ...hostedList().filter((h) => h.id !== id)]);
}

export function removeHosted(id) {
  write(HOSTED, hostedList().filter((h) => h.id !== id));
}

export const hostToken = (id) => (hostedList().find((h) => h.id === id) || {}).token || null;

// 이 안내장에서의 "나": { pid, token } — token은 응답할 때 받은 본인 확인용 비밀값
export function myself(id) {
  const v = read(meKey(id), null);
  if (!v) return null;
  return typeof v === 'string' ? { pid: v, token: null } : v; // 예전 형식(아이디만)
}
export const setMyself = (id, pid, token) => write(meKey(id), { pid, token });

// 응답 전 사람이 변경 배너를 닫은 버전
const seenKey = (id) => `moim.seen.${id}`;
export const localSeen = (id) => read(seenKey(id), 0);
export const setLocalSeen = (id, v) => write(seenKey(id), v);

// 로그인 정보: { token, user: { phone, name } }
const SESSION = 'moim.session';
export const session = () => read(SESSION, null);
export const setSession = (s) => write(SESSION, s);
export function clearSession() {
  try {
    localStorage.removeItem(SESSION);
  } catch { /* 저장소를 못 쓰면 지울 것도 없음 */ }
}

// 이 브라우저에 남은 "나" 기록 전체 (로그인할 때 계정으로 옮김)
export function allMyself() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('moim.me.')) continue;
      const v = read(k, null);
      if (v && v.pid && v.token) out.push({ id: k.slice('moim.me.'.length), pid: v.pid, ptoken: v.token });
    }
  } catch { /* 저장소를 못 쓰면 옮길 기록도 없음 */ }
  return out;
}
