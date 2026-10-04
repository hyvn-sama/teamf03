// 로그인 · 회원가입 (전화번호 + 비밀번호)
import { api } from '../api.js';
import { session, setSession } from '../store.js';
import { icon, toast } from '../ui.js';

// next는 "#" 뒤 경로만 허용 (다른 사이트로 보내지 않게)
const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/my');

export function render(root, { query }) {
  const next = safeNext(query.next);
  if (session()) {
    location.hash = `#${next}`;
    return;
  }
  let tab = query.tab === 'signup' ? 'signup' : 'login';

  const draw = () => {
    const signup = tab === 'signup';
    root.innerHTML = `
      <section class="login-wrap">
        <div class="card card-pad login-card">
          <h1>${signup ? '회원가입' : '로그인'}</h1>
          <p class="hint">${signup ? '전화번호로 가입하면 어느 기기에서든 내 알림장을 볼 수 있어요.' : '안내장을 만들고 내 알림장을 보려면 로그인해주세요.'}</p>
          <div class="seg login-tabs" role="tablist">
            <button type="button" role="tab" data-tab="login" class="${signup ? '' : 'on'}" aria-selected="${!signup}">로그인</button>
            <button type="button" role="tab" data-tab="signup" class="${signup ? 'on' : ''}" aria-selected="${signup}">회원가입</button>
          </div>
          <form novalidate>
            <label class="login-field">휴대폰 번호
              <input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="010-1234-5678" required>
            </label>
            ${signup ? `
              <label class="login-field">이름
                <input class="input" name="name" maxlength="20" autocomplete="name" placeholder="김민지" required>
              </label>` : ''}
            <label class="login-field">비밀번호 <span class="hint">4자 이상</span>
              <input class="input" name="password" type="password" minlength="4" maxlength="30" autocomplete="${signup ? 'new-password' : 'current-password'}" required>
            </label>
            <p class="form-error" role="alert"></p>
            <button class="btn primary block" type="submit">${signup ? '가입하고 시작하기' : '로그인'}</button>
          </form>
          <p class="hint login-note">${icon('alert')}문자 인증은 하지 않아요. 비밀번호를 잊으면 다시 찾을 수 없으니 기억해 두세요.</p>
        </div>
      </section>`;
    root.querySelector('[name="phone"]').focus();
  };

  const onClick = (ev) => {
    const t = ev.target.closest('[data-tab]');
    if (!t || t.dataset.tab === tab) return;
    tab = t.dataset.tab;
    draw();
  };

  let busy = false;
  const onSubmit = async (ev) => {
    ev.preventDefault();
    if (busy) return;
    const form = ev.target;
    const errorEl = form.querySelector('.form-error');
    const data = Object.fromEntries(new FormData(form));
    busy = true;
    form.querySelector('[type="submit"]').disabled = true;
    try {
      const res = tab === 'signup' ? await api.signup(data) : await api.login(data);
      setSession({ token: res.session, user: res.user });
      window.dispatchEvent(new Event('moim:login'));
      // 로그인 전에 이 브라우저에서 만들거나 응답한 모임을 계정으로 옮김
      const moved = await api.claim().catch(() => null);
      const count = moved ? moved.hosted + moved.joined : 0;
      toast(count ? `${res.user.name} 님, 이 기기의 모임 ${count}개를 내 알림장에 옮겼어요` : `${res.user.name} 님, 반가워요`);
      location.hash = `#${next}`;
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      busy = false;
      const btn = form.querySelector('[type="submit"]');
      if (btn) btn.disabled = false;
    }
  };

  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  draw();
  return () => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('submit', onSubmit);
  };
}
