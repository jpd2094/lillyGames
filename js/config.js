// ── Backend configuration ────────────────────────────────────────────────
// With an empty apiKey the app runs in "demo mode": everything is stored in
// this browser's localStorage, so matches only work on a single device.
//
// To play across devices, create a free Firebase project and paste its web
// app config here (see README.md → "Going live with Firebase").
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

export const USE_FIREBASE = Boolean(firebaseConfig.apiKey);
