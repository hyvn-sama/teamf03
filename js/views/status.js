// 03 참석 현황 (주최자) — 응답 자동 집계, 참석·정산 상태 변경
import { api } from '../api.js';
import { hostToken } from '../store.js';
import { countRsvp, settleSummary, won } from '../calc.js';
import { esc, icon, toast, pageHead, errorView, RSVP_LABEL, SETTLE_LABEL, SETTLE_ICON } from '../ui.js';

const POLL_MS = 15000;

function stat(kind, label, n, active) {
  return `<div class="stat card ${kind}${active ? ' active' : ''}"><p><i></i>${label}</p><b class="serif">${n}</b><span>명</span></div>`;
}

function row(p) {
  const canToggle = p.settle !== 'excluded';
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
      <td>
        <button class="pill ${p.settle}" data-settle ${canToggle ? '' : 'disabled'} title="${canToggle ? '눌러서 완료 ↔ 미정산' : '참석자만 정산 대상이에요'}">
          ${icon(SETTLE_ICON[p.settle])}${SETTLE_LABEL[p.settle]}
        </button>
      </td>
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

  const draw = () => {
    const { event: e, participants: ps } = data;
    const c = countRsvp(ps);
    const s = settleSummary(ps, e.settlement);
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
        <span class="hint">정산 상태를 누르면 완료 ↔ 미정산이 바뀌어요</span>
      </p>
      ${ps.length ? `
        <div class="card table-wrap">
          <table class="status-table">
            <thead><tr><th>참가자</th><th>참석 여부</th><th>정산 상태</th></tr></thead>
            <tbody>${ps.map(row).join('')}</tbody>
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
    if (!ev.target.matches('[data-rsvp]')) return;
    const pid = ev.target.closest('tr').dataset.pid;
    update(pid, { rsvp: ev.target.value }, `${RSVP_LABEL[ev.target.value]}으로 바꿨어요`);
  };
  const onClick = (ev) => {
    const btn = ev.target.closest('[data-settle]');
    if (!btn || btn.disabled) return;
    const pid = btn.closest('tr').dataset.pid;
    const p = data.participants.find((x) => x.id === pid);
    const next = p.settle === 'done' ? 'unpaid' : 'done';
    update(pid, { settle: next }, `${p.name} 님을 ${SETTLE_LABEL[next]}로 표시했어요`);
  };
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  draw();

  const timer = setInterval(async () => {
    if (busy || isStale() || document.hidden || document.activeElement?.matches('select')) return;
    try {
      data = await api.get(id);
      if (!isStale()) draw();
    } catch { /* 다음 주기에 다시 */ }
  }, POLL_MS);

  return () => {
    clearInterval(timer);
    root.removeEventListener('change', onChange);
    root.removeEventListener('click', onClick);
  };
}
