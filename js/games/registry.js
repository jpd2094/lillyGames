// Game registry. Adding a game to the platform = write a plugin folder
// under js/games/<id>/ that default-exports the game interface (see
// js/games/wordgrid/index.js for the contract), then list it here.

import wordgrid from "./wordgrid/index.js";
import anagrams from "./anagrams/index.js";
import blackjack from "./blackjack/index.js";
import scrabble from "./scrabble/index.js";
import sudoku from "./sudoku/index.js";
import wordle from "./wordle/index.js";
import cuppong from "./cuppong/index.js";

export const GAMES = [wordgrid, anagrams, blackjack, scrabble, sudoku, wordle, cuppong];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}
