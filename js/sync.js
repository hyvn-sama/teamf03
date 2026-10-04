// 다른 기기로 옮기기: 내가 만든 모임(관리 토큰)과 응답 기록을 링크 하나(#/sync?d=...)로 묶고 푼다
// 화면·브라우저 저장소와 무관한 순수 함수만 둔다 (테스트에서 그대로 쓴다)

const EVENT_ID = /^[a-z0-9]{8}$/;
const PERSON_ID = /^p_[a-z0-9]{8}$/;
const TOKEN = /^[a-z0-9]{8,64}$/;

const toBase64Url = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

// hosted: [{ id, token }], joined: [{ id, pid, token }] → 링크에 넣을 문자열
export function packSync({ hosted = [], joined = [] }) {
  return toBase64Url(JSON.stringify({
    v: 1,
    h: hosted.map((h) => [h.id, h.token]),
    j: joined.map((j) => [j.id, j.pid, j.token]),
  }));
}

// 잘못되거나 잘린 링크면 Error. 형식이 틀린 항목은 조용히 버린다
export function unpackSync(d) {
  let raw;
  try {
    raw = JSON.parse(fromBase64Url(String(d || '')));
  } catch {
    throw new Error('옮기기 링크가 올바르지 않아요. 링크 전체를 다시 복사해주세요.');
  }
  if (!raw || raw.v !== 1 || !Array.isArray(raw.h) || !Array.isArray(raw.j)) {
    throw new Error('옮기기 링크가 올바르지 않아요. 링크 전체를 다시 복사해주세요.');
  }
  const hosted = raw.h
    .filter((x) => Array.isArray(x) && EVENT_ID.test(x[0]) && TOKEN.test(x[1]))
    .map(([id, token]) => ({ id, token }));
  const joined = raw.j
    .filter((x) => Array.isArray(x) && EVENT_ID.test(x[0]) && PERSON_ID.test(x[1]) && TOKEN.test(x[2]))
    .map(([id, pid, token]) => ({ id, pid, token }));
  return { hosted, joined };
}

export const syncUrl = (base, data) => `${base}#/sync?d=${packSync(data)}`;
