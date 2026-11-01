/* beginner-budget-app sw.js — Web Push 수신 전용 서비스워커.
   fetch는 캐시하지 않고 네트워크로 그대로 통과시킨다(배포 캐시 사고 방지). */
'use strict';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (_) { payload = {}; }
  const title = typeof payload.title === 'string' && payload.title ? payload.title : '처음 가계부';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '새 알림이 있어요.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: typeof payload.url === 'string' && payload.url ? payload.url : './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        try { await client.navigate(target); } catch (_) { /* 이동 실패 시 포커스만 */ }
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
