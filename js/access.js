// 주최자 화면 접근: 이 브라우저의 관리 토큰 또는 로그인한 주최자
import { api } from './api.js';
import { hostToken, session } from './store.js';
import { errorView } from './ui.js';

export const loginHref = (next) => `#/login?next=${encodeURIComponent(next)}`;

export async function hostAccess(id) {
  const token = hostToken(id);
  if (token) return { ok: true, token };
  if (!session()) return { ok: false, token: null };
  const me = await api.me(id);
  return { ok: me.isHost, token: null };
}

// 주최자가 아닐 때 보여줄 안내 (로그인 안 했으면 로그인 버튼)
export function noHostView(id, message, next) {
  return session()
    ? errorView(message, { href: `#/e/${id}`, label: '안내장 보기' })
    : errorView(`${message} 주최자라면 로그인해주세요.`, { href: loginHref(next), label: '로그인하기' });
}
