// One Wordle Duel round: same secret for both players, six guesses, a
// count-up clock. Fewer guesses wins the round; time breaks ties.
//
// mountRound(container, opts) -> destroy()
//   opts: { seed, round, totalRounds, me, results, dictionary,
//           onDone, reportProgress, onRivalUpdate }
//   onDone({ score, guesses, seconds })  — score = guesses*10000 + seconds

import {
  WORD_LEN, MAX_GUESSES, FAIL_GUESSES, wordForRound, scoreGuess, encodeScore, decodeScore,
} from "./engine.js";

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "\nzxcvbnm<"]; // \n = Enter, < = backspace

export function mountRound(container, opts) {
  const { seed, round, totalRounds, me, results, dictionary, onDone, reportProgress, onRivalUpdate } = opts;
  const secret = wordForRound(seed, round);

  // Restore this round's run after a refresh; the clock never restarts.
  const prior = results?.[me]?.progress;
  const restored = Number(prior?.round) === round;
  const startedAt = restored && Number(prior.startedAt) ? Number(prior.startedAt) : Date.now();
  let guesses = restored && Array.isArray(prior.guesses)
    ? prior.guesses.filter((g) => typeof g === "string" && /^[a-z]{5}$/.test(g)).slice(0, MAX_GUESSES)
    : [];
  let current = "";
  let ended = false;

  container.innerHTML = `
    <div class="round wd">
      <div class="round-top">
        <span class="round-chip">Round ${round}<i>/${totalRounds}</i></span>
        <span class="round-clock su-clock" data-clock>0:00</span>
        <span class="su-fill" data-tries></span>
      </div>
      <div class="su-rival" data-rival hidden></div>
      <p class="sc-note" data-note>&nbsp;</p>
      <div class="wd-board" data-board></div>
      <div class="wd-keys" data-keys>
        ${KEY_ROWS.map((row) => `<div class="wd-krow">${[...row].map((k) =>
          k === "\n" ? `<button class="wd-key wd-key-wide" data-k="enter">Enter</button>`
          : k === "<" ? `<button class="wd-key wd-key-wide" data-k="back">⌫</button>`
          : `<button class="wd-key" data-k="${k}">${k.toUpperCase()}</button>`).join("")}</div>`).join("")}
      </div>
    </div>`;

  const el = (s) => container.querySelector(s);
  const boardEl = el("[data-board]"), noteEl = el("[data-note]");
  const clockEl = el("[data-clock]"), triesEl = el("[data-tries]"), rivalEl = el("[data-rival]");

  const elapsedSec = () => Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const timer = setInterval(() => { clockEl.textContent = fmt(elapsedSec()); }, 250);
  clockEl.textContent = fmt(elapsedSec());

  const report = () => reportProgress?.({ round, startedAt, guesses: guesses.slice(), at: Date.now() });
  report();

  onRivalUpdate?.((entry) => {
    if (ended) return;
    const finished = entry?.rounds?.filter(Boolean)?.length || 0;
    if (finished >= totalRounds) {
      const { guesses: g, seconds } = decodeScore(entry.total);
      rivalEl.hidden = false;
      rivalEl.textContent = `Rival finished: ${g} guesses · ${fmt(seconds)} — beat it!`;
      return;
    }
    const p = entry?.progress;
    if (Number(p?.round) >= 1) {
      rivalEl.hidden = false;
      rivalEl.textContent = `Rival: round ${Number(p.round)}, guess ${(Array.isArray(p.guesses) ? p.guesses.length : 0) + 1}`;
    }
  });

  function note(text, isError = false) {
    noteEl.textContent = text || " ";
    noteEl.classList.toggle("is-error", isError);
    if (isError) {
      noteEl.classList.remove("is-shake");
      void noteEl.offsetWidth;
      noteEl.classList.add("is-shake");
    }
  }

  function finish(solved) {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    const seconds = elapsedSec();
    const count = solved ? guesses.length : FAIL_GUESSES;
    note(solved
      ? `Got it in ${guesses.length} — banking the round.`
      : `Out of guesses — it was ${secret.toUpperCase()}.`);
    render();
    // let the reveal land before the platform swaps the view
    setTimeout(() => onDone({
      score: encodeScore(count, seconds), guesses: count, seconds, guessWords: guesses.slice(),
    }), solved ? 900 : 1800);
  }

  function submit() {
    if (ended || current.length !== WORD_LEN) {
      if (current.length !== WORD_LEN) note("Five letters first.", true);
      return;
    }
    if (!dictionary.has(current)) {
      note(`"${current.toUpperCase()}" isn't a word.`, true);
      return;
    }
    guesses.push(current);
    const solved = current === secret;
    current = "";
    report();
    render();
    if (solved) return finish(true);
    if (guesses.length >= MAX_GUESSES) return finish(false);
    note(" ");
  }

  function type(ch) {
    if (ended || current.length >= WORD_LEN) return;
    current += ch;
    render();
  }

  function back() {
    if (ended) return;
    current = current.slice(0, -1);
    render();
  }

  // best mark per letter for keyboard coloring: g beats y beats x
  function keyMarks() {
    const rank = { g: 3, y: 2, x: 1 };
    const best = {};
    for (const g of guesses) {
      const marks = scoreGuess(g, secret);
      for (let i = 0; i < WORD_LEN; i++) {
        if ((rank[marks[i]] || 0) > (rank[best[g[i]]] || 0)) best[g[i]] = marks[i];
      }
    }
    return best;
  }

  function render() {
    const rows = [];
    for (let r = 0; r < MAX_GUESSES; r++) {
      const word = guesses[r] ?? (r === guesses.length ? current : "");
      const marks = guesses[r] ? scoreGuess(guesses[r], secret) : null;
      rows.push(`<div class="wd-row">${Array.from({ length: WORD_LEN }, (_, i) => {
        const ch = word[i] || "";
        const cls = marks ? ` is-${marks[i]}` : ch ? " is-typed" : "";
        return `<span class="wd-cell${cls}">${ch.toUpperCase()}</span>`;
      }).join("")}</div>`);
    }
    boardEl.innerHTML = rows.join("");
    triesEl.textContent = `${guesses.length}/${MAX_GUESSES}`;
    const best = keyMarks();
    for (const key of container.querySelectorAll(".wd-key")) {
      const k = key.dataset.k;
      key.className = `wd-key${k.length > 1 ? " wd-key-wide" : ""}${best[k] ? ` is-${best[k]}` : ""}`;
    }
  }

  el("[data-keys]").addEventListener("click", (e) => {
    const key = e.target.closest("[data-k]");
    if (!key) return;
    if (key.dataset.k === "enter") submit();
    else if (key.dataset.k === "back") back();
    else type(key.dataset.k);
  });

  function onKeyDown(e) {
    if (e.metaKey || e.ctrlKey) return;
    if (/^[a-zA-Z]$/.test(e.key)) type(e.key.toLowerCase());
    else if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "Backspace") { e.preventDefault(); back(); }
  }
  document.addEventListener("keydown", onKeyDown);

  render();

  return function destroy() {
    ended = true;
    clearInterval(timer);
    document.removeEventListener("keydown", onKeyDown);
  };
}
