// One Cup Pong run: drag from the ball and flick up — sink all 10 cups in
// as few throws as you can. Fewest throws wins the match; time breaks ties.
//
// mountRound(container, opts) -> destroy()
//   opts: { me, results, onDone, reportProgress, onRivalUpdate }
//   onDone({ score, throws, seconds })  — score = throws*10000 + seconds
//
// Everything on the table is drawn into one canvas in a fake-3D view:
// depth shrinks and raises things, the ball flies a parabola with its
// shadow staying on the table. The mapping from swipe to landing point is
// pure engine math — the animation is presentation only.

import {
  CUPS, CUP_R, THROW_MIN, aimFromSwipe, resolveLanding, encodeScore, decodeScore,
} from "./engine.js";
// (CUP_R doubles as the visual radius — see cupPx below)

export function mountRound(container, opts) {
  const { me, results, onDone, reportProgress, onRivalUpdate } = opts;

  // Restore a run in progress (refresh mid-game); the clock never resets.
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
      <p class="sc-note" data-note>Flick up from the ball. Long flick, long throw.</p>
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

  // ── Canvas + fake 3D ───────────────────────────────────────────────────
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;

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

  // one unit system: cups draw at exactly their logical radius, so what
  // you see is what the hit test uses
  const XPROJ = 0.42;
  const depthScale = (z) => 1 - 0.34 * Math.min(1.1, z);
  const yAt = (z) => H * (0.86 - 0.60 * z);
  const xAt = (x, z) => W / 2 + x * W * XPROJ * depthScale(z);
  const cupPx = (z) => CUP_R * W * XPROJ * depthScale(z);
  const BALL_HOME = { x: 0, z: 0 };

  function drawTable() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    // felt
    const topW = W * 0.34 * depthScale(1.05), botW = W * 0.44;
    ctx.beginPath();
    ctx.moveTo(W / 2 - botW, H * 0.97);
    ctx.lineTo(W / 2 - topW, yAt(1.05));
    ctx.lineTo(W / 2 + topW, yAt(1.05));
    ctx.lineTo(W / 2 + botW, H * 0.97);
    ctx.closePath();
    const felt = ctx.createLinearGradient(0, yAt(1.05), 0, H);
    felt.addColorStop(0, "#1d5c43");
    felt.addColorStop(1, "#2c7a58");
    ctx.fillStyle = felt;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();
    // center line
    ctx.beginPath();
    ctx.moveTo(W / 2, H * 0.965);
    ctx.lineTo(W / 2, yAt(1.05));
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.stroke();
  }

  function drawCup(cup, scalePulse = 1, fade = 1) {
    const cx = xAt(cup.x, cup.z), cy = yAt(cup.z);
    const rTop = cupPx(cup.z) * scalePulse, rBot = rTop * 0.62, h = rTop * 1.5;
    ctx.globalAlpha = fade;
    // body
    const grad = ctx.createLinearGradient(cx - rTop, 0, cx + rTop, 0);
    grad.addColorStop(0, "#a43227");
    grad.addColorStop(0.5, "#d64b3a");
    grad.addColorStop(1, "#8f291f");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cx - rTop, cy - h / 2);
    ctx.lineTo(cx - rBot, cy + h / 2);
    ctx.quadraticCurveTo(cx, cy + h / 2 + rBot * 0.35, cx + rBot, cy + h / 2);
    ctx.lineTo(cx + rTop, cy - h / 2);
    ctx.closePath();
    ctx.fill();
    // rim
    ctx.beginPath();
    ctx.ellipse(cx, cy - h / 2, rTop, rTop * 0.34, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#e9e2d2";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, cy - h / 2, rTop * 0.8, rTop * 0.26, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#6d1f17";
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawBall(x, z, height, scale = 1) {
    const cx = xAt(x, z), groundY = yAt(z);
    const r = cupPx(z) * 0.42 * scale;
    // shadow stays on the table
    ctx.beginPath();
    ctx.ellipse(cx, groundY, r * (1 - height * 0.35), r * 0.4 * (1 - height * 0.35), 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fill();
    // ball
    const by = groundY - height * H * 0.34 * depthScale(z);
    const grad = ctx.createRadialGradient(cx - r * 0.3, by - r * 0.3, r * 0.2, cx, by, r);
    grad.addColorStop(0, "#ffffff");
    grad.addColorStop(1, "#c9c2ae");
    ctx.beginPath();
    ctx.arc(cx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  let anim = null; // {landing, result, t0} while a ball is in the air
  let sinkAnim = null; // {cup, t0}
  let dragFrom = null, dragNow = null;

  function draw() {
    if (!ctx) return;
    drawTable();
    // far cups first so nearer cups overlap them
    const order = CUPS.map((c, i) => ({ c, i })).sort((a, b) => b.c.z - a.c.z);
    for (const { c, i } of order) {
      if (alive[i]) drawCup(c);
      else if (sinkAnim && sinkAnim.cup === i) {
        const t = Math.min(1, (performance.now() - sinkAnim.t0) / 420);
        drawCup(c, 1 - 0.25 * t, 1 - t);
      }
    }
    if (anim) {
      const t = Math.min(1, (performance.now() - anim.t0) / 750);
      const x = anim.landing.x * t, z = anim.landing.z * t;
      drawBall(x, z, Math.sin(Math.PI * Math.min(1, t)) * (0.55 + 0.25 * anim.landing.z));
    } else {
      drawBall(BALL_HOME.x, BALL_HOME.z, 0);
    }
    // aim arrow while dragging
    if (dragFrom && dragNow && !anim) {
      const bx = xAt(0, 0), by = yAt(0);
      const dx = dragNow.x - dragFrom.x, dy = dragFrom.y - dragNow.y;
      if (dy > 4) {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + dx * 1.6, by - dy * 1.6);
        ctx.strokeStyle = "rgba(245, 197, 66, 0.85)";
        ctx.lineWidth = 4;
        ctx.setLineDash([7, 7]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
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
  function throwBall(dxN, dyN) {
    if (ended || anim) return;
    const landing = aimFromSwipe(dxN, dyN);
    const result = resolveLanding(landing, alive);
    throws++;
    anim = { landing, result, t0: performance.now() };
    hud();
    const step = () => {
      if (ended && !anim) return;
      draw();
      if (performance.now() - anim.t0 < 750) {
        requestAnimationFrame(step);
      } else {
        settle();
      }
    };
    requestAnimationFrame(step);
  }

  function settle() {
    const { result } = anim;
    anim = null;
    if (Number.isInteger(result.hit)) {
      alive[result.hit] = false;
      sinkAnim = { cup: result.hit, t0: performance.now() };
      const left = alive.filter(Boolean).length;
      note(left ? ["Splash!", "Sunk it!", "Right in.", "Nothing but cup."][left % 4] : "Rack cleared!");
      const fade = () => {
        draw();
        if (sinkAnim && performance.now() - sinkAnim.t0 < 420) requestAnimationFrame(fade);
        else { sinkAnim = null; draw(); }
      };
      requestAnimationFrame(fade);
    } else if (Number.isInteger(result.rim)) {
      note("Rimmed out!");
      draw();
    } else {
      note("Air ball.");
      draw();
    }
    hud();
    report();
    if (!alive.some(Boolean)) finish();
  }

  function finish() {
    if (ended) return;
    ended = true;
    clearInterval(timer);
    const seconds = elapsedSec();
    setTimeout(() => onDone({ score: encodeScore(throws, seconds), throws, seconds }), 900);
  }

  // ── Input ──────────────────────────────────────────────────────────────
  function onPointerDown(e) {
    if (ended || anim) return;
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
    const ref = Math.max(320, window.innerHeight);
    const dxN = (e.clientX - dragFrom.x) / ref;
    const dyN = (dragFrom.y - e.clientY) / ref;
    dragFrom = dragNow = null;
    if (dyN >= THROW_MIN) throwBall(dxN, dyN);
    else draw();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("resize", resize);

  hud();
  resize();
  // a refresh right at the end still banks the run
  if (!alive.some(Boolean)) finish();

  return function destroy() {
    ended = true;
    clearInterval(timer);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("resize", resize);
  };
}
