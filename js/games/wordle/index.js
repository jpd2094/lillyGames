// Wordle Duel game plugin.
//
// Three rounds, one shared secret word per round. Round score encodes
// guesses-then-time (see engine.js); the match total therefore compares
// total guesses first and total time as the tiebreak — lowest wins.

import { loadDictionary } from "../wordgrid/dict.js";
import { MAX_GUESSES, wordForRound, scoreGuess, decodeScore } from "./engine.js";
import { mountRound as mountRoundUi } from "./ui.js";

export default {
  id: "wordle",
  name: "Wordle Duel",
  tagline: "Same secret word. Who cracks it in fewer guesses?",
  rounds: 3,
  roundSeconds: 0, // untimed — the clock counts up and only breaks ties
  pitch: "3 rounds · fewest guesses",
  lowerWins: true,
  // a guess row: two greens, a yellow, two blanks
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
    <rect x="1.6" y="9.2" width="4.6" height="4.6" rx="1.1" fill="currentColor" opacity="0.9" stroke="none"/>
    <rect x="6.9" y="9.2" width="4.6" height="4.6" rx="1.1" fill="currentColor" opacity="0.45" stroke="none"/>
    <rect x="12.2" y="9.2" width="4.6" height="4.6" rx="1.1" fill="currentColor" opacity="0.9" stroke="none"/>
    <rect x="17.5" y="9.2" width="4.6" height="4.6" rx="1.1"/>
    <rect x="1.6" y="15.4" width="4.6" height="4.6" rx="1.1"/>
    <rect x="6.9" y="15.4" width="4.6" height="4.6" rx="1.1"/>
    <rect x="1.6" y="3" width="4.6" height="4.6" rx="1.1" opacity="0.5"/>
    <rect x="6.9" y="3" width="4.6" height="4.6" rx="1.1" opacity="0.5"/>
  </svg>`,
  rules: [
    "Same secret five-letter word for both of you, three rounds of it.",
    "Six guesses. Green is the right spot, gold is the right letter elsewhere.",
    "Fewest total guesses across the rounds wins; total time breaks ties. Missing a word costs seven.",
    "The clock counts up from your first look and keeps running even if you leave.",
  ],

  formatScore(total) {
    const { guesses, seconds } = decodeScore(total);
    return `${guesses}g · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  },

  async prepare() {
    return { dictionary: await loadDictionary() };
  },

  mountRound(container, { seed, round, totalRounds, assets, me, results, onDone, reportProgress, onRivalUpdate }) {
    return mountRoundUi(container, {
      seed, round, totalRounds, me, results,
      dictionary: assets.dictionary,
      onDone, reportProgress, onRivalUpdate,
    });
  },

  // Side-by-side colored boards per round, secret revealed.
  renderResults(container, { match, me, rival }) {
    const html = [];
    for (let r = 1; r <= match.rounds; r++) {
      const secret = wordForRound(match.seed, r);
      const board = (p) => {
        const round = match.results[p]?.rounds?.[r - 1];
        const words = Array.isArray(round?.guessWords) ? round.guessWords : null;
        const { guesses, seconds } = decodeScore(round?.score);
        const grid = words ? words.filter((w) => /^[a-z]{5}$/.test(w)).map((w) => {
          const marks = scoreGuess(w, secret);
          return `<div class="wd-row wd-row-mini">${[...w].map((ch, i) =>
            `<span class="wd-cell is-${marks[i]}">${ch.toUpperCase()}</span>`).join("")}</div>`;
        }).join("") : "";
        return `<p class="wd-stat">${guesses > MAX_GUESSES ? "didn't get it" : `${guesses} guess${guesses === 1 ? "" : "es"}`}
          · ${this.formatScore(round?.score).split("· ")[1] || ""}</p>${grid}`;
      };
      html.push(`
        <section class="result-round">
          <h3>Round ${r} · ${secret.toUpperCase()}</h3>
          <div class="result-cols">
            <div class="result-col is-me"><h4>${esc(me)}</h4>${board(me)}</div>
            <div class="result-col is-rival"><h4>${esc(rival)}</h4>${board(rival)}</div>
          </div>
        </section>`);
    }
    container.innerHTML = html.join("");
  },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
