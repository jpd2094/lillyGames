// One playable round of Word Grid: renders the board, handles finger/mouse
// tracing, validates words, keeps score, runs the clock.
//
// mountRound(container, opts) -> destroy()
//   opts: { grid, roundNum, totalRounds, durationSec, dictionary, onDone }
//   onDone({ score, words: {word: score, ...} })
//   (words is a plain object, not entries — Firestore rejects nested arrays)

import { SIZE, isAdjacent, wordScore, pathToWord } from "./engine.js";

export function mountRound(container, opts) {
  const { grid, roundNum, totalRounds, durationSec, dictionary, onDone } = opts;

  const found = new Map(); // word -> score
  let score = 0;
  let path = [];
  let tracing = false;
  let ended = false;
  let tileRects = null;

  container.innerHTML = `
    <div class="round">
      <div class="round-top">
        <span class="round-chip">Round ${roundNum}<i>/${totalRounds}</i></span>
        <span class="round-score" data-score>0</span>
        <span class="round-clock" data-clock>${fmt(durationSec)}</span>
      </div>
      <div class="timebar"><div class="timebar-fill" data-timebar></div></div>
      <div class="tracer" data-tracer>&nbsp;</div>
      <div class="board" data-board>
        <svg class="board-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <polyline data-line points=""></polyline>
        </svg>
        ${grid.map((cell, i) => `
          <button class="tile" data-idx="${i}" aria-label="${cell}">
            <span>${cell === "qu" ? "Qu" : cell.toUpperCase()}</span>
          </button>`).join("")}
      </div>
      <div class="found" data-found>
        <span class="found-empty">Trace neighboring tiles to spell a word — 3 letters or more.</span>
      </div>
    </div>`;

  const boardEl = container.querySelector("[data-board]");
  const lineEl = container.querySelector("[data-line]");
  const tracerEl = container.querySelector("[data-tracer]");
  const scoreEl = container.querySelector("[data-score]");
  const clockEl = container.querySelector("[data-clock]");
  const timebarEl = container.querySelector("[data-timebar]");
  const foundEl = container.querySelector("[data-found]");
  const tiles = [...container.querySelectorAll(".tile")];

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

  function finish() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    clearPath();
    boardEl.classList.add("is-done");
    onDone({ score, words: Object.fromEntries(found) });
  }

  // ── Tracing ────────────────────────────────────────────────────────────
  // Hit-test against tile centers with a radius, not raw element bounds:
  // fingers are imprecise, and requiring the touch to be near a tile's
  // center prevents accidentally clipping a diagonal neighbor in passing.
  function hitTile(x, y) {
    if (!tileRects) tileRects = tiles.map((t) => t.getBoundingClientRect());
    for (let i = 0; i < tileRects.length; i++) {
      const r = tileRects[i];
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const radius = r.width * 0.42;
      if (Math.abs(x - cx) < radius && Math.abs(y - cy) < radius) return i;
    }
    return -1;
  }

  function drawPath() {
    tiles.forEach((t, i) => t.classList.toggle("is-active", path.includes(i)));
    lineEl.setAttribute("points", path.map((i) => {
      const r = Math.floor(i / SIZE), c = i % SIZE;
      return `${((c + 0.5) / SIZE) * 100},${((r + 0.5) / SIZE) * 100}`;
    }).join(" "));
    const word = pathToWord(grid, path);
    tracerEl.textContent = word ? word.toUpperCase() : " ";
    tracerEl.className = "tracer" + (word.length >= 3 && dictionary.has(word) && !found.has(word) ? " is-valid" : "");
  }

  function clearPath() {
    path = [];
    tracing = false;
    drawPath();
  }

  function extendTo(idx) {
    if (idx < 0) return;
    const last = path[path.length - 1];
    if (idx === last) return;
    if (path.length > 1 && idx === path[path.length - 2]) {
      path.pop(); // sliding back onto the previous tile undoes a step
    } else if (last === undefined || (isAdjacent(last, idx) && !path.includes(idx))) {
      path.push(idx);
    } else {
      return;
    }
    drawPath();
  }

  function submit() {
    const word = pathToWord(grid, path);
    if (word.length >= 3) {
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
        flash(boardEl, "is-shake");
      }
    }
    clearPath();
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

  function onPointerDown(e) {
    if (ended) return;
    e.preventDefault();
    tileRects = null; // layout may have shifted (rotation, scroll)
    tracing = true;
    boardEl.setPointerCapture?.(e.pointerId);
    extendTo(hitTile(e.clientX, e.clientY));
  }

  function onPointerMove(e) {
    if (!tracing || ended) return;
    extendTo(hitTile(e.clientX, e.clientY));
  }

  function onPointerUp() {
    if (!tracing || ended) return;
    tracing = false;
    submit();
  }

  boardEl.addEventListener("pointerdown", onPointerDown);
  boardEl.addEventListener("pointermove", onPointerMove);
  boardEl.addEventListener("pointerup", onPointerUp);
  boardEl.addEventListener("pointercancel", clearPath);

  return function destroy() {
    ended = true;
    clearInterval(timer);
  };
}
