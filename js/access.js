// 주최자 화면 접근: 이 브라우저의 관리 토큰 또는 로그인한 주최자
import { api } from './api.js';
import { hostToken, removeHosted, session } from './store.js';
import { errorView, toast } from './ui.js';

// 안내장 삭제 (내 알림장·초대장·수정 화면 공용). 확인 창에서 취소하거나 실패하면 false
export async function confirmDelete(e, responses = 0) {
  const who = responses ? `\n응답한 ${responses}명도 더 이상 안내장을 볼 수 없어요.` : '';
  if (!window.confirm(`'${e.title}' 안내장을 삭제할까요?${who}\n삭제하면 되돌릴 수 없어요.`)) return false;
  try {
    await api.remove(e.id, hostToken(e.id));
    removeHosted(e.id);
    toast('안내장을 삭제했어요');
    return true;
  } catch (err) {
    toast(err.message, 'err');
    return false;
  }
}

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
