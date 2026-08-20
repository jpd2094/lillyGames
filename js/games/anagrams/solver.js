// Finds every dictionary word buildable from a rack, best-scoring first.
// Used on the results screen for the "nobody found" list.

import { wordScore } from "../wordgrid/engine.js";
import { RACK_SIZE, letterCounts, canBuild } from "./engine.js";

export function solveRack(rack, dictionary) {
  const rackCounts = letterCounts(rack.join(""));
  const found = [];
  for (const word of dictionary) {
    if (word.length < 3 || word.length > RACK_SIZE) continue;
    if (canBuild(word, rackCounts)) found.push(word);
  }
  return found.sort((a, b) => wordScore(b) - wordScore(a) || a.localeCompare(b));
}
