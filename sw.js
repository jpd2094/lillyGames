// Service worker: receives Web Push while the app is closed, shows the
// notification, keeps the app-icon badge honest, and opens the right match
// when the notification is tapped. No caching — GitHub Pages handles that.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* non-JSON push */ }
  const title = typeof data.title === "string" ? data.title : "Lilly Games";
  const body = typeof data.body === "string" ? data.body : "It's your move.";
  const url = typeof data.url === "string" && data.url.startsWith("#/") ? data.url : "#/";

  const work = [
    self.registration.showNotification(title, {
      body,
      tag: typeof data.tag === "string" ? data.tag : "lilly-turn",
      icon: "icons/icon-512.png",
      badge: "icons/icon-512.png",
      data: { url },
    }),
  ];
  if (Number.isInteger(data.badgeCount) && "setAppBadge" in navigator) {
    work.push(data.badgeCount > 0 ? navigator.setAppBadge(data.badgeCount) : navigator.clearAppBadge());
  }
  event.waitUntil(Promise.all(work));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "#/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) {
      wins[0].navigate?.(new URL(url, self.registration.scope).href);
      return wins[0].focus();
    }
    return self.clients.openWindow(new URL(url, self.registration.scope).href);
  })());
});
