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
import { USE_FIREBASE, AUTH_PROVIDER } from "./config.js";

// Real sign-in (Apple/Google via Firebase) is active only when both a
// backend and a provider are configured; otherwise login is username-only.
const AUTH_ON = USE_FIREBASE && Boolean(AUTH_PROVIDER);
const AUTH_LABEL = AUTH_PROVIDER === "google" ? "Google" : "Apple";

const app = document.getElementById("app");
let store = null;
let cleanup = null; // per-view teardown (unsubscribes, timers)

// Bumped whenever the match data format changes. Stamped onto new matches so
// an out-of-date cached client (GitHub Pages caches JS for ~10 min after a
// deploy) refuses to play a match it doesn't understand instead of corrupting
// it or silently failing to save.
const SCHEMA = 4;

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
  if (ta === tb) return "tie";
  // races compare times: lowest wins (game declares lowerWins)
  const lower = getGame(match.gameId)?.lowerWins;
  return (lower ? ta < tb : ta > tb) ? a : b;
}

// Totals render as points unless the game formats them (e.g. times)
function scoreLabel(game, total) {
  return game?.formatScore ? game.formatScore(total) : String(total);
}

// Lockstep rule: I may play round N+1 only if my opponent has finished at
// least as many rounds as I have. (Round 1 is always open to both.)
function canPlay(match, me) {
  const rival = match.players.find((p) => p !== me) || me;
  const mine = roundsDone(match, me);
  return mine < match.rounds && mine <= roundsDone(match, rival);
}

// Presence: a player with a round mounted heartbeats a timestamp every 25s;
// fresher than 70s (two missed beats' grace) counts as "in there right now".
const PRESENCE_FRESH_MS = 70_000;

function isLiveNow(match, player) {
  return Number(match.results?.[player]?.presence) > Date.now() - PRESENCE_FRESH_MS;
}

// ── Router ───────────────────────────────────────────────────────────────
const routes = [
  { re: /^#?\/?$/, view: viewHome },
  { re: /^#\/login$/, view: viewLogin },
  { re: /^#\/claim$/, view: viewClaim },
  { re: /^#\/new$/, view: viewNew },
  { re: /^#\/match\/([a-zA-Z0-9]+)$/, view: viewMatch },
  { re: /^#\/rivalry\/([a-z0-9_-]+)$/, view: viewRivalry },
];

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  if (!store) store = await initStore();

  const hash = location.hash || "#/";
  if (AUTH_ON) {
    // Gate 1: signed in at all? Gate 2: has this account claimed a username?
    const authed = await store.authUser();
    if (!authed) {
      if (hash !== "#/login") { location.hash = "#/login"; return; }
    } else if (!session.user) {
      const name = await store.myUsername();
      if (name) session.user = name;
      else if (hash !== "#/claim") { location.hash = "#/claim"; return; }
    }
  } else if (!session.user && hash !== "#/login") { location.hash = "#/login"; return; }

  for (const r of routes) {
    const m = hash.match(r.re);
    if (m) { cleanup = (await r.view(...m.slice(1))) || null; return; }
  }
  location.hash = "#/";
}

window.addEventListener("hashchange", route);
route();

// Coming back to the app after it was backgrounded: iOS (especially when
// installed to the home screen) kills the network while the phone sleeps,
// and the Firestore client can wake up wedged — so first cycle the store's
// connection, then rebuild the home screen so match states are fresh.
// (Match views handle their own wake-up checks; forms and active rounds are
// left alone.)
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  store?.reviveConnection?.().catch(() => {});
  const hash = location.hash || "#/";
  if (hash === "#/" || hash === "#") route();
});

// Pull-to-refresh: the installed web app has no reload button, so dragging
// down from the very top of the page hard-reloads. Game surfaces that own
// touch gestures are excluded so tracing a word can't trigger it.
(function pullToRefresh() {
  const bar = document.createElement("div");
  bar.className = "ptr";
  document.body.prepend(bar);
  const ARM_AT = 120;
  let startY = null, pulled = 0;
  window.addEventListener("touchstart", (e) => {
    const onGame = e.target.closest?.(".board, .rack, .sc-board, .sc-rack, .bj-table");
    startY = window.scrollY <= 0 && !onGame ? e.touches[0].clientY : null;
    pulled = 0;
  }, { passive: true });
  window.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    pulled = e.touches[0].clientY - startY;
    if (pulled > 16) {
      bar.style.height = `${Math.min(60, (pulled - 16) * 0.4)}px`;
      bar.classList.toggle("is-armed", pulled > ARM_AT);
      bar.textContent = pulled > ARM_AT ? "↻ Let go to refresh" : "↓ Pull to refresh";
    }
  }, { passive: true });
  window.addEventListener("touchend", () => {
    if (startY !== null && pulled > ARM_AT) {
      bar.textContent = "Refreshing…";
      location.reload();
    } else {
      bar.style.height = "0px";
    }
    startY = null;
  });
})();

// Warm caches in the background so the first round starts instantly.
setTimeout(() => GAMES.forEach((g) => g.prepare().catch(() => {})), 500);

// ── Views ────────────────────────────────────────────────────────────────

function viewLogin() {
  const loginHead = `
      <div class="login-tiles" aria-hidden="true">
        ${"LILLY".split("").map((ch, i) => `<span class="minitile" style="--d:${i * 70}ms">${ch}</span>`).join("")}
      </div>
      <h1 class="wordmark">Lilly&nbsp;Games</h1>
      <p class="login-sub">Two players. One grid. Old grudges.</p>`;

  if (AUTH_ON) {
    setView(`
      <main class="login">
        ${loginHead}
        <button class="btn btn-primary" data-signin>Continue with ${AUTH_LABEL}</button>
        <p class="hint" data-auth-error></p>
      </main>`);
    const btn = app.querySelector("[data-signin]");
    const errEl = app.querySelector("[data-auth-error]");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      errEl.textContent = "";
      try {
        await store.signIn();
        session.user = null; // route() resolves the username for this account
        location.hash = "#/";
        route();
      } catch (err) {
        btn.disabled = false;
        const notSetUp = err.code === "auth/operation-not-allowed" || err.code === "auth/configuration-not-found";
        errEl.textContent = notSetUp
          ? `${AUTH_LABEL} sign-in isn't switched on in Firebase yet — finish the console setup in the README.`
          : `Sign-in didn't complete (${err.code || err.message}). Try again.`;
      }
    });
    return;
  }

  setView(`
    <main class="login">
      ${loginHead}
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

// First sign-in on a new account: pick (or reclaim) a username. Shown only
// when AUTH_ON and the signed-in account has no username yet.
function viewClaim() {
  const remembered = localStorage.getItem("lilly.user") || "";
  setView(`
    <main class="login">
      <h1 class="wordmark">Almost in</h1>
      <p class="login-sub">Pick your player name — your rival challenges you by this name,
        and your match history sticks to it.</p>
      <form class="login-form" data-form>
        <input type="text" data-name inputmode="text" autocapitalize="none" autocomplete="username"
               maxlength="20" placeholder="pick a username" aria-label="Username"
               value="${esc(remembered)}" required>
        <button type="submit" class="btn btn-primary">Claim</button>
      </form>
      <p class="hint" data-claim-error></p>
      <p class="hint"><a href="#/login" data-signout>Sign out</a></p>
    </main>`);

  const form = app.querySelector("[data-form]");
  const errEl = app.querySelector("[data-claim-error]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = normName(form.querySelector("[data-name]").value);
    if (!name) return;
    try {
      await store.claimUsername(name);
      session.user = name;
      location.hash = "#/";
    } catch (err) {
      errEl.textContent = /taken/.test(err.message)
        ? `"${name}" already belongs to someone else — pick another.`
        : `Couldn't claim that name (${err.message}). Try again.`;
    }
  });
  app.querySelector("[data-signout]").addEventListener("click", async () => {
    await store.signOutUser();
    session.user = null;
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

  app.querySelector("[data-logout]").addEventListener("click", async () => {
    if (!confirm(AUTH_ON ? "Sign out?" : "Switch player?")) return;
    if (AUTH_ON) await store.signOutUser();
    session.user = null;
    location.hash = "#/login";
  });

  const content = app.querySelector("[data-content]");
  let lastMatches = null;
  const unsub = store.subscribeMatchesFor(me, (matches) => {
    lastMatches = matches;
    content.innerHTML = renderHome(me, matches);
  });
  // presence indicators go stale by clock, not by data — refresh periodically
  const staleness = setInterval(() => {
    if (lastMatches && content.isConnected) content.innerHTML = renderHome(me, lastMatches);
  }, 30_000);
  return () => { unsub(); clearInterval(staleness); };
}

function renderHome(me, matches) {
  // Live-turn games (scrabble) know whose move it actually is mid-round —
  // ask them, so the badges don't claim "your move" during the rival's turn.
  const statusOf = (m) => {
    const g = getGame(m.gameId);
    return !isComplete(m) && g?.status ? g.status(m, me) : null;
  };
  const isMyMove = (m) => {
    const s = statusOf(m);
    return canPlay(m, me) && (s ? s.yourTurn : true);
  };
  const done = matches.filter((m) => isComplete(m));
  const myMove = matches.filter((m) => !isComplete(m) && isMyMove(m));
  const waiting = matches.filter((m) => !isComplete(m) && !isMyMove(m));

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
        <a class="rivalry" href="#/rivalry/${esc(rival)}" title="Game-by-game record">
          <div class="rivalry-names"><b>${esc(me)}</b><span>vs</span><b>${esc(rival)}</b><i class="rivalry-more">›</i></div>
          <div class="tug" role="img" aria-label="${r.wins} wins, ${r.losses} losses, ${r.ties} ties">
            <div class="tug-me" style="width:${pct}%"></div>
          </div>
          <div class="rivalry-record"><span>${r.wins}W</span><span>${r.ties}T</span><span>${r.losses}L</span></div>
        </a>`;
    }).join("");

  const card = (m, badge) => {
    const rival = m.players.find((p) => p !== me) || me;
    const game = getGame(m.gameId);
    const live = !isComplete(m) && isLiveNow(m, rival);
    return `
      <a class="match-card${live ? " is-live" : ""}" href="#/match/${m.id}">
        <span class="match-game">${game?.icon ? `<span class="match-icon">${game.icon}</span>` : ""}${esc(game ? game.name : m.gameId)}</span>
        <span class="match-vs">vs ${esc(rival)}</span>
        <span class="match-date">${fmtDate(m.createdAt)}</span>
        ${badge(m, rival)}
        ${live ? `<span class="match-live">●&nbsp;${esc(rival)} is in there right now</span>` : ""}
      </a>`;
  };

  const playBadge = (m) => {
    const s = statusOf(m);
    return `<span class="badge is-go">${s ? esc(s.label) : `Play round ${roundsDone(m, me) + 1}`}</span>`;
  };

  const waitBadge = (m, rival) => {
    const s = statusOf(m);
    if (s) return `<span class="badge">${esc(s.label)}</span>`;
    return `<span class="badge">${roundsDone(m, me) >= m.rounds ? "Sealed" : `Their round ${roundsDone(m, rival) + 1}`}</span>`;
  };

  const finalBadge = (m, rival) => {
    const game = getGame(m.gameId);
    const mine = scoreLabel(game, totalOf(m, me)), theirs = scoreLabel(game, totalOf(m, rival));
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

// One rivalry, broken down by game: overall record up top, then W/T/L per
// game type across every finished match against this rival.
async function viewRivalry(rival) {
  const me = session.user;
  setView(`
    <main class="page rivalry-page">
      <header class="page-head"><a class="back" href="#/">&larr;</a><h1>${esc(me)} vs ${esc(rival)}</h1></header>
      <div data-detail><p class="loading">Tallying old scores…</p></div>
    </main>`);

  const matches = (await store.listMatchesFor(me))
    .filter((m) => m.players.includes(rival) && isComplete(m));
  const detail = app.querySelector("[data-detail]");
  if (!detail) return;
  if (!matches.length) {
    detail.innerHTML = `<p class="hint">No finished matches against ${esc(rival)} yet.
      First blood is still up for grabs.</p>`;
    return;
  }

  const overall = { wins: 0, ties: 0, losses: 0 };
  const perGame = new Map(); // gameId -> {wins, ties, losses, last}
  for (const m of matches) {
    const g = perGame.get(m.gameId) || { wins: 0, ties: 0, losses: 0, last: 0 };
    const w = winnerOf(m);
    const key = w === "tie" ? "ties" : w === me ? "wins" : "losses";
    g[key]++;
    overall[key]++;
    g.last = Math.max(g.last, m.createdAt);
    perGame.set(m.gameId, g);
  }

  const row = (gameId, r) => {
    const game = getGame(gameId);
    const total = r.wins + r.ties + r.losses;
    const pct = total ? ((r.wins + r.ties / 2) / total) * 100 : 50;
    return `
      <div class="rivalry">
        <div class="rivalry-names"><b class="rivalry-game">${game?.icon ? `<span class="match-icon">${game.icon}</span>` : ""}${esc(game ? game.name : gameId)}</b>
          <span>${total} match${total === 1 ? "" : "es"}</span></div>
        <div class="tug" role="img" aria-label="${r.wins} wins, ${r.losses} losses, ${r.ties} ties">
          <div class="tug-me" style="width:${pct}%"></div>
        </div>
        <div class="rivalry-record"><span>${r.wins}W</span><span>${r.ties}T</span><span>${r.losses}L</span></div>
      </div>`;
  };

  const overallTotal = overall.wins + overall.ties + overall.losses;
  const overallPct = overallTotal ? ((overall.wins + overall.ties / 2) / overallTotal) * 100 : 50;
  detail.innerHTML = `
    <section class="section">
      <div class="rivalry is-overall">
        <div class="rivalry-names"><b>All games</b><span>${overallTotal} match${overallTotal === 1 ? "" : "es"}</span></div>
        <div class="tug"><div class="tug-me" style="width:${overallPct}%"></div></div>
        <div class="rivalry-record"><span>${overall.wins}W</span><span>${overall.ties}T</span><span>${overall.losses}L</span></div>
      </div>
    </section>
    <section class="section">
      <h2>By game</h2>
      ${[...perGame.entries()].sort((a, b) => b[1].last - a[1].last).map(([id, r]) => row(id, r)).join("")}
    </section>`;
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
              <span class="game-option-card">
                <span class="game-icon">${g.icon || ""}</span>
                <b>${esc(g.name)}</b>
                <span class="game-details">
                  <small>${esc(g.tagline)}</small>
                  <em>${esc(g.pitch || `${g.rounds} rounds · ${g.roundSeconds}s each`)}</em>
                </span>
              </span>
            </label>`).join("")}
        </div>
        <div data-variants></div>
        <h2>Rival</h2>
        <div class="rival-chips" data-rivals hidden></div>
        <input type="text" data-rival autocapitalize="none" maxlength="20"
               placeholder="their username" aria-label="Opponent username" required>
        <p class="hint">They log in with this exact name to play their side.</p>
        <button type="submit" class="btn btn-primary" data-create>Deal the tiles</button>
      </form>
    </main>`);

  const form = app.querySelector("[data-form]");
  const createBtn = form.querySelector("[data-create]");
  const rivalInput = form.querySelector("[data-rival]");
  let creating = false; // guards against double-taps creating duplicate matches

  // Per-match options (e.g. sudoku difficulty): shown for games that
  // declare `variants`, refreshed when the game selection changes.
  const variantsEl = form.querySelector("[data-variants]");
  const renderVariants = () => {
    const game = getGame(form.querySelector("[name=game]:checked").value);
    variantsEl.innerHTML = !game?.variants ? "" : `
      <div class="variant-pick">
        ${game.variants.map((v, i) => `
          <label class="variant-option">
            <input type="radio" name="variant" value="${esc(v.id)}" ${i === 0 ? "checked" : ""}>
            <span>${esc(v.name)}</span>
          </label>`).join("")}
      </div>`;
  };
  renderVariants();
  form.querySelectorAll("[name=game]").forEach((r) => r.addEventListener("change", renderVariants));

  // Rivals list: everyone you've ever played, freshest match first, derived
  // from match history (no separate friends storage to keep in sync). Tap a
  // chip to fill the input; typing a new name still works.
  const chipsEl = form.querySelector("[data-rivals]");
  store.listMatchesFor(me).then((matches) => {
    const rivals = [...new Set(matches.flatMap((m) => m.players).filter((p) => p !== me))];
    if (!rivals.length || !chipsEl.isConnected) return;
    chipsEl.hidden = false;
    chipsEl.innerHTML = rivals
      .map((r) => `<button type="button" class="rival-chip" data-pick="${esc(r)}">${esc(r)}</button>`)
      .join("");
    chipsEl.addEventListener("click", (e) => {
      const pick = e.target.closest("[data-pick]");
      if (!pick) return;
      rivalInput.value = pick.dataset.pick;
      [...chipsEl.children].forEach((c) => c.classList.toggle("is-picked", c === pick));
    });
  }).catch(() => {}); // history is a convenience — the form works without it

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
      if (AUTH_ON) {
        // Locked-down rules only let people create their own user doc, so a
        // rival must have signed in and claimed their name before you can
        // challenge them.
        if (!(await store.getUser(rival))) {
          throw new Error(`no player named "${rival}" yet — they need to sign in and claim that name first`);
        }
      } else {
        await store.ensureUser(rival);
      }
      const variant = form.querySelector("[name=variant]:checked")?.value;
      const match = await store.createMatch({
        gameId, players: [me, rival], createdBy: me, seed: randomSeed(), rounds: game.rounds, v: SCHEMA,
        ...(variant ? { variant } : {}),
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
  if ((Number(match.v) || 1) > SCHEMA) {
    setView(`<main class="page"><p class="loading">This match needs a newer version of Lilly Games than
      this device has. Close every Lilly Games tab and reopen — updates can take ~10 minutes to arrive.</p>
      <a class="btn" href="#/">Home</a></main>`);
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
  const liveUnsubs = []; // rival subscriptions opened for the current round
  const dropLive = () => { liveUnsubs.splice(0).forEach((u) => u()); };

  // Presence heartbeat while a round is mounted, so the rival's home screen
  // can show "they're in there right now". Cleared on the way out.
  let presenceTimer = null;
  const startPresence = () => {
    stopPresence(false);
    const beat = () => { if (!dead) store.submitPresence(match.id, me, Date.now()).catch(() => {}); };
    beat();
    presenceTimer = setInterval(beat, 25_000);
  };
  function stopPresence(clear) {
    if (presenceTimer) clearInterval(presenceTimer);
    presenceTimer = null;
    if (clear) store.submitPresence(match.id, me, 0).catch(() => {});
  }

  const ready = () => {
    const next = myRounds.length + 1;
    setView(`
      <main class="page play-intro">
        <header class="page-head"><a class="back" href="#/">&larr;</a><h1>${esc(game.name)}</h1></header>
        <div class="versus"><b class="is-me">${esc(me)}</b><span>vs</span><b class="is-rival">${esc(rival)}</b></div>
        <ul class="rules">
          ${(game.rules || [
            `${match.rounds} rounds, ${game.roundSeconds} seconds each.`,
            "Same puzzles for both of you — same seed, same letters.",
            "Rounds move in lockstep: you both play round 1 before either of you starts round 2.",
            "3–4 letters = 1 pt · 5 = 2 · 6 = 3 · 7 = 5 · 8+ = 11.",
          ]).map((r) => `<li>${esc(r)}</li>`).join("")}
        </ul>
        ${next > 1 ? `<p class="hint">Rounds 1–${next - 1} are banked. Up next: round ${next}.</p>` : ""}
        <button class="btn btn-primary" data-start disabled>Loading tiles…</button>
      </main>`);
    const btn = app.querySelector("[data-start]");
    // A live-turn game already under way resumes rather than "starts"
    const resuming = Boolean(match.results[me]?.progress?.moves?.length);
    game.prepare().then((assets) => {
      if (dead) return;
      btn.disabled = false;
      btn.textContent = resuming ? "Resume game" : `Start round ${next}`;
      btn.addEventListener("click", () => playRound(next, assets), { once: true });
    }).catch(() => { btn.textContent = "Couldn't load the word list — check your connection."; });
  };

  const playRound = (round, assets) => {
    setView(`<main class="page page-round" data-round-host></main>`);
    startPresence();
    destroyRound = game.mountRound(app.querySelector("[data-round-host]"), {
      seed: match.seed, round, totalRounds: match.rounds, assets,
      me, players: match.players, results: match.results, variant: match.variant,
      // Live hooks (optional for games): publish my mid-round progress under
      // my own results entry, and watch the rival's entry as they play.
      reportProgress: (progress) => {
        if (!dead) store.submitProgress(match.id, me, progress).catch(() => {});
      },
      onRivalUpdate: (cb) => {
        // cb(rivalEntry, match) — the full match rides along so a game can
        // also notice its own entry changing (same player, another device).
        const unsub = store.subscribeMatch(match.id, (m) => {
          if (!dead && m) cb(m.results?.[rival] ?? null, m);
        });
        liveUnsubs.push(unsub);
        return unsub;
      },
      onDone: (result) => {
        destroyRound = null;
        dropLive();
        stopPresence(false); // submitResult replaces my entry, presence included
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
        <p class="interlude-score">${scoreLabel(game, Number(result.score) || 0)}${game.formatScore ? "" : "<i>pts</i>"}</p>
        <p class="hint">${esc(rival)} already played round ${round} — no waiting. Shake it off.</p>
        <button class="btn btn-primary" data-next>Start round ${round + 1}</button>
        <p class="hint"><a class="quiet-link" href="#/">Back to home — round ${round + 1} will wait for you</a></p>
      </main>`);
    app.querySelector("[data-next]").addEventListener("click", () => playRound(round + 1, assets), { once: true });
  };

  ready();
  return () => {
    const leaving = Boolean(presenceTimer);
    dead = true;
    destroyRound?.();
    dropLive();
    stopPresence(leaving);
  };
}

// ── Waiting: I'm ahead of my rival (mid-match) or done entirely ─────────
function waitScreen(match, game, me, rival) {
  const mine = roundsDone(match, me);
  const finishedAll = mine >= match.rounds;
  const theirNext = roundsDone(match, rival) + 1;

  setView(`
    <main class="page play-intro">
      <header class="page-head"><a class="back" href="#/">&larr;</a><h1>${esc(game.name)}</h1></header>
      <p class="interlude-kicker">${finishedAll ? (game.lowerWins ? "Your time" : "You scored") : `Round ${mine} banked — you have`}</p>
      <p class="interlude-score">${scoreLabel(game, totalOf(match, me))}${game.formatScore ? "" : "<i>pts</i>"}</p>
      ${finishedAll
        ? `<p class="hint">That's all your rounds. Results stay sealed until ${esc(rival)}
             finishes — go tell them the tiles are waiting.</p>`
        : `<p class="hint">Rounds move in lockstep: round ${mine + 1} unlocks once ${esc(rival)}
             plays round ${theirNext}. This screen updates on its own — or come back later.</p>`}
      <p class="hint" data-rival-live></p>
      <a class="btn btn-primary" href="#/">Back to home</a>
    </main>`);

  // Unlock the moment the rival catches up (or finishes). Belt and braces:
  // the live subscription is the fast path, but mobile browsers silently
  // drop live connections when the phone sleeps — so also poll, and check
  // immediately whenever the app returns to the foreground.
  let advanced = false;
  const liveEl = app.querySelector("[data-rival-live]");
  const consider = (m) => {
    if (advanced || !m) return;
    // Live peek while waiting: if the rival is mid-round and their game
    // publishes progress (Blackjack Duel's ticker), narrate it here too;
    // otherwise the presence heartbeat at least says they're in there.
    const p = m.results?.[rival]?.progress;
    if (liveEl && p && typeof p.played === "number") {
      const stale = Number(p.at) && Date.now() - Number(p.at) > 10 * 60_000;
      liveEl.textContent = `${rival} ${stale ? "paused at" : "is playing —"} hand ${Number(p.played) || 0} · ${Number(p.chips) || 0} chips`;
    } else if (liveEl) {
      liveEl.textContent = isLiveNow(m, rival) ? `● ${rival} is in there right now` : "";
      liveEl.classList.toggle("is-live-note", isLiveNow(m, rival));
    }
    if (!(isComplete(m) || canPlay(m, me))) return;
    advanced = true;
    teardown();
    route();
  };
  const check = () => store.getMatch(match.id).then(consider).catch(() => {});
  const unsub = store.subscribeMatch(match.id, consider);
  const poll = setInterval(check, 10_000);
  const onWake = () => { if (!document.hidden) check(); };
  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);

  function teardown() {
    unsub();
    clearInterval(poll);
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("focus", onWake);
  }
  return () => { advanced = true; teardown(); };
}

async function renderResults(match, game, me, rival) {
  const mine = totalOf(match, me);
  const theirs = totalOf(match, rival);
  const winner = winnerOf(match);
  const verdict = winner === "tie" ? "Dead tie." : winner === me ? "You take it." : `${esc(rival)} takes it.`;
  // the tug bar always shows "how much of the win is mine" — for races
  // (lowerWins) the smaller number is the better one
  const pct = mine + theirs ? ((game?.lowerWins ? theirs : mine) / (mine + theirs)) * 100 : 50;

  setView(`
    <main class="page results">
      <header class="page-head"><a class="back" href="#/">&larr;</a><h1>${esc(game.name)}</h1></header>
      <p class="verdict ${winner === me ? "is-win" : winner === "tie" ? "" : "is-loss"}">${verdict}</p>
      <div class="scoreline">
        <div class="scoreline-side is-me"><b>${scoreLabel(game, mine)}</b><span>${esc(me)}</span></div>
        <div class="scoreline-side is-rival"><b>${scoreLabel(game, theirs)}</b><span>${esc(rival)}</span></div>
      </div>
      <div class="tug"><div class="tug-me" style="width:${pct}%"></div></div>
      <div data-detail><p class="loading">Reading the boards…</p></div>
      <a class="btn btn-primary" href="#/new">Rematch</a>
    </main>`);

  const assets = await game.prepare();
  const detail = app.querySelector("[data-detail]");
  if (detail) game.renderResults(detail, { match, me, rival, assets });
}
