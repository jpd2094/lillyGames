// One Cup Pong run: flick the ball at the rack — GamePigeon-style scene
// with a panelled wall, wood floor and a bordered table; cups show their
// interiors, the ball arcs with a live shadow, and rim hits bounce.
//
// mountRound(container, opts) -> destroy()
//   opts: { me, results, onDone, reportProgress, onRivalUpdate }
//   onDone({ score, throws, seconds })  — score = throws*10000 + seconds
//
// No aim line: power is how far AND how fast you flick (engine.aimFromFlick),
// measured from the pointer's last ~90ms before release.

import {
  CUPS, CUP_R, THROW_MIN, aimFromFlick, bounceFrom, resolveLanding, encodeScore, decodeScore,
} from "./engine.js";

export function mountRound(container, opts) {
  const { me, results, onDone, reportProgress, onRivalUpdate } = opts;

  const prior = results?.[me]?.progress;
  const startedAt = Number(prior?.startedAt) || Date.now();
  let alive = typeof prior?.cups === "string" && /^[01]{10}$/.test(prior.cups)
    ? [...prior.cups].map((c) => c === "1")
    : CUPS.map(() => true);
  let throws = Number.isInteger(prior?.throws) && prior.throws >= 0 ? prior.throws : 0;
  let ended = false;

  container.innerHTML = `
    <div class="round cp">
      <div class="round-top">
        <span class="round-chip" data-cups></span>
        <span class="round-clock su-clock" data-clock>0:00</span>
        <span class="su-fill" data-throws></span>
      </div>
      <div class="su-rival" data-rival hidden></div>
      <p class="sc-note" data-note>Flick the ball at the cups — snap of the wrist and all.</p>
      <div class="cp-table"><canvas data-canvas></canvas></div>
    </div>`;

  const el = (s) => container.querySelector(s);
  const canvas = el("[data-canvas]");
  const noteEl = el("[data-note]"), clockEl = el("[data-clock]");
  const cupsEl = el("[data-cups]"), throwsEl = el("[data-throws]"), rivalEl = el("[data-rival]");

  const elapsedSec = () => Math.max(1, Math.round((Date.now() - startedAt) / 1000));
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const timer = setInterval(() => { clockEl.textContent = fmt(elapsedSec()); }, 250);
  clockEl.textContent = fmt(elapsedSec());

  const report = () => reportProgress?.({
    startedAt, throws, cups: alive.map((a) => (a ? "1" : "0")).join(""), at: Date.now(),
  });
  report();

  onRivalUpdate?.((entry) => {
    if (ended) return;
    const finished = entry?.rounds?.filter(Boolean)?.length;
    if (finished) {
      const { throws: t, seconds } = decodeScore(entry.total);
      rivalEl.hidden = false;
      rivalEl.textContent = `Rival cleared the rack in ${t} throws · ${fmt(seconds)} — beat it!`;
      return;
    }
    const p = entry?.progress;
    if (typeof p?.cups === "string" && /^[01]{10}$/.test(p.cups)) {
      const left = [...p.cups].filter((c) => c === "1").length;
      rivalEl.hidden = false;
      rivalEl.textContent = `Rival: ${left} cup${left === 1 ? "" : "s"} left · ${Number(p.throws) || 0} throws`;
    }
  });

  // ── Scene geometry ─────────────────────────────────────────────────────
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;
  const WALL_H = 0.16;   // fraction of canvas height given to the back wall
  const FLOOR_H = 0.045; // wood strip between wall and table's far edge

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
    draw();
  }

  const XPROJ = 0.46;
  const depthScale = (z) => 1 - 0.30 * Math.min(1.15, z);
  const yAt = (z) => H * (0.93 - (0.93 - WALL_H - FLOOR_H) * (z / 1.15));
  const xAt = (x, z) => W / 2 + x * W * XPROJ * depthScale(z);
  const cupPx = (z) => CUP_R * W * XPROJ * depthScale(z);

  function drawScene() {
    if (!ctx) return;
    // wall: deep teal wainscot with a hint of panelling
    ctx.fillStyle = "#22403c";
    ctx.fillRect(0, 0, W, H * (WALL_H + FLOOR_H));
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 3;
    for (const px of [0.16, 0.5, 0.84]) {
      ctx.strokeRect(W * px - W * 0.11, H * 0.025, W * 0.22, H * WALL_H * 0.62);
    }
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(0, H * WALL_H * 0.82, W, 4);
    // wood floor strip
    const floorY = H * WALL_H;
    const wood = ctx.createLinearGradient(0, floorY, 0, floorY + H * FLOOR_H + 8);
    wood.addColorStop(0, "#a97d4e");
    wood.addColorStop(1, "#8a6038");
    ctx.fillStyle = wood;
    ctx.fillRect(0, floorY, W, H - floorY);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo((W / 8) * i, floorY);
      ctx.lineTo((W / 8) * i, H);
      ctx.stroke();
    }
    // table: trapezoid with a white trim border, like the reference
    const zFar = 1.13, zNear = -0.06;
    const trim = (inset) => {
      ctx.beginPath();
      ctx.moveTo(xAt(-1.02 + inset, zNear), yAt(zNear) - inset * W * 0.02);
      ctx.lineTo(xAt(-1.02 + inset, zFar), yAt(zFar) + inset * W * 0.02);
      ctx.lineTo(xAt(1.02 - inset, zFar), yAt(zFar) + inset * W * 0.02);
      ctx.lineTo(xAt(1.02 - inset, zNear), yAt(zNear) - inset * W * 0.02);
      ctx.closePath();
    };
    trim(0);
    ctx.fillStyle = "#f0ead8";
    ctx.fill();
    trim(0.045);
    const felt = ctx.createLinearGradient(0, yAt(zFar), 0, yAt(zNear));
    felt.addColorStop(0, "#41645a");
    felt.addColorStop(1, "#4d7265");
    ctx.fillStyle = felt;
    ctx.fill();
    // center line
    ctx.beginPath();
    ctx.moveTo(xAt(0, zNear), yAt(zNear));
    ctx.lineTo(xAt(0, zFar), yAt(zFar));
    ctx.strokeStyle = "rgba(245,241,228,0.9)";
    ctx.lineWidth = Math.max(2, W * 0.008);
    ctx.stroke();
  }

  function drawCup(cup, scalePulse = 1, fade = 1) {
    const cx = xAt(cup.x, cup.z), cy = yAt(cup.z);
    const r = cupPx(cup.z) * scalePulse;   // rim radius
    const h = r * 2.2;                      // cup height
    const rBot = r * 0.58;
    const rimRy = r * 0.42;                 // seen a little from above
    ctx.globalAlpha = fade;
    // shadow on the felt
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.18, cy + r * 0.28, r * 1.05, rimRy * 0.8, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fill();
    // body
    const grad = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    grad.addColorStop(0, "#8f2318");
    grad.addColorStop(0.28, "#c63b2a");
    grad.addColorStop(0.55, "#e05540");
    grad.addColorStop(0.8, "#b02f20");
    grad.addColorStop(1, "#7c1d13");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - h);
    ctx.lineTo(cx - rBot, cy - rimRy * 0.3);
    ctx.quadraticCurveTo(cx, cy + rBot * 0.5, cx + rBot, cy - rimRy * 0.3);
    ctx.lineTo(cx + r, cy - h);
    ctx.closePath();
    ctx.fill();
    // glossy highlight
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy - h * 0.97);
    ctx.lineTo(cx - r * 0.34, cy - rimRy * 0.5);
    ctx.lineTo(cx - r * 0.18, cy - rimRy * 0.5);
    ctx.lineTo(cx - r * 0.38, cy - h * 0.97);
    ctx.closePath();
    ctx.fill();
    // mouth: white lip, then the interior
    ctx.beginPath();
    ctx.ellipse(cx, cy - h, r, rimRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#f3eee0";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy - h, r * 0.84, rimRy * 0.82, 0, 0, Math.PI * 2);
    const inner = ctx.createLinearGradient(0, cy - h - rimRy, 0, cy - h + rimRy);
    inner.addColorStop(0, "#d9d2bd");
    inner.addColorStop(1, "#f7f3e6");
    ctx.fillStyle = inner;
    ctx.fill();
    // inner far wall shading
    ctx.beginPath();
    ctx.ellipse(cx, cy - h - rimRy * 0.18, r * 0.8, rimRy * 0.5, 0, Math.PI, Math.PI * 2);
    ctx.fillStyle = "rgba(90,60,50,0.35)";
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawBall(x, z, height, scale = 1) {
    const cx = xAt(x, z), groundY = yAt(z);
    const r = Math.max(4, cupPx(z) * 0.42 * scale);
    ctx.beginPath();
    ctx.ellipse(cx, groundY, r * (1 - height * 0.35), r * 0.38 * (1 - height * 0.35), 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();
    const by = groundY - height * H * 0.32 * depthScale(z) - r * 0.5;
    const grad = ctx.createRadialGradient(cx - r * 0.35, by - r * 0.35, r * 0.15, cx, by, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(0.75, "#e8e2d2");
    grad.addColorStop(1, "#b9b19a");
    ctx.beginPath();
    ctx.arc(cx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // ── Animation state ────────────────────────────────────────────────────
  // anim: {from, to, t0, dur, apex, result, phase: "throw"|"bounce"}
  let anim = null;
  let sinkAnim = null;

  function draw() {
    if (!ctx) return;
    drawScene();
    const order = CUPS.map((c, i) => ({ c, i })).sort((a, b) => b.c.z - a.c.z);
    for (const { c, i } of order) {
      if (alive[i]) drawCup(c);
      else if (sinkAnim && sinkAnim.cup === i) {
        const t = Math.min(1, (performance.now() - sinkAnim.t0) / 420);
        drawCup(c, 1 - 0.25 * t, 1 - t);
      }
    }
    if (anim) {
      const t = Math.min(1, (performance.now() - anim.t0) / anim.dur);
      const x = anim.from.x + (anim.to.x - anim.from.x) * t;
      const z = anim.from.z + (anim.to.z - anim.from.z) * t;
      drawBall(x, z, Math.sin(Math.PI * t) * anim.apex);
    } else {
      drawBall(0, 0, 0);
    }
  }

  function hud() {
    const left = alive.filter(Boolean).length;
    cupsEl.innerHTML = `${left}<i> cups left</i>`;
    throwsEl.textContent = `${throws} throw${throws === 1 ? "" : "s"}`;
  }

  function note(text) {
    noteEl.textContent = text || " ";
  }

  // ── Throwing ───────────────────────────────────────────────────────────
  function animate(from, to, dur, apex, done) {
    anim = { from, to, t0: performance.now(), dur, apex };
    const step = () => {
      draw();
      if (anim && performance.now() - anim.t0 < anim.dur) requestAnimationFrame(step);
      else { anim = null; done(); }
    };
    requestAnimationFrame(step);
  }

  function throwBall(dxN, dyN, v) {
    if (ended || anim) return;
    const landing = aimFromFlick(dxN, dyN, v);
    throws++;
    hud();
    animate({ x: 0, z: 0 }, landing, 720, 0.55 + 0.22 * Math.min(1.1, landing.z), () => {
      const result = resolveLanding(landing, alive);
      if (Number.isInteger(result.hit)) return sink(result.hit);
      if (Number.isInteger(result.rim)) {
        // real rim physics: one deterministic hop off the edge
        const second = bounceFrom(landing, CUPS[result.rim]);
        note("Off the rim…");
        return animate(landing, second, 340, 0.18, () => {
          const r2 = resolveLanding(second, alive);
          if (Number.isInteger(r2.hit)) return sink(r2.hit, true);
          note("Rimmed out!");
          afterThrow();
        });
      }
      note(landing.z > 1.05 ? "Long — off the table." : landing.z < 0.4 ? "Short." : "Air ball.");
      afterThrow();
    });
  }

  function sink(idx, offBounce = false) {
    alive[idx] = false;
    sinkAnim = { cup: idx, t0: performance.now() };
    const left = alive.filter(Boolean).length;
    note(!left ? "Rack cleared!" : offBounce ? "Bounced in?!" : ["Splash!", "Sunk it!", "Right in.", "Nothing but cup."][left % 4]);
    const fade = () => {
      draw();
      if (sinkAnim && performance.now() - sinkAnim.t0 < 420) requestAnimationFrame(fade);
      else { sinkAnim = null; draw(); }
    };
    requestAnimationFrame(fade);
    afterThrow();
  }

  function afterThrow() {
    hud();
    report();
    draw();
    if (!alive.some(Boolean)) finish();
  }

  function finish() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    const seconds = elapsedSec();
    setTimeout(() => onDone({ score: encodeScore(throws, seconds), throws, seconds }), 900);
  }

  // ── Input: a real flick — direction from the path, speed from the tail ─
  let trail = null; // [{x, y, t}, ...] while the pointer is down

  function onPointerDown(e) {
    if (ended || anim) return;
    trail = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
  }

  function onPointerMove(e) {
    if (!trail) return;
    trail.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (trail.length > 40) trail.shift();
  }

  function onPointerUp(e) {
    if (!trail) return;
    const start = trail[0];
    const end = { x: e.clientX, y: e.clientY, t: performance.now() };
    const ref = Math.max(320, window.innerHeight);
    const dxN = (end.x - start.x) / ref;
    const dyN = (start.y - end.y) / ref;
    // release speed: displacement over the trail's last ~90ms
    const cutoff = end.t - 90;
    let tail = trail.find((p) => p.t >= cutoff) || start;
    const dt = Math.max(1, end.t - tail.t);
    const v = Math.hypot(end.x - tail.x, end.y - tail.y) / dt; // px/ms
    trail = null;
    if (dyN >= THROW_MIN * 0.6 && (dyN >= THROW_MIN || v > 0.9)) throwBall(dxN, dyN, v);
    else draw();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("resize", resize);

  hud();
  resize();
  if (!alive.some(Boolean)) finish();

  return function destroy() {
    ended = true;
    clearInterval(timer);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("resize", resize);
  };
}
