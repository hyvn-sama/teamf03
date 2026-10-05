// 내 모임장 — 이 브라우저에서 만든 모임장 목록 (가까운 모임부터)
import { api } from '../api.js';
import { session } from '../store.js';
import { loginHref, confirmDelete } from '../access.js';
import {
  daysUntil, countRsvp, seenCount, settleSummary, formatDate, formatTime, josa, changeSummary, lateList, amountFor, won,
} from '../calc.js';
import { esc, nl2br, icon } from '../ui.js';
import { ddayBadge } from '../card.js';

const changedText = (e) => josa(changeSummary(e), '이', '가');

// 카드에 띄울 알림 — 참여한 모임은 "나" 기준(내가 아직 안 본 변경, 내가 낼 정산), 주최한 모임은 전체 기준
function alertsOf({ event: e, participants: ps, role, pid }) {
  const me = pid ? ps.find((p) => p.id === pid) : null;
  if (role === 'host') {
    const { seen, total } = seenCount(ps, e.changeVersion || 0);
    const s = settleSummary(ps, e.settlement);
    return {
      changed: e.changeVersion > 0 && seen < total,
      settle: e.settlement && s.unpaid ? `정산 등록됨 · 미입금 ${s.unpaid}명` : '',
    };
  }
  return {
    changed: Boolean(me && e.changeVersion > 0 && (me.seenVersion || 0) < e.changeVersion),
    settle: e.settlement && me && me.rsvp === 'yes' && me.settle === 'unpaid'
      ? `정산 금액이 등록되었어요 · 내 금액 ${won(amountFor(e.settlement, me.id))}` : '',
  };
}

const cornerAlert = (a) => (a.changed || a.settle
  ? `<span class="corner-alert" aria-label="${a.settle ? '정산 알림' : '변경 안내 미확인'}">!</span>` : '');

// 주최자는 확인 현황까지, 참여자는 아직 확인하지 않았을 때만
function changeLine(e, ps, role, a) {
  if (!e.changeVersion || !e.changes.length || (role !== 'host' && !a.changed)) return '';
  const { seen, total } = seenCount(ps, e.changeVersion);
  return `
    <a class="mini-change" href="#/e/${e.id}">
      <span>${icon('alert')}${esc(changedText(e))} 변경되었어요</span>
      ${role === 'host' ? (total ? `<span class="seen-pill">${icon('check')}확인 ${seen} / ${total}</span>` : '') : `<span class="seen-pill">확인하기 ${icon('next')}</span>`}
    </a>`;
}

const settleLine = (e, a, role) => (a.settle ? `
  <a class="mini-settle" href="${role === 'host' ? `#/e/${e.id}/status` : `#/e/${e.id}`}">${icon('money')}<span>${esc(a.settle)}</span>${icon('next')}</a>` : '');

function progress(e, ps) {
  const c = countRsvp(ps);
  const goal = e.expectedCount || c.total || 1;
  return `
    <div class="progress-label"><span>참석 ${c.yes}명${e.expectedCount ? ` · 예상 ${e.expectedCount}명` : ` · 응답 ${c.total}명`}</span><b>${Math.round(Math.min(100, (c.yes / goal) * 100))}%</b></div>
    <div class="bar"><i class="yes" style="width:${Math.min(100, (c.yes / goal) * 100)}%"></i></div>`;
}

const deleteBtn = (e) => `<button type="button" class="btn sm del-btn" data-del="${e.id}" aria-label="${esc(e.title)} 삭제">삭제</button>`;

// 주최한 모임만 수정·재공유·삭제, 참여한 모임은 자세히 보기만
const buttons = (e, role) => (role === 'host' ? `
  <div class="btn-row">
    <a class="btn sm" href="#/e/${e.id}">자세히 보기</a>
    <a class="btn sm primary" href="#/e/${e.id}/edit">수정 · 재공유</a>
    ${deleteBtn(e)}
  </div>` : `<a class="btn sm block" href="#/e/${e.id}">자세히 보기</a>`);

const roleTag = (role) => `<span class="role-tag ${role}">${role === 'host' ? '주최' : '참여'}</span>`;

function todayCard(item) {
  const { event: e, participants: ps, role } = item;
  const c = countRsvp(ps);
  const a = alertsOf(item);
  return `
    <article class="today-card card${a.changed || a.settle ? ' has-alert' : ''}">
      ${cornerAlert(a)}
      <p class="live">오늘의 모임 · 당일 모드 ${roleTag(role)}</p>
      <span class="dday-dark serif">D-<em>DAY</em></span>
      <h2>${esc(e.title)}</h2>
      <p class="today-card-time">${esc(formatDate(e.date))} ${esc(formatTime(e.startTime))}</p>
      <ul class="today-card-info">
        <li>${icon('pin')}<b>${esc(e.placeName)}</b></li>
        ${e.supplies ? `<li>${icon('bag')}${esc(e.supplies)}</li>` : ''}
        <li>${icon('users')}참석 예정 ${c.yes}${e.expectedCount ? ` / ${e.expectedCount}` : ''} 명</li>
        ${lateList(ps).length ? `<li class="late-li">${icon('clock')}늦는다고 알린 사람 ${lateList(ps).length}명 · ${esc(lateList(ps).map((p) => `${p.name} ${p.late.minutes}분`).join(', '))}</li>` : ''}
      </ul>
      ${e.notes ? `<div class="notice"><p class="notice-title">${icon('alert')}유의사항</p><p>${nl2br(e.notes)}</p></div>` : ''}
      ${changeLine(e, ps, role, a)}
      ${settleLine(e, a, role)}
      ${buttons(e, role)}
    </article>`;
}

function upcomingCard(item, tag) {
  const { event: e, participants: ps, role } = item;
  const a = alertsOf(item);
  return `
    <article class="ev-card card${a.changed || a.settle ? ' has-alert' : ''}">
      ${cornerAlert(a)}
      <div class="ev-top">${ddayBadge(e.date)}<span class="hint">${esc(tag)} ${roleTag(role)}</span></div>
      ${changeLine(e, ps, role, a)}
      ${settleLine(e, a, role)}
      <h3>${esc(e.title)}</h3>
      <p class="ev-meta">${icon('calendar')}${esc(formatDate(e.date))} ${esc(formatTime(e.startTime))}</p>
      <p class="ev-meta">${icon('pin')}${esc(e.placeName)}</p>
      ${progress(e, ps)}
      ${buttons(e, role)}
    </article>`;
}

// 지난 모임은 변경 안내 대신 정산 알림만
function pastCard(item) {
  const { event: e, participants: ps, role } = item;
  const c = countRsvp(ps);
  const s = settleSummary(ps, e.settlement);
  const settleText = !e.settlement ? '정산 미등록' : s.unpaid ? `정산 ${s.unpaid}명 남음` : '정산 완료';
  const a = { changed: false, settle: alertsOf(item).settle };
  return `
    <article class="ev-card card past${a.settle ? ' has-alert' : ''}">
      ${cornerAlert(a)}
      <div class="ev-top">${ddayBadge(e.date)}${roleTag(role)}</div>
      ${settleLine(e, a, role)}
      <h3>${esc(e.title)}</h3>
      <p class="ev-meta">${icon('calendar')}${esc(formatDate(e.date))} ${esc(formatTime(e.startTime))}</p>
      <p class="ev-meta">${icon('pin')}${esc(e.placeName)}</p>
      <div class="progress-label"><span>최종 참석 ${c.yes}명</span><b><a href="#/e/${e.id}/status">${settleText}</a></b></div>
      ${role === 'host' ? `<div class="btn-row"><a class="btn sm ghost" href="#/create?from=${e.id}">복제해서 새로 만들기</a>${deleteBtn(e)}</div>` : `<a class="btn sm block ghost" href="#/e/${e.id}">자세히 보기</a>`}
    </article>`;
}

export async function render(root, { isStale }) {
  if (!session()) {
    root.innerHTML = `
      <div class="dash-head"><div><h1>내 모임장</h1></div></div>
      <div class="empty card">
        ${icon('list', 'big')}
        <p>로그인하면 어느 기기에서든<br>내가 만든 모임과 응답한 모임을 볼 수 있어요.</p>
        <a class="btn primary" href="${loginHref('/my')}">로그인하기</a>
        <a class="link-btn" href="#/login?tab=signup&next=%2Fmy">처음이라면 회원가입</a>
      </div>`;
    return;
  }
  // 내가 만든 모임(주최)과 응답한 모임(참여) — 서버가 계정 기준으로 모아 줌
  const { items } = await api.mine();
  if (isStale()) return;

  const today = items.filter((x) => daysUntil(x.event.date) === 0);
  const upcoming = items.filter((x) => daysUntil(x.event.date) > 0).sort((a, b) => a.event.date.localeCompare(b.event.date) || a.event.startTime.localeCompare(b.event.startTime));
  const past = items.filter((x) => daysUntil(x.event.date) < 0).sort((a, b) => b.event.date.localeCompare(a.event.date));
  const alertCount = items.filter((x) => {
    const a = alertsOf(x);
    return a.settle || (a.changed && daysUntil(x.event.date) >= 0);
  }).length;
  const tagOf = (x) => (x.event.fee ? `참가비 ${x.event.fee.toLocaleString()}원` : '');

  root.innerHTML = `
    <div class="dash-head">
      <div>
        <h1>내 모임장</h1>
        <p class="sub">가까운 모임부터 보여드려요. 진행 중 ${today.length + upcoming.length}개 · 종료 ${past.length}개${alertCount ? ` · <b>새 알림 ${alertCount}건</b>` : ''}</p>
      </div>
      <a class="btn primary" href="#/create">${icon('plus')}새 모임장</a>
    </div>
    ${items.length === 0 ? `
      <div class="empty card">
        ${icon('list', 'big')}
        <p>아직 만들거나 응답한 모임이 없어요.<br><span class="hint">모임장을 만들거나 받은 링크에서 응답하면 여기에 모여요.</span></p>
        <a class="btn primary" href="#/create">${icon('mail')}첫 모임장 만들기</a>
      </div>` : ''}
    ${today.map(todayCard).join('')}
    ${upcoming.length ? `<h2 class="section-title">다가오는 모임</h2><div class="ev-grid">${upcoming.map((x) => upcomingCard(x, tagOf(x))).join('')}</div>` : ''}
    ${past.length ? `<h2 class="section-title muted">최근 종료된 모임</h2><div class="ev-grid">${past.map(pastCard).join('')}</div>` : ''}`;

  const onClick = async (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    const item = items.find((x) => x.event.id === btn.dataset.del);
    if (!item) return;
    btn.disabled = true;
    if (await confirmDelete(item.event, item.participants.length)) redraw();
    else btn.disabled = false;
  };
  root.addEventListener('click', onClick);
  return () => root.removeEventListener('click', onClick);
}

// 라우터를 통해 다시 그려야 이 화면의 클릭 처리기가 정리된다
const redraw = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
