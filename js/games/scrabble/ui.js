// One Scrabble game: shared board derived from both players' move lists,
// live turn-by-turn play. Tap a rack tile, tap a square. Untimed.
//
// mountRound(container, opts) -> destroy()
//   opts: { seed, me, players, results, onDone, reportProgress, onRivalUpdate }
//   onDone({ score, moves }) — fired when the derived game state says over.

import {
  SIZE, CENTER, PREMIUM, TILE_VALUES,
  deriveState, validateMove, canExchange, wordsFormed,
} from "./engine.js";

const PREMIUM_LABEL = { dl: "DL", tl: "TL", dw: "DW", tw: "TW" };

export function mountRound(container, opts) {
  const { seed, me, players, results, dictionary, onDone, reportProgress, onRivalUpdate } = opts;
  const myIdx = Math.max(0, players.indexOf(me));
  const rival = players[1 - myIdx] || me;

  const movesOf = (entry) => entry?.progress?.moves || entry?.rounds?.[0]?.moves || [];
  const myMoves = movesOf(results?.[me]).slice();
  let rivalMoves = movesOf(results?.[rival]).slice();

  let state = null;
  let pending = []; // {pos, letter, blank}
  let rackView = []; // display order of my remaining tiles
  let selected = -1; // index into rackView
  let swapMode = false;
  let swapSel = new Set();
  let ended = false;
  let lastNote = "";

  container.innerHTML = `
    <div class="round sc">
      <div class="sc-head">
        <div class="sc-side is-me"><b data-my-score>0</b><span>${esc(me)}</span></div>
        <div class="sc-mid"><span class="sc-turn" data-turn></span><span class="sc-bag" data-bag></span></div>
        <div class="sc-side is-rival"><b data-rival-score>0</b><span>${esc(rival)}</span></div>
      </div>
      <p class="sc-note" data-note>&nbsp;</p>
      <div class="sc-board" data-board></div>
      <div class="sc-rack" data-rack></div>
      <div class="sc-actions" data-actions>
        <button class="btn" data-do="swap">Swap</button>
        <button class="btn" data-do="pass">Pass</button>
        <button class="btn" data-do="recall">Recall</button>
        <button class="btn" data-do="shuffle">Mix</button>
        <button class="btn btn-primary" data-do="play">Play</button>
      </div>
      <div class="sc-picker" data-picker hidden>
        <p>This blank becomes…</p>
        <div class="sc-picker-grid">
          ${"abcdefghijklmnopqrstuvwxyz".split("").map((ch) => `<button class="tile sc-pick" data-ch="${ch}">${ch.toUpperCase()}</button>`).join("")}
        </div>
        <button class="btn sc-pick-cancel" data-cancel>Never mind</button>
      </div>
    </div>`;

  const el = (s) => container.querySelector(s);
  const boardEl = el("[data-board]"), rackEl = el("[data-rack]"), noteEl = el("[data-note]");
  const pickerEl = el("[data-picker]");
  let pickerPos = -1;

  // ── Derivation ─────────────────────────────────────────────────────────
  const listsFor = () => (myIdx === 0 ? [myMoves, rivalMoves] : [rivalMoves, myMoves]);

  function reDerive() {
    const [a, b] = listsFor();
    state = deriveState(seed, a, b);
    // If a committed move landed on a square I had staged, unstage — the
    // staged letters are part of the derived rack rebuilt just below.
    if (pending.some((t) => state.board[t.pos])) { pending = []; selected = -1; }
    // Rebuild the rack display: staged (pending) letters stay off the rack,
    // and surviving tiles keep their prior visual order.
    const remaining = [...state.racks[myIdx]];
    for (const t of pending) {
      const i = remaining.indexOf(t.blank ? "?" : t.letter);
      if (i !== -1) remaining.splice(i, 1);
    }
    const kept = [];
    for (const ch of rackView) {
      const i = remaining.indexOf(ch);
      if (i !== -1) { kept.push(ch); remaining.splice(i, 1); }
    }
    rackView = [...kept, ...remaining];
  }

  function myTurn() {
    return !state.over && state.turn % 2 === myIdx;
  }

  // ── Actions ────────────────────────────────────────────────────────────
  function closePicker() {
    pickerEl.hidden = true;
    pickerPos = -1;
  }

  function commit(move) {
    if (ended) return;
    myMoves.push(move);
    pending = [];
    selected = -1;
    swapMode = false;
    swapSel.clear();
    closePicker();
    reDerive();
    reportProgress?.({ moves: myMoves, at: Date.now() });
    render();
    maybeFinish();
  }

  function maybeFinish() {
    if (!state.over || ended) return;
    ended = true;
    onDone({ score: state.finalScores[myIdx], moves: myMoves });
  }

  function place(pos) {
    if (selected < 0 || state.board[pos] || pending.some((t) => t.pos === pos)) return;
    const ch = rackView[selected];
    if (ch === undefined) return;
    if (ch === "?") { pickerPos = pos; pickerEl.hidden = false; return; }
    pending.push({ pos, letter: ch, blank: false });
    rackView.splice(selected, 1);
    selected = -1;
    render();
  }

  function placeBlank(pos, letter) {
    // the picker can outlive its moment (state moved on underneath it) —
    // only act if the selected rack tile is still the blank that opened it
    if (rackView[selected] !== "?" || state.board[pos] || pending.some((t) => t.pos === pos)) {
      closePicker();
      render();
      return;
    }
    pending.push({ pos, letter, blank: true });
    rackView.splice(selected, 1);
    selected = -1;
    closePicker();
    render();
  }

  function recall(rerender = true) {
    for (const t of pending) rackView.push(t.blank ? "?" : t.letter);
    pending = [];
    selected = -1;
    closePicker();
    if (rerender) render();
  }

  function play() {
    if (!myTurn()) return note("Hold on — it's not your turn.");
    const check = validateMove(state, myIdx, pending, dictionary);
    if (!check.ok) return note(check.error, true);
    note(`You played ${check.words.map((w) => w.toUpperCase()).join(", ")} for ${check.score}.`);
    commit({ type: "play", tiles: pending.slice() });
  }

  function pass() {
    if (!myTurn()) return note("Hold on — it's not your turn.");
    if (!confirm("Pass this turn?")) return;
    recall(false);
    note("You passed.");
    commit({ type: "pass" });
  }

  function toggleSwap() {
    if (!myTurn()) return note("Hold on — it's not your turn.");
    if (!swapMode && !canExchange(state)) return note("Swapping needs at least 7 tiles left in the bag.", true);
    recall(false);
    swapMode = !swapMode;
    swapSel.clear();
    note(swapMode ? "Tap the tiles to swap, then Play to confirm." : "");
    render();
  }

  function confirmSwap() {
    const letters = [...swapSel].map((i) => rackView[i]);
    if (!letters.length) return note("Pick at least one tile to swap.", true);
    note(`You swapped ${letters.length} tile${letters.length > 1 ? "s" : ""}.`);
    commit({ type: "exchange", letters });
  }

  function shuffleRack() {
    for (let i = rackView.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rackView[i], rackView[j]] = [rackView[j], rackView[i]];
    }
    selected = -1;
    swapSel.clear(); // index-based selection wouldn't survive the reorder
    render();
  }

  function note(text, isError = false) {
    lastNote = text;
    noteEl.textContent = text || " ";
    noteEl.classList.toggle("is-error", isError);
    if (isError) {
      noteEl.classList.remove("is-shake");
      void noteEl.offsetWidth;
      noteEl.classList.add("is-shake");
    }
  }

  // ── Live updates (rival's moves, and my own from another device) ───────
  onRivalUpdate?.((entry, match) => {
    if (ended) return;
    let changed = false;
    // Scrabble games span days; the same player may move from another
    // device. If my remote move list is ahead of this tab's, adopt it —
    // committing from stale local state would fork the game.
    const remoteMine = movesOf(match?.results?.[me]);
    if (remoteMine.length > myMoves.length) {
      myMoves.length = 0;
      myMoves.push(...remoteMine);
      pending = [];
      selected = -1;
      closePicker();
      note("Caught up with your moves from another device.");
      changed = true;
    }
    const theirs = movesOf(entry);
    if (theirs.length > rivalMoves.length) {
      const newMove = theirs[theirs.length - 1];
      const prevBoard = state.board;
      rivalMoves = theirs.slice();
      reDerive();
      changed = true;
      if (newMove?.type === "play") {
        const words = wordsFormed(prevBoard, (newMove.tiles || []).filter((t) =>
          t && Number.isInteger(t.pos) && /^[a-z]$/.test(t.letter || "")))
          .map((w) => w.map((c) => c.letter).join("").toUpperCase());
        note(`${rival} played ${words.join(", ") || "a word"}.`);
      } else if (newMove?.type === "exchange") {
        note(`${rival} swapped tiles.`);
      } else if (newMove?.type === "pass") {
        note(`${rival} passed.`);
      }
    } else if (changed) {
      reDerive();
    }
    if (changed) {
      render();
      maybeFinish();
    }
  });

  // ── Render ─────────────────────────────────────────────────────────────
  function render() {
    el("[data-my-score]").textContent = state.over ? state.finalScores[myIdx] : state.scores[myIdx];
    el("[data-rival-score]").textContent = state.over ? state.finalScores[1 - myIdx] : state.scores[1 - myIdx];
    el("[data-bag]").textContent = `${state.bagRemaining} in bag`;
    el("[data-turn]").textContent = state.over ? "Game over" : myTurn() ? "Your turn" : `${rival}'s turn`;

    const pendingMap = new Map(pending.map((t) => [t.pos, t]));
    boardEl.innerHTML = Array.from({ length: SIZE * SIZE }, (_, p) => {
      const cell = state.board[p], pend = pendingMap.get(p);
      if (cell || pend) {
        const t = cell || pend;
        // letters flow in from the rival's stored moves — never trust them
        const letter = /^[a-z]$/.test(t.letter) ? t.letter.toUpperCase() : "?";
        const value = t.blank ? 0 : TILE_VALUES[t.letter] || 0;
        return `<button class="sc-cell sc-tile${pend ? " is-pending" : ""}${t.blank ? " is-blank" : ""}" data-pos="${p}">
          ${letter}<i>${value || ""}</i></button>`;
      }
      const prem = PREMIUM[p];
      return `<button class="sc-cell${prem ? ` is-${prem}` : ""}" data-pos="${p}">${p === CENTER ? "★" : prem ? PREMIUM_LABEL[prem] : ""}</button>`;
    }).join("");

    rackEl.innerHTML = rackView.map((ch, i) => `
      <button class="tile sc-rtile${i === selected ? " is-active" : ""}${swapSel.has(i) ? " is-swap" : ""}" data-ri="${i}">
        ${ch === "?" ? "&nbsp;" : ch.toUpperCase()}<i>${TILE_VALUES[ch] || ""}</i>
      </button>`).join("");

    const acts = el("[data-actions]");
    acts.querySelector('[data-do="play"]').textContent = swapMode ? "Swap now" : "Play";
    for (const b of acts.querySelectorAll("button")) {
      b.disabled = state.over || (!myTurn() && b.dataset.do !== "recall" && b.dataset.do !== "shuffle");
    }
  }

  boardEl.addEventListener("click", (e) => {
    const cell = e.target.closest("[data-pos]");
    if (!cell || swapMode || !myTurn() || !pickerEl.hidden) return;
    const p = Number(cell.dataset.pos);
    const pendIdx = pending.findIndex((t) => t.pos === p);
    if (pendIdx !== -1) { // take a pending tile back
      const [t] = pending.splice(pendIdx, 1);
      rackView.push(t.blank ? "?" : t.letter);
      render();
    } else {
      place(p);
    }
  });

  rackEl.addEventListener("click", (e) => {
    const t = e.target.closest("[data-ri]");
    if (!t || !pickerEl.hidden) return;
    const i = Number(t.dataset.ri);
    if (swapMode) {
      swapSel.has(i) ? swapSel.delete(i) : swapSel.add(i);
    } else {
      selected = selected === i ? -1 : i;
    }
    render();
  });

  el("[data-actions]").addEventListener("click", (e) => {
    const b = e.target.closest("[data-do]");
    if (!b || b.disabled) return;
    if (b.dataset.do === "play") swapMode ? confirmSwap() : play();
    else if (b.dataset.do === "pass") pass();
    else if (b.dataset.do === "recall") recall();
    else if (b.dataset.do === "shuffle") shuffleRack();
    else if (b.dataset.do === "swap") toggleSwap();
  });

  pickerEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-cancel]")) {
      closePicker();
      selected = -1;
      render();
      return;
    }
    const b = e.target.closest("[data-ch]");
    if (b && pickerPos >= 0) placeBlank(pickerPos, b.dataset.ch);
  });

  reDerive();
  render();
  maybeFinish(); // the game may already be over (rival made the last move)

  return function destroy() {
    ended = true;
  };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
