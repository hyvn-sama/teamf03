// 04 정산 안내 (주최자) — 총 비용 ÷ 정산 인원 자동 계산, 개인별 조정, 계좌 등록
import { api } from '../api.js';
import { hostToken } from '../store.js';
import { perPerson, settleSummary, settleTargets, won } from '../calc.js';
import { esc, icon, toast, pageHead, errorView, inviteUrl, copyText } from '../ui.js';

const num = (v) => (v === '' || v == null ? 0 : Number(v));

export async function render(root, { id }) {
  const token = hostToken(id);
  if (!token) {
    root.innerHTML = errorView('정산 등록은 안내장을 만든 주최자만 할 수 있어요.', { href: `#/e/${id}`, label: '안내장 보기' });
    return;
  }
  let { event: e, participants: ps } = await api.get(id, { fresh: true });
  // 정산 인원 = 참석자 중 '정산 제외'가 아닌 사람 (참석 현황에서 지정)
  let attending = settleTargets(ps);
  const s0 = e.settlement || {};
  const changedSince = e.settlement && s0.count !== attending.length;
  const state = {
    total: s0.total ?? (e.fee && attending.length ? e.fee * attending.length : ''),
    count: attending.length,
    mode: s0.mode || 'equal',
    custom: { ...(s0.custom || {}) },
  };

  root.innerHTML = `
    ${pageHead({ num: '04', title: '정산 안내', sub: esc(e.title), back: { href: `#/e/${id}/status`, label: '참석 현황으로' } })}
    <div class="settle-layout">
      <form class="card card-pad settle-form" novalidate>
        <div class="settle-form-head"><h2>정산 등록</h2><span class="tag opt">주최자 화면</span></div>
        <p class="hint">총 비용을 넣으면 정산 인원으로 나눠 1인당 금액이 자동으로 계산돼요.</p>
        ${changedSince ? `<p class="local-warn">${icon('alert')}정산을 등록할 때는 ${s0.count}명이었는데 지금 정산 대상은 ${attending.length}명이에요. 확인 후 다시 보내주세요.</p>` : ''}

        <div class="field"><label for="s-total">총 비용<span class="tag req">필수</span></label>
          <div class="input-unit"><input class="input" id="s-total" name="total" type="number" inputmode="numeric" min="1" placeholder="224000"><span>원</span></div></div>
        <div class="field"><label for="s-count">정산 인원<span class="tag opt">자동</span></label>
          <div>
            <div class="input-unit"><input class="input" id="s-count" name="count" type="number" readonly tabindex="-1"><span>명</span></div>
            <p class="hint field-hint">참석자 중 '정산 제외'가 아닌 사람 수예요. 바꾸려면 <a href="#/e/${id}/status">참석 현황</a>에서 정산 상태를 바꿔주세요.</p>
          </div></div>

        <section class="amount-box">
          <div class="amount-head">
            <h3>정산 금액</h3>
            <div class="seg" role="group" aria-label="분배 방식">
              <button type="button" data-mode="equal">균등 분배</button>
              <button type="button" data-mode="custom">개인별 조정</button>
            </div>
          </div>
          <div class="amount-body"></div>
        </section>

        <div class="field"><label for="s-account">계좌번호<span class="tag req">필수</span></label>
          <input class="input" id="s-account" name="accountNo" maxlength="60" placeholder="[은행명] 000-0000-0000"></div>
        <div class="field"><label for="s-holder">예금주<span class="tag req">필수</span></label>
          <input class="input" id="s-holder" name="accountHolder" maxlength="30" placeholder="${esc(e.hostName || '김민지')}"></div>

        <p class="form-error" role="alert"></p>
        <button class="btn primary block submit" type="submit">정산 안내 보내기</button>
        <p class="sent-msg" ${e.settlement ? '' : 'hidden'}>${icon('checkCircle')}<span></span></p>
      </form>

      <aside class="settle-side">
        <p class="preview-label">참석자에게 보이는 화면</p>
        <div class="card participant-preview"></div>
        <div class="card card-pad side-status"></div>
      </aside>
    </div>`;

  const form = root.querySelector('form');
  const errorEl = form.querySelector('.form-error');
  form.elements.total.value = state.total;
  form.elements.count.value = state.count;
  form.elements.accountNo.value = s0.accountNo || '';
  form.elements.accountHolder.value = s0.accountHolder || e.hostName || '';

  const amountOf = (pid) => (state.mode === 'custom' && state.custom[pid] != null ? state.custom[pid] : perPerson(num(state.total), num(state.count)));

  const drawAmounts = () => {
    const base = perPerson(num(state.total), num(state.count));
    form.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === state.mode));
    const body = form.querySelector('.amount-body');
    if (state.mode === 'equal') {
      const remainder = base * num(state.count) - num(state.total);
      body.innerHTML = `
        <p class="per-person">1인당 <b class="serif">${won(base)}</b></p>
        ${remainder > 0 ? `<p class="hint">나누어떨어지지 않아 1원 단위로 올렸어요. 총 ${won(remainder)} 더 걷혀요.</p>` : ''}`;
      return;
    }
    if (!attending.length) {
      body.innerHTML = '<p class="hint">참석으로 응답한 사람이 아직 없어요.</p>';
      return;
    }
    const sum = attending.reduce((acc, p) => acc + num(amountOf(p.id)), 0);
    const diff = sum - num(state.total);
    body.innerHTML = `
      <div class="amount-tools"><span class="hint">참석자마다 금액을 정할 수 있어요. 기본값은 균등 금액 ${won(base)}이에요.</span>
        <button type="button" class="btn sm" data-reset>균등 금액으로 되돌리기</button></div>
      <div class="amount-list">
        ${attending.map((p) => `
          <label class="amount-row"><span><i class="avatar">${esc(p.name.slice(-2, -1) || p.name[0])}</i>${esc(p.name)}</span>
            <span class="input-unit"><input class="input" type="number" inputmode="numeric" min="0" data-pid="${esc(p.id)}" value="${amountOf(p.id)}"><span>원</span></span></label>`).join('')}
      </div>
      <div class="amount-sum"><span>합계</span><b>${won(sum)}</b></div>
      <p class="${diff === 0 ? 'ok' : 'due'} sum-check">${diff === 0 ? '합계가 총 비용과 딱 맞아요' : `총 비용보다 ${won(Math.abs(diff))} ${diff > 0 ? '많아요' : '적어요'}`}</p>`;
  };

  const drawPreview = () => {
    const p = attending[0];
    const holder = form.elements.accountHolder.value.trim() || '예금주';
    root.querySelector('.participant-preview').innerHTML = `
      <p class="notice-title preview-head">${icon('alert')}정산 금액이 등록되었어요</p>
      <div class="card-pad">
        <p class="hint">모임 후 정산 · ${esc(p ? p.name : '참석자')} 님의 금액</p>
        <p class="settle-amount serif">${won(p ? amountOf(p.id) : perPerson(num(state.total), num(state.count)))}</p>
        <div class="account"><div><p class="hint">계좌번호</p><p class="account-no">${esc(form.elements.accountNo.value.trim() || '[은행명] 000-0000-0000')}</p><p class="hint">예금주 <b>${esc(holder)}</b></p></div><span class="btn sm dark">복사</span></div>
        <div class="my-settle"><span>나의 정산 상태</span><span class="pill ${p && p.settle === 'done' ? 'done' : 'unpaid'}">${p && p.settle === 'done' ? '입금 완료' : '미납'}</span></div>
        ${p && p.settle === 'done' ? '' : '<span class="btn primary block">입금했어요</span>'}
      </div>`;
    const sum = settleSummary(ps, e.settlement);
    root.querySelector('.side-status').innerHTML = `
      <p class="hint">참석 현황 반영 · 정산 대상 ${sum.targets}명 중 <b class="ok">완료 ${sum.done}명</b>${sum.unpaid ? ` · <b class="due">미정산 ${sum.unpaid}명</b>` : ''}</p>
      <a class="btn sm block" href="#/e/${id}/status">참석 현황 보기 ${icon('next')}</a>`;
  };

  const drawSent = () => {
    const msg = form.querySelector('.sent-msg');
    msg.hidden = !e.settlement;
    if (e.settlement) msg.querySelector('span').textContent = `정산 대상 ${attending.length}명에게 정산 안내가 표시되고 있어요`;
  };

  form.addEventListener('input', (ev) => {
    const t = ev.target;
    t.classList.remove('invalid');
    if (t.name === 'total') {
      state[t.name] = t.value;
      drawAmounts();
    } else if (t.dataset.pid) {
      state.custom[t.dataset.pid] = t.value === '' ? 0 : Number(t.value);
      // 합계 줄만 다시 그려 입력 중 커서를 잃지 않게 한다
      const sum = attending.reduce((acc, p) => acc + num(amountOf(p.id)), 0);
      const diff = sum - num(state.total);
      form.querySelector('.amount-sum b').textContent = won(sum);
      const check = form.querySelector('.sum-check');
      check.className = `${diff === 0 ? 'ok' : 'due'} sum-check`;
      check.textContent = diff === 0 ? '합계가 총 비용과 딱 맞아요' : `총 비용보다 ${won(Math.abs(diff))} ${diff > 0 ? '많아요' : '적어요'}`;
    }
    drawPreview();
  });

  form.addEventListener('click', (ev) => {
    const modeBtn = ev.target.closest('[data-mode]');
    if (modeBtn) {
      state.mode = modeBtn.dataset.mode;
      drawAmounts();
      drawPreview();
    }
    if (ev.target.closest('[data-reset]')) {
      state.custom = {};
      drawAmounts();
      drawPreview();
    }
  });

  let busy = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (busy) return;
    if (!attending.length) {
      errorEl.textContent = '정산 대상이 없어요. 참석 현황에서 참석자를 확인해주세요.';
      return;
    }
    const required = ['total', 'accountNo', 'accountHolder'];
    const empty = required.map((n) => form.elements[n]).find((el) => !String(el.value).trim() || (el.type === 'number' && Number(el.value) <= 0));
    required.forEach((n) => form.elements[n].classList.toggle('invalid', form.elements[n] === empty));
    if (empty) {
      errorEl.textContent = '필수 항목을 모두 채워주세요.';
      empty.focus();
      return;
    }
    if (state.mode === 'custom') {
      const sum = attending.reduce((acc, p) => acc + num(amountOf(p.id)), 0);
      if (sum !== num(state.total)) {
        errorEl.textContent = `개인별 금액의 합계(${won(sum)})가 총 비용(${won(num(state.total))})과 같아야 해요.`;
        return;
      }
    }
    errorEl.textContent = '';
    busy = true;
    form.querySelector('.submit').disabled = true;
    try {
      // 화면을 연 뒤 정산 대상이 바뀌었는지 마지막으로 확인
      const fresh = (await api.get(id, { fresh: true })).participants;
      const latest = settleTargets(fresh);
      if (latest.length !== attending.length) {
        ps = fresh;
        attending = latest;
        state.count = attending.length;
        form.elements.count.value = state.count;
        drawAmounts();
        drawPreview();
        throw new Error(`그 사이 정산 대상이 ${attending.length}명으로 바뀌었어요. 금액을 확인하고 다시 보내주세요.`);
      }
      const custom = {};
      if (state.mode === 'custom') attending.forEach((p) => { custom[p.id] = num(amountOf(p.id)); });
      const res = await api.settle(id, token, {
        total: form.elements.total.value,
        count: form.elements.count.value,
        mode: state.mode,
        custom,
        accountNo: form.elements.accountNo.value,
        accountHolder: form.elements.accountHolder.value,
      });
      ({ event: e, participants: ps } = res);
      drawSent();
      drawPreview();
      const amount = e.settlement.mode === 'custom' ? '개인별 금액은 링크에서 확인해주세요' : `1인 ${won(perPerson(e.settlement.total, e.settlement.count))}`;
      const text = `[정산 안내] ${e.title}\n${amount} · ${e.settlement.accountNo} (${e.settlement.accountHolder})\n입금 후 링크에서 '입금했어요'를 눌러주세요.`;
      if (navigator.share) {
        navigator.share({ title: e.title, text, url: inviteUrl(id) }).catch(() => {});
      } else {
        copyText(`${text}\n${inviteUrl(id)}`, '정산 안내를 등록하고, 카톡용 문구를 복사했어요');
      }
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      busy = false;
      form.querySelector('.submit').disabled = false;
    }
  });

  drawAmounts();
  drawPreview();
  drawSent();
  if (!attending.length) toast('아직 참석으로 응답한 사람이 없어요', 'err');
}
