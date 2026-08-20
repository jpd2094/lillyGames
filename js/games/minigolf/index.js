// Mini Golf game plugin.
//
// Three hand-built holes (each proven finishable under par by the engine's
// solver, in tests). Both players play the same course solo; fewest total
// strokes wins, total time breaks ties. The clock is the tiebreak, so the
// pre-round splash stays.

import { HOLES, decode } from "./engine.js";
import { mountRound as mountRoundUi } from "./ui.js";

export default {
  id: "minigolf",
  name: "Mini Golf",
  tagline: "Three holes, one putter. Fewest strokes takes it.",
  rounds: 1,
  roundSeconds: 0, // count-up clock; it only breaks ties
  pitch: `${HOLES.length} holes · fewest strokes`,
  lowerWins: true,
  // a flag in the cup
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <ellipse cx="12" cy="19" rx="7.5" ry="2.6"/>
    <path d="M12 19 V4.5"/>
    <path d="M12 4.5 l7 2.6 -7 2.6 z" fill="currentColor" stroke="none"/>
    <circle cx="6.4" cy="18.4" r="1.4" fill="currentColor" stroke="none"/>
  </svg>`,
  rules: [
    `${HOLES.length} holes, same course for both of you. Pull back from the ball and release to putt.`,
    "Walls bounce, sand slows, water costs a stroke. Roll in gently — the cup lips out fast balls.",
    "Fewest total strokes wins the match; total time breaks ties. Eight strokes on a hole and you pick up.",
    "The clock counts up from your first look and keeps running even if you leave.",
  ],

  formatScore(total) {
    const { strokes, seconds } = decode(total);
    return `${strokes} strokes · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  },

  async prepare() {
    return {}; // the course is code
  },

  mountRound(container, { me, results, onDone, reportProgress, onRivalUpdate }) {
    return mountRoundUi(container, { me, results, onDone, reportProgress, onRivalUpdate });
  },

  // The classic scorecard: hole-by-hole strokes vs par for both players.
  renderResults(container, { match, me, rival }) {
    const holesOf = (p) => {
      const r = match.results[p]?.rounds?.[0];
      return Array.isArray(r?.holes) ? r.holes.map((n) => Number(n) || 0) : [];
    };
    const mine = holesOf(me), theirs = holesOf(rival);
    const cell = (v, par) => v === undefined ? "<td>—</td>"
      : `<td class="${v < par ? "is-plus" : v > par ? "is-minus" : ""}">${v}</td>`;
    container.innerHTML = `
      <section class="result-round">
        <h3>Scorecard</h3>
        <table class="bj-ledger">
          <thead>
            <tr><th></th>${HOLES.map((_, i) => `<th>H${i + 1}</th>`).join("")}<th>Total</th></tr>
            <tr><th>Par</th>${HOLES.map((h) => `<th>${h.par}</th>`).join("")}<th>${HOLES.reduce((a, h) => a + h.par, 0)}</th></tr>
          </thead>
          <tbody>
            <tr><td class="is-me-th">${esc(me)}</td>${HOLES.map((h, i) => cell(mine[i], h.par)).join("")}<td>${mine.reduce((a, b) => a + b, 0) || "—"}</td></tr>
            <tr><td class="is-rival-th">${esc(rival)}</td>${HOLES.map((h, i) => cell(theirs[i], h.par)).join("")}<td>${theirs.reduce((a, b) => a + b, 0) || "—"}</td></tr>
          </tbody>
        </table>
        <p class="wd-stat">${esc(me)}: ${this.formatScore(match.results[me]?.total)} · ${esc(rival)}: ${this.formatScore(match.results[rival]?.total)}</p>
      </section>`;
  },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
