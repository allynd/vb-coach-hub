const CACHE='volleyball-coach-hub-v15.36';
const ASSETS=['./excel-export.js','./match-corrections.mjs','./player-set-rates.mjs','./sheet-ops.mjs','./stat-sheets.js?v=15.36','./stat-sheets.css?v=15.36','./vendor/exceljs.min.js?v=15.36','./','./index.html','./coach.css?v=15.36','./minor-ui.css?v=15.36','./gameday-controls.css?v=15.36','./gameday-quickstats.css?v=15.36','./stream-overlay-controls.css?v=15.36','./stream-page.css?v=15.36','./overlay.css?v=15.36','./coach.js?v=15.36','./history-delete.js?v=15.36','./manual-results.js?v=15.36','./conference.js?v=15.36','./cloud.js?v=15.36','./cloud-v14.js?v=15.36','./team-invites.js?v=15.36','./team-membership.js?v=15.36','./dashboard-results.js?v=15.36','./restore-fix.js?v=15.36','./class-year.js?v=15.36','./gameday-controls.js?v=15.36','./libero-active.js?v=15.36','./gameday-quickstats.js?v=15.36','./stream-overlay.js?v=15.36','./stream-page.js?v=15.36','./overlay.html','./overlay.js?v=15.36','./cloud-restore.js','./cloud-sync.js','./update-manager.js?v=15.36','./supabase-config.js','./db.js','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(async cache=>{
    for(const asset of ASSETS){
      const request=new Request(asset,{cache:'reload'});
      const response=await fetch(request);
      if(response.ok) await cache.put(request,response.clone());
    }
  }).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{
      const fresh=await fetch(event.request,{cache:'no-store'});
      if(fresh&&fresh.ok){const cache=await caches.open(CACHE);cache.put(event.request,fresh.clone());return fresh;}
    }catch{}
    const cached=await caches.match(event.request);if(cached)return cached;
    if(event.request.mode==='navigate')return (await caches.match('./index.html'))||Response.error();
    return Response.error();
  })());
});
