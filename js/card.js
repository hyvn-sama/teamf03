// 안내장 카드 — 만들기 미리보기와 초대장 보기가 같이 쓴다
import { ddayLabel, daysUntil, formatDate, timeRange, won, displayValue } from './calc.js';
import { esc, nl2br, icon } from './ui.js';

export function ddayBadge(date) {
  const n = daysUntil(date);
  return `<span class="dday ${n === 0 ? 'today' : n < 0 ? 'past' : ''}">${ddayLabel(date)}</span>`;
}

export const seenPill = ({ seen, total }) =>
  `<button type="button" class="seen-pill" data-act="open-seen" aria-label="변경 안내 확인 현황 보기">${icon('check')}확인 ${seen} / ${total}</button>`;

// 준비물 · 누가 가져오나요? (초대장에서만, supply = supplyStatus 결과)
function supplyBox(supply, cls = '', oldHtml = '') {
  const need = supply.filter((x) => x.needed).length;
  const label = (x) => (x.each ? '각자' : x.bringers.length ? `${x.bringers.length}명` : '담당 없음');
  return `
    <div class="supply-box${cls}">
      ${icon('bag')}
      <div class="supply-main">
        <p class="row-label">준비물 · 누가 가져오나요?</p>
        ${oldHtml}
        <div class="supply-chips">
          ${supply.map((x) => `<span class="supply-chip${x.needed ? ' need' : ''}"><b>${esc(x.name)}</b><small>${label(x)}</small></span>`).join('')}
        </div>
        ${need ? `<p class="need-line">담당자가 필요한 준비물이 ${need}개 있어요</p>` : ''}
      </div>
      <button type="button" class="link-btn" data-act="open-supply">담당 정하기 ${icon('next')}</button>
    </div>`;
}

// changed: { field: before } — 바뀐 항목은 주황색 + 이전 값 취소선
// seen: { seen, total } — 바뀐 항목 옆에 확인 현황 버튼, supply: 준비물 담당 현황
export function inviteCard(e, { changed = {}, preview = false, actions = '', seen = null, supply = null } = {}) {
  const was = (...fields) => fields.find((f) => f in changed);
  const mark = (...fields) => (was(...fields) ? ' changed' : '');
  // 묶음(일정 = 날짜·시작·종료) 안에서 바뀐 항목의 이전 값을 모두 보여줌
  const old = (...fields) => {
    const list = fields.filter((f) => f in changed);
    return list.length ? `<div class="strike">${list.map((f) => esc(displayValue(f, changed[f]))).join(' · ')}</div>` : '';
  };
  const tag = (...fields) => (was(...fields) ? `<span class="tag changed-tag">! 변경됨</span>${seen && seen.total ? seenPill(seen) : ''}` : '');

  const title = e.title || (preview ? '모임명을 입력해주세요' : '');
  const chips = [
    e.expectedCount ? `<span class="chip${mark('expectedCount')}">${icon('users')}${e.expectedCount}명 예정</span>` : '',
    e.fee || 'fee' in changed ? `<span class="chip${mark('fee')}">${icon('money')}1인 ${'fee' in changed ? `<s>${esc(displayValue('fee', changed.fee))}</s> ` : ''}${e.fee ? won(e.fee) : '없음'}</span>` : '',
  ].join('');

  return `
    <article class="invite-card${preview ? ' is-preview' : ''}">
      <header class="invite-card-head">
        <div>
          <p class="eyebrow">모임 안내장</p>
          ${'title' in changed ? `<p class="old-title">${esc(changed.title)}</p>` : ''}
          <h2 class="${e.title ? '' : 'placeholder'}${mark('title')}">${esc(title)}</h2>
        </div>
        ${e.date ? ddayBadge(e.date) : ''}
      </header>
      <div class="invite-card-body">
        <div class="row${mark('date', 'startTime', 'endTime')}">
          ${icon('calendar')}
          <div>
            <p class="row-label">일정 ${tag('date', 'startTime', 'endTime')}</p>
            ${old('date', 'startTime', 'endTime')}
            <p class="row-main">${e.date ? esc(formatDate(e.date)) : '<span class="placeholder">날짜</span>'}</p>
            <p class="row-sub">${e.startTime ? esc(timeRange(e)) : ''}</p>
          </div>
        </div>
        <div class="row${mark('placeName', 'address')}">
          ${icon('pin')}
          <div>
            <p class="row-label">장소 ${tag('placeName', 'address')}</p>
            ${old('placeName', 'address')}
            <p class="row-main">${e.placeName ? esc(e.placeName) : '<span class="placeholder">장소</span>'}</p>
            ${e.address ? `<p class="row-sub">${esc(e.address)}</p>` : ''}
          </div>
        </div>
        ${chips ? `<div class="chips">${chips}</div>` : ''}
        ${supply && supply.length ? supplyBox(supply, mark('supplies'), old('supplies')) : e.supplies ? `
          <div class="row plain${mark('supplies')}">
            ${icon('bag')}
            <div><p class="row-label">준비물 ${tag('supplies')}</p>${old('supplies')}<p>${nl2br(e.supplies)}</p></div>
          </div>` : ''}
        ${e.notes ? `
          <div class="notice${mark('notes')}">
            <p class="notice-title">${icon('alert')}유의사항 ${tag('notes')}</p>
            ${old('notes')}
            <p>${nl2br(e.notes)}</p>
          </div>` : ''}
        ${actions}
      </div>
    </article>`;
}
