// Firestore-backed store adapter. Loaded dynamically only when configured,
// so demo mode never touches the network.

export async function createFirebaseStore(firebaseConfig, authProvider = "") {
  const { initializeApp } = await import(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"
  );
  const fs = await import(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
  );

  const app = initializeApp(firebaseConfig);
  // Long-polling transport, not the default streaming channel: on Safari/
  // WebKit the streaming backchannel can die silently mid-session, after
  // which every read hangs and write acks never arrive (stuck "Dealing…"/
  // "Banking…" screens). Long-polling is the transport Firestore falls back
  // to behind restrictive proxies, works everywhere, and costs this
  // two-player app nothing in latency that anyone would notice.
  const db = fs.initializeFirestore(app, { experimentalForceLongPolling: true });

  // Auth is optional: only loaded when config.js names a provider. Identity
  // model: users/{name} carries a uid once claimed; byUid/{uid} -> {name} is
  // the reverse lookup (and what the security rules use to know who you are).
  let auth = null, authNS = null;
  if (authProvider) {
    authNS = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    auth = authNS.getAuth(app);
    // Completes a sign-in that came back via full-page redirect (popup-
    // blocked fallback). Errors here resurface on the next explicit attempt.
    try { await authNS.getRedirectResult(auth); } catch { /* ignored */ }
  }

  const userRef = (name) => fs.doc(db, "users", name);
  const matchRef = (id) => fs.doc(db, "matches", id);
  // No orderBy here on purpose: array-contains + orderBy would require a
  // composite index. We sort client-side instead.
  const matchesFor = (name) =>
    fs.query(fs.collection(db, "matches"), fs.where("players", "array-contains", name));

  const byNewest = (a, b) => b.createdAt - a.createdAt;

  return {
    kind: "firebase",
    authProvider,

    // ── Auth (no-ops when authProvider is "") ───────────────────────────
    async authUser() {
      if (!auth) return null;
      await auth.authStateReady();
      return auth.currentUser;
    },

    async signIn() {
      const provider = new authNS.OAuthProvider(
        authProvider === "google" ? "google.com" : "apple.com"
      );
      if (authProvider === "apple") {
        provider.addScope("email");
        provider.addScope("name");
      }
      try {
        await authNS.signInWithPopup(auth, provider);
      } catch (err) {
        // Popup blockers: fall back to a full-page redirect round trip.
        if (err.code === "auth/popup-blocked") {
          return authNS.signInWithRedirect(auth, provider);
        }
        throw err;
      }
    },

    async signOutUser() {
      if (auth) await authNS.signOut(auth);
    },

    async myUsername() {
      const u = await this.authUser();
      if (!u) return null;
      const snap = await fs.getDoc(fs.doc(db, "byUid", u.uid));
      return snap.exists() ? snap.data().name : null;
    },

    // Claim a username for the signed-in account. Existing pre-auth
    // usernames (no uid on the doc) can be claimed by their owner exactly
    // once; a name already tied to another account is refused.
    async claimUsername(name) {
      const u = await this.authUser();
      if (!u) throw new Error("Not signed in");
      await fs.runTransaction(db, async (tx) => {
        const ref = userRef(name);
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : null;
        if (data?.uid && data.uid !== u.uid) throw new Error(`"${name}" is taken`);
        tx.set(ref, { name, uid: u.uid, createdAt: data?.createdAt ?? Date.now() });
        tx.set(fs.doc(db, "byUid", u.uid), { name });
      });
      return name;
    },

    // ── Users / matches ──────────────────────────────────────────────────
    async getUser(name) {
      const snap = await fs.getDoc(userRef(name));
      return snap.exists() ? snap.data() : null;
    },

    async ensureUser(name) {
      const snap = await fs.getDoc(userRef(name));
      if (!snap.exists()) {
        const user = { name, createdAt: Date.now() };
        await fs.setDoc(userRef(name), user);
        return user;
      }
      return snap.data();
    },

    async createMatch(data) {
      const ref = fs.doc(fs.collection(db, "matches"));
      const match = { ...data, id: ref.id, createdAt: Date.now(), results: {}, status: "open", winner: null };
      await fs.setDoc(ref, match);
      return match;
    },

    async getMatch(id) {
      const snap = await fs.getDoc(matchRef(id));
      return snap.exists() ? snap.data() : null;
    },

    // iOS kills the network while the phone sleeps and the Firestore client
    // can wake up wedged — listeners attached, nothing delivered. Cycling
    // the network forces a clean reconnect and re-delivers every listener.
    async reviveConnection() {
      await fs.disableNetwork(db);
      await fs.enableNetwork(db);
    },

    // Web Push subscriptions live on my own user doc, keyed per device so
    // phone and laptop can both subscribe. Only ever touches users/<me>.
    async savePushSubscription(name, subJson) {
      const key = "d" + Math.abs([...subJson.endpoint].reduce((h, c) => (h * 33 + c.charCodeAt(0)) | 0, 5381)).toString(36);
      await fs.updateDoc(userRef(name), { [`push.${key}`]: subJson });
    },

    // Presence heartbeat: "I have this match's round open right now".
    // A timestamp under my own results entry; 0 clears it on clean exit.
    async submitPresence(matchId, player, ts) {
      await fs.updateDoc(matchRef(matchId), {
        [`results.${player}.presence`]: ts,
      });
    },

    // Transient mid-round progress (live rival ticker). Same field-path
    // discipline as submitResult: only ever touches results.<own name>, so
    // it stays legal under the locked-down rules.
    async submitProgress(matchId, player, progress) {
      await fs.updateDoc(matchRef(matchId), {
        [`results.${player}.progress`]: progress,
      });
    },

    async submitResult(matchId, player, result) {
      // Field-path update: each player only ever writes results.<own name>,
      // so simultaneous submissions from both players can't clobber each
      // other. (Usernames are normalized to [a-z0-9_-], so no dots in paths.)
      await fs.updateDoc(matchRef(matchId), {
        [`results.${player}`]: { ...result, submittedAt: Date.now() },
      });
      return this.getMatch(matchId);
    },

    async listMatchesFor(name) {
      const snap = await fs.getDocs(matchesFor(name));
      return snap.docs.map((d) => d.data()).sort(byNewest);
    },

    subscribeMatch(id, cb) {
      return fs.onSnapshot(matchRef(id), (snap) => cb(snap.exists() ? snap.data() : null));
    },

    subscribeMatchesFor(name, cb) {
      return fs.onSnapshot(matchesFor(name), (snap) =>
        cb(snap.docs.map((d) => d.data()).sort(byNewest))
      );
    },
  };
}
