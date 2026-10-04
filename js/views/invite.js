// 02 초대장 보기 (참석자 화면) + D-DAY 당일 모드
import { api, getMode } from '../api.js';
import { hostToken, addHosted, myself, setMyself, localSeen, setLocalSeen, joinedList } from '../store.js';
import { syncUrl } from '../sync.js';
import {
  countRsvp, seenCount, amountFor, daysUntil, formatDate, formatTime, timeLeft, won, displayValue,
  supplyStatus, lateList, changeSummary, josa, pendingChanges, latestChanges, googleCalendarUrl,
} from '../calc.js';
import {
  esc, nl2br, icon, toast, copyText, writeClipboard, inviteUrl, shareInvite, mapUrl, errorView, RSVP_LABEL,
} from '../ui.js';
import { inviteCard, ddayBadge, seenPill } from '../card.js';

// 참석자는 1분, 주최자는 15초마다 새로고침 (수백 명이 동시에 열어도 부담 없게)
const POLL_HOST_MS = 15000;
const POLL_GUEST_MS = 60000;

// 다른 기기에서 이어서 쓰는 링크 (토큰은 # 뒤에 있어 서버로 전송되지 않음)
const adminUrl = (id, token) => `${inviteUrl(id)}?k=${encodeURIComponent(token)}`;
// 응답한 모임만 담은 옮기기 링크 — 관리 토큰은 넣지 않아 단톡방에 잘못 붙여넣어도 내 안내장은 안전
const responsesSyncUrl = () => syncUrl(`${location.origin}${location.pathname}`, { joined: joinedList() });
const SYNC_COPIED = '옮기기 링크를 복사했어요. 카톡 나와의 채팅에 붙여넣어 두면 다른 기기에서도 내 알림장에 보여요.';

const localWarning = () => (getMode() === 'local'
  ? `<p class="local-warn">${icon('alert')}지금은 체험 모드라 이 링크는 <b>이 브라우저에서만</b> 열려요. 다른 사람·다른 기기와 공유하려면 서버 저장소를 연결해야 해요.</p>`
  : '');

function hostBar(e, isNew) {
  return `
    ${isNew ? `
      <div class="card created">
        <div>
          <p class="created-title">${icon('checkCircle')}안내장이 만들어졌어요!</p>
          <p class="hint">아래 링크를 카톡방에 공유하면 참석자가 바로 응답할 수 있어요.</p>
        </div>
        <div class="link-box"><span>${esc(inviteUrl(e.id))}</span><button class="btn sm dark" data-act="copy-link">링크 복사</button></div>
        <button class="btn primary" data-act="share">${icon('share')}카톡으로 공유하기</button>
        ${localWarning()}
        <div class="admin-box">
          <p><b>주최자 관리 링크</b> · 휴대폰 등 다른 기기에서도 수정·정산하려면 이 링크를 나에게만 보내 두세요. 참석자에게는 공유하지 마세요.</p>
          <button class="btn sm dark" data-act="copy-admin">관리 링크 복사</button>
        </div>
      </div>` : ''}
    <nav class="host-bar" aria-label="주최자 메뉴">
      <span class="host-bar-label">주최자 메뉴</span>
      <button class="btn sm" data-act="share">${icon('share')}공유</button>
      <button class="btn sm" data-act="copy-admin" title="다른 기기에서 관리할 때 쓰는 링크">${icon('copy')}관리 링크</button>
      <a class="btn sm" href="#/e/${e.id}/edit">${icon('edit')}수정·재공유</a>
      <a class="btn sm" href="#/e/${e.id}/status">${icon('users')}참석 현황</a>
      <a class="btn sm" href="#/e/${e.id}/settle">${icon('money')}정산</a>
    </nav>`;
}

// changes: 이 사람이 아직 확인하지 않은 변경 (앞선 수정분까지 합쳐서)
function changeBanner(e, participants, changes) {
  if (!changes.length) return '';
  const { seen, total } = seenCount(participants, e.changeVersion);
  return `
    <section class="change-banner">
      <div class="change-banner-head">
        <span class="alert-dot">!</span>
        <strong>안내장 내용이 변경되었어요</strong>
        ${total ? seenPill({ seen, total }) : ''}
      </div>
      <div class="change-rows">
        ${changes.map((c) => `
          <div class="change-row"><span>기존 ${esc(c.label)}</span><span class="strike">${esc(displayValue(c.field, c.before))}</span></div>
          <div class="change-row now"><span>변경된 ${esc(c.label)}</span><strong>${esc(displayValue(c.field, c.after))}</strong></div>`).join('')}
      </div>
      <div class="change-banner-foot">
        <span class="hint">변경된 항목은 아래 안내장에 주황색으로 표시돼요</span>
        <button class="btn sm primary" data-act="seen">확인했어요</button>
      </div>
    </section>`;
}

function rsvpPanel(me) {
  const buttons = ['yes', 'maybe', 'no'].map((r) => `
    <button class="rsvp-btn ${me && me.rsvp === r ? `on ${r}` : ''}" data-rsvp="${r}" aria-pressed="${me && me.rsvp === r}">${RSVP_LABEL[r]}</button>`).join('');
  return `
    <section class="card side-card rsvp-card">
      <h3>나의 참석 여부</h3>
      ${me
        ? `<p class="hint"><b>${esc(me.name)}</b> 님은 <b>${RSVP_LABEL[me.rsvp]}</b>으로 응답했어요. 바꾸려면 다시 눌러주세요.</p>
           <p class="hint my-link">다른 기기의 내 알림장에서도 보려면 <button class="link-btn" data-act="copy-me">옮기기 링크 복사</button> · 나만 보는 곳에 보관하세요</p>`
        : `<p class="hint">아직 응답하지 않았어요. 이름을 적고 선택해주세요.</p>
           <label class="sr-only" for="rsvp-name">이름</label>
           <input class="input" id="rsvp-name" maxlength="20" placeholder="이름 (예: 송다은)" autocomplete="name">`}
      <div class="rsvp-buttons">${buttons}</div>
    </section>`;
}

// 누가 오나요? — 주최자가 아니어도 응답한 사람 이름을 볼 수 있다 (이름·응답만, 정산 정보는 제외)
function whoList(participants, me, open) {
  if (!participants.length) return '';
  const group = (r) => participants.filter((p) => p.rsvp === r);
  const names = (list) => list.map((p) => `<span class="who-name${me && me.id === p.id ? ' me' : ''}">${esc(p.name)}${me && me.id === p.id ? ' (나)' : ''}</span>`).join('');
  return `
    <details class="who"${open ? ' open' : ''}>
      <summary>누가 오나요? ${icon('next')}</summary>
      ${['yes', 'maybe', 'no'].filter((r) => group(r).length).map((r) => `
        <div class="who-group">
          <p class="who-label"><span class="lg ${r}"></span>${RSVP_LABEL[r]} ${group(r).length}</p>
          <div class="who-names">${names(group(r))}</div>
        </div>`).join('')}
    </details>`;
}

function attendancePanel(e, participants, isHost, me, whoOpen) {
  const c = countRsvp(participants);
  const pct = (n) => (c.total ? (n / c.total) * 100 : 0);
  return `
    <section class="card side-card">
      <div class="att-head"><h3>참석 현황</h3><p><b class="serif">${c.yes}</b>명 참석 예정</p></div>
      <div class="bar"><i class="yes" style="width:${pct(c.yes)}%"></i><i class="maybe" style="width:${pct(c.maybe)}%"></i><i class="no" style="width:${pct(c.no)}%"></i></div>
      <p class="legend"><span class="lg yes"></span>참석 ${c.yes}<span class="lg maybe"></span>미정 ${c.maybe}<span class="lg no"></span>불참 ${c.no}</p>
      ${whoList(participants, me, whoOpen)}
      ${isHost ? `<a class="btn sm block" href="#/e/${e.id}/status">참석자 명단 · 정산 상세보기 ${icon('next')}</a>` : ''}
    </section>`;
}

function settlePanel(e, me) {
  const s = e.settlement;
  if (!s || !me || me.rsvp !== 'yes' || me.settle === 'excluded') return '';
  const done = me.settle === 'done';
  return `
    <section class="card side-card settle-card">
      <p class="notice-title">${icon('alert')}정산 금액이 등록되었어요</p>
      <p class="hint">모임 후 정산 · ${esc(me.name)} 님의 금액</p>
      <p class="settle-amount serif">${won(amountFor(s, me.id))}</p>
      <div class="account">
        <div><p class="hint">계좌번호</p><p class="account-no">${esc(s.accountNo)}</p><p class="hint">예금주 <b>${esc(s.accountHolder)}</b></p></div>
        <button class="btn sm dark" data-act="copy-account">복사</button>
      </div>
      <div class="my-settle"><span>나의 정산 상태</span><span class="pill ${done ? 'done' : 'unpaid'}">${done ? '입금 완료' : '미납'}</span></div>
      ${done ? '' : '<button class="btn primary block" data-act="paid">입금했어요</button>'}
    </section>`;
}

const avatar = (p) => `<span class="avatar">${esc(p.name.slice(-2, -1) || p.name[0])}</span>`;

function seenModal(e, ps, me) {
  const { seen, total } = seenCount(ps, e.changeVersion);
  const unseen = ps.filter((p) => (p.seenVersion || 0) < e.changeVersion);
  const summary = changeSummary(e);
  return {
    title: '변경 안내 확인 현황',
    body: `
      <p class="hint">${esc(summary)} 변경 안내를 ${total}명 중 ${seen}명이 확인했어요.</p>
      <div class="bar modal-bar"><i class="yes" style="width:${total ? (seen / total) * 100 : 0}%"></i></div>
      ${unseen.length ? `
        <h3 class="modal-sub">아직 확인하지 않은 ${unseen.length}명</h3>
        <ul class="person-list">
          ${unseen.map((p) => `<li>${avatar(p)}<span>${esc(p.name)}${me && me.id === p.id ? ' (나)' : ''}</span><em>미확인</em></li>`).join('')}
        </ul>` : `<p class="all-done">${icon('checkCircle')}모두 확인했어요</p>`}`,
    footer: unseen.length ? '<button class="btn primary block" data-act="renotify">미확인자에게 다시 알리기</button>' : '<button class="btn primary block" data-act="close-modal">닫기</button>',
  };
}

function supplyModal(e, ps, me, isHost) {
  const list = supplyStatus(e, ps);
  const mine = new Set((me && me.brings) || []);
  return {
    title: '준비물 · 누가 가져오나요?',
    body: `
      <p class="hint">안내장의 준비물을 쉼표(,) 기준으로 나눴어요. 모두 챙기는 건 <b>각자</b>${isHost ? '를 켜고' : '로 표시돼 있고'}, 한 명만 가져오면 되는 건 담당을 정해주세요.</p>
      <ul class="supply-list">
        ${list.map((x) => `
          <li class="supply-item${x.needed ? ' need' : ''}">
            <div>
              <p class="supply-name">${esc(x.name)}
                ${isHost
                  ? `<button type="button" class="each-toggle${x.each ? ' on' : ''}" data-each="${esc(x.name)}" aria-pressed="${x.each}">${icon('users')}각자</button>`
                  : x.each ? `<span class="each-toggle on">${icon('users')}각자</span>` : ''}
              </p>
              ${x.needed ? '<span class="tag need-tag">담당자 필요</span>' : ''}
              <p class="hint">${x.each ? '모두 각자 챙겨요' : x.bringers.length ? `${esc(x.bringers.map((p) => p.name).join(', '))} 가져와요` : '아직 아무도 없어요'}</p>
            </div>
            ${x.each ? '' : `<button type="button" class="btn sm${mine.has(x.name) ? ' primary' : ''}" data-bring="${esc(x.name)}" aria-pressed="${mine.has(x.name)}">${mine.has(x.name) ? `${icon('check')}내가 가져가요` : '내가 가져갈게요'}</button>`}
          </li>`).join('')}
      </ul>`,
    footer: '<button class="btn primary block" data-act="close-modal">완료</button>',
  };
}

function modalView(m) {
  return `
    <div class="modal-backdrop" data-act="close-modal">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-head"><h2 id="modal-title">${m.title}</h2><button class="modal-x" data-act="close-modal" aria-label="닫기">✕</button></div>
        <div class="modal-body">${m.body}</div>
        <div class="modal-foot">${m.footer}</div>
      </div>
    </div>`;
}

// 늦어요 (참석자) — 주최자 화면에 바로 표시
function latePanel(me) {
  const cur = me && me.late ? me.late.minutes : 0;
  return `
    <section class="card card-pad late-card">
      <h2 class="late-title">늦을 것 같나요?</h2>
      <p class="hint">누르면 주최자에게 바로 알려드려요.</p>
      <div class="late-buttons">
        ${[10, 20, 30].map((m) => `<button class="btn${cur === m ? ' primary' : ''}" data-late="${m}" aria-pressed="${cur === m}">${m}분 늦어요</button>`).join('')}
      </div>
      ${cur ? `<p class="late-sent">${icon('checkCircle')}주최자에게 ${cur}분 늦는다고 알렸어요 <button class="link-btn" data-late="0">제시간에 가요</button></p>` : ''}
    </section>`;
}

// 늦어요 (주최자 화면)
function lateBoard(ps) {
  const late = lateList(ps);
  if (!late.length) return '';
  return `
    <section class="card card-pad late-board">
      <h2 class="today-h">${icon('clock')}늦는다고 알린 사람 ${late.length}명</h2>
      <ul class="person-list">
        ${late.map((p) => `<li>${avatar(p)}<span>${esc(p.name)}</span><em>${p.late.minutes}분 늦어요 · ${esc(formatTime(new Date(p.late.at).toTimeString().slice(0, 5)))} 알림</em></li>`).join('')}
      </ul>
    </section>`;
}

function fullView(data, ctx) {
  const { event: e, participants } = data;
  const { me, isHost, pending, isNew } = ctx;
  // 카드에 표시할 변경: 아직 확인 안 한 것, 주최자는 최근 수정분
  const marks = pending.length ? pending : isHost ? latestChanges(e) : [];
  const changed = Object.fromEntries(marks.map((c) => [c.field, c.before]));
  const seen = marks.length ? seenCount(participants, e.changeVersion) : null;
  const n = daysUntil(e.date);
  return `
    ${isHost ? hostBar(e, isNew) : ''}
    <a class="back-link" href="${isHost ? '#/my' : '#/'}">${icon('back')}${isHost ? '내 알림장으로' : '모임 알림장 홈'}</a>
    <div class="page-head"><span class="step-num">02</span><div><h1>초대장 보기</h1></div></div>
    <div class="invite-layout">
      <div class="invite-main card">
        ${changeBanner(e, participants, pending)}
        ${inviteCard(e, { changed, seen, supply: supplyStatus(e, participants), actions: `<a class="btn block" href="${esc(googleCalendarUrl(e, inviteUrl(e.id)))}" target="_blank" rel="noopener">${icon('calendar')}구글 캘린더에 추가</a>` })}
      </div>
      <aside class="invite-side">
        <section class="card side-card dday-card">
          <p class="hint">${n < 0 ? '종료된 모임' : '모임까지'}</p>
          <p class="dday-big serif">${n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : `${-n}일 전`}</p>
          <p class="hint">${esc(formatDate(e.date, { year: false }))} ${esc(formatTime(e.startTime))}</p>
          ${n === 0 ? `<a class="btn sm primary" href="#/e/${e.id}">당일 모드로 보기</a>` : ''}
        </section>
        ${rsvpPanel(me)}
        ${settlePanel(e, me)}
        ${attendancePanel(e, participants, isHost, me, ctx.whoOpen)}
      </aside>
    </div>
    ${me ? '' : `<button class="btn primary rsvp-jump" data-act="jump-rsvp">참석 여부 응답하기</button>`}`;
}

function todayView(data, ctx) {
  const { event: e } = data;
  const left = timeLeft(e);
  const supplies = (e.supplies || '').split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
  return `
    ${ctx.isHost ? hostBar(e, ctx.isNew) : ''}
    <div class="today">
      <a class="back-link" href="${ctx.isHost ? '#/my' : '#/'}">${icon('back')}${ctx.isHost ? '내 알림장으로' : '모임 알림장 홈'}</a>
      <section class="today-hero">
        <div class="today-hero-top"><span class="live">당일 모드</span>${ddayBadge(e.date)}</div>
        <h1>${esc(e.title)}</h1>
        <p class="today-time">오늘 ${esc(formatTime(e.startTime))} <em>${left ? `${left} 남았어요` : '모임이 시작됐어요'}</em></p>
        <p class="today-hint">오늘은 가는 길과 연락처를 먼저 보여드려요.</p>
      </section>
      ${ctx.isHost ? lateBoard(data.participants) : ''}
      ${changeBanner(e, data.participants, ctx.pending)}
      <section class="card card-pad">
        <h2 class="today-h">${icon('pin')}오시는 길</h2>
        <p class="today-place">${esc(e.placeName)}</p>
        ${e.address ? `<p class="hint">${esc(e.address)}</p>` : ''}
        <div class="btn-row">
          <a class="btn primary" href="${mapUrl(e)}" target="_blank" rel="noopener">${icon('map')}지도에서 보기</a>
          <button class="btn dark" data-act="copy-address">주소 복사</button>
        </div>
      </section>
      ${e.hostName || e.hostPhone ? `
        <section class="card card-pad">
          <h2 class="today-h">${icon('users')}주최자 연락처</h2>
          <p><b>${esc(e.hostName)}</b>${e.hostPhone ? ` · ${esc(e.hostPhone)}` : ''}</p>
          ${e.hostPhone ? `
            <div class="btn-row">
              <a class="btn" href="tel:${esc(e.hostPhone.replace(/[^\d+]/g, ''))}">${icon('phone')}전화</a>
              <a class="btn" href="sms:${esc(e.hostPhone.replace(/[^\d+]/g, ''))}">${icon('message')}문자</a>
            </div>` : ''}
        </section>` : ''}
      ${ctx.me && ctx.me.rsvp === 'yes' ? latePanel(ctx.me) : ''}
      ${supplies.length || e.notes ? `
        <section class="card card-pad">
          <h2 class="today-h">챙길 것 · 유의사항</h2>
          ${supplies.length ? `<div class="chips">${supplies.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
          ${supplyStatus(e, data.participants).length ? `<button class="link-btn" data-act="open-supply">누가 무엇을 가져오는지 보기 ${icon('next')}</button>` : ''}
          ${e.notes ? `<p class="today-notes">${nl2br(e.notes)}</p>` : ''}
        </section>` : ''}
      ${rsvpPanel(ctx.me)}
      ${settlePanel(e, ctx.me)}
      <a class="btn block ghost" href="#/e/${e.id}?view=full">전체 안내장 보기</a>
    </div>`;
}

export async function render(root, { id, query, isStale }) {
  // 다른 기기에서 받은 관리 링크(?k=) / 내 응답 링크(?p=&t=)를 이 브라우저에 저장하고 주소에서 지움
  if (query.k) addHosted(id, query.k);
  if (query.p && query.t) setMyself(id, query.p, query.t);
  if (query.k || query.p) {
    history.replaceState(null, '', `#/e/${id}${query.view ? `?view=${encodeURIComponent(query.view)}` : ''}`);
    if (query.k) toast('이 기기에서도 주최자로 관리할 수 있어요');
    if (query.p) toast('내 응답을 이 기기에 연결했어요');
  }

  const isHost = !!hostToken(id);
  let data = await api.get(id, { fresh: isHost });
  const isNew = query.new === '1';
  let busy = false;
  let gen = 0; // 내가 바꾼 횟수 — 그 사이 끝난 주기 새로고침 결과(옛 데이터)는 버린다
  let modal = null; // 'seen' | 'supply'
  let whoOpen = false; // "누가 오나요?" 펼침 상태 — 새로고침으로 다시 그려도 유지

  const ctxOf = () => {
    const auth = myself(id);
    // 토큰이 없는 예전 기록은 본인 확인을 못 하므로 다시 응답하게 한다
    const me = (auth && auth.token && data.participants.find((p) => p.id === auth.pid)) || null;
    const seenVer = me ? me.seenVersion || 0 : localSeen(id);
    return { me, auth, isHost, pending: pendingChanges(data.event, seenVer), isNew, whoOpen };
  };

  const draw = () => {
    const who = root.querySelector('details.who');
    if (who) whoOpen = who.open;
    const ctx = ctxOf();
    const today = daysUntil(data.event.date) === 0 && query.view !== 'full';
    const typed = root.querySelector('#rsvp-name');
    const name = typed ? typed.value : '';
    const scroll = root.querySelector('.modal-body')?.scrollTop || 0;
    let html = today ? todayView(data, ctx) : fullView(data, ctx);
    if (modal === 'seen') html += modalView(seenModal(data.event, data.participants, ctx.me));
    if (modal === 'supply') html += modalView(supplyModal(data.event, data.participants, ctx.me, isHost));
    root.innerHTML = html;
    document.body.classList.toggle('modal-open', !!modal);
    if (modal) root.querySelector('.modal-body').scrollTop = scroll;
    const again = root.querySelector('#rsvp-name');
    if (again) again.value = name;
    document.title = `${data.event.title} — 모임 알림장`;
  };

  const run = async (fn, done) => {
    if (busy) return;
    busy = true;
    gen++;
    try {
      data = await fn();
      if (done) toast(typeof done === 'function' ? done() : done);
      draw();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy = false;
    }
  };

  const onClick = (ev) => {
    const btn = ev.target.closest('[data-act], [data-rsvp], [data-each], [data-bring], [data-late]');
    if (!btn) return;
    const { me, auth } = ctxOf();
    const e = data.event;
    const token = hostToken(id);

    if (btn.dataset.each != null) {
      const item = btn.dataset.each;
      const on = !btn.classList.contains('on');
      run(() => api.each(id, token, { item, on }), on ? `${item}: 모두 각자 챙기도록 했어요` : `${item}: 담당을 정할 수 있어요`);
      return;
    }
    if (btn.dataset.bring != null) {
      if (!me || me.rsvp !== 'yes') {
        toast('먼저 참석으로 응답해주세요', 'err');
        return;
      }
      const item = btn.dataset.bring;
      const has = (me.brings || []).includes(item);
      const brings = has ? me.brings.filter((b) => b !== item) : [...(me.brings || []), item];
      run(() => api.self(id, auth, { brings }), has ? `${item} 담당을 취소했어요` : `${josa(item, '을', '를')} 가져가기로 했어요`);
      return;
    }
    if (btn.dataset.late != null) {
      if (!me) return;
      const late = Number(btn.dataset.late);
      run(() => api.self(id, auth, { late }), late ? `주최자에게 ${late}분 늦는다고 알렸어요` : '늦어요 알림을 취소했어요');
      return;
    }

    if (btn.dataset.rsvp) {
      const rsvp = btn.dataset.rsvp;
      if (me) {
        if (me.rsvp !== rsvp) run(() => api.self(id, auth, { rsvp }), `${RSVP_LABEL[rsvp]}으로 바꿨어요`);
        return;
      }
      const input = root.querySelector('#rsvp-name');
      const name = input.value.trim();
      if (!name) {
        input.classList.add('invalid');
        input.focus();
        toast('이름을 먼저 적어주세요', 'err');
        return;
      }
      let copied = false;
      run(async () => {
        const res = await api.rsvp(id, { name, rsvp });
        setMyself(id, res.participant.id, res.participantToken);
        // 응답하면 옮기기 링크(응답 기록만)를 바로 복사 — 브라우저가 막으면 카드의 복사 버튼으로
        copied = await writeClipboard(responsesSyncUrl());
        return res;
      }, () => `${rsvp === 'yes' ? '참석으로 응답했어요.' : '응답했어요.'}${copied ? ' 옮기기 링크도 복사했어요. 카톡 나와의 채팅에 붙여넣어 두세요.' : ''}`);
      return;
    }

    const act = btn.dataset.act;
    if (act === 'close-modal') {
      // 배경을 직접 눌렀을 때만 닫힘 (모달 안 클릭은 무시)
      if (btn.classList.contains('modal-backdrop') && ev.target !== btn) return;
      modal = null;
      draw();
      return;
    }
    if (act === 'open-seen' || act === 'open-supply') {
      modal = act === 'open-seen' ? 'seen' : 'supply';
      draw();
      root.querySelector('.modal-x').focus();
      return;
    }
    if (act === 'renotify') {
      const names = data.participants.filter((p) => (p.seenVersion || 0) < e.changeVersion).map((p) => p.name);
      shareInvite(e, `[변경 안내 다시 알림] ${names.join(', ')}님, ${josa(changeSummary(e), '이', '가')} 바뀌었어요. 링크에서 확인 부탁드려요!

`);
      return;
    }
    if (act === 'copy-admin') copyText(adminUrl(id, token), '관리 링크를 복사했어요. 참석자에게는 보내지 마세요.');
    if (act === 'copy-me' && auth) copyText(responsesSyncUrl(), SYNC_COPIED);
    if (act === 'jump-rsvp') {
      const card = root.querySelector('.rsvp-card');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => card.querySelector('input')?.focus({ preventScroll: true }), 400);
    }
    if (act === 'copy-link') copyText(inviteUrl(id), '링크를 복사했어요');
    if (act === 'share') shareInvite(e);
    if (act === 'copy-address') copyText(e.address || e.placeName, '주소를 복사했어요');
    if (act === 'copy-account') copyText(e.settlement.accountNo.replace(/^\[[^\]]*\]\s*/, ''), '계좌번호를 복사했어요');
    if (act === 'paid' && me) run(() => api.self(id, auth, { paid: true }), '입금 완료로 표시했어요. 주최자 화면에도 반영돼요.');
    if (act === 'seen') {
      if (me) run(() => api.self(id, auth, { seen: true }), '확인했어요');
      else {
        setLocalSeen(id, e.changeVersion);
        draw();
      }
    }
  };
  root.addEventListener('click', onClick);
  const onKey = (ev) => {
    if (ev.key === 'Escape' && modal) {
      modal = null;
      draw();
    }
  };
  document.addEventListener('keydown', onKey);

  draw();

  // 다른 사람의 응답·정산이 보이도록 주기적으로 새로고침 (입력 중이면 건너뜀)
  const timer = setInterval(async () => {
    if (busy || modal || isStale() || document.hidden || document.activeElement?.id === 'rsvp-name') return;
    const startGen = gen;
    try {
      const fresh = await api.get(id, { fresh: isHost });
      if (startGen !== gen || busy || isStale()) return; // 그 사이 내가 바꿨으면 옛 데이터라 버림
      if (fresh.stamp && data.stamp && fresh.stamp < data.stamp) return; // CDN에 남은 더 오래된 응답
      data = fresh;
      draw();
    } catch { /* 다음 주기에 다시 */ }
  }, isHost ? POLL_HOST_MS : POLL_GUEST_MS);
  return () => {
    clearInterval(timer);
    root.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('modal-open');
  };
}
