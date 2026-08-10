self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch {}
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'sismo',
    renotify: true,
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 1000],
    data: { url: data.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(data.title || 'Sismo detectado', options));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(target);
    })
  );
});