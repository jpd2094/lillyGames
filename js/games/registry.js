// Game registry. Adding a game to the platform = write a plugin folder
// under js/games/<id>/ that default-exports the game interface (see
// js/games/wordgrid/index.js for the contract), then list it here.

import wordgrid from "./wordgrid/index.js";

export const GAMES = [wordgrid];

export function getGame(id) {
  return GAMES.find((g) => g.id === id) || null;
}
