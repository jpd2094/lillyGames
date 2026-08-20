// Scrabble engine: official board, tiles, placement rules, scoring, and the
// full game state derived from both players' move lists. Everything here is
// pure — no DOM, no storage.
//
// Shared-board-without-shared-writes: each player persists only their own
// move list (the platform's per-player results rule). Both clients derive
// the identical board/racks/scores by replaying the interleaved move lists
// against the seeded bag: turn i belongs to players[i % 2], player 0 is the
// match creator and moves first.
//
// A move is one of:
//   { type: "play", tiles: [{ pos, letter, blank }] }   letter = chosen a–z
//   { type: "exchange", letters: ["a", "?"] }           scoreless
//   { type: "pass" }                                    scoreless

import { makeRng } from "../wordgrid/engine.js";

export const SIZE = 15;
export const CENTER = 7 * SIZE + 7;
export const RACK_SIZE = 7;
export const BINGO_BONUS = 50;

// Official letter values; "?" is a blank.
export const TILE_VALUES = {
  a: 1, b: 3, c: 3, d: 2, e: 1, f: 4, g: 2, h: 4, i: 1, j: 8, k: 5, l: 1, m: 3,
  n: 1, o: 1, p: 3, q: 10, r: 1, s: 1, t: 1, u: 1, v: 4, w: 4, x: 8, y: 4, z: 10,
  "?": 0,
};

// Official 100-tile distribution.
export const TILE_DIST = {
  a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1, l: 4, m: 2,
  n: 6, o: 8, p: 2, q: 1, r: 6, s: 4, t: 6, u: 4, v: 2, w: 2, x: 1, y: 2, z: 1,
  "?": 2,
};

// Standard premium layout: seed points from one octant, expanded through
// all 8 board symmetries (the official board is fully dihedral-symmetric).
// Official counts: 8 TW, 17 DW (incl. center), 12 TL, 24 DL.
export const PREMIUM = (() => {
  const grid = Array(SIZE * SIZE).fill(null);
  const M = SIZE - 1;
  const put = (r, c, kind) => {
    for (const [rr, cc] of [
      [r, c], [c, r], [M - r, M - c], [M - c, M - r],
      [r, M - c], [M - r, c], [c, M - r], [M - c, r],
    ]) grid[rr * SIZE + cc] = kind;
  };
  [[0, 0], [0, 7]].forEach(([r, c]) => put(r, c, "tw"));
  [[1, 1], [2, 2], [3, 3], [4, 4], [7, 7]].forEach(([r, c]) => put(r, c, "dw"));
  [[1, 5], [5, 5]].forEach(([r, c]) => put(r, c, "tl"));
  [[0, 3], [2, 6], [3, 7], [6, 6]].forEach(([r, c]) => put(r, c, "dl"));
  return grid;
})();

// The standard two-letter words (TWL). The app dictionary starts at 3
// letters, and twos are load-bearing in scrabble, so they're baked in here.
export const TWO_LETTER_WORDS = new Set(
  ("aa ab ad ae ag ah ai al am an ar as at aw ax ay ba be bi bo by de do ed ef eh el em en er es et ex fa fe " +
   "go ha he hi hm ho id if in is it jo ka ki la li lo ma me mi mm mo mu my na ne no nu od oe of oh oi om on " +
   "op or os ow ox oy pa pe pi qi re sh si so ta ti to uh um un up us ut we wo xi xu ya ye yo za").split(" ")
);

export function isWord(word, dictionary) {
  return word.length === 2 ? TWO_LETTER_WORDS.has(word) : dictionary.has(word);
}

export function bagForMatch(matchSeed) {
  const rng = makeRng(`${matchSeed}#scrabble#bag`);
  const bag = [];
  for (const [letter, count] of Object.entries(TILE_DIST)) {
    for (let i = 0; i < count; i++) bag.push(letter);
  }
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

const row = (p) => Math.floor(p / SIZE);
const col = (p) => p % SIZE;

function tileCell(t) {
  return { letter: t.letter, value: t.blank ? 0 : TILE_VALUES[t.letter], blank: !!t.blank, isNew: true };
}

// All words (length ≥ 2) formed by placing `tiles` on `board`: for every
// placed tile, expand the horizontal and the vertical run through it over
// board + placements; dedupe by start/direction. Covers the main word and
// every cross word uniformly, including single-tile plays.
export function wordsFormed(board, tiles) {
  const placed = new Map(tiles.map((t) => [t.pos, tileCell(t)]));
  const at = (p) => placed.get(p) ?? (board[p] ? { ...board[p], isNew: false } : null);
  const words = new Map();
  for (const t of tiles) {
    for (const [step, inLine] of [[1, (p) => row(p) === row(t.pos)], [SIZE, () => true]]) {
      let start = t.pos;
      while (start - step >= 0 && (step !== 1 || inLine(start - step)) && at(start - step)) start -= step;
      const cells = [];
      let p = start;
      while (p < SIZE * SIZE && (step !== 1 || row(p) === row(start)) && at(p)) {
        cells.push({ pos: p, ...at(p) });
        p += step;
      }
      if (cells.length >= 2) words.set(`${start}/${step}`, cells);
    }
  }
  return [...words.values()];
}

export function scoreWords(words, tileCount) {
  let total = 0;
  for (const cells of words) {
    let sum = 0, mult = 1;
    for (const c of cells) {
      let v = c.value;
      if (c.isNew) {
        const prem = PREMIUM[c.pos];
        if (prem === "dl") v *= 2;
        if (prem === "tl") v *= 3;
        if (prem === "dw") mult *= 2;
        if (prem === "tw") mult *= 3;
      }
      sum += v;
    }
    total += sum * mult;
  }
  return total + (tileCount === RACK_SIZE ? BINGO_BONUS : 0);
}

// Full legality check for a proposed play. Returns
// { ok, error?, words?: [string], score? }.
export function validateMove(state, playerIdx, tiles, dictionary) {
  const fail = (error) => ({ ok: false, error });
  if (state.over) return fail("The game is over.");
  if (playerIdx !== state.turn % 2) return fail("It's not your turn.");
  if (!tiles.length) return fail("Place at least one tile.");
  if (tiles.length > RACK_SIZE) return fail("Too many tiles.");

  const seen = new Set();
  for (const t of tiles) {
    if (t.pos < 0 || t.pos >= SIZE * SIZE || seen.has(t.pos)) return fail("Tiles overlap.");
    seen.add(t.pos);
    if (state.board[t.pos]) return fail("That square is taken.");
    if (!/^[a-z]$/.test(t.letter)) return fail("Bad letter.");
  }
  const need = tiles.map((t) => (t.blank ? "?" : t.letter));
  const rack = [...state.racks[playerIdx]];
  for (const ch of need) {
    const i = rack.indexOf(ch);
    if (i === -1) return fail("You don't have those tiles.");
    rack.splice(i, 1);
  }

  const rows = new Set(tiles.map((t) => row(t.pos)));
  const cols = new Set(tiles.map((t) => col(t.pos)));
  if (rows.size > 1 && cols.size > 1) return fail("Tiles must sit in one line.");
  const step = rows.size === 1 && (cols.size > 1 || tiles.length === 1) ? 1 : SIZE;
  const sorted = [...tiles].sort((a, b) => a.pos - b.pos);
  const placed = new Set(tiles.map((t) => t.pos));
  for (let p = sorted[0].pos; p < sorted[sorted.length - 1].pos; p += step) {
    if (!placed.has(p) && !state.board[p]) return fail("The word can't have gaps.");
  }

  const boardEmpty = state.board.every((c) => !c);
  if (boardEmpty) {
    if (!placed.has(CENTER)) return fail("The first word must cross the center star.");
    if (tiles.length < 2) return fail("The first word needs at least two letters.");
  }

  const words = wordsFormed(state.board, tiles);
  if (!words.length) return fail("That doesn't form a word.");
  if (!boardEmpty && !words.some((w) => w.some((c) => !c.isNew))) {
    return fail("New words must connect to what's on the board.");
  }
  for (const cells of words) {
    const word = cells.map((c) => c.letter).join("");
    if (!isWord(word, dictionary)) return fail(`"${word.toUpperCase()}" isn't a word.`);
  }
  return { ok: true, words: words.map((w) => w.map((c) => c.letter).join("")), score: scoreWords(words, tiles.length) };
}

export function canExchange(state) {
  return !state.over && state.bagRemaining >= RACK_SIZE;
}

// Moves are persisted and replayed on both clients, so a tampered or buggy
// list must never corrupt derivation or rendering: drop any tile that isn't
// a real letter on a real empty square.
export function sanitizeTiles(board, tiles) {
  return (tiles || []).filter((t) =>
    t && Number.isInteger(t.pos) && t.pos >= 0 && t.pos < SIZE * SIZE &&
    typeof t.letter === "string" && /^[a-z]$/.test(t.letter) && !board[t.pos]);
}

// Replay both move lists into the full game state. Moves are trusted (they
// were validated when played); scores are recomputed so both clients agree.
export function deriveState(seed, movesA, movesB) {
  const bag = bagForMatch(seed);
  let bagPos = 0;
  const draw = (n) => {
    const out = [];
    while (n-- > 0 && bagPos < bag.length) out.push(bag[bagPos++]);
    return out;
  };
  const racks = [draw(RACK_SIZE), draw(RACK_SIZE)];
  const board = Array(SIZE * SIZE).fill(null);
  const scores = [0, 0];
  const lists = [movesA || [], movesB || []];
  let turn = 0, scoreless = 0, over = false, outPlayer = -1;

  while (!over) {
    const p = turn % 2;
    const move = lists[p][Math.floor(turn / 2)];
    if (!move) break;
    if (move.type === "pass") {
      scoreless++;
    } else if (move.type === "exchange") {
      const returned = [];
      for (const ch of move.letters || []) {
        const i = racks[p].indexOf(ch);
        if (i !== -1) { racks[p].splice(i, 1); returned.push(ch); }
      }
      racks[p].push(...draw(returned.length));
      bag.push(...returned.sort()); // deterministic stand-in for reshuffling
      scoreless++;
    } else if (move.type === "play") {
      const tiles = sanitizeTiles(board, move.tiles);
      const score = scoreWords(wordsFormed(board, tiles), tiles.length);
      for (const t of tiles) {
        const i = racks[p].indexOf(t.blank ? "?" : t.letter);
        if (i !== -1) racks[p].splice(i, 1);
        board[t.pos] = { letter: t.letter, value: t.blank ? 0 : TILE_VALUES[t.letter], blank: !!t.blank };
      }
      scores[p] += score;
      scoreless = score > 0 ? 0 : scoreless + 1;
      racks[p].push(...draw(RACK_SIZE - racks[p].length));
      if (!racks[p].length && bagPos >= bag.length) { over = true; outPlayer = p; }
    }
    turn++;
    if (!over && scoreless >= 6) over = true;
  }

  let finalScores = null;
  if (over) {
    const rackVal = (r) => r.reduce((sum, t) => sum + TILE_VALUES[t], 0);
    finalScores = [0, 1].map((i) => scores[i] - (i === outPlayer ? 0 : rackVal(racks[i])));
    if (outPlayer !== -1) finalScores[outPlayer] += rackVal(racks[1 - outPlayer]);
  }
  return { board, racks, scores, turn, bagRemaining: bag.length - bagPos, scoreless, over, outPlayer, finalScores };
}
