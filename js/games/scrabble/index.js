// Scrabble game plugin.
//
// Same contract as every game (see js/games/registry.js). Uses the live
// hooks (reportProgress / onRivalUpdate) as the turn transport: each player
// stores only their own move list, and both clients derive the shared board
// from the interleaved lists (see engine.js). rounds: 1 — the whole game is
// one round, submitted when the derived state says the game is over.

import { loadDictionary } from "../wordgrid/dict.js";
import { PREMIUM, deriveState, wordsFormed, scoreWords, sanitizeTiles } from "./engine.js";
import { mountRound as mountRoundUi } from "./ui.js";

export default {
  id: "scrabble",
  name: "Scrabble",
  tagline: "The classic. Real board, real turns, live.",
  rounds: 1,
  roundSeconds: 0, // untimed — the game ends by the scrabble rules
  pitch: "1 board · live turns",
  instantStart: true, // no clock — straight to the board, no splash
  // two words crossing on a premium square
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
    <rect x="2.5" y="9" width="19" height="6" rx="1.6"/>
    <rect x="9" y="2.5" width="6" height="19" rx="1.6"/>
    <rect x="9" y="9" width="6" height="6" fill="currentColor" opacity="0.4" stroke="none"/>
    <path d="M5.5 12 h1 M17.5 12 h1 M12 5.5 v1 M12 17.5 v1" stroke-linecap="round"/>
  </svg>`,
  rules: [
    "Real Scrabble: 15×15 board, 100 tiles, official letter values and premium squares.",
    "The match creator goes first; turns alternate live — leave and come back whenever.",
    "Tap a rack tile, then a square. Play validates every word formed, crosses included.",
    "All 7 tiles in one turn is a 50-point bingo. Swap needs 7+ tiles in the bag.",
    "Game ends when someone plays out with an empty bag, or after six scoreless turns. Leftover racks count against you.",
  ],

  async prepare() {
    return { dictionary: await loadDictionary() };
  },

  // Whose move is it really? The platform's lockstep bookkeeping can't tell
  // mid-round, so it asks. Derived from the same move lists as the board.
  status(match, me) {
    const movesOf = (p) => match.results[p]?.rounds?.[0]?.moves || match.results[p]?.progress?.moves || [];
    const byIdx = match.players.map(movesOf);
    const s = deriveState(match.seed, byIdx[0], byIdx[1]);
    if (s.over) return null; // ending is handled by round submission
    const turnPlayer = match.players[s.turn % 2];
    return turnPlayer === me
      ? { yourTurn: true, label: "Your move" }
      : { yourTurn: false, label: `${turnPlayer}'s move` };
  },

  mountRound(container, { seed, assets, me, players, results, onDone, reportProgress, onRivalUpdate }) {
    return mountRoundUi(container, {
      seed, me, players, results,
      dictionary: assets.dictionary,
      onDone, reportProgress, onRivalUpdate,
    });
  },

  // Final board plus a per-turn ledger with each play's recomputed score.
  renderResults(container, { match, me, rival }) {
    const movesOf = (p) => match.results[p]?.rounds?.[0]?.moves || match.results[p]?.progress?.moves || [];
    const byIdx = match.players.map(movesOf);
    const final = deriveState(match.seed, byIdx[0], byIdx[1]);

    // Replay prefixes to attribute real words and scores to every turn:
    // before turn t, player 0 has made ceil(t/2) moves and player 1 the rest.
    const ledger = [[], []];
    for (let t = 0; ; t++) {
      const p = t % 2;
      const move = byIdx[p][Math.floor(t / 2)];
      if (!move) break;
      let label;
      if (move.type === "play") {
        const before = deriveState(match.seed,
          byIdx[0].slice(0, Math.ceil(t / 2)),
          byIdx[1].slice(0, Math.floor(t / 2)));
        const tiles = sanitizeTiles(before.board, move.tiles);
        const words = wordsFormed(before.board, tiles);
        const names = words.map((w) => w.map((c) => c.letter).join("").toUpperCase());
        label = `${names.join(", ") || "—"} +${scoreWords(words, tiles.length)}`;
      } else {
        label = move.type === "exchange" ? "swapped tiles" : "passed";
      }
      ledger[p].push(label);
    }
    if (final.finalScores) {
      for (const i of [0, 1]) {
        const adj = final.finalScores[i] - final.scores[i];
        if (adj !== 0) ledger[i].push(`rack ${adj > 0 ? "+" : ""}${adj}`);
      }
    }

    const cellHtml = (c, p) => {
      if (!c) {
        const prem = PREMIUM[p];
        return `<span class="sc-cell${prem ? ` is-${prem}` : ""}"></span>`;
      }
      const letter = /^[a-z]$/.test(c.letter) ? c.letter.toUpperCase() : "?";
      return `<span class="sc-cell sc-tile${c.blank ? " is-blank" : ""}">${letter}</span>`;
    };

    const meIdx = match.players.indexOf(me);
    const col = (idx, who, cls) => `
      <div class="result-col ${cls}">
        <h4>${esc(who)} · ${final.finalScores ? final.finalScores[idx] : final.scores[idx]}</h4>
        <ul class="wordlist">${ledger[idx].map((l) => `<li>${esc(l)}</li>`).join("") || "<li>no turns</li>"}</ul>
      </div>`;

    container.innerHTML = `
      <section class="result-round">
        <h3>Final board</h3>
        <div class="sc-board sc-board-mini">${final.board.map(cellHtml).join("")}</div>
        <div class="result-cols">
          ${col(meIdx, me, "is-me")}
          ${col(1 - meIdx, rival, "is-rival")}
        </div>
      </section>`;
  },
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
