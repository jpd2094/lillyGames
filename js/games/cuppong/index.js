// Cup Pong game plugin.
//
// Both players face an identical 10-cup rack and clear it solo, GamePigeon
// style: flick to throw, pure skill, no randomness. Fewest throws wins the
// match; total time breaks ties (score = throws*10000 + seconds, lowest
// wins). The clock is the tiebreak, so the splash stays — no surprise start.

import { decodeScore } from "./engine.js";
import { mountRound as mountRoundUi } from "./ui.js";

export default {
  id: "cuppong",
  name: "Cup Pong",
  tagline: "Ten cups, one flick at a time. Fewest throws takes it.",
  rounds: 1,
  roundSeconds: 0, // count-up clock; it only breaks ties
  pitch: "10 cups · fewest throws",
  lowerWins: true,
  // a rack of three cups and an incoming ball
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 10.5 h5 l-0.9 6.5 h-3.2 z"/>
    <path d="M15 10.5 h5 l-0.9 6.5 h-3.2 z"/>
    <path d="M9.5 3.5 h5 l-0.9 6.5 h-3.2 z"/>
    <circle cx="12" cy="20.2" r="1.7" fill="currentColor" stroke="none"/>
  </svg>`,
  rules: [
    "Ten cups each, same rack. Drag from the ball and flick up to throw.",
    "Flick length is power, flick angle is aim. Sink every cup.",
    "Fewest total throws wins the match; total time breaks ties.",
    "The clock counts up from your first look and keeps running even if you leave.",
  ],

  formatScore(total) {
    const { throws, seconds } = decodeScore(total);
    return `${throws} throws · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  },

  async prepare() {
    return {}; // nothing to load — it's all drawn
  },

  mountRound(container, { me, results, onDone, reportProgress, onRivalUpdate }) {
    return mountRoundUi(container, { me, results, onDone, reportProgress, onRivalUpdate });
  },

  renderResults(container, { match, me, rival }) {
    const stat = (p) => {
      const { throws, seconds } = decodeScore(match.results[p]?.total);
      const acc = throws ? Math.round((10 / throws) * 100) : 0;
      return `<p class="su-time">${throws} throws</p>
        <p class="wd-stat">${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} · ${acc}% accuracy</p>`;
    };
    container.innerHTML = `
      <section class="result-round">
        <h3>The rack</h3>
        <div class="result-cols">
          <div class="result-col is-me"><h4>${esc(me)}</h4>${stat(me)}</div>
          <div class="result-col is-rival"><h4>${esc(rival)}</h4>${stat(rival)}</div>
        </div>
      </section>`;
  },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
