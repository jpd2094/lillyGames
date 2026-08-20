// One Mini Golf round: three holes, pull back and release to putt.
// Flat, minimal look: soft fairways, clean hazards, a coral flag.
//
// mountRound(container, opts) -> destroy()
//   opts: { me, results, onDone, reportProgress, onRivalUpdate }
//   onDone({ score, strokes, seconds, holes })  — score = strokes*10000 + s
//
// All rolling comes from engine.simulateShot — the UI replays its points.

import {
  HOLES, BALL_R, CUP_R, MAX_POWER, STROKE_CAP, simulateShot, decode, encode,
} from "./engine.js";

export function mountRound(container, opts) {
  const { me, results, onDone, reportProgress, onRivalUpdate } = opts;

  const prior = results?.[me]?.progress;
  const startedAt = Number(prior?.startedAt) || Date.now();
  let holeIdx = Number.isInteger(prior?.hole) && prior.hole >= 0 && prior.hole < HOLES.length ? prior.hole : 0;
  let perHole = Array.isArray(prior?.strokes)
    ? prior.strokes.slice(0, HOLES.length).map((n) => Math.max(0, Number(n) || 0))
    : [];
  let cur = Number.isInteger(prior?.cur) && prior.cur >= 0 ? prior.cur : 0;
  let ball = prior?.ball && Number.isFinite(prior.ball.x) && Number.isFinite(prior.ball.y)
    ? { x: prior.ball.x, y: prior.ball.y }
    : { ...HOLES[holeIdx].tee };
  let ended = false;

  container.innerHTML = `
    <div class="round mg">
      <div class="round-top">
        <span class="round-chip" data-hole></span>
        <span class="round-clock su-clock" data-clock>0:00</span>
        <span class="su-fill" data-score></span>
      </div>
      <div class="su-rival" data-rival hidden></div>
      <p class="sc-note" data-note>Pull back from the ball and let go — like a slingshot.</p>
      <div class="mg-course"><canvas data-canvas></canvas></div>
    </div>`;

  const el = (s) => container.querySelector(s);
  const canvas = el("[data-canvas]");
  const noteEl = el("[data-note]"), clockEl = el("[data-clock]");
  const holeEl = el("[data-hole]"), scoreEl = el("[data-score]"), rivalEl = el("[data-rival]");

  const elapsedSec = () => Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const timer = setInterval(() => { clockEl.textContent = fmt(elapsedSec()); }, 250);
  clockEl.textContent = fmt(elapsedSec());

  const totalStrokes = () => perHole.reduce((a, b) => a + b, 0) + cur;
  const report = () => reportProgress?.({
    startedAt, hole: holeIdx, strokes: perHole.slice(), cur, ball: { x: ball.x, y: ball.y }, at: Date.now(),
  });
  report();

  onRivalUpdate?.((entry) => {
    if (ended) return;
    const finished = entry?.rounds?.filter(Boolean)?.length;
    if (finished) {
      const { strokes, seconds } = decode(entry.total);
      rivalEl.hidden = false;
      rivalEl.textContent = `Rival finished: ${strokes} strokes · ${fmt(seconds)} — beat it!`;
      return;
    }
    const p = entry?.progress;
    if (Number.isInteger(p?.hole)) {
      const t = (Array.isArray(p.strokes) ? p.strokes.reduce((a, b) => a + (Number(b) || 0), 0) : 0) + (Number(p.cur) || 0);
      rivalEl.hidden = false;
      rivalEl.textContent = `Rival: hole ${Math.min(HOLES.length, p.hole + 1)}/${HOLES.length} · ${t} strokes`;
    }
  });

  // ── Canvas ─────────────────────────────────────────────────────────────
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, S = 1, OX = 0, OY = 0, dpr = 1;

  function resize() {
    const box = canvas.parentElement.getBoundingClientRect();
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    W = Math.round(box.width);
    H = Math.round(box.height);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    S = Math.min(W / 108, H / 168); // course units → px, small margin
    OX = (W - 100 * S) / 2;
    OY = (H - 160 * S) / 2;
    draw();
  }

  const px = (x) => OX + x * S;
  const py = (y) => OY + y * S;

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(px(x), py(y), w * S, h * S, r * S);
  }

  function drawHole() {
    const hole = HOLES[holeIdx];
    ctx.clearRect(0, 0, W, H);
    // cream apron under the fairway = the walls
    for (const f of hole.fairway) { rr(f.x - 2.4, f.y - 2.4, f.w + 4.8, f.h + 4.8, 4.5); ctx.fillStyle = "#efe7d3"; ctx.fill(); }
    for (const f of hole.fairway) { rr(f.x - 2.4, f.y - 2.4, f.w + 4.8, f.h + 4.8, 4.5); ctx.fillStyle = "#efe7d3"; ctx.fill(); }
    // fairway
    for (const f of hole.fairway) { rr(f.x, f.y, f.w, f.h, 3); ctx.fillStyle = "#8fbc74"; ctx.fill(); }
    for (const f of hole.fairway) { rr(f.x, f.y, f.w, f.h, 3); ctx.fillStyle = "#8fbc74"; ctx.fill(); }
    // subtle mow stripes
    ctx.save();
    for (const f of hole.fairway) { rr(f.x, f.y, f.w, f.h, 3); ctx.clip(); }
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let y = 0; y < 160; y += 16) ctx.fillRect(px(0), py(y), 100 * S, 8 * S);
    ctx.restore();
    // hazards
    for (const s of hole.sand) { rr(s.x, s.y, s.w, s.h, 2.5); ctx.fillStyle = "#e7d7a4"; ctx.fill(); }
    for (const w of hole.water) {
      rr(w.x, w.y, w.w, w.h, 2.5);
      ctx.fillStyle = "#7fb3d9";
      ctx.fill();
      ctx.save();
      rr(w.x, w.y, w.w, w.h, 2.5);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1.5;
      for (let yy = w.y + 5; yy < w.y + w.h; yy += 8) {
        ctx.beginPath();
        ctx.moveTo(px(w.x + 4), py(yy));
        ctx.quadraticCurveTo(px(w.x + w.w / 2), py(yy - 2.5), px(w.x + w.w - 4), py(yy));
        ctx.stroke();
      }
      ctx.restore();
    }
    // cup + flag
    ctx.beginPath();
    ctx.arc(px(hole.cup.x), py(hole.cup.y), CUP_R * S, 0, Math.PI * 2);
    ctx.fillStyle = "#26332a";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px(hole.cup.x), py(hole.cup.y));
    ctx.lineTo(px(hole.cup.x), py(hole.cup.y - 9));
    ctx.strokeStyle = "#f5efdf";
    ctx.lineWidth = Math.max(1.5, 0.8 * S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px(hole.cup.x), py(hole.cup.y - 9));
    ctx.lineTo(px(hole.cup.x + 6), py(hole.cup.y - 6.8));
    ctx.lineTo(px(hole.cup.x), py(hole.cup.y - 4.6));
    ctx.closePath();
    ctx.fillStyle = "#ff6e5e";
    ctx.fill();
  }

  function drawBall(x, y) {
    ctx.beginPath();
    ctx.ellipse(px(x) + 1.2, py(y) + 1.6, BALL_R * S, BALL_R * S * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fill();
    const g = ctx.createRadialGradient(px(x) - S * 0.5, py(y) - S * 0.5, S * 0.2, px(x), py(y), BALL_R * S);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, "#d8d2c0");
    ctx.beginPath();
    ctx.arc(px(x), py(y), BALL_R * S, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
  }

  let dragFrom = null, dragNow = null;
  let rolling = null; // {points, i, result}

  function draw() {
    if (!ctx) return;
    drawHole();
    const pos = rolling ? rolling.points[rolling.i] : ball;
    // aim preview: dotted line opposite the pull, length = power
    if (dragFrom && dragNow && !rolling) {
      const dx = dragFrom.x - dragNow.x, dy = dragFrom.y - dragNow.y;
      const pull = Math.hypot(dx, dy);
      if (pull > 8) {
        const power = Math.min(1, pull / (44 * S / 10) / 10); // ~full at 44 units
        const len = 6 + power * 30;
        const ang = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(px(pos.x), py(pos.y));
        ctx.lineTo(px(pos.x + Math.cos(ang) * len), py(pos.y + Math.sin(ang) * len));
        ctx.setLineDash([5, 6]);
        ctx.lineWidth = 3;
        ctx.strokeStyle = power > 0.85 ? "#ff6e5e" : "#f5c542";
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    drawBall(pos.x, pos.y);
  }

  function hud() {
    const hole = HOLES[holeIdx];
    holeEl.innerHTML = `Hole ${holeIdx + 1}<i>/${HOLES.length}</i> · Par ${hole.par}`;
    scoreEl.textContent = `${cur} here · ${totalStrokes()} total`;
  }

  function note(text) {
    noteEl.textContent = text || " ";
  }

  // ── Shooting ───────────────────────────────────────────────────────────
  function shoot(angle, power) {
    if (ended || rolling) return;
    const hole = HOLES[holeIdx];
    cur++;
    hud();
    const result = simulateShot(hole, ball, angle, power);
    rolling = { points: result.points, i: 0, result };
    const step = () => {
      if (!rolling) return;
      rolling.i = Math.min(rolling.points.length - 1, rolling.i + 3);
      draw();
      if (rolling.i < rolling.points.length - 1) requestAnimationFrame(step);
      else settle();
    };
    requestAnimationFrame(step);
  }

  function settle() {
    const { result } = rolling;
    rolling = null;
    ball = { ...result.end };
    if (result.water) {
      cur++; // penalty stroke
      note("Splash! One-stroke penalty.");
    } else if (result.sunk) {
      return holeDone(false);
    } else if (cur >= STROKE_CAP) {
      note(`That's ${STROKE_CAP} — picking up.`);
      return holeDone(true);
    }
    hud();
    report();
    draw();
  }

  function holeDone(pickedUp) {
    const hole = HOLES[holeIdx];
    const diff = cur - hole.par;
    const call = pickedUp ? "Picked up" :
      diff <= -2 ? "An eagle?!" : diff === -1 ? "Birdie!" : diff === 0 ? "Par." :
      diff === 1 ? "Bogey." : `+${diff}.`;
    note(`${call} ${hole.name} in ${cur}.`);
    perHole[holeIdx] = cur;
    cur = 0;
    if (holeIdx + 1 >= HOLES.length) {
      report();
      return finish();
    }
    holeIdx++;
    ball = { ...HOLES[holeIdx].tee };
    hud();
    report();
    setTimeout(() => { if (!ended) { note(`Hole ${holeIdx + 1}: ${HOLES[holeIdx].name}, par ${HOLES[holeIdx].par}.`); draw(); } }, 900);
    draw();
  }

  function finish() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    const seconds = elapsedSec();
    const strokes = perHole.reduce((a, b) => a + b, 0);
    setTimeout(() => onDone({
      score: encode(strokes, seconds), strokes, seconds, holes: perHole.slice(),
    }), 1100);
  }

  // ── Input: pull back and release ───────────────────────────────────────
  function onPointerDown(e) {
    if (ended || rolling) return;
    dragFrom = { x: e.clientX, y: e.clientY };
    dragNow = dragFrom;
    draw();
  }

  function onPointerMove(e) {
    if (!dragFrom) return;
    dragNow = { x: e.clientX, y: e.clientY };
    draw();
  }

  function onPointerUp(e) {
    if (!dragFrom) return;
    const dx = dragFrom.x - e.clientX, dy = dragFrom.y - e.clientY;
    const pull = Math.hypot(dx, dy);
    dragFrom = dragNow = null;
    if (pull > 12 && !rolling && !ended) {
      const angle = Math.atan2(dy, dx);
      const power = Math.min(1, pull / (4.4 * S * 10)) * MAX_POWER;
      shoot(angle, Math.max(14, power));
    } else {
      draw();
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("resize", resize);

  hud();
  note(`Hole ${holeIdx + 1}: ${HOLES[holeIdx].name}, par ${HOLES[holeIdx].par}. Pull back from the ball and let go.`);
  resize();

  return function destroy() {
    ended = true;
    clearInterval(timer);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("resize", resize);
  };
}
