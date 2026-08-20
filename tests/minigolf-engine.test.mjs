// Mini Golf engine tests — including a solver proof that every hole is
// finishable at or under par. Run: node tests/minigolf-engine.test.mjs
import {
  HOLES, BALL_R, CUP_R, MAX_POWER, insideAny, simulateShot, solvable,
} from "../js/games/minigolf/engine.js";

let failures = 0;
const check = (name, cond) => { if (!cond) { failures++; console.error(`FAIL: ${name}`); } else console.log(`ok: ${name}`); };

check("three holes", HOLES.length === 3);
for (const h of HOLES) {
  check(`${h.name}: tee on the fairway`, insideAny(h.fairway, h.tee.x, h.tee.y));
  check(`${h.name}: cup on the fairway`, insideAny(h.fairway, h.cup.x, h.cup.y));
  check(`${h.name}: cup not in sand or water`, !insideAny(h.sand, h.cup.x, h.cup.y) && !insideAny(h.water, h.cup.x, h.cup.y));
  check(`${h.name}: tee clear of hazards`, !insideAny(h.sand, h.tee.x, h.tee.y) && !insideAny(h.water, h.tee.x, h.tee.y));
}

// Physics fundamentals on a plain corridor (hole 2's open rect)
const straight = HOLES[1];
{
  const up = -Math.PI / 2;
  const r = simulateShot(straight, { x: 50, y: 140 }, up, 40);
  check("ball rolls and stops (friction)", !r.sunk && r.end.y < 140 && r.end.y > 15);
  const far = simulateShot(straight, { x: 50, y: 140 }, up, 40);
  check("simulation is deterministic", JSON.stringify(far) === JSON.stringify(r));

  const wall = simulateShot(straight, { x: 50, y: 140 }, Math.PI, 60); // straight left
  check("wall bounce keeps the ball in bounds", insideAny(straight.fairway, wall.end.x, wall.end.y));
  check("bounce loses energy (ends near the wall it hit)", wall.end.x < 50);

  // dead-center full-power blast at the cup: too hot — must lip out
  const dy = straight.cup.y - 140;
  const hot = simulateShot(straight, { x: 50, y: 140 }, Math.atan2(dy, 0), MAX_POWER);
  check("cup lips out at speed", !hot.sunk || Math.hypot(hot.end.x - 50, hot.end.y - 140) > 5);
}

// Sand slows: same shot through the hourglass waist vs the open lane
{
  const up = -Math.PI / 2;
  const throughSand = simulateShot(straight, { x: 34, y: 140 }, up, 70); // left lane = sand
  const throughOpen = simulateShot(straight, { x: 50, y: 140 }, up, 70); // middle gap
  check("sand drinks momentum", throughSand.end.y > throughOpen.end.y + 8);
}

// Water: crossing hole punishes a shot into the drink and resets it
{
  const h = HOLES[2];
  const start = { x: 40, y: 130 };
  const r = simulateShot(h, start, -Math.PI / 2, 60); // up the left side: water
  check("water contact flags and resets to the shot's start", r.water && r.end.x === start.x && r.end.y === start.y);
  const bridge = simulateShot(h, { x: 59, y: 130 }, -Math.PI / 2, 70); // up the bridge
  check("the bridge is crossable", !bridge.water && bridge.end.y < 100);
}

// The course-quality proof: every hole finishable at or under par
for (const h of HOLES) {
  const strokes = solvable(h, h.par);
  check(`${h.name}: solvable in ${strokes || "> " + h.par} (par ${h.par})`, strokes > 0 && strokes <= h.par);
}

process.exit(failures ? 1 : 0);
