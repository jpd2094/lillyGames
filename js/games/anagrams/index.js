// Anagrams game plugin.
//
// Every game on the platform exports this same shape (see js/games/registry.js):
//   id, name, tagline, rounds, roundSeconds
//   prepare()                              -> assets (loaded once, cached)
//   mountRound(container, opts)            -> destroy()   (play one round)
//   renderResults(container, opts)                        (game-specific breakdown)
// The platform owns everything else: users, match lifecycle, storage, winner.

import { wordScore } from "../wordgrid/engine.js";
import { loadDictionary } from "../wordgrid/dict.js";
import { rackForRound } from "./engine.js";
import { solveRack } from "./solver.js";
import { mountRound as mountRoundUi } from "./ui.js";

export default {
  id: "anagrams",
  name: "Anagrams",
  tagline: "Eight letters, every word you can make.",
  rounds: 3,
  roundSeconds: 60,
  // three letter tiles mid-shuffle
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
    <rect x="1.5" y="8" width="7.5" height="7.5" rx="1.8" transform="rotate(-10 5.25 11.75)"/>
    <rect x="8.3" y="8" width="7.5" height="7.5" rx="1.8" transform="rotate(4 12 11.75)"/>
    <rect x="15" y="8" width="7.5" height="7.5" rx="1.8" transform="rotate(12 18.75 11.75)"/>
    <path d="M7 4.5 q5 -3 10 0" stroke-dasharray="2 2" opacity="0.8"/>
    <path d="M15.6 3.2 l1.4 1.3 -1.8 0.9" opacity="0.8"/>
  </svg>`,

  async prepare() {
    return { dictionary: await loadDictionary() };
  },

  mountRound(container, { seed, round, totalRounds, assets, onDone }) {
    return mountRoundUi(container, {
      rack: rackForRound(seed, round),
      roundNum: round,
      totalRounds,
      durationSec: this.roundSeconds,
      dictionary: assets.dictionary,
      onDone,
    });
  },

  // Rich results: per-round word lists side by side, plus the best words
  // on each rack that neither player found.
  renderResults(container, { match, me, rival, assets }) {
    const mine = match.results[me];
    const theirs = match.results[rival];
    const html = [];

    for (let r = 1; r <= match.rounds; r++) {
      const rack = rackForRound(match.seed, r);
      const myWords = wordsMap(mine?.rounds?.[r - 1]?.words);
      const theirWords = wordsMap(theirs?.rounds?.[r - 1]?.words);
      const everyone = new Set([...myWords.keys(), ...theirWords.keys()]);
      const missed = solveRack(rack, assets.dictionary)
        .filter((w) => !everyone.has(w))
        .slice(0, 6);

      html.push(`
        <section class="result-round">
          <h3>Round ${r} · ${rack.map((ch) => ch.toUpperCase()).join(" ")}</h3>
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

// words are stored as {word: score} (Firestore can't nest arrays); accept
// [[word, score]] pairs too for symmetry with wordgrid's legacy format.
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
