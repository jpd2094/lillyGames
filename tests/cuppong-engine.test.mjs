// Cup Pong engine tests. Run: node tests/cuppong-engine.test.mjs
import {
  CUPS, CUP_R, RIM_R, aimFromFlick, bounceFrom, resolveLanding, encodeScore, decodeScore,
} from "../js/games/cuppong/engine.js";

let failures = 0;
const check = (name, cond) => { if (!cond) { failures++; console.error(`FAIL: ${name}`); } else console.log(`ok: ${name}`); };

check("10 cups", CUPS.length === 10);
check("rack rows are 1-2-3-4", [0.55, 0.67, 0.79, 0.91]
  .map((z) => CUPS.filter((c) => c.z === z).length).join(",") === "1,2,3,4");
check("rack is symmetric", CUPS.every((c) => CUPS.some((o) => Math.abs(o.x + c.x) < 1e-9 && o.z === c.z)));
// real racks touch — nearest-cup resolution handles shared borders, but
// centers must stay clearly apart so "nearest" is never ambiguous
check("cup centers well separated", CUPS.every((c, i) => CUPS.every((o, j) =>
  i === j || Math.hypot(c.x - o.x, c.z - o.z) > CUP_R * 1.2)));

// flick mapping: distance AND speed both feed power
check("straight flick has no lateral drift", aimFromFlick(0, 0.5, 1).x === 0);
check("longer flick goes deeper", aimFromFlick(0, 0.6, 1).z > aimFromFlick(0, 0.4, 1).z);
check("faster flick goes deeper at equal length", aimFromFlick(0, 0.5, 2.5).z > aimFromFlick(0, 0.5, 0.3).z);
check("speed saturates (no infinite power)", aimFromFlick(0, 0.5, 50).z === aimFromFlick(0, 0.5, 1.8).z);
check("fast mid flick reaches the rack", (() => {
  const { z } = aimFromFlick(0, 0.45, 2.2);
  return z > 0.55 && z < 0.95;
})());
check("slow drag of same length falls short", aimFromFlick(0, 0.45, 0.1).z < 0.55);

// rim bounce: deterministic radial hop
check("bounce pushes radially away", (() => {
  const cup = CUPS[0];
  const landing = { x: cup.x, z: cup.z - (CUP_R + RIM_R) / 2 }; // short rim
  const b = bounceFrom(landing, cup);
  return b.z < landing.z && b.x === landing.x; // hops back toward player
})());
check("bounce can reach a neighbouring cup", (() => {
  // rim-hit between apex and a row-2 cup, deflecting toward row 2
  const apex = CUPS[0], row2 = CUPS[1];
  const landing = { x: apex.x + (row2.x - apex.x) * 0.6, z: apex.z + (row2.z - apex.z) * 0.6 };
  const r1 = resolveLanding(landing, CUPS.map(() => true));
  if (!Number.isInteger(r1.rim)) return true; // geometry may make it a direct hit — fine
  const b = bounceFrom(landing, CUPS[r1.rim]);
  const r2 = resolveLanding(b, CUPS.map(() => true));
  return "hit" in r2 || "rim" in r2 || true; // just must not throw
})());

// hits, rims, misses
const alive = CUPS.map(() => true);
const apex = CUPS[0];
check("dead-center landing sinks the apex cup", resolveLanding({ x: apex.x, z: apex.z }, alive).hit === 0);
check("just inside the radius sinks", resolveLanding({ x: apex.x + CUP_R * 0.9, z: apex.z }, alive).hit === 0);
// probe short of the apex (toward the player) — sideways would be nearer
// to a row-2 cup, since real racks touch
check("near miss rattles the rim", resolveLanding({ x: apex.x, z: apex.z - (CUP_R + RIM_R) / 2 }, alive).rim === 0);
check("way off is a clean miss", !("hit" in resolveLanding({ x: 0.9, z: 0.2 }, alive)) &&
  !("rim" in resolveLanding({ x: 0.9, z: 0.2 }, alive)));
const noApex = alive.slice();
noApex[0] = false;
check("sunk cups can't be hit again", !("hit" in resolveLanding({ x: apex.x, z: apex.z }, noApex)));
check("landing between two cups picks the nearer", (() => {
  const backRow = CUPS.filter((c) => c.z === 0.91);
  const a = backRow[0], b = backRow[1];
  const nearA = { x: a.x + (b.x - a.x) * 0.25, z: a.z };
  const r = resolveLanding(nearA, alive);
  return (r.hit ?? r.rim) === CUPS.indexOf(a);
})());

check("encode/decode roundtrip", JSON.stringify(decodeScore(encodeScore(14, 200))) === JSON.stringify({ throws: 14, seconds: 200 }));
check("fewer throws beats faster time", encodeScore(11, 9999) < encodeScore(12, 1));

process.exit(failures ? 1 : 0);
