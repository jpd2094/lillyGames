// Sudoku engine tests. Run from anywhere: node tests/sudoku-engine.test.mjs
import {
  VARIANTS, puzzleForMatch, conflicts, isSolved, countSolutions,
} from "../js/games/sudoku/engine.js";

let failures = 0;
const check = (name, cond) => { if (!cond) { failures++; console.error(`FAIL: ${name}`); } else console.log(`ok: ${name}`); };

function validGroup(cells) {
  const seen = new Set();
  for (const v of cells) {
    if (v < 1 || v > 9 || seen.has(v)) return false;
    seen.add(v);
  }
  return true;
}

function fullyValid(grid) {
  for (let i = 0; i < 9; i++) {
    const row = grid.slice(i * 9, i * 9 + 9);
    const col = Array.from({ length: 9 }, (_, r) => grid[r * 9 + i]);
    const box = Array.from({ length: 9 }, (_, k) =>
      grid[(Math.floor(i / 3) * 3 + Math.floor(k / 3)) * 9 + (i % 3) * 3 + (k % 3)]);
    if (!validGroup(row) || !validGroup(col) || !validGroup(box)) return false;
  }
  return true;
}

check("three variants: easy/medium/hard", VARIANTS.map((v) => v.id).join(",") === "easy,medium,hard");

for (const variant of VARIANTS) {
  const { givens, solution } = puzzleForMatch("sudotest1", variant.id);
  const again = puzzleForMatch("sudotest1", variant.id);
  const clues = givens.filter((v) => v !== 0).length;
  check(`${variant.id}: deterministic`, givens.join("") === again.givens.join("") && solution.join("") === again.solution.join(""));
  check(`${variant.id}: solution is a valid sudoku`, fullyValid(solution));
  check(`${variant.id}: givens agree with solution`, givens.every((v, i) => v === 0 || v === solution[i]));
  check(`${variant.id}: clue count ${clues} in range`, clues >= variant.minClues && clues <= variant.clues + 6);
  check(`${variant.id}: unique solution`, countSolutions(givens, 2) === 1);
}

{
  const easy = puzzleForMatch("sudotest1", "easy").givens.filter(Boolean).length;
  const hard = puzzleForMatch("sudotest1", "hard").givens.filter(Boolean).length;
  check(`hard (${hard}) has fewer clues than easy (${easy})`, hard < easy);
  const other = puzzleForMatch("sudotest2", "easy");
  check("different seed, different puzzle", other.givens.join("") !== puzzleForMatch("sudotest1", "easy").givens.join(""));
}

// conflicts: live feedback for duplicate digits
{
  const { givens, solution } = puzzleForMatch("sudotest1", "easy");
  check("clean grid has no conflicts", conflicts(solution).size === 0);
  const grid = [...givens];
  // place a wrong duplicate: copy a row-mate's value into an empty cell
  const empty = grid.findIndex((v) => v === 0);
  const row = Math.floor(empty / 9);
  const mate = grid.slice(row * 9, row * 9 + 9).find((v) => v !== 0);
  grid[empty] = mate;
  const c = conflicts(grid);
  check("duplicate in a row is flagged, both cells", c.has(empty) && c.size >= 2);
  check("isSolved: givens alone are not solved", isSolved(givens, solution) === false);
  check("isSolved: full solution is solved", isSolved(solution, solution) === true);
  const nearly = [...solution];
  nearly[80] = 0;
  check("isSolved: one empty cell is not solved", isSolved(nearly, solution) === false);
}

process.exit(failures ? 1 : 0);
