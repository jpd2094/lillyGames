// Store facade: picks the backend once, exposes a single `initStore()`.
// Everything else in the app talks to the returned store object and never
// knows which backend is underneath.
//
// Store interface (all methods async unless noted):
//   ensureUser(name)                          -> user
//   createMatch({gameId, players, createdBy, seed, rounds}) -> match
//   getMatch(id)                              -> match | null
//   submitResult(matchId, player, result, finalize) -> match
//   listMatchesFor(name)                      -> match[]
//   subscribeMatch(id, cb)                    -> unsubscribe fn  (sync)
//   subscribeMatchesFor(name, cb)             -> unsubscribe fn  (sync)

import { USE_FIREBASE, firebaseConfig } from "../config.js";
import { createLocalStore } from "./local.js";

let storePromise = null;

export function initStore() {
  if (!storePromise) {
    storePromise = USE_FIREBASE
      ? import("./firebase.js").then((m) => m.createFirebaseStore(firebaseConfig))
      : Promise.resolve(createLocalStore());
  }
  return storePromise;
}
