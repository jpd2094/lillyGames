// Word Grid engine: deterministic grid generation, adjacency, scoring.
// Everything here is pure — no DOM, no storage — so it can be unit-tested
// and reused (e.g. the solver imports the same adjacency map).

export const SIZE = 4;

// Classic Boggle dice: 16 dice, one per cell, each with 6 faces. Using real
// dice distributions (rather than uniform random letters) is what makes
// grids feel "wordy". "q" is always played and displayed as "Qu".
const DICE = [
  "aaeegn", "abbjoo", "achops", "affkps",
  "aoottw", "cimotu", "deilrx", "delrvy",
  "distty", "eeghnw", "eeinsu", "ehrtvw",
  "eiosst", "elrtty", "himnqu", "hlnnrz",
];

// ── Seeded RNG (xmur3 hash → mulberry32) ────────────────────────────────
// Both players hash the same seed string, so both derive identical grids
// with zero server involvement.
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seedString) {
  return mulberry32(xmur3(seedString)());
}

export function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}

// Returns an array of 16 cell strings, e.g. "a", "t", "qu".
export function gridForRound(matchSeed, round) {
  const rng = makeRng(`${matchSeed}#round${round}`);
  const dice = [...DICE];
  // Fisher–Yates shuffle: which die lands on which cell
  for (let i = dice.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [dice[i], dice[j]] = [dice[j], dice[i]];
  }
  return dice.map((die) => {
    const face = die[Math.floor(rng() * 6)];
    return face === "q" ? "qu" : face;
  });
}

// Precomputed 8-directional adjacency for a 4x4 board.
export const NEIGHBORS = (() => {
  const map = [];
  for (let i = 0; i < SIZE * SIZE; i++) {
    const r = Math.floor(i / SIZE), c = i % SIZE, out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = r + dr, nc = c + dc;
        if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) out.push(nr * SIZE + nc);
      }
    }
    map.push(out);
  }
  return map;
})();

export function isAdjacent(a, b) {
  return NEIGHBORS[a].includes(b);
}

// Classic Boggle scoring: rewards both finding many words and long words.
export function wordScore(word) {
  const len = word.length;
  if (len < 3) return 0;
  if (len <= 4) return 1;
  if (len === 5) return 2;
  if (len === 6) return 3;
  if (len === 7) return 5;
  return 11;
}

export function pathToWord(grid, path) {
  return path.map((i) => grid[i]).join("");
}
