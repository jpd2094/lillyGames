// ── Backend configuration ────────────────────────────────────────────────
// With an empty apiKey the app runs in "demo mode": everything is stored in
// this browser's localStorage, so matches only work on a single device.
//
// To play across devices, create a free Firebase project and paste its web
// app config here (see README.md → "Going live with Firebase").
export const firebaseConfig = {
  apiKey: "AIzaSyAiIlnZrpteflUryaQs6qUUZNKwS08rsAA",
  authDomain: "lilly-games.firebaseapp.com",
  projectId: "lilly-games",
  storageBucket: "lilly-games.firebasestorage.app",
  messagingSenderId: "725575701700",
  appId: "1:725575701700:web:a311577220e386b308e591",
};

export const USE_FIREBASE = Boolean(firebaseConfig.apiKey);

// Sign-in provider to require: "" (usernames only, no auth), "apple", or
// "google". Flip this ONLY after (1) the provider is enabled in the Firebase
// console and (2) the locked-down Firestore rules from the README are
// published — flipping early locks everyone out.
export const AUTH_PROVIDER = "apple";
