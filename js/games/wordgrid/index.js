// Word Grid game plugin.
//
// Every game on the platform exports this same shape (see js/games/registry.js):
//   id, name, tagline, rounds, roundSeconds
//   prepare()                              -> assets (loaded once, cached)
//   mountRound(container, opts)            -> destroy()   (play one round)
//   renderResults(container, opts)                        (game-specific breakdown)
// The platform owns everything else: users, match lifecycle, storage, winner.

import { gridForRound, wordScore } from "./engine.js";
import { loadDictionary } from "./dict.js";
import { solveGrid } from "./solver.js";
import { mountRound as mountRoundUi } from "./ui.js";

export default {
  id: "wordgrid",
  name: "Word Grid",
  tagline: "Trace words in the tiles. Longer is better.",
  rounds: 3,
  roundSeconds: 60,

  async prepare() {
    return { dictionary: await loadDictionary() };
  },

  mountRound(container, { seed, round, totalRounds, assets, onDone }) {
    return mountRoundUi(container, {
      grid: gridForRound(seed, round),
      roundNum: round,
      totalRounds,
      durationSec: this.roundSeconds,
      dictionary: assets.dictionary,
      onDone,
    });
  },

  // Rich results: per-round word lists side by side, plus the best words
  // on each board that neither player found.
  renderResults(container, { match, me, rival, assets }) {
    const mine = match.results[me];
    const theirs = match.results[rival];
    const html = [];

    for (let r = 1; r <= match.rounds; r++) {
      const grid = gridForRound(match.seed, r);
      const myWords = wordsMap(mine?.rounds?.[r - 1]?.words);
      const theirWords = wordsMap(theirs?.rounds?.[r - 1]?.words);
      const everyone = new Set([...myWords.keys(), ...theirWords.keys()]);
      const missed = solveGrid(grid, assets.dictionary)
        .filter((w) => !everyone.has(w))
        .slice(0, 6);

      html.push(`
        <section class="result-round">
          <h3>Round ${r}</h3>
          <div class="result-cols">
            <div class="result-col is-me">
              <h4>${esc(me)} · ${Number(mine?.rounds?.[r - 1]?.score) || 0}</h4>
              ${wordList(myWords, theirWords)}
            </div>
            <div class="result-col is-rival">
              <h4>${esc(rival)} · ${Number(theirs?.rounds?.[r - 1]?.score) || 0}</h4>
              ${wordList(theirWords, myWords)}
            </div>
          </div>
          ${missed.length ? `
            <p class="result-missed">
              <span>Nobody found</span> ${missed.map((w) => `<em>${esc(w)} (${wordScore(w)})</em>`).join(" ")}
            </p>` : ""}
        </section>`);
    }
    container.innerHTML = html.join("");
  },
};

// words are stored as {word: score} (Firestore can't nest arrays); older
// local-mode matches stored [[word, score]] pairs — accept both.
function wordsMap(v) {
  return new Map(Array.isArray(v) ? v : Object.entries(v || {}));
}

function wordList(words, otherWords) {
  if (!words.size) return `<p class="result-none">no words</p>`;
  const sorted = [...words.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return `<ul class="wordlist">${sorted
    .map(([w, pts]) => `<li${otherWords.has(w) ? "" : ` class="is-unique"`}>${esc(w)}<i>${Number(pts) || 0}</i></li>`)
    .join("")}</ul>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
