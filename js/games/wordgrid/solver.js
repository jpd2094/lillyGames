// Finds every dictionary word traceable on a grid. Used on the results
// screen to show the best words both players missed.
//
// Strategy: rather than building a trie of all 170k dictionary words (heavy
// on mobile), first cut the dictionary down to words spellable from the
// grid's letter multiset (typically a few thousand), build a tiny trie from
// those, then DFS the board with prefix pruning.

import { NEIGHBORS, wordScore } from "./engine.js";

function letterCounts(cells) {
  const counts = {};
  for (const cell of cells) for (const ch of cell) counts[ch] = (counts[ch] || 0) + 1;
  return counts;
}

function spellable(word, counts) {
  const used = {};
  for (const ch of word) {
    used[ch] = (used[ch] || 0) + 1;
    if (used[ch] > (counts[ch] || 0)) return false;
  }
  return true;
}

export function solveGrid(grid, dictionary) {
  const counts = letterCounts(grid);
  // "qu" cells contribute both letters, but a word containing "q" without a
  // following "u" can never be traced — the multiset filter handles q via u.
  const candidates = [];
  for (const word of dictionary) {
    if (word.length > 16 && !word.includes("qu")) continue;
    if (word.includes("q") && !word.includes("qu")) continue;
    if (spellable(word, counts)) candidates.push(word);
  }

  // Tiny trie over candidates only
  const root = {};
  for (const word of candidates) {
    let node = root;
    for (const ch of word) node = node[ch] || (node[ch] = {});
    node.$ = word;
  }

  const found = new Set();
  const visited = new Array(grid.length).fill(false);

  function dfs(idx, node) {
    const cell = grid[idx]; // "a" or "qu"
    let next = node;
    for (const ch of cell) {
      next = next[ch];
      if (!next) return;
    }
    if (next.$) found.add(next.$);
    visited[idx] = true;
    for (const n of NEIGHBORS[idx]) if (!visited[n]) dfs(n, next);
    visited[idx] = false;
  }

  for (let i = 0; i < grid.length; i++) dfs(i, root);

  return [...found].sort((a, b) => wordScore(b) - wordScore(a) || b.length - a.length || a.localeCompare(b));
}
