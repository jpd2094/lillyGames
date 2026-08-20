// Cup Pong engine: table geometry, the swipe-to-landing mapping, and hit
// detection. Pure — the canvas work lives in ui.js.
//
// Coordinates: x is lateral in table units (-1..1 across the playable
// width, independent of depth — perspective narrowing is purely visual),
// z is depth from the ball (0) to past the back row (~1). A throw maps a
// swipe to a landing point; a cup is sunk when the landing point falls
// within its radius. No randomness anywhere: same swipe, same result.

export const CUP_R = 0.115;      // sink radius — also the cup's visual radius
export const RIM_R = 0.18;       // near-miss: rattles out
export const THROW_MIN = 0.18;   // swipes shorter than this don't throw

// 10-cup rack, apex toward the player: rows of 1, 2, 3, 4, cups touching
// (spacing = one cup diameter), spread deep enough to read in perspective.
export const CUPS = (() => {
  const rows = [[0.55, 1], [0.67, 2], [0.79, 3], [0.91, 4]];
  const cups = [];
  for (const [z, n] of rows) {
    for (let i = 0; i < n; i++) cups.push({ x: (i - (n - 1) / 2) * 0.24, z });
  }
  return cups;
})();

// Swipe (normalized by viewport height: dxN right+, dyN upward+) → landing.
// Tuned so a ~55%-height flick reaches the middle of the rack.
export function aimFromSwipe(dxN, dyN) {
  return { x: dxN * 2.4, z: dyN * 1.35 };
}

// Which cup (index into `alive`-masked CUPS) a landing hits, if any.
// Returns { hit } | { rim } | {} — nearest live cup decides.
export function resolveLanding(landing, alive) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < CUPS.length; i++) {
    if (!alive[i]) continue;
    const d = Math.hypot(landing.x - CUPS[i].x, landing.z - CUPS[i].z);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best === -1) return {};
  if (bestD <= CUP_R) return { hit: best };
  if (bestD <= RIM_R) return { rim: best };
  return {};
}

export function encodeScore(throws, seconds) {
  return throws * 10000 + Math.min(9999, Math.max(0, Math.round(seconds)));
}

export function decodeScore(total) {
  const t = Math.max(0, Number(total) || 0);
  return { throws: Math.floor(t / 10000), seconds: t % 10000 };
}
