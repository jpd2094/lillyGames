// Turn-notification decision tests. Run: node tests/notify-logic.test.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { computeNotifications, waitingOn } = require("../functions/logic.js");

let failures = 0;
const check = (name, cond) => { if (!cond) { failures++; console.error(`FAIL: ${name}`); } else console.log(`ok: ${name}`); };

const base = (over = {}) => ({
  gameId: "wordgrid", players: ["jp", "lil"], createdBy: "jp", rounds: 3, results: {}, ...over,
});
const withRounds = (m, p, n) => ({
  ...m, results: { ...m.results, [p]: { rounds: Array.from({ length: n }, () => ({ score: 1 })), total: n } },
});

// creation → challenge push to the rival only
{
  const d = computeNotifications(null, base(), "m1");
  check("creation notifies the rival only", d.length === 1 && d[0].to === "lil");
  check("challenge copy names the challenger", /jp challenged you/.test(d[0].title));
  check("url targets the match", d[0].url === "#/match/m1");
}

// presence/progress ticks are silent
{
  const before = base();
  const after = { ...before, results: { jp: { presence: 123, progress: { hands: 3 } } } };
  check("presence tick is silent", computeNotifications(before, after, "m1").length === 0);
}

// lockstep unlock: rival finishing round 1 wakes me for round 2
{
  let m0 = withRounds(base(), "jp", 1);          // I finished round 1, waiting
  const m1 = withRounds(m0, "lil", 1);           // lil finishes round 1
  const d = computeNotifications(m0, m1, "m2");
  check("round unlock notifies the blocked player", d.length === 1 && d[0].to === "jp");
  check("unlock copy is a your-move nudge", /Your move vs lil/.test(d[0].title));
}

// my own submission doesn't notify me, and doesn't re-notify a rival who could already play
{
  const m0 = base();                              // both can play round 1
  const m1 = withRounds(m0, "jp", 1);             // I submit round 1
  check("no self/duplicate notifications", computeNotifications(m0, m1, "m3").length === 0);
}

// completion → the non-actor hears the match is decided
{
  const m0 = withRounds(withRounds(base({ rounds: 1 }), "jp", 1), "lil", 0);
  const m1 = withRounds(m0, "lil", 1);
  const d = computeNotifications(m0, m1, "m4");
  check("completion notifies the other player", d.length === 1 && d[0].to === "jp" && /decided/.test(d[0].title));
}

// scrabble: strict alternation by move parity
{
  const sc = base({ gameId: "scrabble", rounds: 1 });
  check("fresh scrabble waits on the creator", waitingOn(sc).join(",") === "jp");
  const afterMove = { ...sc, results: { jp: { progress: { moves: [{ type: "play" }] } } } };
  const d = computeNotifications(sc, afterMove, "m5");
  check("scrabble move flips the turn to the rival", d.length === 1 && d[0].to === "lil" && /Scrabble/.test(d[0].body));
  const afterReply = { ...afterMove, results: { ...afterMove.results, lil: { progress: { moves: [{ type: "pass" }] } } } };
  const d2 = computeNotifications(afterMove, afterReply, "m5");
  check("reply flips it back", d2.length === 1 && d2[0].to === "jp");
}

process.exit(failures ? 1 : 0);
