// Only the offline notice and its public assets are cached. No authenticated HTML/API responses.
const CACHE='kfid-offline-v4';
const ASSETS=['/offline.html','/offline.css','/picture/fonts/manrope/Manrope-Latin.woff2'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('kfid-offline-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;if(ASSETS.includes(url.pathname))event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));else if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('/offline.html')));});
// Notiser (2026-10-07): a web push shows a short notice (title, text, where a tap leads); nothing is cached or fetched.
// The server sends it only to those who chose push under Mina inställningar. A tap opens the notice's own page in the app.
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{};}catch{data={body:event.data?event.data.text():''};}
  const options={body:String(data.body||'Du har en ny påminnelse.').slice(0,200),icon:'/icons/workflow-192.png?v=1',badge:'/icons/workflow-32.png?v=1',tag:String(data.tag||'workflow').slice(0,64),lang:'sv',data:{url:String(data.url||'/')}};
  event.waitUntil(self.registration.showNotification(String(data.title||'Workflow').slice(0,80),options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  // Only a page of this app; anything else leads to the start page.
  let target=new URL('/',self.location.origin);
  try{const wanted=new URL(String((event.notification.data&&event.notification.data.url)||'/'),self.location.origin);if(wanted.origin===self.location.origin)target=wanted;}catch{}
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const open=windows.find(client=>{try{return new URL(client.url).origin===self.location.origin&&'focus' in client;}catch{return false;}});
    if(open)return open.focus().then(client=>('navigate' in client?client.navigate(target.href):client));
    return self.clients.openWindow(target.href);
  }));
});
