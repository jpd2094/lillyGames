// One playable round of Anagrams: renders the rack, handles tapping and
// typing, validates words, keeps score, runs the clock.
//
// mountRound(container, opts) -> destroy()
//   opts: { rack, roundNum, totalRounds, durationSec, dictionary, onDone }
//   onDone({ score, words: {word: score, ...} })
//   (words is a plain object, not entries — Firestore rejects nested arrays)

import { wordScore } from "../wordgrid/engine.js";

export function mountRound(container, opts) {
  const { rack, roundNum, totalRounds, durationSec, dictionary, onDone } = opts;

  const found = new Map(); // word -> score
  let score = 0;
  let picked = []; // rack indices, in the order tapped/typed
  let ended = false;

  container.innerHTML = `
    <div class="round">
      <div class="round-top">
        <span class="round-chip">Round ${roundNum}<i>/${totalRounds}</i></span>
        <span class="round-score" data-score>0</span>
        <span class="round-clock" data-clock>${fmt(durationSec)}</span>
      </div>
      <div class="timebar"><div class="timebar-fill" data-timebar></div></div>
      <div class="tracer" data-tracer>&nbsp;</div>
      <div class="rack" data-rack>
        ${rack.map((ch, i) => `
          <button class="tile rack-tile" data-idx="${i}" aria-label="${ch}">
            <span>${ch.toUpperCase()}</span>
          </button>`).join("")}
      </div>
      <div class="rack-actions">
        <button class="btn" data-shuffle>Shuffle</button>
        <button class="btn" data-clear>Clear</button>
        <button class="btn btn-primary" data-submit>Enter</button>
      </div>
      <div class="found" data-found>
        <span class="found-empty">Tap letters (or type) to build a word — 3 letters or more, each tile once.</span>
      </div>
    </div>`;

  const rackEl = container.querySelector("[data-rack]");
  const tracerEl = container.querySelector("[data-tracer]");
  const scoreEl = container.querySelector("[data-score]");
  const clockEl = container.querySelector("[data-clock]");
  const timebarEl = container.querySelector("[data-timebar]");
  const foundEl = container.querySelector("[data-found]");
  const tiles = [...container.querySelectorAll(".rack-tile")];

  // ── Clock ──────────────────────────────────────────────────────────────
  const endsAt = Date.now() + durationSec * 1000;
  const timer = setInterval(() => {
    const left = Math.max(0, endsAt - Date.now());
    clockEl.textContent = fmt(Math.ceil(left / 1000));
    timebarEl.style.width = `${(left / (durationSec * 1000)) * 100}%`;
    if (left <= 10_000) timebarEl.classList.add("is-low");
    if (left <= 0) finish();
  }, 250);

  function fmt(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // Also detach the document-level key handler here: on a naturally finished
  // round the platform never calls destroy(), and a listener left on
  // `document` would pin this round's detached DOM in memory for good.
  function finish() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    document.removeEventListener("keydown", onKeyDown);
    clearWord();
    rackEl.classList.add("is-done");
    onDone({ score, words: Object.fromEntries(found) });
  }

  // ── Building a word ────────────────────────────────────────────────────
  function currentWord() {
    return picked.map((i) => rack[i]).join("");
  }

  function draw() {
    tiles.forEach((t, i) => t.classList.toggle("is-active", picked.includes(i)));
    const word = currentWord();
    tracerEl.textContent = word ? word.toUpperCase() : " ";
    tracerEl.className = "tracer" + (word.length >= 3 && dictionary.has(word) && !found.has(word) ? " is-valid" : "");
  }

  function clearWord() {
    picked = [];
    draw();
  }

  // Tapping an unused tile appends it; tapping a picked tile takes it (and
  // anything typed after it) back — the natural "undo" on a touch screen.
  function toggleTile(idx) {
    const at = picked.indexOf(idx);
    if (at === -1) picked.push(idx);
    else picked.splice(at);
    draw();
  }

  // Typing: use the first unpicked tile carrying that letter.
  function typeLetter(ch) {
    const idx = rack.findIndex((c, i) => c === ch && !picked.includes(i));
    if (idx !== -1) { picked.push(idx); draw(); }
  }

  function submit() {
    const word = currentWord();
    if (word.length < 3) return; // a stray Enter shouldn't wipe picked tiles
    if (found.has(word)) {
      flash(tracerEl, "is-dupe");
    } else if (dictionary.has(word)) {
      const pts = wordScore(word);
      found.set(word, pts);
      score += pts;
      scoreEl.textContent = score;
      flash(scoreEl, "is-pop");
      addChip(word, pts);
    } else {
      flash(rackEl, "is-shake");
    }
    clearWord();
  }

  // Reorder the on-screen tiles without touching indices already picked —
  // sometimes the word only jumps out after a stir.
  function shuffle() {
    const order = tiles.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    order.forEach((idx) => rackEl.appendChild(tiles[idx]));
  }

  function addChip(word, pts) {
    const empty = foundEl.querySelector(".found-empty");
    if (empty) empty.remove();
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `${word}<i>${pts}</i>`;
    foundEl.prepend(chip);
  }

  function flash(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  rackEl.addEventListener("click", (e) => {
    if (ended) return;
    const tile = e.target.closest(".rack-tile");
    if (tile) toggleTile(Number(tile.dataset.idx));
  });
  container.querySelector("[data-shuffle]").addEventListener("click", () => { if (!ended) shuffle(); });
  container.querySelector("[data-clear]").addEventListener("click", () => { if (!ended) clearWord(); });
  container.querySelector("[data-submit]").addEventListener("click", () => { if (!ended) submit(); });

  function onKeyDown(e) {
    if (ended) return;
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    else if (e.key === "Backspace") { e.preventDefault(); picked.pop(); draw(); }
    else if (e.key === "Escape") clearWord();
    else if (/^[a-zA-Z]$/.test(e.key)) typeLetter(e.key.toLowerCase());
  }
  document.addEventListener("keydown", onKeyDown);

  return function destroy() {
    ended = true;
    clearInterval(timer);
    document.removeEventListener("keydown", onKeyDown);
  };
}
