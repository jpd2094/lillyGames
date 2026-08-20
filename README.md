# Lilly Games

A tiny head-to-head gaming platform for two friends: pick a username, challenge
your rival, and keep a lifetime rivalry score. First game: **Word Grid** — trace
words through a 4×4 letter grid, 3 rounds per match, both players get the exact
same grids.

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
with the URL could read/write your matches. That's the accepted trade-off for
now. When you outgrow it, the upgrade path is Firebase Anonymous Auth +
per-user rules, with no changes to the game code.

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
```

## Known limitations (accepted for v1)

- Refreshing **mid-round** restarts that round (completed rounds are kept).
- Scores are computed client-side and trusted — fine between friends.
- Demo mode is single-device by design.
