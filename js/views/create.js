// 01 안내장 만들기  /  안내장 수정·재공유 (#/e/:id/edit) — 같은 폼을 쓴다
import { api } from '../api.js';
import { addHosted, removeHosted, session } from '../store.js';
import { hostAccess, noHostView, loginHref } from '../access.js';
import { EDIT_FIELDS, FIELD_LABELS, diffEvent, displayValue, todayStr, josa, supplyItems } from '../calc.js';
import { esc, icon, toast, copyText, inviteUrl, shareInvite, pageHead } from '../ui.js';
import { inviteCard } from '../card.js';

const REQUIRED = ['title', 'date', 'startTime', 'placeName'];

const field = (name, label, control, { required = false, wide = false } = {}) => `
  <div class="field${wide ? ' wide' : ''}" data-field="${name}">
    <label for="f-${name}">${label}<span class="tag ${required ? 'req' : 'opt'}">${required ? '필수' : '선택'}</span></label>
    <div>
      ${control}
      <p class="was" hidden></p>
    </div>
  </div>`;

const input = (name, attrs = '') => `<input class="input" id="f-${name}" name="${name}" ${attrs}>`;
const area = (name, ph) => `<textarea class="textarea" id="f-${name}" name="${name}" placeholder="${ph}"></textarea>`;
const unit = (name, u, ph) => `<div class="input-unit"><input class="input" id="f-${name}" name="${name}" type="number" inputmode="numeric" min="0" step="1" placeholder="${ph}"><span>${u}</span></div>`;

function formHTML() {
  return `
    <form class="card card-pad create-form" novalidate>
      <h3 class="form-section">기본 정보</h3>
      ${field('title', '모임명', input('title', 'maxlength="60" placeholder="예) 가을 동아리 모임" autocomplete="off"'), { required: true })}

      <h3 class="form-section">일정</h3>
      ${field('date', '날짜', input('date', `type="date" min="${todayStr()}"`), { required: true })}
      ${field('startTime', '시작 시간', input('startTime', 'type="time"'), { required: true })}
      ${field('endTime', '종료 시간', input('endTime', 'type="time"'))}

      <h3 class="form-section">장소</h3>
      ${field('placeName', '장소명', input('placeName', 'maxlength="80" placeholder="예) 하이브 라운지 3층"'), { required: true })}
      ${field('address', '주소', input('address', 'maxlength="120" placeholder="예) 서울시 강남구 테헤란로 123"'))}

      <div class="two-col">
        <div>
          <h3 class="form-section">인원</h3>
          ${field('expectedCount', '예상 인원', unit('expectedCount', '명', '20'))}
        </div>
        <div>
          <h3 class="form-section">비용</h3>
          ${field('fee', '참가비 (1인)', unit('fee', '원', '16000'))}
        </div>
      </div>

      <h3 class="form-section">상세 안내</h3>
      ${field('supplies', '준비물', area('supplies', '예) 개인 컵, 간단한 간식 (쉼표로 구분)'))}
      ${field('notes', '유의사항', area('notes', '예) 주차 2시간 지원돼요.\n늦으면 단톡방에 미리 알려주세요.'))}

      <h3 class="form-section">주최자 <span class="hint">당일 연락용</span></h3>
      ${field('hostName', '이름', input('hostName', 'maxlength="30" placeholder="예) 김민지" autocomplete="name"'))}
      ${field('hostPhone', '연락처', input('hostPhone', 'type="tel" maxlength="30" placeholder="010-0000-0000" autocomplete="tel"'))}

      <p class="form-error" role="alert"></p>
      <button class="btn primary block submit" type="submit"></button>
    </form>`;
}

function readForm(form) {
  const data = {};
  for (const f of EDIT_FIELDS) data[f] = form.elements[f].value;
  return data;
}

function fillForm(form, e) {
  for (const f of EDIT_FIELDS) form.elements[f].value = e[f] ?? '';
}

function validate(form) {
  let first = null;
  for (const f of REQUIRED) {
    const el = form.elements[f];
    const bad = !el.value.trim();
    el.classList.toggle('invalid', bad);
    if (bad && !first) first = el;
  }
  if (first) {
    first.focus();
    return `${josa(FIELD_LABELS[first.name], '을', '를')} 입력해주세요.`;
  }
  return '';
}

// 숫자 칸은 화면 미리보기용으로만 숫자로 바꾼다 (저장 시 검증은 ops.js)
function previewData(data) {
  return {
    ...data,
    expectedCount: data.expectedCount === '' ? null : Number(data.expectedCount),
    fee: data.fee === '' ? null : Number(data.fee),
  };
}

export async function render(root, { id, query, edit }) {
  let original = null;
  let people = [];
  let token = null;

  // 안내장 만들기는 로그인 필수 (어느 기기에서든 내 알림장에서 관리하려고)
  if (!edit && !session()) {
    location.hash = loginHref(`/create${query.from ? `?from=${query.from}` : ''}`);
    return;
  }

  if (edit) {
    const access = await hostAccess(id);
    if (!access.ok) {
      root.innerHTML = noHostView(id, '안내장은 만든 사람만 수정할 수 있어요.', `/e/${id}/edit`);
      return;
    }
    token = access.token;
    const loaded = await api.get(id, { fresh: true });
    original = loaded.event;
    people = loaded.participants;
  }

  root.innerHTML = `
    ${edit
      ? pageHead({ iconName: 'edit', title: '안내장 수정 · 재공유', sub: `${esc(original.title)} · 바뀐 항목은 주황색으로 표시되고, 공유하면 참석자에게 변경 안내가 떠요.`, back: { href: '#/my', label: '내 알림장으로' } })
      : pageHead({ num: '01', title: '안내장 만들기', sub: '필수 항목만 채워도 안내장이 완성돼요. 입력하면 미리보기에 바로 반영돼요.' })}
    <div class="create-layout">
      ${formHTML()}
      <aside class="create-side">
        ${edit ? `
          <div class="card change-box">
            <div class="change-box-head">${icon('alert')}<span class="change-count">바뀐 항목이 없어요</span></div>
            <div class="change-list"></div>
            <button class="btn primary block save-share" type="button" disabled>수정 저장하고 공유하기</button>
          </div>
          <div class="card card-pad reshare">
            <h3>안내장 다시 공유하기</h3>
            <p class="hint">내용은 그대로 두고 링크만 다시 보내요.</p>
            <div class="link-box"><span>${esc(inviteUrl(id))}</span><button class="btn sm dark copy-link" type="button">링크 복사</button></div>
            <button class="btn block share-again" type="button">카톡으로 다시 공유</button>
          </div>` : `
          <p class="preview-label">PREVIEW</p>
          <div class="preview"></div>
          <p class="hint">선택 항목은 비워두면 안내장에 나타나지 않아요.</p>`}
      </aside>
    </div>
    ${edit ? `
      <section class="card card-pad delete-box">
        <div>
          <h3>안내장 삭제</h3>
          <p class="hint">안내장과 응답${people.length ? ` ${people.length}개` : ''}·정산 기록이 모두 지워지고, 초대 링크도 더 이상 열리지 않아요. 되돌릴 수 없어요.</p>
        </div>
        <button class="btn delete-event" type="button">${icon('alert')}이 안내장 삭제하기</button>
      </section>` : ''}`;

  const form = root.querySelector('form');
  const submit = form.querySelector('.submit');
  const errorEl = form.querySelector('.form-error');
  submit.textContent = edit ? '수정 저장하고 공유하기' : '안내장 만들기';

  if (edit) {
    fillForm(form, original);
  } else if (query.from) {
    // 지난 모임 복제: 날짜만 비우고 나머지 그대로
    try {
      const src = (await api.get(query.from)).event;
      fillForm(form, { ...src, date: '' });
    } catch { /* 원본이 없으면 빈 폼 */ }
  }

  const preview = root.querySelector('.preview');
  const update = () => {
    const data = readForm(form);
    if (preview) preview.innerHTML = inviteCard(previewData(data), { preview: true, actions: '<div class="btn-row"><span class="btn sm">캘린더에 추가</span><span class="btn sm primary">참석할게요</span></div>' });
    if (!edit) return;

    const changes = diffEvent(original, previewData(data));
    const changedFields = new Set(changes.map((c) => c.field));
    form.querySelectorAll('[data-field]').forEach((row) => {
      const f = row.dataset.field;
      const on = changedFields.has(f);
      row.classList.toggle('is-changed', on);
      const was = row.querySelector('.was');
      was.hidden = !on;
      if (on) was.innerHTML = `기존 <span class="strike">${esc(displayValue(f, original[f]))}</span> <button type="button" class="revert" data-revert="${f}">되돌리기</button>`;
    });
    root.querySelector('.change-count').textContent = changes.length ? `${changes.length}개 항목이 변경되었어요` : '바뀐 항목이 없어요';
    root.querySelector('.change-box').classList.toggle('has-changes', changes.length > 0);
    root.querySelector('.change-list').innerHTML = changes.map((c) => `
      <div class="change-item">
        <span class="change-label">${esc(c.label)}</span>
        <div><p class="strike">${esc(displayValue(c.field, c.before))}</p><p class="after">${esc(displayValue(c.field, c.after))}</p></div>
      </div>`).join('');
    root.querySelector('.save-share').disabled = changes.length === 0;

    // 준비물 이름을 바꾸거나 지우면 그 준비물의 담당·'각자' 표시가 사라진다는 걸 미리 알림
    const kept = new Set(supplyItems(data));
    const lost = supplyItems(original).filter((item) => !kept.has(item)
      && ((original.supplyEach || []).includes(item) || people.some((p) => (p.brings || []).includes(item))));
    const warn = form.querySelector('[data-field="supplies"] .was');
    if (lost.length) {
      warn.hidden = false;
      warn.insertAdjacentHTML('beforeend', `<span class="supply-lost">${icon('alert')}${esc(lost.join(', '))}의 담당·'각자' 표시가 사라져요</span>`);
    }
  };

  form.addEventListener('input', (ev) => {
    ev.target.classList.remove('invalid');
    update();
  });
  form.addEventListener('click', (ev) => {
    const f = ev.target.dataset && ev.target.dataset.revert;
    if (!f) return;
    form.elements[f].value = original[f] ?? '';
    update();
  });

  let busy = false;
  const save = async () => {
    if (busy) return;
    errorEl.textContent = validate(form);
    if (errorEl.textContent) return;
    busy = true;
    submit.disabled = true;
    try {
      if (edit) {
        const res = await api.edit(id, token, readForm(form));
        if (!res.changes.length) {
          toast('바뀐 내용이 없어요');
          return;
        }
        toast('수정했어요. 참석자에게 변경 안내가 표시돼요.');
        await shareInvite(res.event, '[변경 안내] ');
        location.hash = `#/e/${id}`;
      } else {
        const res = await api.create(readForm(form));
        addHosted(res.event.id, res.editToken);
        location.hash = `#/e/${res.event.id}?new=1`;
      }
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      busy = false;
      submit.disabled = false;
    }
  };

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    save();
  });

  if (edit) {
    root.querySelector('.save-share').addEventListener('click', save);
    root.querySelector('.copy-link').addEventListener('click', () => copyText(inviteUrl(id), '링크를 복사했어요'));
    root.querySelector('.share-again').addEventListener('click', () => shareInvite(original));
    const delBtn = root.querySelector('.delete-event');
    delBtn.addEventListener('click', async () => {
      const who = people.length ? `\n응답한 ${people.length}명도 더 이상 안내장을 볼 수 없어요.` : '';
      if (!window.confirm(`'${original.title}' 안내장을 삭제할까요?${who}\n삭제하면 되돌릴 수 없어요.`)) return;
      delBtn.disabled = true;
      try {
        await api.remove(id, token);
        removeHosted(id);
        toast('안내장을 삭제했어요');
        location.hash = '#/my';
      } catch (err) {
        toast(err.message, 'err');
        delBtn.disabled = false;
      }
    });
  }

  update();
}
