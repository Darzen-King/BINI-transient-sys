/* global self, caches, URL, fetch, clients */

const CACHE_NAME = 'bini-pms-v4-migration-4';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/apple-touch-icon.png',
  '/pwa-192.png',
  '/pwa-512.png',
  '/pwa-512-maskable.png',
  '/bini-blooms-logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match('/'))),
  );
});

// Background reminders (Firebase Cloud Messaging, data-only). The server sends title/body/tag; this worker shows the
// notification itself so installed iPhone apps, Android and desktop browsers behave the same. iOS requires every push
// to show a notification, so one is always shown.
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const data = payload.data || {};
  const notification = payload.notification || {};
  const title = notification.title || data.title || 'BINI PMS';
  event.waitUntil(self.registration.showNotification(title, {
    body: notification.body || data.body || '',
    tag: data.tag || undefined,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    lang: 'zh-Hant',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    return existing ? existing.focus() : clients.openWindow(target);
  }));
});
