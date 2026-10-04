// 내 알림장 — 이 브라우저에서 만든 안내장 목록 (가까운 모임부터)
import { api } from '../api.js';
import { hostedList, addHosted, removeHosted } from '../store.js';
import { daysUntil, countRsvp, seenCount, settleSummary, formatDate, formatTime, josa, changeSummary, lateList } from '../calc.js';
import { esc, nl2br, icon, toast } from '../ui.js';
import { ddayBadge } from '../card.js';

const changedText = (e) => josa(changeSummary(e), '이', '가');

function changeLine(e, ps) {
  if (!e.changeVersion || !e.changes.length) return '';
  const { seen, total } = seenCount(ps, e.changeVersion);
  return `
    <div class="mini-change">
      <span>${icon('alert')}${esc(changedText(e))} 변경되었어요</span>
      ${total ? `<span class="seen-pill">${icon('check')}확인 ${seen} / ${total}</span>` : ''}
    </div>`;
}

function progress(e, ps) {
  const c = countRsvp(ps);
  const goal = e.expectedCount || c.total || 1;
  return `
    <div class="progress-label"><span>참석 ${c.yes}명${e.expectedCount ? ` · 예상 ${e.expectedCount}명` : ` · 응답 ${c.total}명`}</span><b>${Math.round(Math.min(100, (c.yes / goal) * 100))}%</b></div>
    <div class="bar"><i class="yes" style="width:${Math.min(100, (c.yes / goal) * 100)}%"></i></div>`;
}

const buttons = (e) => `
  <div class="btn-row">
    <a class="btn sm" href="#/e/${e.id}">자세히 보기</a>
    <a class="btn sm primary" href="#/e/${e.id}/edit">수정 · 재공유</a>
  </div>`;

function todayCard({ event: e, participants: ps }) {
  const c = countRsvp(ps);
  return `
    <article class="today-card card">
      <p class="live">오늘의 모임 · 당일 모드</p>
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
      ${changeLine(e, ps)}
      ${buttons(e)}
    </article>`;
}

function upcomingCard({ event: e, participants: ps }, tag) {
  const alert = e.changeVersion > 0 && seenCount(ps, e.changeVersion).seen < ps.length;
  return `
    <article class="ev-card card${alert ? ' has-alert' : ''}">
      ${alert ? '<span class="corner-alert" aria-label="변경 안내 미확인">!</span>' : ''}
      <div class="ev-top">${ddayBadge(e.date)}<span class="hint">${esc(tag)}</span></div>
      ${changeLine(e, ps)}
      <h3>${esc(e.title)}</h3>
      <p class="ev-meta">${icon('calendar')}${esc(formatDate(e.date))} ${esc(formatTime(e.startTime))}</p>
      <p class="ev-meta">${icon('pin')}${esc(e.placeName)}</p>
      ${progress(e, ps)}
      ${buttons(e)}
    </article>`;
}

function pastCard({ event: e, participants: ps }) {
  const c = countRsvp(ps);
  const s = settleSummary(ps, e.settlement);
  const settleText = !e.settlement ? '정산 미등록' : s.unpaid ? `정산 ${s.unpaid}명 남음` : '정산 완료';
  return `
    <article class="ev-card card past">
      <div class="ev-top">${ddayBadge(e.date)}</div>
      <h3>${esc(e.title)}</h3>
      <p class="ev-meta">${icon('calendar')}${esc(formatDate(e.date))} ${esc(formatTime(e.startTime))}</p>
      <p class="ev-meta">${icon('pin')}${esc(e.placeName)}</p>
      <div class="progress-label"><span>최종 참석 ${c.yes}명</span><b><a href="#/e/${e.id}/status">${settleText}</a></b></div>
      <a class="btn sm block ghost" href="#/create?from=${e.id}">복제해서 새로 만들기</a>
    </article>`;
}

export async function render(root, { isStale }) {
  const list = hostedList();
  const loaded = await Promise.all(list.map((h) => api.get(h.id).catch((err) => ({ missing: h.id, err }))));
  if (isStale()) return;
  // 서버에서 지워진 안내장은 목록에서 정리
  loaded.filter((x) => x.missing && /찾을 수 없/.test(x.err.message)).forEach((x) => removeHosted(x.missing));
  const items = loaded.filter((x) => x.event);

  const today = items.filter((x) => daysUntil(x.event.date) === 0);
  const upcoming = items.filter((x) => daysUntil(x.event.date) > 0).sort((a, b) => a.event.date.localeCompare(b.event.date) || a.event.startTime.localeCompare(b.event.startTime));
  const past = items.filter((x) => daysUntil(x.event.date) < 0).sort((a, b) => b.event.date.localeCompare(a.event.date));
  const changeCount = items.filter((x) => x.event.changeVersion > 0 && daysUntil(x.event.date) >= 0).length;
  const tagOf = (x) => (x.event.fee ? `참가비 ${x.event.fee.toLocaleString()}원` : '');

  root.innerHTML = `
    <div class="dash-head">
      <div>
        <h1>내 알림장</h1>
        <p class="sub">가까운 모임부터 보여드려요. 진행 중 ${today.length + upcoming.length}개 · 종료 ${past.length}개${changeCount ? ` · <b>변경 안내 ${changeCount}건</b>` : ''}</p>
      </div>
      <a class="btn primary" href="#/create">${icon('plus')}새 안내장</a>
    </div>
    ${items.length === 0 ? `
      <div class="empty card">
        ${icon('list', 'big')}
        <p>아직 만든 안내장이 없어요.<br><span class="hint">안내장은 만든 브라우저에 저장돼요.</span></p>
        <a class="btn primary" href="#/create">${icon('mail')}첫 안내장 만들기</a>
        <button class="btn ghost" data-act="sample">샘플 모임 불러오기 (시연용)</button>
      </div>` : ''}
    ${today.map(todayCard).join('')}
    ${upcoming.length ? `<h2 class="section-title">다가오는 모임</h2><div class="ev-grid">${upcoming.map((x) => upcomingCard(x, tagOf(x))).join('')}</div>` : ''}
    ${past.length ? `<h2 class="section-title muted">최근 종료된 모임</h2><div class="ev-grid">${past.map(pastCard).join('')}</div>` : ''}
    ${items.length ? '<p class="sample-more"><button class="link-btn" data-act="sample">샘플 모임 불러오기 (시연용)</button></p>' : ''}`;

  const sampleBtn = root.querySelector('[data-act="sample"]');
  if (sampleBtn) {
    sampleBtn.addEventListener('click', async () => {
      sampleBtn.disabled = true;
      sampleBtn.textContent = '불러오는 중…';
      try {
        const { seedSamples } = await import('../sample.js');
        const created = await seedSamples(api);
        created.reverse().forEach((c) => addHosted(c.id, c.token));
        toast('샘플 모임 6개를 불러왔어요');
        if (!isStale()) render(root, { isStale });
      } catch (err) {
        toast(err.message, 'err');
        sampleBtn.disabled = false;
      }
    });
  }
}
