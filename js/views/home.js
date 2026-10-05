// 홈 — 첫 화면 (모모: 모두의 모임)
import { icon } from '../ui.js';

const leaf = '<svg class="momo-leaf" viewBox="0 0 40 24" aria-hidden="true"><path d="M3 21C6 8 18 1 37 3 33 16 21 23 3 21z" fill="#5fa35a"/><path d="M5 20C14 14 22 9 33 5" stroke="#3f7d3c" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>';

export function render(root) {
  root.innerHTML = `
    <section class="hero">
      <div class="hero-text">
        <p class="hero-eyebrow">MOMO</p>
        <h1 class="hero-title"><span class="momo-word">${leaf}모모</span><span class="sr-only"> — </span><span class="hero-sub">모두의 모임</span></h1>
        <p class="hero-desc">시간·장소·준비물·유의사항부터 참석 응답, 정산까지<br>카톡 대화를 뒤지지 않고 모모 하나로 끝내요.</p>
        <a class="btn primary hero-cta" href="#/create">${icon('mail')}모임장 만들기</a>
      </div>
      <div class="hero-art" aria-hidden="true"><img src="img/momo-hero.webp" alt=""></div>
    </section>`;
}
