// Sudoku engine: deterministic puzzle generation with a guaranteed unique
// solution, plus the small helpers the race UI needs. Pure — no DOM.
//
// Generation: seeded backtracking fills a complete grid, then clues are
// removed in seeded-random order, keeping only removals that leave exactly
// one solution. Both players derive the identical puzzle from seed+variant.

import { makeRng } from "../wordgrid/engine.js";

// clues = removal target; minClues = hard floor the tests assert against.
export const VARIANTS = [
  { id: "easy", name: "Easy", clues: 40, minClues: 36 },
  { id: "medium", name: "Medium", clues: 32, minClues: 28 },
  { id: "hard", name: "Hard", clues: 26, minClues: 22 },
];

const rowOf = (i) => Math.floor(i / 9);
const colOf = (i) => i % 9;
const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

// Peer cells (same row/col/box) for each cell, precomputed once.
const PEERS = (() => {
  const peers = [];
  for (let i = 0; i < 81; i++) {
    const set = new Set();
    for (let j = 0; j < 81; j++) {
      if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) set.add(j);
    }
    peers.push([...set]);
  }
  return peers;
})();

function candidates(grid, i) {
  const used = new Set();
  for (const p of PEERS[i]) if (grid[p]) used.add(grid[p]);
  const out = [];
  for (let v = 1; v <= 9; v++) if (!used.has(v)) out.push(v);
  return out;
}

// Count solutions up to `limit` (2 is enough to prove non-uniqueness).
export function countSolutions(grid, limit = 2) {
  const g = [...grid];
  let count = 0;
  (function walk() {
    if (count >= limit) return;
    // most-constrained empty cell first keeps the search shallow
    let best = -1, bestCands = null;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const c = candidates(g, i);
      if (!c.length) return; // dead end
      if (!bestCands || c.length < bestCands.length) { best = i; bestCands = c; }
      if (bestCands.length === 1) break;
    }
    if (best === -1) { count++; return; }
    for (const v of bestCands) {
      g[best] = v;
      walk();
      if (count >= limit) break;
    }
    g[best] = 0;
  })();
  return count;
}

function generateSolved(rng) {
  const g = Array(81).fill(0);
  (function fill(i) {
    if (i === 81) return true;
    const c = candidates(g, i);
    for (let k = c.length - 1; k > 0; k--) {
      const j = Math.floor(rng() * (k + 1));
      [c[k], c[j]] = [c[j], c[k]];
    }
    for (const v of c) {
      g[i] = v;
      if (fill(i + 1)) return true;
    }
    g[i] = 0;
    return false;
  })(0);
  return g;
}

export function puzzleForMatch(matchSeed, variantId) {
  const variant = VARIANTS.find((v) => v.id === variantId) || VARIANTS[0];
  const rng = makeRng(`${matchSeed}#sudoku#${variant.id}`);
  const solution = generateSolved(rng);
  const givens = [...solution];
  const order = [...Array(81).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let clues = 81;
  for (const i of order) {
    if (clues <= variant.clues) break;
    const kept = givens[i];
    givens[i] = 0;
    if (countSolutions(givens, 2) === 1) clues--;
    else givens[i] = kept; // that clue was load-bearing
  }
  return { givens, solution };
}

// Cells participating in any duplicate-digit clash (for live feedback).
export function conflicts(grid) {
  const bad = new Set();
  for (let i = 0; i < 81; i++) {
    if (!grid[i]) continue;
    for (const p of PEERS[i]) {
      if (grid[p] === grid[i]) { bad.add(i); bad.add(p); }
    }
  }
  return bad;
}

export function isSolved(grid, solution) {
  return grid.every((v, i) => v === solution[i]);
}
