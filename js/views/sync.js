// 다른 기기에서 만든 옮기기 링크(#/sync?d=...)를 열었을 때 — 확인 후 이 기기의 내 알림장으로 가져온다
import { api } from '../api.js';
import { unpackSync } from '../sync.js';
import { hostToken, addHosted, myself, setMyself } from '../store.js';
import { esc, icon, toast, pageHead, errorView } from '../ui.js';

export async function render(root, { query, isStale }) {
  let data;
  try {
    data = unpackSync(query.d);
  } catch (err) {
    root.innerHTML = errorView(err.message, { href: '#/my', label: '내 알림장으로' });
    return;
  }
  // 토큰이 담긴 주소가 화면·방문 기록에 남지 않게 지운다 (데이터는 이 화면이 들고 있음)
  history.replaceState(null, '', '#/sync');

  const total = data.hosted.length + data.joined.length;
  if (!total) {
    root.innerHTML = errorView('옮길 모임이 없는 링크예요.', { href: '#/my', label: '내 알림장으로' });
    return;
  }

  const titleOf = async (id) => {
    try {
      return (await api.get(id)).event.title;
    } catch {
      return null; // 지워졌거나 이 기기(체험 모드)에서 볼 수 없는 안내장
    }
  };
  const [hostedTitles, joinedTitles] = await Promise.all([
    Promise.all(data.hosted.map((h) => titleOf(h.id))),
    Promise.all(data.joined.map((j) => titleOf(j.id))),
  ]);
  if (isStale()) return;

  const row = (title, tag) => `<li>${title ? esc(title) : '<span class="hint">(불러올 수 없는 안내장)</span>'}<span class="tag ${tag === '주최' ? 'req' : 'opt'}">${tag}</span></li>`;

  root.innerHTML = `
    ${pageHead({ iconName: 'list', title: '내 알림장 가져오기', sub: '다른 기기에서 만든 옮기기 링크예요.', back: { href: '#/my', label: '내 알림장으로' } })}
    <section class="card card-pad sync-card">
      <p class="sync-warn">${icon('alert')}<span><b>본인 기기에서만 여세요.</b> 이 링크로 가져오면 안내장 수정·정산과 내 응답 변경을 할 수 있어요. 다른 사람에게 받은 링크라면 가져오지 마세요.</span></p>
      <h2 class="sync-title">가져올 모임 ${total}개</h2>
      <ul class="sync-list">
        ${data.hosted.map((h, i) => row(hostedTitles[i], '주최')).join('')}
        ${data.joined.map((j, i) => row(joinedTitles[i], '참여')).join('')}
      </ul>
      <div class="btn-row">
        <a class="btn" href="#/my">가져오지 않기</a>
        <button class="btn primary" data-act="import">${icon('check')}이 기기로 가져오기</button>
      </div>
    </section>`;

  root.querySelector('[data-act="import"]').addEventListener('click', () => {
    let added = 0;
    // 목록 맨 앞에 쌓이므로 거꾸로 넣어 원래 순서를 지킨다
    [...data.hosted].reverse().forEach((h) => {
      if (hostToken(h.id) !== h.token) added++;
      addHosted(h.id, h.token);
    });
    data.joined.forEach((j) => {
      // 이 기기에서 이미 응답한 모임은 이 기기의 기록을 그대로 둔다
      const mine = myself(j.id);
      if (mine && mine.token) return;
      setMyself(j.id, j.pid, j.token);
      added++;
    });
    toast(added ? `모임 ${added}개를 가져왔어요` : '이미 모두 있는 모임이에요');
    location.hash = '#/my';
  });
}
