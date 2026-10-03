// 안내장 카드 — 만들기 미리보기와 초대장 보기가 같이 쓴다
import { ddayLabel, daysUntil, formatDate, timeRange, won, displayValue } from './calc.js';
import { esc, nl2br, icon } from './ui.js';

export function ddayBadge(date) {
  const n = daysUntil(date);
  return `<span class="dday ${n === 0 ? 'today' : n < 0 ? 'past' : ''}">${ddayLabel(date)}</span>`;
}

// changed: { field: before } — 바뀐 항목은 주황색 + 이전 값 취소선
export function inviteCard(e, { changed = {}, preview = false, actions = '' } = {}) {
  const was = (...fields) => fields.find((f) => f in changed);
  const mark = (...fields) => (was(...fields) ? ' changed' : '');
  const old = (...fields) => {
    const f = was(...fields);
    return f ? `<div class="strike">${esc(displayValue(f, changed[f]))}</div>` : '';
  };
  const tag = (...fields) => (was(...fields) ? '<span class="tag changed-tag">! 변경됨</span>' : '');

  const title = e.title || (preview ? '모임명을 입력해주세요' : '');
  const chips = [
    e.expectedCount ? `<span class="chip${mark('expectedCount')}">${icon('users')}${e.expectedCount}명 예정</span>` : '',
    e.fee ? `<span class="chip${mark('fee')}">${icon('money')}1인 ${won(e.fee)}</span>` : '',
  ].join('');

  return `
    <article class="invite-card${preview ? ' is-preview' : ''}">
      <header class="invite-card-head">
        <div>
          <p class="eyebrow">모임 안내장</p>
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
        ${e.supplies ? `
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
