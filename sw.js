// Changing this cache name on each release causes the installed PWA to update.

const CACHE_NAME='mi-bodega-v3-2026-10-31-01';
const APP_FILES=['./','./index.html','./styles.css','./cloud-config.js','./app.js','./sync.js','./qr-engine.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mi-bodega-') && k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
  // Network first for app files, offline fallback. Never cache cloud API requests.
  e.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try {const result=await fetch(req,{cache:'no-store'});if(result.ok)await cache.put(req,result.clone());return result;}
    catch(err){return (await cache.match(req))||(req.mode==='navigate'?await cache.match('./index.html'):undefined)||Response.error();}
  })());
});
