// 해시 라우터: #/경로?쿼리 → 화면 모듈의 render(root, ctx)
import { init, getMode } from './api.js';
import { errorView, loadingView } from './ui.js';

const routes = [
  { path: /^\/?$/, view: 'home', nav: 'home' },
  { path: /^\/create$/, view: 'create', nav: 'create' },
  { path: /^\/my$/, view: 'dashboard', nav: 'my' },
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

function showModeBanner(mode) {
  const el = document.getElementById('mode-banner');
  if (mode === 'local') {
    el.hidden = false;
    el.innerHTML = '<b>체험 모드</b> · 서버 저장소가 연결되지 않아 이 브라우저에만 저장돼요. 다른 기기에서는 안내장이 보이지 않아요.';
  }
}

window.addEventListener('hashchange', render);

init().then((mode) => {
  showModeBanner(mode);
  render();
});

export { getMode };
