// 해시 라우터: #/경로?쿼리 → 화면 모듈의 render(root, ctx)
import { init, getMode, api } from './api.js';
import { errorView, loadingView, esc, toast } from './ui.js';
import { session, setSession, clearSession } from './store.js';

const routes = [
  { path: /^\/?$/, view: 'home', nav: 'home' },
  { path: /^\/create$/, view: 'create', nav: 'create' },
  { path: /^\/my$/, view: 'dashboard', nav: 'my' },
  { path: /^\/login$/, view: 'login', nav: '' },
  { path: /^\/e\/([a-z0-9]+)$/, view: 'invite', nav: '' },
  { path: /^\/e\/([a-z0-9]+)\/edit$/, view: 'create', nav: 'my', edit: true },
  { path: /^\/e\/([a-z0-9]+)\/status$/, view: 'status', nav: 'my' },
  { path: /^\/e\/([a-z0-9]+)\/settle$/, view: 'settle', nav: 'my' },
];

const root = document.getElementById('view');
let cleanup = null;
let renderSeq = 0;

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

async function render() {
  const seq = ++renderSeq;
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  const { path, query } = parseHash();
  const route = routes.find((r) => r.path.test(path));
  document.body.dataset.view = route ? route.view : 'none';
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', route && a.dataset.nav === route.nav));

  if (!route) {
    root.innerHTML = errorView('없는 페이지예요.');
    return;
  }
  root.innerHTML = loadingView();
  window.scrollTo(0, 0);
  try {
    const mod = await import(`./views/${route.view}.js`);
    if (seq !== renderSeq) return; // 그 사이 다른 화면으로 이동함
    const id = (path.match(route.path) || [])[1];
    cleanup = await mod.render(root, { id, query, edit: !!route.edit, isStale: () => seq !== renderSeq });
  } catch (err) {
    console.error(err);
    if (seq === renderSeq) root.innerHTML = errorView(err.message || '화면을 불러오지 못했어요.');
  }
}

const isLocalHost = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);

function showModeBanner(mode) {
  const el = document.getElementById('mode-banner');
  if (mode !== 'local') return;
  el.hidden = false;
  if (isLocalHost) {
    el.innerHTML = '<b>체험 모드</b> · 서버 저장소가 연결되지 않아 이 브라우저에만 저장돼요. 다른 기기에서는 안내장이 보이지 않아요.';
  } else {
    // 배포된 사이트인데 저장소가 없으면 심사·실사용에서 바로 문제가 되므로 크게 알린다
    el.classList.add('danger');
    el.innerHTML = '<b>서버 저장소가 연결되지 않았어요</b> · 지금 만든 안내장은 이 브라우저에만 저장돼서, 링크를 받은 다른 사람은 열 수 없어요. (관리자: Vercel Storage에서 Upstash Redis를 연결하세요)';
  }
}

// 상단바 로그인 영역
function renderAuth() {
  const slot = document.getElementById('auth-slot');
  const s = session();
  if (s) {
    slot.innerHTML = `<span class="auth-user">${esc(s.user.name)} 님</span><button type="button" class="nav-logout" data-logout>로그아웃</button>`;
  } else {
    const here = (location.hash.replace(/^#/, '') || '/').split('?')[0];
    const next = here === '/login' ? '/my' : here;
    slot.innerHTML = `<a class="nav-link auth-link" href="#/login?next=${encodeURIComponent(next)}">로그인</a>`;
  }
}

document.getElementById('auth-slot').addEventListener('click', async (ev) => {
  if (!ev.target.closest('[data-logout]')) return;
  await api.logout().catch(() => {});
  clearSession();
  renderAuth();
  toast('로그아웃했어요');
  location.hash = '#/';
});
window.addEventListener('moim:login', renderAuth);
window.addEventListener('moim:logout', () => {
  renderAuth();
  toast('로그인이 만료됐어요. 다시 로그인해주세요.', 'err');
});

window.addEventListener('hashchange', () => {
  renderAuth();
  render();
});

root.innerHTML = loadingView(); // 서버 연결 확인(첫 접속 시 1~2초)하는 동안 빈 화면 대신
init().then(async (mode) => {
  showModeBanner(mode);
  // 저장된 로그인이 아직 유효한지 확인하고 이름을 최신으로 (만료됐으면 api.js가 정리)
  if (session()) {
    try {
      const { user } = await api.whoami();
      setSession({ ...session(), user });
    } catch { /* 401이면 이미 정리됨, 네트워크 오류면 그대로 둠 */ }
  }
  renderAuth();
  render();
});

export { getMode };
