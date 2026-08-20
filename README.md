# Lilly Games

A tiny head-to-head gaming platform for two friends: pick a username, challenge
your rival, and keep a lifetime rivalry score. Two games so far: **Word Grid** —
trace words through a 4×4 letter grid — and **Anagrams** — build words from a
rack of 8 shuffled letters. Both are 3 rounds × 60 seconds per match, and both
players get the exact same puzzles. Rounds move in lockstep: each round is saved the
moment you finish it, and round N+1 unlocks only once both players have played
round N (whoever finishes a round second rolls straight into the next one).

No build step, no framework — plain ES modules, hostable on any static host
(built for GitHub Pages).

## Running locally

Any static file server works (ES modules won't load from `file://`):

```bash
cd lillyGames
python3 -m http.server 8080
# open http://localhost:8080
```

Out of the box the app runs in **demo mode**: users and matches are stored in
`localStorage`, so both players must share one device (or one browser). Good
for trying it out; not what you want for real play.

## Going live with Firebase (cross-device play)

The site is static, so shared state (matches, scores) needs a hosted database.
Firebase Firestore's free tier is far more than two players will ever use.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (Analytics off is fine).
2. In the project: **Build → Firestore Database → Create database** → start in **test mode** (fine for now — see the honesty note below), pick a region near you.
3. **Project settings → Your apps → Web app (`</>`)** → register it (no hosting needed) → copy the `firebaseConfig` object.
4. Paste those values into `js/config.js`. That's the only file that changes.
5. Recommended: replace test-mode rules (they expire after 30 days) with open
   rules scoped to this app's collections — in Firestore → Rules:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{u} { allow read, write: if true; }
       match /matches/{m} { allow read, write: if true; }
     }
   }
   ```

**Honesty note:** with username-only "login" there is no real security — anyone
with the URL could read/write your matches. That's the accepted trade-off until
you enable real sign-in (below).

## Real sign-in (Apple or Google)

The app ships with `AUTH_PROVIDER: ""` in `js/config.js` (username-only login).
Setting it to `"apple"` or `"google"` turns on real authentication: players
sign in with their Apple/Google account, claim their username once (existing
usernames carry their history over), and the Firestore rules below make
impersonation and score-tampering impossible.

**Order matters.** Do the console setup first, then publish the rules and flip
the flag together. Flipping early locks everyone out.

### Apple prerequisites (Apple's requirements, not ours)

- An **Apple Developer Program membership** ($99/year, developer.apple.com).
- In the Apple Developer portal ([developer.apple.com/account](https://developer.apple.com/account) → Certificates, Identifiers & Profiles):
  1. **Identifiers → + → App IDs → App**: any description, bundle ID like
     `com.lillygames.app`, tick **Sign in with Apple**, register.
  2. **Identifiers → + → Services IDs**: identifier like `com.lillygames.web`,
     register, then open it → enable **Sign in with Apple** → Configure:
     primary App ID = the one from step 1; domain `lilly-games.firebaseapp.com`;
     return URL `https://lilly-games.firebaseapp.com/__/auth/handler`.
  3. **Keys → +**: name it, tick **Sign in with Apple**, configure → pick the
     App ID, register, **download the `.p8` file** (one chance!), note the
     **Key ID** and your **Team ID** (top-right of the portal).
- In the Firebase console → **Authentication → Sign-in method → Apple →
  Enable**: fill in the Services ID, Team ID, Key ID, and paste the `.p8`
  contents. Save.
- Firebase console → **Authentication → Settings → Authorized domains**: add
  `jpd2094.github.io`.

(Google instead: Authentication → Sign-in method → Google → Enable. That's the
whole setup — no fee.)

### Locked-down Firestore rules (publish when flipping the flag)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function authed() { return request.auth != null; }
    function myName() {
      return get(/databases/$(database)/documents/byUid/$(request.auth.uid)).data.name;
    }

    match /users/{name} {
      allow read: if authed();
      // create your own doc; claim an unclaimed legacy name; never steal one
      allow create: if authed() && request.resource.data.uid == request.auth.uid;
      allow update: if authed()
        && (resource.data.uid == null || resource.data.uid == request.auth.uid)
        && request.resource.data.uid == request.auth.uid;
    }
    match /byUid/{uid} {
      allow read: if authed();
      allow write: if authed() && uid == request.auth.uid;
    }
    match /matches/{id} {
      allow read: if authed();
      allow create: if authed() && myName() in request.resource.data.players;
      // players may only ever touch their own results entry
      allow update: if authed() && myName() in resource.data.players
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['results'])
        && request.resource.data.results.diff(resource.data.results).affectedKeys().hasOnly([myName()]);
    }
  }
}
```

## Deploying to GitHub Pages

```bash
git init && git add -A && git commit -m "Lilly Games"
gh repo create lillyGames --public --source . --push
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
The site appears at `https://<you>.github.io/lillyGames/`. All paths in the app
are relative, so the subpath just works.

## Adding a new game

The platform (users, matches, storage, winner logic, rivalry stats) is separate
from the games. A game is a folder under `js/games/<id>/` whose `index.js`
default-exports:

```js
{
  id, name, tagline,        // shown on the "New match" screen
  rounds, roundSeconds,     // match shape
  async prepare(),          // load assets once (dictionary, sprites…) → assets
  mountRound(el, { seed, round, totalRounds, assets, onDone }) → destroy(),
                            // play ONE round; call onDone({ score, words?/detail? })
  renderResults(el, { match, me, rival, assets }),  // game-specific breakdown
}
```

Rules of the contract:

- **Determinism:** everything random must derive from `seed + round` (use
  `makeRng` from `wordgrid/engine.js`) so both players get identical puzzles.
- **Score is a number:** the platform compares `total` across players; your
  round result just needs a numeric `score`.
- Register it in `js/games/registry.js` — one import, one array entry. Done.

## Layout

```
index.html            app shell
css/style.css         all styling (design tokens at the top)
data/dictionary.txt   ENABLE public-domain word list (3–16 letters)
js/main.js            platform: session, router, match lifecycle, views
js/config.js          Firebase config (empty = local demo mode)
js/store/             storage adapters behind one interface
  local.js            localStorage (demo mode)
  firebase.js         Firestore (loaded only when configured)
js/games/registry.js  the list of games
js/games/wordgrid/    first game
  engine.js           seeded RNG, Boggle dice, adjacency, scoring (pure)
  dict.js             dictionary loader
  solver.js           finds every word on a grid (for "nobody found" on results)
  ui.js               round UI: tracing, timer, chips
  index.js            the game-plugin definition
js/games/anagrams/    second game
  engine.js           seeded rack from a baked-in word pool, letter accounting (pure)
  solver.js           finds every word buildable from a rack
  ui.js               round UI: tap/type letters, timer, chips
  index.js            the game-plugin definition
```

## Known limitations (accepted for v1)

- Refreshing **mid-round** restarts that round (finished rounds are already
  saved to the store, so they're never lost — even across devices).
- Scores are computed client-side and trusted — fine between friends.
- Demo mode is single-device by design.
