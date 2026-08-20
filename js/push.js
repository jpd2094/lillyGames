// Web Push subscribe flow. iOS home-screen web apps (16.4+) speak standard
// Web Push with VAPID — no Apple-side setup, but three things must be true:
// the app is installed to the Home Screen, permission is granted from a
// user gesture, and a service worker is registered.

import { PUSH_PUBLIC_KEY } from "./config.js";

export function pushSupported() {
  return Boolean(PUSH_PUBLIC_KEY) && "serviceWorker" in navigator &&
    "PushManager" in window && "Notification" in window;
}

export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("sw.js"); } catch { return null; }
}

export async function currentSubscription() {
  const reg = await navigator.serviceWorker?.getRegistration?.();
  return reg ? reg.pushManager.getSubscription() : null;
}

// Must be called from a user gesture (the bell tap).
export async function enablePush(store, me) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("permission " + permission);
  const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
  if (!reg) throw new Error("no service worker");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64ToBytes(PUSH_PUBLIC_KEY),
  });
  await store.savePushSubscription(me, sub.toJSON());
  return sub;
}

function b64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
