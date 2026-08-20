// Firestore-backed store adapter. Loaded dynamically only when configured,
// so demo mode never touches the network.

export async function createFirebaseStore(firebaseConfig) {
  const { initializeApp } = await import(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"
  );
  const fs = await import(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
  );

  const app = initializeApp(firebaseConfig);
  const db = fs.getFirestore(app);

  const userRef = (name) => fs.doc(db, "users", name);
  const matchRef = (id) => fs.doc(db, "matches", id);
  // No orderBy here on purpose: array-contains + orderBy would require a
  // composite index. We sort client-side instead.
  const matchesFor = (name) =>
    fs.query(fs.collection(db, "matches"), fs.where("players", "array-contains", name));

  const byNewest = (a, b) => b.createdAt - a.createdAt;

  return {
    kind: "firebase",

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
