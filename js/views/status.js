// 03 참석 현황 (주최자) — 응답 자동 집계, 참석·정산 상태 변경
import { api } from '../api.js';
import { hostToken } from '../store.js';
import { countRsvp, settleSummary, settleCountMismatch, won } from '../calc.js';
import { esc, icon, toast, pageHead, errorView, RSVP_LABEL, SETTLE_LABEL, SETTLE_ICON } from '../ui.js';

const POLL_MS = 15000;

function stat(kind, label, n, active) {
  return `<div class="stat card ${kind}${active ? ' active' : ''}"><p><i></i>${label}</p><b class="serif">${n}</b><span>명</span></div>`;
}

// 참석자는 미정산 / 정산 완료(정산 등록 후) / 정산 제외 중에서 고름 (주최자 본인 등은 '정산 제외')
function settleCell(p, settled) {
  if (p.rsvp !== 'yes') {
    return `<span class="pill excluded" title="참석자만 정산 대상이에요">${icon(SETTLE_ICON.excluded)}${SETTLE_LABEL.excluded}</span>`;
  }
  const opts = ['unpaid', 'done', 'excluded'].map((v) => {
    const disabled = v === 'done' && !settled && p.settle !== 'done';
    return `<option value="${v}"${p.settle === v ? ' selected' : ''}${disabled ? ' disabled' : ''}>${SETTLE_LABEL[v]}${disabled ? ' (정산 등록 후)' : ''}</option>`;
  }).join('');
  return `
    <label class="sr-only" for="s-${esc(p.id)}">${esc(p.name)} 정산 상태</label>
    <select id="s-${esc(p.id)}" class="settle-select ${p.settle}" data-settle>${opts}</select>`;
}

function row(p, settled) {
  return `
    <tr data-pid="${esc(p.id)}">
      <td>
        <span class="avatar ${p.rsvp}">${esc(p.name.slice(-2, -1) || p.name[0])}</span>
        <span class="who">${esc(p.name)}
          ${p.rsvp === 'yes' && p.late ? `<span class="late-chip">${icon('clock')}${p.late.minutes}분 늦어요</span>` : ''}
          ${p.rsvp === 'yes' && p.brings && p.brings.length ? `<small>${esc(p.brings.join(', '))} 담당</small>` : ''}
        </span>
      </td>
      <td>
        <label class="sr-only" for="r-${esc(p.id)}">${esc(p.name)} 참석 여부</label>
        <select id="r-${esc(p.id)}" class="rsvp-select ${p.rsvp}" data-rsvp>
          ${['yes', 'maybe', 'no'].map((r) => `<option value="${r}"${p.rsvp === r ? ' selected' : ''}>${RSVP_LABEL[r]}</option>`).join('')}
        </select>
      </td>
      <td>${settleCell(p, settled)}</td>
    </tr>`;
}

export async function render(root, { id, isStale }) {
  const token = hostToken(id);
  if (!token) {
    root.innerHTML = errorView('참석 현황은 안내장을 만든 주최자만 볼 수 있어요.', { href: `#/e/${id}`, label: '안내장 보기' });
    return;
  }
  let data = await api.get(id);
  let busy = false;
  let gen = 0; // 내가 바꾼 횟수 — 진행 중이던 주기 새로고침 결과(옛 데이터)는 버림

  const draw = () => {
    const { event: e, participants: ps } = data;
    const c = countRsvp(ps);
    const s = settleSummary(ps, e.settlement);
    const mismatch = settleCountMismatch(ps, e.settlement);
    root.innerHTML = `
      <div class="status-top">
        <div>${pageHead({ num: '03', title: '참석 현황', sub: `${esc(e.title)}${e.fee ? ` · 1인 ${won(e.fee)}` : ''}`, back: { href: `#/e/${id}`, label: `${e.title} 초대장으로` } })}</div>
        <a class="btn primary" href="#/e/${id}/settle">${icon('money')}${e.settlement ? '정산 수정' : '정산 등록'}</a>
      </div>
      <div class="stats">
        ${stat('total', '전체 응답', c.total, true)}
        ${stat('yes', '참석', c.yes)}
        ${stat('maybe', '미정', c.maybe)}
        ${stat('no', '불참', c.no)}
      </div>
      <p class="settle-line">
        정산 대상 <b>${s.targets}명</b>
        <span class="ok">정산 완료 <b>${s.done}명</b></span>
        <span class="due">미정산 <b>${s.unpaid}명</b>${e.settlement && s.remaining ? ` · ${won(s.remaining)} 남음` : ''}</span>
        <span class="hint">주최자 본인처럼 돈을 내지 않는 참석자는 '정산 제외'로 바꿔주세요</span>
      </p>
      ${mismatch ? `
        <div class="notice mismatch">
          <p class="notice-title">${icon('alert')}정산 인원이 바뀌었어요</p>
          <p>정산을 등록할 때는 <b>${mismatch.registered}명</b>이었는데 지금 정산 대상은 <b>${mismatch.current}명</b>이에요. 1인당 금액이 맞지 않을 수 있으니 정산을 다시 등록해주세요.</p>
          <a class="btn sm primary" href="#/e/${id}/settle">정산 다시 등록하기</a>
        </div>` : ''}
      ${ps.length ? `
        <div class="card table-wrap">
          <table class="status-table">
            <thead><tr><th>참가자</th><th>참석 여부</th><th>정산 상태</th></tr></thead>
            <tbody>${ps.map((p) => row(p, !!e.settlement)).join('')}</tbody>
          </table>
        </div>` : `
        <div class="empty card">
          ${icon('users', 'big')}
          <p>아직 응답한 사람이 없어요.<br><span class="hint">초대장 링크를 공유하면 응답이 여기에 자동으로 모여요.</span></p>
          <a class="btn primary" href="#/e/${id}?new=1">${icon('share')}링크 공유하기</a>
        </div>`}`;
  };

  const update = async (pid, patch, done) => {
    if (busy) return;
    busy = true;
    gen++;
    try {
      data = await api.host(id, token, pid, patch);
      toast(done);
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      busy = false;
      draw();
    }
  };

  const onChange = (ev) => {
    const t = ev.target;
    const tr = t.closest('tr');
    if (!tr) return;
    const p = data.participants.find((x) => x.id === tr.dataset.pid);
    if (t.matches('[data-rsvp]')) update(p.id, { rsvp: t.value }, `${p.name} 님을 ${RSVP_LABEL[t.value]}으로 바꿨어요`);
    if (t.matches('[data-settle]')) update(p.id, { settle: t.value }, `${p.name} 님을 ${SETTLE_LABEL[t.value]}로 표시했어요`);
  };
  root.addEventListener('change', onChange);
  draw();

  const timer = setInterval(async () => {
    if (busy || isStale() || document.hidden || document.activeElement?.matches('select')) return;
    const startGen = gen;
    try {
      const fresh = await api.get(id);
      if (startGen !== gen || busy || isStale()) return;
      data = fresh;
      draw();
    } catch { /* 다음 주기에 다시 */ }
  }, POLL_MS);

  return () => {
    clearInterval(timer);
    root.removeEventListener('change', onChange);
  };
}
