// One Sudoku Race: same puzzle for both players, wall-clock timer, first
// correct finish sets your time — lowest time wins the match.
//
// mountRound(container, opts) -> destroy()
//   opts: { seed, variant, me, results, onDone, reportProgress, onRivalUpdate }
//   onDone({ score }) — score is elapsed seconds (game declares lowerWins).
//
// The clock is wall-clock, anchored to the first time this player opened
// the puzzle (persisted via progress), so refreshing or leaving doesn't
// reset — or pause — the race. Filled cells persist the same way.

import { puzzleForMatch, conflicts, isSolved, PEERS } from "./engine.js";

export function mountRound(container, opts) {
  const { seed, variant, me, results, onDone, reportProgress, onRivalUpdate } = opts;
  const { givens, solution } = puzzleForMatch(seed, variant);

  // Restore my run (refresh mid-race) or start the clock now.
  const prior = results?.[me]?.progress;
  const startedAt = Number(prior?.startedAt) || Date.now();
  let grid = restoreCells(prior?.cells) || [...givens];
  let notes = restoreNotes(prior?.notes); // 81 Sets of pencilled candidates
  let selected = -1;
  let penMode = false;
  let ended = false;

  container.innerHTML = `
    <div class="round su">
      <div class="round-top">
        <span class="round-chip">${esc(variantName(variant))}</span>
        <span class="round-clock su-clock" data-clock>0:00</span>
        <span class="su-fill" data-fill></span>
      </div>
      <div class="su-rival" data-rival hidden></div>
      <div class="su-grid" data-grid></div>
      <div class="su-pad" data-pad>
        <button class="btn su-key su-key-pen" data-pen aria-label="Pencil marks" title="Pencil marks">✎</button>
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="btn su-key" data-n="${n}">${n}</button>`).join("")}
        <button class="btn su-key" data-n="0" aria-label="Erase">⌫</button>
      </div>
    </div>`;

  const el = (s) => container.querySelector(s);
  const gridEl = el("[data-grid]"), clockEl = el("[data-clock]");
  const fillEl = el("[data-fill]"), rivalEl = el("[data-rival]");

  const elapsedSec = () => Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const timer = setInterval(() => { clockEl.textContent = fmt(elapsedSec()); }, 250);
  clockEl.textContent = fmt(elapsedSec());

  const report = () => reportProgress?.({
    startedAt, cells: grid.join(""), notes: encodeNotes(notes), at: Date.now(),
  });
  report();

  onRivalUpdate?.((entry) => {
    if (ended) return;
    const finished = entry?.rounds?.filter(Boolean)?.length;
    if (finished) {
      rivalEl.hidden = false;
      rivalEl.textContent = `Rival finished in ${fmt(Number(entry.total) || 0)} — beat it!`;
      return;
    }
    const cells = restoreCells(entry?.progress?.cells);
    if (cells) {
      const filled = cells.filter(Boolean).length;
      rivalEl.hidden = false;
      rivalEl.textContent = `Rival: ${filled}/81 cells`;
    }
  });

  function setCell(n) {
    if (ended || selected < 0 || givens[selected] !== 0) return;
    if (penMode && grid[selected] === 0) {
      // pencil marks: toggle a small candidate; erase clears them all
      if (n === 0) notes[selected].clear();
      else notes[selected].has(n) ? notes[selected].delete(n) : notes[selected].add(n);
      report();
      render();
      return;
    }
    grid[selected] = n;
    notes[selected].clear(); // a real digit replaces the cell's pencilling
    // ...and rules that candidate out for every row/col/box neighbour
    if (n) for (const p of PEERS[selected]) notes[p].delete(n);
    report();
    render();
    if (grid.every(Boolean) && isSolved(grid, solution)) finish();
  }

  function finish() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    onDone({ score: elapsedSec() });
  }

  function render() {
    const bad = conflicts(grid);
    const selVal = selected >= 0 ? grid[selected] : 0;
    gridEl.innerHTML = grid.map((v, i) => {
      const cls = ["su-cell"];
      if (givens[i]) cls.push("is-given");
      if (i === selected) cls.push("is-selected");
      else if (selVal && v === selVal) cls.push("is-same");
      if (bad.has(i)) cls.push("is-bad");
      // empty cell with pencil marks: tiny candidates in their 3x3 slots
      const body = v || (notes[i].size
        ? `<span class="su-notes">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<i>${notes[i].has(d) ? d : ""}</i>`).join("")}</span>`
        : "");
      return `<button class="${cls.join(" ")}" data-i="${i}">${body}</button>`;
    }).join("");
    fillEl.textContent = `${grid.filter(Boolean).length}/81`;
    el("[data-pen]").classList.toggle("is-active", penMode);
  }

  gridEl.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-i]");
    if (!cell || ended) return;
    selected = Number(cell.dataset.i);
    render();
  });

  el("[data-pad]").addEventListener("click", (e) => {
    if (e.target.closest("[data-pen]")) {
      penMode = !penMode;
      render();
      return;
    }
    const key = e.target.closest("[data-n]");
    if (key) setCell(Number(key.dataset.n));
  });

  function onKeyDown(e) {
    if (ended) return;
    if (/^[1-9]$/.test(e.key)) setCell(Number(e.key));
    else if (e.key === "p" || e.key === "n") { penMode = !penMode; render(); }
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") setCell(0);
    else if (e.key.startsWith("Arrow") && selected >= 0) {
      const d = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key];
      const next = selected + d;
      if (next >= 0 && next < 81) { selected = next; render(); e.preventDefault(); }
    }
  }
  document.addEventListener("keydown", onKeyDown);

  render();
  // a refresh right at the finish line still counts
  if (grid.every(Boolean) && isSolved(grid, solution)) finish();

  return function destroy() {
    ended = true;
    clearInterval(timer);
    document.removeEventListener("keydown", onKeyDown);
  };
}

function restoreCells(cells) {
  if (typeof cells !== "string" || cells.length !== 81 || !/^[0-9]{81}$/.test(cells)) return null;
  return [...cells].map(Number);
}

// Pencil marks travel as "236||89|…" — 81 digit-runs joined by "|".
function encodeNotes(notes) {
  return notes.map((s) => [...s].sort().join("")).join("|");
}

function restoreNotes(encoded) {
  const parts = typeof encoded === "string" && /^[1-9]{0,9}(\|[1-9]{0,9}){80}$/.test(encoded)
    ? encoded.split("|") : null;
  return Array.from({ length: 81 }, (_, i) => new Set(parts ? [...parts[i]].map(Number) : []));
}

function variantName(id) {
  return { easy: "Easy", medium: "Medium", hard: "Hard" }[id] || "Sudoku";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
