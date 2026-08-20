// Mini Golf engine: the course, and a fully deterministic shot simulator.
// Pure — the UI animates by replaying the simulator's rollout points.
//
// Coordinates: x 0..100, y 0..160, tee at the bottom, cup at the top.
// A hole's playable ground is a union of rects; leaving it bounces the
// ball off the wall with some energy lost. Sand is ground that drinks
// momentum; water resets the shot with a one-stroke penalty.

export const BALL_R = 1.5;
export const CUP_R = 2.4;
export const MAX_POWER = 95;     // launch speed, units/s
export const SINK_SPEED = 30;    // faster than this lips out over the cup
export const STROKE_CAP = 8;     // per hole — then you pick up and move on

const R = (x, y, w, h) => ({ x, y, w, h });

export const HOLES = [
  {
    name: "The Opener", par: 2,
    tee: { x: 50, y: 128 }, cup: { x: 78, y: 40 },
    fairway: [R(30, 60, 40, 80), R(30, 20, 60, 40)],
    sand: [], water: [],
  },
  {
    name: "The Hourglass", par: 3,
    tee: { x: 50, y: 132 }, cup: { x: 50, y: 30 },
    fairway: [R(25, 15, 50, 130)],
    sand: [R(25, 68, 18, 26), R(57, 68, 18, 26)],
    water: [],
  },
  {
    name: "The Crossing", par: 3,
    tee: { x: 50, y: 130 }, cup: { x: 50, y: 35 },
    fairway: [R(25, 100, 50, 45), R(25, 60, 50, 40), R(32, 18, 36, 42)],
    sand: [],
    water: [R(25, 60, 30, 40), R(63, 60, 12, 40)], // an 8-unit bridge at x55-63
  },
];

export function encode(strokes, seconds) {
  return strokes * 10000 + Math.min(9999, Math.max(0, Math.round(seconds)));
}

export function decode(total) {
  const t = Math.max(0, Number(total) || 0);
  return { strokes: Math.floor(t / 10000), seconds: t % 10000 };
}

export function insideAny(rects, x, y) {
  return rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
}

// One shot, rolled out to rest. Returns:
//   { points: [{x,y}...], end: {x,y}, sunk, water }
// On water contact the ball goes back to where the shot started (the UI
// charges the penalty stroke).
export function simulateShot(hole, start, angle, power) {
  const dt = 1 / 120;
  let x = start.x, y = start.y;
  let vx = Math.cos(angle) * Math.min(MAX_POWER, power);
  let vy = Math.sin(angle) * Math.min(MAX_POWER, power);
  const points = [{ x, y }];

  for (let step = 0; step < 2400; step++) {
    const speed = Math.hypot(vx, vy);
    if (speed < 2.5) break;

    const onSand = insideAny(hole.sand, x, y);
    const damp = onSand ? 0.965 : 0.9915;
    vx *= damp;
    vy *= damp;

    // axis-separated movement → clean wall reflections
    const nx = x + vx * dt;
    if (insideAny(hole.fairway, nx, y)) x = nx;
    else vx = -vx * 0.8;
    const ny = y + vy * dt;
    if (insideAny(hole.fairway, x, ny)) y = ny;
    else vy = -vy * 0.8;

    if (step % 2 === 0) points.push({ x, y });

    if (insideAny(hole.water, x, y)) {
      return { points, end: { ...start }, sunk: false, water: true };
    }

    const d = Math.hypot(x - hole.cup.x, y - hole.cup.y);
    if (d < CUP_R) {
      if (Math.hypot(vx, vy) <= SINK_SPEED) {
        points.push({ ...hole.cup });
        return { points, end: { ...hole.cup }, sunk: true, water: false };
      }
      // lip out: graze the rim, lose pace
      vx *= 0.72;
      vy *= 0.72;
    }
  }
  points.push({ x, y });
  return { points, end: { x, y }, sunk: false, water: false };
}

// Solver used by tests (and nothing else): can this hole be finished in at
// most `maxStrokes`? Plays like a person would — aim at the cup with fine
// power control plus some angle scatter for doglegs and banks, and carry
// the best (nearest-the-cup) resting spots forward as launch pads.
export function solvable(hole, maxStrokes) {
  let spots = [{ ...hole.tee }];
  for (let stroke = 1; stroke <= maxStrokes; stroke++) {
    const cands = [];
    for (const spot of spots) {
      const atCup = Math.atan2(hole.cup.y - spot.y, hole.cup.x - spot.x);
      for (const da of [-0.6, -0.4, -0.25, -0.12, -0.05, 0, 0.05, 0.12, 0.25, 0.4, 0.6]) {
        for (let power = 16; power <= MAX_POWER; power += 3) {
          const r = simulateShot(hole, spot, atCup + da, power);
          if (r.sunk) return stroke;
          if (!r.water) cands.push(r.end);
        }
      }
      for (let a = 0; a < 24; a++) { // scatter for layups around corners
        for (const power of [40, 65, 90]) {
          const r = simulateShot(hole, spot, (a / 24) * Math.PI * 2, power);
          if (r.sunk) return stroke;
          if (!r.water) cands.push(r.end);
        }
      }
    }
    cands.sort((a, b) =>
      Math.hypot(a.x - hole.cup.x, a.y - hole.cup.y) - Math.hypot(b.x - hole.cup.x, b.y - hole.cup.y));
    spots = cands.slice(0, 12);
  }
  return 0;
}
