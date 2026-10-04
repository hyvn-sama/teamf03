// 화면 공통 조각: 이스케이프, 아이콘, 토스트, 복사·공유, 링크
import { formatDate, timeRange } from './calc.js';

// 사용자 입력을 화면에 넣을 때는 항상 esc()를 거친다 (공유 링크로 남이 연 화면이므로)
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const nl2br = (v) => esc(v).replace(/\n/g, '<br>');

const PATHS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
  money: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9.5v5M18 9.5v5"/>',
  bag: '<path d="M5 8h14l-1 13H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  alert: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v6M12 16.5v.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9.5"/><path d="M8 12.5l3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>',
  minus: '<circle cx="12" cy="12" r="9.5"/><path d="M8 12h8"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
  list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  message: '<path d="M4 4h16v12H8l-4 4V4z"/>',
  map: '<path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`;
}

let toastTimer;
export function toast(message, kind = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.className = `toast show ${kind}`;
  el.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

export async function copyText(text, done = '복사했어요') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(done);
}

export const inviteUrl = (id) => `${location.origin}${location.pathname}#/e/${id}`;

export function shareMessage(e, prefix = '') {
  return [
    `${prefix}[모임 알림장] ${e.title}`,
    `📅 ${formatDate(e.date)} ${timeRange(e)}`,
    `📍 ${e.placeName}`,
    '',
    '참석 여부와 자세한 안내는 아래 링크에서 확인해주세요.',
  ].join('\n');
}

// 휴대폰에서는 공유 시트(카카오톡 선택), PC에서는 링크+문구 복사
export async function shareInvite(e, prefix = '') {
  const url = inviteUrl(e.id);
  const text = shareMessage(e, prefix);
  if (navigator.share) {
    try {
      await navigator.share({ title: e.title, text, url });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  await copyText(`${text}\n${url}`, '안내 문구와 링크를 복사했어요. 카톡에 붙여넣어 주세요.');
}

export const mapUrl = (e) => `https://map.naver.com/p/search/${encodeURIComponent(e.address || e.placeName)}`;

export const RSVP_LABEL = { yes: '참석', maybe: '미정', no: '불참' };
export const SETTLE_LABEL = { done: '정산 완료', unpaid: '미정산', excluded: '정산 제외' };
export const SETTLE_ICON = { done: 'checkCircle', unpaid: 'clock', excluded: 'minus' };

export function pageHead({ num, iconName, title, sub, back }) {
  const badge = num ? `<span class="step-num">${num}</span>` : `<span class="step-num">${icon(iconName)}</span>`;
  return `
    ${back ? `<a class="back-link" href="${back.href}">${icon('back')}${esc(back.label)}</a>` : ''}
    <div class="page-head">
      ${badge}
      <div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
    </div>`;
}

export function errorView(message, { href = '#/', label = '처음으로' } = {}) {
  return `
    <div class="empty card">
      ${icon('alert', 'big')}
      <p>${esc(message)}</p>
      <a class="btn" href="${href}">${esc(label)}</a>
    </div>`;
}

export function loadingView() {
  return '<div class="loading" aria-label="불러오는 중"><span></span><span></span><span></span></div>';
}
