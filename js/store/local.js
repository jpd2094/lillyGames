// LocalStorage-backed store adapter. Single-device "demo mode".
// Implements the same interface as the Firebase adapter (see index.js).

const DB_KEY = "lilly.db";

function load() {
  try {
    return JSON.parse(localStorage.getItem(DB_KEY)) || { users: {}, matches: {} };
  } catch {
    return { users: {}, matches: {} };
  }
}

function save(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createLocalStore() {
  const listeners = new Set(); // notified on any write, incl. from other tabs

  window.addEventListener("storage", (e) => {
    if (e.key === DB_KEY) listeners.forEach((fn) => fn());
  });

  function notify() {
    listeners.forEach((fn) => fn());
  }

  return {
    kind: "local",
    authProvider: "",

    // Demo mode has no auth; these exist so callers don't need to care.
    async authUser() { return null; },
    async signIn() { throw new Error("No sign-in in demo mode"); },
    async signOutUser() {},
    async myUsername() { return null; },
    async claimUsername(name) { return (await this.ensureUser(name)).name; },

    async getUser(name) {
      return load().users[name] || null;
    },

    async ensureUser(name) {
      const db = load();
      if (!db.users[name]) {
        db.users[name] = { name, createdAt: Date.now() };
        save(db);
      }
      return db.users[name];
    },

    async createMatch(data) {
      const db = load();
      const match = { ...data, id: newId(), createdAt: Date.now(), results: {}, status: "open", winner: null };
      db.matches[match.id] = match;
      save(db);
      notify();
      return match;
    },

    async getMatch(id) {
      return load().matches[id] || null;
    },

    async reviveConnection() {}, // nothing to revive in localStorage mode

    // Transient mid-round progress (live rival ticker). Overwritten by the
    // round's real result when submitResult lands.
    async submitProgress(matchId, player, progress) {
      const db = load();
      const match = db.matches[matchId];
      if (!match) return;
      (match.results[player] ||= {}).progress = progress;
      save(db);
      notify();
    },

    async submitResult(matchId, player, result) {
      const db = load();
      const match = db.matches[matchId];
      if (!match) throw new Error("Match not found");
      match.results[player] = { ...result, submittedAt: Date.now() };
      save(db);
      notify();
      return match;
    },

    async listMatchesFor(name) {
      return Object.values(load().matches)
        .filter((m) => m.players.includes(name))
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    subscribeMatch(id, cb) {
      const fire = async () => cb(await this.getMatch(id));
      listeners.add(fire);
      fire();
      return () => listeners.delete(fire);
    },

    subscribeMatchesFor(name, cb) {
      const fire = async () => cb(await this.listMatchesFor(name));
      listeners.add(fire);
      fire();
      return () => listeners.delete(fire);
    },
  };
}
