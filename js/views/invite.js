// 02 초대장 보기 (참석자 화면) + D-DAY 당일 모드
import { api } from '../api.js';
import { hostToken, myParticipantId, setMyParticipantId, localSeen, setLocalSeen } from '../store.js';
import {
  countRsvp, seenCount, amountFor, daysUntil, formatDate, formatTime, timeLeft, won, displayValue,
} from '../calc.js';
import {
  esc, nl2br, icon, toast, copyText, inviteUrl, shareInvite, downloadICS, mapUrl, errorView, RSVP_LABEL,
} from '../ui.js';
import { inviteCard, ddayBadge } from '../card.js';

const POLL_MS = 15000;

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
      </div>` : ''}
    <nav class="host-bar" aria-label="주최자 메뉴">
      <span class="host-bar-label">주최자 메뉴</span>
      <button class="btn sm" data-act="share">${icon('share')}공유</button>
      <a class="btn sm" href="#/e/${e.id}/edit">${icon('edit')}수정·재공유</a>
      <a class="btn sm" href="#/e/${e.id}/status">${icon('users')}참석 현황</a>
      <a class="btn sm" href="#/e/${e.id}/settle">${icon('money')}정산</a>
    </nav>`;
}

function changeBanner(e, participants, unseen) {
  if (!unseen) return '';
  const { seen, total } = seenCount(participants, e.changeVersion);
  return `
    <section class="change-banner">
      <div class="change-banner-head">
        <span class="alert-dot">!</span>
        <strong>안내장 내용이 변경되었어요</strong>
        ${total ? `<span class="seen-pill">${icon('check')}확인 ${seen} / ${total}</span>` : ''}
      </div>
      <div class="change-rows">
        ${e.changes.map((c) => `
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
        ? `<p class="hint"><b>${esc(me.name)}</b> 님은 <b>${RSVP_LABEL[me.rsvp]}</b>으로 응답했어요. 바꾸려면 다시 눌러주세요.</p>`
        : `<p class="hint">아직 응답하지 않았어요. 이름을 적고 선택해주세요.</p>
           <label class="sr-only" for="rsvp-name">이름</label>
           <input class="input" id="rsvp-name" maxlength="20" placeholder="이름 (예: 송다은)" autocomplete="name">`}
      <div class="rsvp-buttons">${buttons}</div>
    </section>`;
}

function attendancePanel(e, participants, isHost) {
  const c = countRsvp(participants);
  const pct = (n) => (c.total ? (n / c.total) * 100 : 0);
  return `
    <section class="card side-card">
      <div class="att-head"><h3>참석 현황</h3><p><b class="serif">${c.yes}</b>명 참석 예정</p></div>
      <div class="bar"><i class="yes" style="width:${pct(c.yes)}%"></i><i class="maybe" style="width:${pct(c.maybe)}%"></i><i class="no" style="width:${pct(c.no)}%"></i></div>
      <p class="legend"><span class="lg yes"></span>참석 ${c.yes}<span class="lg maybe"></span>미정 ${c.maybe}<span class="lg no"></span>불참 ${c.no}</p>
      ${isHost ? `<a class="btn sm block" href="#/e/${e.id}/status">참석자 명단 · 정산 상세보기 ${icon('next')}</a>` : ''}
    </section>`;
}

function settlePanel(e, me) {
  const s = e.settlement;
  if (!s || !me || me.rsvp !== 'yes') return '';
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

function fullView(data, ctx) {
  const { event: e, participants } = data;
  const { me, isHost, unseen, isNew } = ctx;
  const changed = unseen ? Object.fromEntries(e.changes.map((c) => [c.field, c.before])) : {};
  const n = daysUntil(e.date);
  return `
    ${isHost ? hostBar(e, isNew) : ''}
    <a class="back-link" href="${isHost ? '#/my' : '#/'}">${icon('back')}${isHost ? '내 알림장으로' : '모임 알림장 홈'}</a>
    <div class="page-head"><span class="step-num">02</span><div><h1>초대장 보기</h1></div></div>
    <div class="invite-layout">
      <div class="invite-main card">
        ${changeBanner(e, participants, unseen)}
        ${inviteCard(e, { changed, actions: `<button class="btn block" data-act="ics">${icon('calendar')}캘린더에 추가</button>` })}
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
        ${attendancePanel(e, participants, isHost)}
      </aside>
    </div>`;
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
      ${ctx.unseen ? changeBanner(e, data.participants, true) : ''}
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
      ${supplies.length || e.notes ? `
        <section class="card card-pad">
          <h2 class="today-h">챙길 것 · 유의사항</h2>
          ${supplies.length ? `<div class="chips">${supplies.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
          ${e.notes ? `<p class="today-notes">${nl2br(e.notes)}</p>` : ''}
        </section>` : ''}
      ${rsvpPanel(ctx.me)}
      ${settlePanel(e, ctx.me)}
      <a class="btn block ghost" href="#/e/${e.id}?view=full">전체 안내장 보기</a>
    </div>`;
}

export async function render(root, { id, query, isStale }) {
  let data = await api.get(id);
  const isHost = !!hostToken(id);
  const isNew = query.new === '1';
  let busy = false;

  const ctxOf = () => {
    const me = data.participants.find((p) => p.id === myParticipantId(id)) || null;
    const seenVer = me ? me.seenVersion || 0 : localSeen(id);
    const unseen = data.event.changeVersion > 0 && data.event.changes.length > 0 && seenVer < data.event.changeVersion;
    return { me, isHost, unseen, isNew };
  };

  const draw = () => {
    const ctx = ctxOf();
    const today = daysUntil(data.event.date) === 0 && query.view !== 'full';
    const typed = root.querySelector('#rsvp-name');
    const name = typed ? typed.value : '';
    root.innerHTML = today ? todayView(data, ctx) : fullView(data, ctx);
    const again = root.querySelector('#rsvp-name');
    if (again) again.value = name;
    document.title = `${data.event.title} — 모임 알림장`;
  };

  const run = async (fn, done) => {
    if (busy) return;
    busy = true;
    try {
      data = await fn();
      if (done) toast(done);
      draw();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy = false;
    }
  };

  const onClick = (ev) => {
    const btn = ev.target.closest('[data-act], [data-rsvp]');
    if (!btn) return;
    const me = ctxOf().me;
    const e = data.event;

    if (btn.dataset.rsvp) {
      const rsvp = btn.dataset.rsvp;
      if (me) {
        if (me.rsvp !== rsvp) run(() => api.self(id, me.id, { rsvp }), `${RSVP_LABEL[rsvp]}으로 바꿨어요`);
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
      run(async () => {
        const res = await api.rsvp(id, { name, rsvp });
        setMyParticipantId(id, res.participant.id);
        return res;
      }, rsvp === 'yes' ? '참석으로 응답했어요. 캘린더에도 추가해보세요!' : '응답했어요');
      return;
    }

    const act = btn.dataset.act;
    if (act === 'copy-link') copyText(inviteUrl(id), '링크를 복사했어요');
    if (act === 'share') shareInvite(e);
    if (act === 'ics') downloadICS(e);
    if (act === 'copy-address') copyText(e.address || e.placeName, '주소를 복사했어요');
    if (act === 'copy-account') copyText(e.settlement.accountNo.replace(/^\[[^\]]*\]\s*/, ''), '계좌번호를 복사했어요');
    if (act === 'paid' && me) run(() => api.self(id, me.id, { paid: true }), '입금 완료로 표시했어요. 주최자 화면에도 반영돼요.');
    if (act === 'seen') {
      if (me) run(() => api.self(id, me.id, { seen: true }), '확인했어요');
      else {
        setLocalSeen(id, e.changeVersion);
        draw();
      }
    }
  };
  root.addEventListener('click', onClick);

  draw();

  // 다른 사람의 응답·정산이 보이도록 주기적으로 새로고침 (입력 중이면 건너뜀)
  const timer = setInterval(async () => {
    if (busy || isStale() || document.hidden || document.activeElement?.id === 'rsvp-name') return;
    try {
      data = await api.get(id);
      if (!isStale()) draw();
    } catch { /* 다음 주기에 다시 */ }
  }, POLL_MS);
  return () => {
    clearInterval(timer);
    root.removeEventListener('click', onClick);
  };
}
