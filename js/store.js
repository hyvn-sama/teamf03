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

export const myParticipantId = (id) => read(meKey(id), null);
export const setMyParticipantId = (id, pid) => write(meKey(id), pid);

// 응답 전 사람이 변경 배너를 닫은 버전
const seenKey = (id) => `moim.seen.${id}`;
export const localSeen = (id) => read(seenKey(id), 0);
export const setLocalSeen = (id, v) => write(seenKey(id), v);
