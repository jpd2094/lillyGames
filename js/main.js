// Lilly Games — platform shell.
// Owns: session (username), routing, match lifecycle, rivalry stats.
// Games own: how a round is played and scored (see js/games/registry.js).
//
// Match flow is LOCKSTEP: each round's result is saved to the store the
// moment the round ends, and round N+1 only unlocks once BOTH players have
// finished round N. Whoever finishes a round second rolls straight into the
// next one; whoever finishes first waits (live) for the other.

import { initStore } from "./store/index.js";
import { GAMES, getGame } from "./games/registry.js";
import { USE_FIREBASE } from "./config.js";

const app = document.getElementById("app");
let store = null;
let cleanup = null; // per-view teardown (unsubscribes, timers)

// ── Session ──────────────────────────────────────────────────────────────
const session = {
  get user() { return localStorage.getItem("lilly.user"); },
  set user(v) { v ? localStorage.setItem("lilly.user", v) : localStorage.removeItem("lilly.user"); },
};

// ── Helpers ──────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function normName(s) {
  return s.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 20);
}

function randomSeed() {
  return Math.random().toString(36).slice(2, 10);
}

function fmtDate(ms) {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function setView(html) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

function demoBanner() {
  return USE_FIREBASE ? "" :
    `<p class="demo-note">Demo mode — scores live on this device only. See README to connect Firebase.</p>`;
}

// ── Derived match state ──────────────────────────────────────────────────
// Nothing about progress or the winner is stored — it's all computed from
// results at read time. With both players submitting rounds concurrently,
// a stored status field could go stale on a write race; a derived one can't.
function roundsDone(match, player) {
  return (match.results[player]?.rounds || []).filter(Boolean).length;
}

function totalOf(match, player) {
  return (match.results[player]?.rounds || [])
    .reduce((sum, r) => sum + (Number(r?.score) || 0), 0);
}

function isComplete(match) {
  return match.players.every((p) => roundsDone(match, p) >= match.rounds);
}

function winnerOf(match) {
  if (!isComplete(match)) return null;
  const [a, b] = match.players;
  const ta = totalOf(match, a), tb = totalOf(match, b);
  return ta === tb ? "tie" : ta > tb ? a : b;
}

// Lockstep rule: I may play round N+1 only if my opponent has finished at
// least as many rounds as I have. (Round 1 is always open to both.)
function canPlay(match, me) {
  const rival = match.players.find((p) => p !== me) || me;
  const mine = roundsDone(match, me);
  return mine < match.rounds && mine <= roundsDone(match, rival);
}

// ── Router ───────────────────────────────────────────────────────────────
const routes = [
  { re: /^#?\/?$/, view: viewHome },
  { re: /^#\/login$/, view: viewLogin },
  { re: /^#\/new$/, view: viewNew },
  { re: /^#\/match\/([a-zA-Z0-9]+)$/, view: viewMatch },
];

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  if (!store) store = await initStore();

  const hash = location.hash || "#/";
  if (!session.user && hash !== "#/login") { location.hash = "#/login"; return; }

  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) { cleanup = (await r.view(...m.slice(1))) || null; return; }
  }
  location.hash = "#/";
}

window.addEventListener("hashchange", route);
route();

// Warm caches in the background so the first round starts instantly.
setTimeout(() => GAMES.forEach((g) => g.prepare().catch(() => {})), 500);

// ── Views ────────────────────────────────────────────────────────────────

function viewLogin() {
  setView(`
    <main class="login">
      <div class="login-tiles" aria-hidden="true">
        ${"LILLY".split("").map((ch, i) => `<span class="minitile" style="--d:${i * 70}ms">${ch}</span>`).join("")}
      </div>
      <h1 class="wordmark">Lilly&nbsp;Games</h1>
      <p class="login-sub">Two players. One grid. Old grudges.</p>
      <form class="login-form" data-form>
        <input type="text" data-name inputmode="text" autocapitalize="none" autocomplete="username"
               maxlength="20" placeholder="pick a username" aria-label="Username" required>
        <button type="submit" class="btn btn-primary">Go</button>
      </form>
      ${demoBanner()}
    </main>`);

  const form = app.querySelector("[data-form]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = normName(form.querySelector("[data-name]").value);
    if (!name) return;
    await store.ensureUser(name);
    session.user = name;
    location.hash = "#/";
  });
}

async function viewHome() {
  const me = session.user;
  setView(`
    <main class="home">
      <header class="home-head">
        <h1 class="wordmark wordmark-sm">Lilly&nbsp;Games</h1>
        <button class="userchip" data-logout title="Switch player">${esc(me)}</button>
      </header>
      ${demoBanner()}
      <div data-content><p class="loading">Dealing tiles…</p></div>
      <a class="btn btn-primary btn-new" href="#/new">New match</a>
    </main>`);

  app.querySelector("[data-logout]").addEventListener("click", () => {
    if (confirm("Switch player?")) { session.user = null; location.hash = "#/login"; }
  });

  const content = app.querySelector("[data-content]");
  const unsub = store.subscribeMatchesFor(me, (matches) => {
    content.innerHTML = renderHome(me, matches);
  });
  return unsub;
}

function renderHome(me, matches) {
  const done = matches.filter((m) => isComplete(m));
  const myMove = matches.filter((m) => !isComplete(m) && canPlay(m, me));
  const waiting = matches.filter((m) => !isComplete(m) && !canPlay(m, me));

  // Rivalry ledger: lifetime record per opponent
  const rivals = {};
  for (const m of done) {
    const rival = m.players.find((p) => p !== me) || me;
    const r = rivals[rival] || (rivals[rival] = { wins: 0, losses: 0, ties: 0 });
    const w = winnerOf(m);
    if (w === "tie") r.ties++;
    else if (w === me) r.wins++;
    else r.losses++;
  }

  const rivalryHtml = Object.entries(rivals)
    .sort((a, b) => (b[1].wins + b[1].losses + b[1].ties) - (a[1].wins + a[1].losses + a[1].ties))
    .map(([rival, r]) => {
      const total = r.wins + r.losses + r.ties;
      const pct = total ? ((r.wins + r.ties / 2) / total) * 100 : 50;
      return `
        <div class="rivalry">
          <div class="rivalry-names"><b>${esc(me)}</b><span>vs</span><b>${esc(rival)}</b></div>
          <div class="tug" role="img" aria-label="${r.wins} wins, ${r.losses} losses, ${r.ties} ties">
            <div class="tug-me" style="width:${pct}%"></div>
          </div>
          <div class="rivalry-record"><span>${r.wins}W</span><span>${r.ties}T</span><span>${r.losses}L</span></div>
        </div>`;
    }).join("");

  const card = (m, badge) => {
    const rival = m.players.find((p) => p !== me) || me;
    const game = getGame(m.gameId);
    return `
      <a class="match-card" href="#/match/${m.id}">
        <span class="match-game">${esc(game ? game.name : m.gameId)}</span>
        <span class="match-vs">vs ${esc(rival)}</span>
        <span class="match-date">${fmtDate(m.createdAt)}</span>
        ${badge(m, rival)}
      </a>`;
  };

  const playBadge = (m) =>
    `<span class="badge is-go">Play round ${roundsDone(m, me) + 1}</span>`;

  const waitBadge = (m, rival) =>
    `<span class="badge">${roundsDone(m, me) >= m.rounds ? "Sealed" : `Their round ${roundsDone(m, rival) + 1}`}</span>`;

  const finalBadge = (m, rival) => {
    const mine = totalOf(m, me), theirs = totalOf(m, rival);
    const w = winnerOf(m);
    const cls = w === "tie" ? "is-tie" : w === me ? "is-win" : "is-loss";
    const label = w === "tie" ? "Tie" : w === me ? "Won" : "Lost";
    return `<span class="badge ${cls}">${label} ${mine}–${theirs}</span>`;
  };

  return `
    ${rivalryHtml ? `<section class="section"><h2>Rivalries</h2>${rivalryHtml}</section>` : ""}
    ${myMove.length ? `<section class="section"><h2>Your move</h2>${myMove.map((m) => card(m, playBadge)).join("")}</section>` : ""}
    ${waiting.length ? `<section class="section"><h2>Waiting on them</h2>${waiting.map((m) => card(m, waitBadge)).join("")}</section>` : ""}
    ${done.length ? `<section class="section"><h2>Finished games</h2>${done.slice(0, 20).map((m) => card(m, finalBadge)).join("")}</section>` : ""}
    ${!matches.length ? `<section class="section empty-state">
        <p>No matches yet. Start one and send your rival the word.</p>
      </section>` : ""}`;
}

function viewNew() {
  const me = session.user;
  setView(`
    <main class="new-match">
      <header class="page-head"><a class="back" href="#/">&larr;</a><h1>New match</h1></header>
      <form data-form>
        <h2>Game</h2>
        <div class="game-pick">
          ${GAMES.map((g, i) => `
            <label class="game-option">
              <input type="radio" name="game" value="${g.id}" ${i === 0 ? "checked" : ""}>
              <span class="game-option-card"><b>${esc(g.name)}</b><small>${esc(g.tagline)}</small>
              <em>${g.rounds} rounds · ${g.roundSeconds}s each</em></span>
            </label>`).join("")}
        </div>
        <h2>Rival</h2>
        <input type="text" data-rival autocapitalize="none" maxlength="20"
               placeholder="their username" aria-label="Opponent username" required>
        <p class="hint">They log in with this exact name to play their side.</p>
        <button type="submit" class="btn btn-primary" data-create>Deal the tiles</button>
      </form>
    </main>`);

  const form = app.querySelector("[data-form]");
  const createBtn = form.querySelector("[data-create]");
  let creating = false; // guards against double-taps creating duplicate matches

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (creating) return;
    const rival = normName(form.querySelector("[data-rival]").value);
    if (!rival) return;
    if (rival === me) { alert("You can't play yourself. That's called practice."); return; }
    creating = true;
    createBtn.disabled = true;
    createBtn.textContent = "Dealing…";
    try {
      const gameId = form.querySelector("[name=game]:checked").value;
      const game = getGame(gameId);
      await store.ensureUser(rival);
      const match = await store.createMatch({
        gameId, players: [me, rival], createdBy: me, seed: randomSeed(), rounds: game.rounds,
      });
      location.hash = `#/match/${match.id}`;
    } catch (err) {
      creating = false;
      createBtn.disabled = false;
      createBtn.textContent = "Deal the tiles";
      alert(`Couldn't create the match (${err.message}). Try again.`);
    }
  });
}

async function viewMatch(id) {
  const me = session.user;
  const match = await store.getMatch(id);
  if (!match) { setView(`<main class="page"><p class="loading">Match not found.</p><a class="btn" href="#/">Home</a></main>`); return; }
  if (!match.players.includes(me)) {
    setView(`<main class="page"><p class="loading">This match is between ${esc(match.players.join(" and "))}.</p><a class="btn" href="#/">Home</a></main>`);
    return;
  }

  const rival = match.players.find((p) => p !== me);
  const game = getGame(match.gameId);

  if (isComplete(match)) return renderResults(match, game, me, rival);
  if (canPlay(match, me)) return playFlow(match, game, me, rival);
  return waitScreen(match, game, me, rival);
}

// ── Play flow: ready screen → round → save → next round or wait ─────────
function playFlow(match, game, me, rival) {
  let destroyRound = null;
  let dead = false; // set on navigation away; silences pending async work
  const myRounds = (match.results[me]?.rounds || []).slice();

  const ready = () => {
    const next = myRounds.length + 1;
    setView(`
      <main class="page play-intro">
        <header class="page-head"><a class="back" href="#/">&larr;</a><h1>${esc(game.name)}</h1></header>
        <div class="versus"><b class="is-me">${esc(me)}</b><span>vs</span><b class="is-rival">${esc(rival)}</b></div>
        <ul class="rules">
          <li>${match.rounds} rounds, ${game.roundSeconds} seconds each.</li>
          <li>Same grids for both of you — same seed, same tiles.</li>
          <li>Rounds move in lockstep: you both play round 1 before either of you starts round 2.</li>
          <li>3–4 letters = 1 pt · 5 = 2 · 6 = 3 · 7 = 5 · 8+ = 11.</li>
        </ul>
        ${next > 1 ? `<p class="hint">Rounds 1–${next - 1} are banked. Up next: round ${next}.</p>` : ""}
        <button class="btn btn-primary" data-start disabled>Loading tiles…</button>
      </main>`);
    const btn = app.querySelector("[data-start]");
    game.prepare().then((assets) => {
      if (dead) return;
      btn.disabled = false;
      btn.textContent = `Start round ${next}`;
      btn.addEventListener("click", () => playRound(next, assets), { once: true });
    }).catch(() => { btn.textContent = "Couldn't load the word list — check your connection."; });
  };

  const playRound = (round, assets) => {
    setView(`<main class="page page-round" data-round-host></main>`);
    destroyRound = game.mountRound(app.querySelector("[data-round-host]"), {
      seed: match.seed, round, totalRounds: match.rounds, assets,
      onDone: (result) => {
        destroyRound = null;
        myRounds[round - 1] = result;
        submitRound(round, result, assets);
      },
    });
  };

  // Save this round to the shared store immediately, then either roll into
  // the next round (rival already played this one) or hand off to the
  // waiting screen via route().
  const submitRound = async (round, result, assets) => {
    if (dead) return;
    setView(`<main class="page"><p class="loading">Banking round ${round}…</p></main>`);
    const total = myRounds.reduce((sum, r) => sum + (Number(r?.score) || 0), 0);
    try {
      const updated = await store.submitResult(match.id, me, { rounds: myRounds, total });
      if (dead) return;
      if (round < match.rounds && canPlay(updated, me)) {
        interlude(round, result, assets);
      } else {
        // Finished all my rounds, or I'm ahead of my rival: re-route so the
        // results/waiting view gets registered with the router for cleanup.
        route();
      }
    } catch (err) {
      if (dead) return;
      setView(`<main class="page"><p class="loading">Couldn't save round ${round} (${esc(err.message)}).</p>
        <button class="btn btn-primary" data-retry>Try again</button></main>`);
      app.querySelector("[data-retry]").addEventListener("click", () => submitRound(round, result, assets), { once: true });
    }
  };

  const interlude = (round, result, assets) => {
    setView(`
      <main class="page play-intro">
        <p class="interlude-kicker">Round ${round} of ${match.rounds}</p>
        <p class="interlude-score">${Number(result.score) || 0}<i>pts</i></p>
        <p class="hint">${esc(rival)} already played round ${round} — no waiting. Shake it off.</p>
        <button class="btn btn-primary" data-next>Start round ${round + 1}</button>
      </main>`);
    app.querySelector("[data-next]").addEventListener("click", () => playRound(round + 1, assets), { once: true });
  };

  ready();
  return () => { dead = true; destroyRound?.(); };
}

// ── Waiting: I'm ahead of my rival (mid-match) or done entirely ─────────
function waitScreen(match, game, me, rival) {
  const mine = roundsDone(match, me);
  const finishedAll = mine >= match.rounds;
  const theirNext = roundsDone(match, rival) + 1;

  setView(`
    <main class="page play-intro">
      <header class="page-head"><a class="back" href="#/">&larr;</a><h1>${esc(game.name)}</h1></header>
      <p class="interlude-kicker">${finishedAll ? "You scored" : `Round ${mine} banked — you have`}</p>
      <p class="interlude-score">${totalOf(match, me)}<i>pts</i></p>
      ${finishedAll
        ? `<p class="hint">That's all your rounds. Results stay sealed until ${esc(rival)}
             finishes — go tell them the tiles are waiting.</p>`
        : `<p class="hint">Rounds move in lockstep: round ${mine + 1} unlocks once ${esc(rival)}
             plays round ${theirNext}. This screen updates on its own — or come back later.</p>`}
    </main>`);

  // Live: the moment the rival catches up (or finishes), re-route to the
  // ready screen / results.
  const unsub = store.subscribeMatch(match.id, (m) => {
    if (m && (isComplete(m) || canPlay(m, me))) { unsub(); route(); }
  });
  return unsub;
}

async function renderResults(match, game, me, rival) {
  const mine = totalOf(match, me);
  const theirs = totalOf(match, rival);
  const winner = winnerOf(match);
  const verdict = winner === "tie" ? "Dead tie." : winner === me ? "You take it." : `${esc(rival)} takes it.`;
  const pct = mine + theirs ? (mine / (mine + theirs)) * 100 : 50;

  setView(`
    <main class="page results">
      <header class="page-head"><a class="back" href="#/">&larr;</a><h1>${esc(game.name)}</h1></header>
      <p class="verdict ${winner === me ? "is-win" : winner === "tie" ? "" : "is-loss"}">${verdict}</p>
      <div class="scoreline">
        <div class="scoreline-side is-me"><b>${mine}</b><span>${esc(me)}</span></div>
        <div class="scoreline-side is-rival"><b>${theirs}</b><span>${esc(rival)}</span></div>
      </div>
      <div class="tug"><div class="tug-me" style="width:${pct}%"></div></div>
      <div data-detail><p class="loading">Reading the boards…</p></div>
      <a class="btn btn-primary" href="#/new">Rematch</a>
    </main>`);

  const assets = await game.prepare();
  const detail = app.querySelector("[data-detail]");
  if (detail) game.renderResults(detail, { match, me, rival, assets });
}
