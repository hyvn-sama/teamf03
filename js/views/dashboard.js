// 내 알림장 — 이 브라우저에서 만든 안내장(주최) + 응답한 안내장(참여) 목록 (가까운 모임부터)
import { api, getMode } from '../api.js';
import { hostedList, addHosted, removeHosted, joinedList, myself } from '../store.js';
import { daysUntil, countRsvp, seenCount, settleSummary, formatDate, formatTime, josa, changeSummary, lateList } from '../calc.js';
import { esc, nl2br, icon, toast, copyText, RSVP_LABEL } from '../ui.js';
import { ddayBadge } from '../card.js';
import { syncUrl } from '../sync.js';

const changedText = (e) => josa(changeSummary(e), '이', '가');

// 참여한 모임에서의 "나" (응답 기록이 서버에서 지워졌으면 null)
const meIn = ({ event: e, participants: ps }) => {
  const auth = myself(e.id);
  return (auth && ps.find((p) => p.id === auth.pid)) || null;
};

const joinTag = (x) => {
  const me = meIn(x);
  return `<span class="join-tag">참여${me ? ` · ${RSVP_LABEL[me.rsvp]}` : ''}</span>`;
};

function changeLine(e, ps, host = true) {
  if (!e.changeVersion || !e.changes.length) return '';
  const { seen, total } = seenCount(ps, e.changeVersion);
  return `
    <div class="mini-change">
      <span>${icon('alert')}${esc(changedText(e))} 변경되었어요</span>
      ${host && total ? `<span class="seen-pill">${icon('check')}확인 ${seen} / ${total}</span>` : ''}
    </div>`;
}

function progress(e, ps) {
  const c = countRsvp(ps);
  const goal = e.expectedCount || c.total || 1;
  return `
    <div class="progress-label"><span>참석 ${c.yes}명${e.expectedCount ? ` · 예상 ${e.expectedCount}명` : ` · 응답 ${c.total}명`}</span><b>${Math.round(Math.min(100, (c.yes / goal) * 100))}%</b></div>
    <div class="bar"><i class="yes" style="width:${Math.min(100, (c.yes / goal) * 100)}%"></i></div>`;
}

const buttons = (e, host = true) => (host ? `
  <div class="btn-row">
    <a class="btn sm" href="#/e/${e.id}">자세히 보기</a>
    <a class="btn sm primary" href="#/e/${e.id}/edit">수정 · 재공유</a>
  </div>` : `
  <div class="btn-row">
    <a class="btn sm primary" href="#/e/${e.id}">초대장 보기</a>
  </div>`);

function todayCard(x) {
  const { event: e, participants: ps, host } = x;
  const c = countRsvp(ps);
  return `
    <article class="today-card card">
      <p class="live">오늘의 모임 · 당일 모드</p>
      ${host ? '' : joinTag(x)}
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
      ${changeLine(e, ps, host)}
      ${buttons(e, host)}
    </article>`;
}

function upcomingCard(x, tag) {
  const { event: e, participants: ps, host } = x;
  const me = host ? null : meIn(x);
  // 주최: 아직 확인 안 한 참석자가 있음 / 참여: 내가 아직 확인 안 함
  const alert = e.changeVersion > 0 && (host ? seenCount(ps, e.changeVersion).seen < ps.length : !me || (me.seenVersion || 0) < e.changeVersion);
  return `
    <article class="ev-card card${alert ? ' has-alert' : ''}${host ? '' : ' joined'}">
      ${alert ? '<span class="corner-alert" aria-label="변경 안내 미확인">!</span>' : ''}
      <div class="ev-top">${ddayBadge(e.date)}${host ? `<span class="hint">${esc(tag)}</span>` : joinTag(x)}</div>
      ${changeLine(e, ps, host)}
      <h3>${esc(e.title)}</h3>
      <p class="ev-meta">${icon('calendar')}${esc(formatDate(e.date))} ${esc(formatTime(e.startTime))}</p>
      <p class="ev-meta">${icon('pin')}${esc(e.placeName)}</p>
      ${progress(e, ps)}
      ${buttons(e, host)}
    </article>`;
}

function pastCard(x) {
  const { event: e, participants: ps, host } = x;
  const c = countRsvp(ps);
  if (!host) {
    return `
    <article class="ev-card card past joined">
      <div class="ev-top">${ddayBadge(e.date)}${joinTag(x)}</div>
      <h3>${esc(e.title)}</h3>
      <p class="ev-meta">${icon('calendar')}${esc(formatDate(e.date))} ${esc(formatTime(e.startTime))}</p>
      <p class="ev-meta">${icon('pin')}${esc(e.placeName)}</p>
      <div class="progress-label"><span>최종 참석 ${c.yes}명</span></div>
      <a class="btn sm block ghost" href="#/e/${e.id}">초대장 보기</a>
    </article>`;
  }
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

// 다른 기기로 옮기기 — 링크에 관리 토큰·응답 토큰이 담기므로 본인만 쓰도록 경고
function syncModal(url) {
  return `
    <div class="modal-backdrop" data-act="close-sync">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="sync-title">
        <div class="modal-head"><h2 id="sync-title">다른 기기로 옮기기</h2><button class="modal-x" data-act="close-sync" aria-label="닫기">✕</button></div>
        <div class="modal-body">
          <p class="hint">휴대폰·PC 등 내 다른 기기에서 이 링크를 열면, 내가 만든 모임과 응답한 모임이 그 기기의 내 알림장으로 옮겨져요.</p>
          <p class="sync-warn">${icon('alert')}<span><b>다른 사람에게 보내지 마세요.</b> 이 링크를 가진 사람은 내 안내장을 수정·정산하고 내 응답을 바꿀 수 있어요. 카톡 '나와의 채팅'처럼 나만 보는 곳에 보내세요.</span></p>
          ${getMode() === 'local' ? `<p class="local-warn">${icon('alert')}지금은 체험 모드라 안내장이 이 브라우저에만 있어요. 다른 기기에서는 모임 내용을 불러올 수 없어요.</p>` : ''}
          <div class="link-box sync-link"><span>${esc(url)}</span></div>
        </div>
        <div class="modal-foot sync-foot">
          <button class="btn" data-act="copy-sync">${icon('copy')}링크 복사</button>
          ${navigator.share ? `<button class="btn primary" data-act="share-sync">${icon('share')}나에게 보내기</button>` : ''}
        </div>
      </div>
    </div>`;
}

export async function render(root, { isStale }) {
  const list = hostedList();
  const hostIds = new Set(list.map((h) => h.id));
  const joined = joinedList().filter((j) => !hostIds.has(j.id)); // 내가 만들고 응답도 했으면 주최로만
  const [loaded, loadedJoined] = await Promise.all([
    Promise.all(list.map((h) => api.get(h.id, { fresh: true }).catch((err) => ({ missing: h.id, err })))),
    Promise.all(joined.map((j) => api.get(j.id).catch(() => ({})))),
  ]);
  if (isStale()) return;
  // 서버에서 지워진 안내장은 목록에서 정리
  loaded.filter((x) => x.missing && /찾을 수 없/.test(x.err.message)).forEach((x) => removeHosted(x.missing));
  const items = [
    ...loaded.filter((x) => x.event).map((x) => ({ ...x, host: true })),
    ...loadedJoined.filter((x) => x.event).map((x) => ({ ...x, host: false })),
  ];
  const canSync = list.length + joined.length > 0;

  const today = items.filter((x) => daysUntil(x.event.date) === 0);
  const upcoming = items.filter((x) => daysUntil(x.event.date) > 0).sort((a, b) => a.event.date.localeCompare(b.event.date) || a.event.startTime.localeCompare(b.event.startTime));
  const past = items.filter((x) => daysUntil(x.event.date) < 0).sort((a, b) => b.event.date.localeCompare(a.event.date));
  const changeCount = items.filter((x) => x.host && x.event.changeVersion > 0 && daysUntil(x.event.date) >= 0).length;
  const tagOf = (x) => (x.event.fee ? `참가비 ${x.event.fee.toLocaleString()}원` : '');

  root.innerHTML = `
    <div class="dash-head">
      <div>
        <h1>내 알림장</h1>
        <p class="sub">가까운 모임부터 보여드려요. 진행 중 ${today.length + upcoming.length}개 · 종료 ${past.length}개${changeCount ? ` · <b>변경 안내 ${changeCount}건</b>` : ''}</p>
      </div>
      <div class="dash-actions">
        ${canSync ? `<button class="btn" data-act="sync">${icon('share')}다른 기기로 옮기기</button>` : ''}
        <a class="btn primary" href="#/create">${icon('plus')}새 안내장</a>
      </div>
    </div>
    ${items.length === 0 ? `
      <div class="empty card">
        ${icon('list', 'big')}
        <p>아직 만들거나 응답한 안내장이 없어요.<br><span class="hint">안내장은 이 브라우저에 저장돼요. 다른 기기에서 쓰던 알림장은 그 기기의 '다른 기기로 옮기기' 링크로 가져올 수 있어요.</span></p>
        <a class="btn primary" href="#/create">${icon('mail')}첫 안내장 만들기</a>
        <button class="btn ghost" data-act="sample">샘플 모임 불러오기 (시연용)</button>
      </div>` : ''}
    ${today.map(todayCard).join('')}
    ${upcoming.length ? `<h2 class="section-title">다가오는 모임</h2><div class="ev-grid">${upcoming.map((x) => upcomingCard(x, tagOf(x))).join('')}</div>` : ''}
    ${past.length ? `<h2 class="section-title muted">최근 종료된 모임</h2><div class="ev-grid">${past.map(pastCard).join('')}</div>` : ''}
    ${items.length ? '<p class="sample-more"><button class="link-btn" data-act="sample">샘플 모임 불러오기 (시연용)</button></p>' : ''}`;

  // 다른 기기로 옮기기 (지금 이 브라우저에 있는 기록을 그대로 담음)
  const url = () => syncUrl(`${location.origin}${location.pathname}`, { hosted: hostedList(), joined: joinedList() });
  const closeSync = () => {
    root.querySelector('.sync-modal-wrap')?.remove();
    document.body.classList.remove('modal-open');
  };
  const onClick = async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'sync') {
      const wrap = document.createElement('div');
      wrap.className = 'sync-modal-wrap';
      wrap.innerHTML = syncModal(url());
      root.appendChild(wrap);
      document.body.classList.add('modal-open');
    }
    if (act === 'close-sync') {
      // 배경을 직접 눌렀을 때만 닫힘 (모달 안 클릭은 무시)
      if (btn.classList.contains('modal-backdrop') && ev.target !== btn) return;
      closeSync();
    }
    if (act === 'copy-sync') copyText(url(), '옮기기 링크를 복사했어요. 다른 사람에게는 보내지 마세요.');
    if (act === 'share-sync') {
      try {
        await navigator.share({ title: '내 알림장 옮기기 (나만 보기)', url: url() });
      } catch (err) {
        if (!err || err.name !== 'AbortError') copyText(url(), '옮기기 링크를 복사했어요. 다른 사람에게는 보내지 마세요.');
      }
    }
  };
  root.addEventListener('click', onClick);

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
        // 라우터를 통해 다시 그려야 이 화면의 클릭 처리기가 정리된다
        if (!isStale()) window.dispatchEvent(new HashChangeEvent('hashchange'));
      } catch (err) {
        toast(err.message, 'err');
        sampleBtn.disabled = false;
      }
    });
  }

  return () => {
    root.removeEventListener('click', onClick);
    document.body.classList.remove('modal-open');
  };
}
