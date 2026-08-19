// Push Notifications for the installed PWA.
//
// Loaded into the Workbox-generated service worker via
// `workbox.importScripts` in vite.config.ts (VitePWA uses the default
// generateSW strategy, so there is no hand-written sw.ts to add these
// listeners to directly - importScripts is the documented way to extend a
// generated service worker without switching strategy). Runs in the same
// worker as the precache/offline logic; must not touch caches itself.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_err) {
    data = { title: "Backstage Pro", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Backstage Pro";
  const options = {
    body: data.body || "",
    icon: "/icon-192-v2.png",
    badge: "/icon-192-v2.png",
    tag: data.notificationId || undefined,
    data: { url: data.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).origin !== self.location.origin) continue;
          if ("focus" in client) {
            if ("navigate" in client) client.navigate(url);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
