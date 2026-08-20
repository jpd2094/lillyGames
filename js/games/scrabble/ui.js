// One Scrabble game: shared board derived from both players' move lists,
// live turn-by-turn play. Tap a rack tile, tap a square. Untimed.
//
// mountRound(container, opts) -> destroy()
//   opts: { seed, me, players, results, onDone, reportProgress, onRivalUpdate }
//   onDone({ score, moves }) — fired when the derived game state says over.

import {
  SIZE, CENTER, PREMIUM, TILE_VALUES, RACK_SIZE,
  deriveState, validateMove, canExchange, wordsFormed, scoreWords,
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
        <a class="back" href="#/" aria-label="Back to home">&larr;</a>
        <div class="sc-side is-me"><b data-my-score>0</b><span>${esc(me)}</span></div>
        <div class="sc-mid"><span class="sc-turn" data-turn></span><span class="sc-bag" data-bag></span></div>
        <div class="sc-side is-rival"><b data-rival-score>0</b><span>${esc(rival)}</span></div>
      </div>
      <p class="sc-note" data-note>&nbsp;</p>
      <div class="sc-viewport" data-viewport>
        <div class="sc-board" data-board></div>
      </div>
      <p class="sc-preview" data-preview>&nbsp;</p>
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
  const viewportEl = el("[data-viewport]"), previewEl = el("[data-preview]");
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

  function place(pos, ri = selected) {
    if (ri < 0) return;
    if (state.board[pos] || pending.some((t) => t.pos === pos)) {
      note("That square is taken.", true);
      render(); // clears any drag styling from a rejected drop
      return;
    }
    const ch = rackView[ri];
    if (ch === undefined) return;
    if (ch === "?") {
      selected = ri; // placeBlank's staleness guard keys off the selection
      pickerPos = pos;
      pickerEl.hidden = false;
      render();
      return;
    }
    pending.push({ pos, letter: ch, blank: false });
    rackView.splice(ri, 1);
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

  // ── Zoom & pan (pinch, trackpad pinch / ctrl+wheel, double-tap) ────────
  const zoom = { s: 1, tx: 0, ty: 0 };

  function applyZoom() {
    const limit = viewportEl.clientWidth * (zoom.s - 1);
    zoom.tx = Math.min(0, Math.max(-limit, zoom.tx));
    zoom.ty = Math.min(0, Math.max(-limit, zoom.ty));
    boardEl.style.transform = `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.s})`;
  }

  // rescale around a fixed viewport point so the spot under your fingers stays put
  function setScale(s, cx, cy) {
    s = Math.min(2.5, Math.max(1, s));
    const k = s / zoom.s;
    zoom.tx = cx - k * (cx - zoom.tx);
    zoom.ty = cy - k * (cy - zoom.ty);
    zoom.s = s;
    if (s === 1) { zoom.tx = 0; zoom.ty = 0; }
    applyZoom();
  }

  function viewportPoint(e) {
    const r = viewportEl.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  viewportEl.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // trackpad pinch arrives as ctrl+wheel
    e.preventDefault();
    const [cx, cy] = viewportPoint(e);
    setScale(zoom.s * (e.deltaY < 0 ? 1.12 : 0.89), cx, cy);
  }, { passive: false });

  // ── Dragging tiles + touch pan/pinch ───────────────────────────────────
  const pointers = new Map(); // pointerId -> {x, y}
  let pinch = null; // {dist, s}
  let pan = null;   // {x, y, tx, ty}
  let drag = null;  // {kind: "rack"|"pending", ri?, pos?, letter, blank, startX, startY, active, ghost}
  let suppressClick = false;
  let lastTap = { t: 0, x: 0, y: 0 };

  function makeGhost(letter, blank) {
    const g = document.createElement("div");
    g.className = "sc-ghost" + (blank ? " is-blank" : "");
    g.textContent = blank && letter === "?" ? "" : letter.toUpperCase();
    document.body.appendChild(g);
    return g;
  }

  function startDragMaybe(e, info) {
    if (!myTurn() || swapMode || !pickerEl.hidden || state.over) return;
    drag = { ...info, startX: e.clientX, startY: e.clientY, active: false, ghost: null };
  }

  function dropTarget(e) {
    // the ghost floats ~35px above the finger so it isn't hidden under it —
    // drop where the ghost visually sits, not where the finger is
    const hit = document.elementFromPoint(e.clientX, e.clientY - 35);
    const cell = hit?.closest?.("[data-pos]");
    return cell && boardEl.contains(cell) ? Number(cell.dataset.pos) : null;
  }

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    suppressClick = false;
    if (pointers.size === 2) {
      // second finger: whatever was in flight becomes a pinch
      if (drag?.ghost) drag.ghost.remove();
      drag = null;
      pan = null;
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), s: zoom.s };
      return;
    }
    const rackTile = e.target.closest?.(".sc-rtile");
    const boardCell = e.target.closest?.("[data-pos]");
    if (rackTile && rackEl.contains(rackTile)) {
      const ri = Number(rackTile.dataset.ri);
      startDragMaybe(e, { kind: "rack", ri, letter: rackView[ri], blank: rackView[ri] === "?" });
    } else if (boardCell && boardEl.contains(boardCell)) {
      const p = Number(boardCell.dataset.pos);
      const pend = pending.find((t) => t.pos === p);
      if (pend) startDragMaybe(e, { kind: "pending", pos: p, letter: pend.letter, blank: pend.blank });
      else if (zoom.s > 1) pan = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty };
    }
  }

  function onPointerMove(e) {
    const pt = pointers.get(e.pointerId);
    if (!pt) return;
    pt.x = e.clientX;
    pt.y = e.clientY;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = viewportEl.getBoundingClientRect();
      setScale(pinch.s * (dist / pinch.dist), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      return;
    }
    if (drag) {
      if (!drag.active && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 8) {
        drag.active = true;
        drag.ghost = makeGhost(drag.letter, drag.blank);
        if (drag.kind === "rack") rackEl.querySelector(`[data-ri="${drag.ri}"]`)?.classList.add("is-dragging");
        else boardEl.querySelector(`[data-pos="${drag.pos}"]`)?.classList.add("is-dragging");
      }
      if (drag.active) {
        drag.ghost.style.left = `${e.clientX}px`;
        drag.ghost.style.top = `${e.clientY}px`;
      }
      return;
    }
    if (pan) {
      zoom.tx = pan.tx + (e.clientX - pan.x);
      zoom.ty = pan.ty + (e.clientY - pan.y);
      applyZoom();
    }
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag) {
      const d = drag;
      drag = null;
      if (d.active) {
        d.ghost?.remove();
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
        const target = dropTarget(e);
        if (d.kind === "rack") {
          if (target !== null) place(target, d.ri);
          render(); // rejected or not, drag styling must clear
        } else {
          const pend = pending.find((t) => t.pos === d.pos);
          if (pend && target !== null && target !== d.pos &&
              (state.board[target] || pending.some((t) => t.pos === target))) {
            note("That square is taken.", true); // stays where it was
          } else if (pend && target !== null && !state.board[target] && !pending.some((t) => t.pos === target)) {
            pend.pos = target; // slide the staged tile to a new square
          } else if (pend && target === null) {
            pending = pending.filter((t) => t !== pend); // dropped off-board: back to the rack
            rackView.push(pend.blank ? "?" : pend.letter);
          }
          render();
        }
        return;
      }
    }
    if (pan) { pan = null; return; }
    // double-tap on the board toggles zoom — but a tap while a rack tile is
    // selected is a placement, never a zoom gesture
    if (selected >= 0) { lastTap = { t: 0, x: 0, y: 0 }; return; }
    const onBoard = e.target.closest?.("[data-pos]");
    if (onBoard && boardEl.contains(onBoard)) {
      const now = Date.now();
      if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        const r = viewportEl.getBoundingClientRect();
        setScale(zoom.s > 1 ? 1 : 2, e.clientX - r.left, e.clientY - r.top);
        lastTap = { t: 0, x: 0, y: 0 };
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  }

  viewportEl.addEventListener("pointerdown", onPointerDown);
  rackEl.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

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
    // Invariant: one tile per square, whatever path tried to break it —
    // a stacked pending tile would render hidden, so bounce it to the rack.
    const taken = new Set(state.board.map((c, i) => (c ? i : -1)).filter((i) => i >= 0));
    pending = pending.filter((t) => {
      if (taken.has(t.pos)) {
        rackView.push(t.blank ? "?" : t.letter);
        return false;
      }
      taken.add(t.pos);
      return true;
    });

    el("[data-my-score]").textContent = state.over ? state.finalScores[myIdx] : state.scores[myIdx];
    el("[data-rival-score]").textContent = state.over ? state.finalScores[1 - myIdx] : state.scores[1 - myIdx];
    el("[data-bag]").textContent = `${state.bagRemaining} in bag`;
    el("[data-turn]").textContent = state.over ? "Game over" : myTurn() ? "Your turn" : `${rival}'s turn`;

    // Live feedback: the moment the staged tiles form a fully legal play,
    // tint every word it makes and show the score it would bank.
    let goodCells = null;
    previewEl.textContent = " ";
    if (pending.length && myTurn()) {
      const v = validateMove(state, myIdx, pending, dictionary);
      if (v.ok) {
        const words = wordsFormed(state.board, pending);
        goodCells = new Set(words.flat().map((c) => c.pos));
        const parts = words.map((w) => `${w.map((c) => c.letter).join("").toUpperCase()} ${scoreWords([w], 0)}`);
        previewEl.textContent =
          `${parts.join(" · ")}${pending.length === RACK_SIZE ? " · bingo +50" : ""} — ${v.score} pts`;
      }
    }

    const pendingMap = new Map(pending.map((t) => [t.pos, t]));
    boardEl.innerHTML = Array.from({ length: SIZE * SIZE }, (_, p) => {
      const cell = state.board[p], pend = pendingMap.get(p);
      const good = goodCells?.has(p) ? " is-inword" : "";
      if (cell || pend) {
        const t = cell || pend;
        // letters flow in from the rival's stored moves — never trust them
        const letter = /^[a-z]$/.test(t.letter) ? t.letter.toUpperCase() : "?";
        const value = t.blank ? 0 : TILE_VALUES[t.letter] || 0;
        return `<button class="sc-cell sc-tile${pend ? " is-pending" : ""}${t.blank ? " is-blank" : ""}${good}" data-pos="${p}">
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
    if (!cell || swapMode || !myTurn() || !pickerEl.hidden || suppressClick) return;
    const p = Number(cell.dataset.pos);
    const pendIdx = pending.findIndex((t) => t.pos === p);
    if (pendIdx !== -1 && selected < 0) { // take a pending tile back
      const [t] = pending.splice(pendIdx, 1);
      rackView.push(t.blank ? "?" : t.letter);
      render();
    } else {
      place(p); // occupied squares reject with a "square taken" note
    }
  });

  rackEl.addEventListener("click", (e) => {
    const t = e.target.closest("[data-ri]");
    if (!t || !pickerEl.hidden || suppressClick) return;
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
    drag?.ghost?.remove();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
  };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
