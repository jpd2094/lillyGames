// Pure decision logic for turn notifications — mirrors the platform's
// lockstep rules plus scrabble's turn parity, kept dependency-free so it
// can be unit tested with plain node.

const GAME_NAMES = {
  wordgrid: "Word Grid", anagrams: "Anagrams", blackjack: "Blackjack Duel",
  scrabble: "Scrabble", sudoku: "Sudoku Race", wordle: "Wordle Duel", cuppong: "Cup Pong",
};

function roundsDone(m, p) {
  return ((m.results || {})[p]?.rounds || []).filter(Boolean).length;
}

function isComplete(m) {
  return (m.players || []).length > 0 && m.players.every((p) => roundsDone(m, p) >= (m.rounds || 0));
}

function movesLen(m, p) {
  const r = (m.results || {})[p];
  const moves = r?.progress?.moves ?? r?.rounds?.[0]?.moves;
  return Array.isArray(moves) ? moves.length : 0;
}

// Players the match is currently waiting on.
function waitingOn(m) {
  if (!m || !Array.isArray(m.players) || m.players.length < 2 || isComplete(m)) return [];
  if (m.gameId === "scrabble") {
    // strict alternation: turn parity over both move lists (creator first)
    return [m.players[(movesLen(m, m.players[0]) + movesLen(m, m.players[1])) % 2]];
  }
  return m.players.filter((p) => {
    const rival = m.players.find((x) => x !== p);
    return roundsDone(m, p) < m.rounds && roundsDone(m, p) <= roundsDone(m, rival);
  });
}

// Which players' results entries changed in this write (the "actors").
function actorsOf(before, after) {
  if (!before) return [after.createdBy].filter(Boolean);
  return (after.players || []).filter((p) =>
    JSON.stringify((before.results || {})[p] ?? null) !== JSON.stringify((after.results || {})[p] ?? null));
}

// Presence/ticker writes shouldn't notify: only round submissions and
// scrabble moves change what we react to.
function meaningfulChange(before, after) {
  if (!before) return true; // creation
  for (const p of after.players || []) {
    if (roundsDone(before, p) !== roundsDone(after, p)) return true;
    if (after.gameId === "scrabble" && movesLen(before, p) !== movesLen(after, p)) return true;
  }
  return false;
}

// The exported decision: which pushes should this write produce?
// Returns [{ to, title, body, url }]
function computeNotifications(before, after, matchId) {
  if (!after || !meaningfulChange(before, after)) return [];
  const game = GAME_NAMES[after.gameId] || after.gameId || "a game";
  const actors = new Set(actorsOf(before, after));
  const url = `#/match/${matchId}`;
  const out = [];

  if (!before) {
    for (const p of after.players.filter((x) => !actors.has(x))) {
      out.push({ to: p, title: `${after.createdBy || "Your rival"} challenged you`, body: `New ${game} match — your move.`, url });
    }
    return out;
  }

  if (isComplete(after) && !isComplete(before)) {
    for (const p of after.players.filter((x) => !actors.has(x))) {
      out.push({ to: p, title: `${game} is decided`, body: "The match just finished — see who took it.", url });
    }
    return out;
  }

  const beforeWait = new Set(waitingOn(before));
  for (const p of waitingOn(after)) {
    if (beforeWait.has(p) || actors.has(p)) continue;
    const rival = after.players.find((x) => x !== p) || "your rival";
    out.push({ to: p, title: `Your move vs ${rival}`, body: `${game} is waiting on you.`, url });
  }
  return out;
}

module.exports = { computeNotifications, waitingOn, isComplete };
