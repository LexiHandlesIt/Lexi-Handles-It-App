/* Lexi service worker — notifications only.
   Deliberately has NO fetch handler, so it never caches the app and can't serve
   a stale build after a deploy. Its only job is to post notifications to the
   phone's system tray (which requires a service worker on mobile PWAs) and to
   focus the app when a notification is tapped. The push handler is ready for
   when Web Push (closed-app notifications) is wired up to a backend sender. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// Focus the app (or open it) when a notification is tapped.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});

// Web Push entry point (used once a backend sends pushes for closed-app alerts).
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || 'Lexi';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || 'lexi',
      icon: '1 Lexi Handles It Transparent.png',
      badge: '1 Lexi Handles It Transparent.png',
    })
  );
});
