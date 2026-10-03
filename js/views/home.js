// 홈 — 첫 화면
import { icon } from '../ui.js';

export function render(root) {
  root.innerHTML = `
    <section class="hero">
      <span class="hero-mark" aria-hidden="true"></span>
      <p class="hero-eyebrow">MOIM · ALLIMJANG</p>
      <h1 class="hero-title">링크 하나<span>모임 알림장</span></h1>
      <p class="hero-desc">시간·장소·준비물·유의사항부터 참석 응답, 정산까지<br>카톡 대화를 뒤지지 않고 링크 하나로 끝내요.</p>
      <a class="btn primary hero-cta" href="#/create">${icon('mail')}모임장 만들기</a>
    </section>`;
}
