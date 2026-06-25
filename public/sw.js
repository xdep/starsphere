/* STARSPHERE ONLINE — service worker.
   Minimal for now: it exists so mobile browsers can show notifications
   (they refuse the bare `new Notification()` constructor and require
   ServiceWorkerRegistration.showNotification, which only works from
   within an active service worker). A `push` handler for true offline
   delivery (Web Push) can be added here later. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// click a notification (or one of its action buttons) → focus the game and deep-link to the
// relevant screen. The "Dismiss" action just closes; everything else navigates.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'dismiss') return;
  const go = (e.notification.data && e.notification.data.go) || 'overview';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list){
        if ('focus' in c){ try { c.postMessage({ sphereGo: go }); } catch (x){} return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow('/?go=' + encodeURIComponent(go));
    })
  );
});
