/* NEST :: the service worker. Two jobs: show a notification when the database
   sends one, and bring the app forward when it is tapped. It caches nothing,
   so a deploy is never hidden behind an old copy of the game. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("push", e => {
  let d = {};
  try{ d = e.data ? e.data.json() : {}; }
  catch(err){ d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "NEST", {
    body: d.body || "Something happened in your nest.",
    tag: d.tag || "nest",
    renotify: !!d.tag,
    icon: "icons/icon-192.png",
    badge: "icons/badge-72.png",
    data: { url: d.url || "/" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type:"window", includeUncontrolled:true });
    const mine = open.find(c => new URL(c.url).origin === self.location.origin);
    if(mine){ await mine.focus(); return; }
    await self.clients.openWindow(url);
  })());
});
