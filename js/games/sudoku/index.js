// Sudoku Race game plugin.
//
// Same contract as every game (see js/games/registry.js), plus three
// optional fields this game introduces: `variants` (per-match difficulty,
// picked on the New match screen and stored on the match), `lowerWins`
// (the platform's winner logic compares times, not points), and
// `formatScore` (totals render as m:ss everywhere the platform shows them).

import { VARIANTS, puzzleForMatch } from "./engine.js";
import { mountRound as mountRoundUi } from "./ui.js";

export default {
  id: "sudoku",
  name: "Sudoku Race",
  tagline: "Same puzzle, two pencils. Fastest clean finish.",
  rounds: 1,
  roundSeconds: 0, // untimed — the clock counts up, lowest time wins
  pitch: "1 puzzle · fastest wins",
  // a 3x3 grid with a diagonal of solved cells
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
    <rect x="2.5" y="2.5" width="19" height="19" rx="2.6"/>
    <path d="M8.8 2.5 v19 M15.2 2.5 v19 M2.5 8.8 h19 M2.5 15.2 h19" stroke-width="1.1" opacity="0.65"/>
    <circle cx="5.6" cy="5.6" r="1.4" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>
    <circle cx="18.4" cy="18.4" r="1.4" fill="currentColor" stroke="none"/>
  </svg>`,
  lowerWins: true,
  variants: VARIANTS.map(({ id, name }) => ({ id, name })),
  rules: [
    "One sudoku, identical for both of you. Fill it correctly — fastest time wins.",
    "The clock starts when you open the puzzle and keeps running even if you leave.",
    "Conflicting digits glow red as you go; the puzzle only completes when it's right.",
    "Race live or on your own schedule — your rival's fill count shows while you play.",
  ],

  formatScore(total) {
    const s = Math.max(0, Number(total) || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  },

  async prepare() {
    return {}; // puzzles are generated, not loaded
  },

  mountRound(container, { seed, me, results, onDone, reportProgress, onRivalUpdate, variant }) {
    return mountRoundUi(container, { seed, variant, me, results, onDone, reportProgress, onRivalUpdate });
  },

  renderResults(container, { match, me, rival }) {
    const timeOf = (p) => this.formatScore(match.results[p]?.total);
    const { solution } = puzzleForMatch(match.seed, match.variant);
    container.innerHTML = `
      <section class="result-round">
        <h3>${esc(variantLabel(match.variant))} puzzle</h3>
        <div class="result-cols">
          <div class="result-col is-me"><h4>${esc(me)}</h4><p class="su-time">${timeOf(me)}</p></div>
          <div class="result-col is-rival"><h4>${esc(rival)}</h4><p class="su-time">${timeOf(rival)}</p></div>
        </div>
        <div class="su-grid su-grid-mini">${solution.map((v) => `<span class="su-cell">${v}</span>`).join("")}</div>
      </section>`;
  },
};

function variantLabel(id) {
  return VARIANTS.find((v) => v.id === id)?.name || "Sudoku";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
