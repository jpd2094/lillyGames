// Cloud Function: watches match writes and Web-Pushes "your move" /
// "match finished" alerts to the waiting player's subscribed devices,
// with an accurate app-badge count. VAPID keys come from functions/.env.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const webpush = require("web-push");
const { computeNotifications, waitingOn, isComplete } = require("./logic");

setGlobalOptions({ region: "us-central1", maxInstances: 5 });
admin.initializeApp();

async function badgeCountFor(db, player) {
  const snap = await db.collection("matches").where("players", "array-contains", player).get();
  let n = 0;
  for (const doc of snap.docs) {
    const m = doc.data();
    if (!isComplete(m) && waitingOn(m).includes(player)) n++;
  }
  return n;
}

exports.notifyturn = onDocumentWritten("matches/{id}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  const decisions = computeNotifications(before, after, event.params.id);
  if (!decisions.length) return;

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@example.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  const db = admin.firestore();

  for (const d of decisions) {
    const userSnap = await db.doc(`users/${d.to}`).get();
    const subs = userSnap.get("push") || {};
    const entries = Object.entries(subs).filter(([, s]) => s && typeof s.endpoint === "string");
    if (!entries.length) continue;
    const badgeCount = await badgeCountFor(db, d.to);
    const payload = JSON.stringify({
      title: d.title, body: d.body, url: d.url, tag: `match-${event.params.id}`, badgeCount,
    });
    await Promise.all(entries.map(async ([key, sub]) => {
      try {
        await webpush.sendNotification(sub, payload);
      } catch (err) {
        // dead endpoint (uninstalled / re-subscribed): prune it
        if (err.statusCode === 404 || err.statusCode === 410) {
          await db.doc(`users/${d.to}`)
            .update({ [`push.${key}`]: admin.firestore.FieldValue.delete() })
            .catch(() => {});
        }
      }
    }));
  }
});
