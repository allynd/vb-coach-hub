const CACHE='volleyball-coach-hub-v15.04';
const ASSETS=['./','./index.html','./coach.css?v=15.04','./minor-ui.css?v=15.04','./coach.js?v=15.04','./history-delete.js?v=15.04','./manual-results.js?v=15.04','./conference.js?v=15.04','./cloud.js?v=15.04','./cloud-v14.js?v=15.04','./team-invites.js?v=15.04','./team-membership.js?v=15.04','./dashboard-results.js?v=15.04','./restore-fix.js?v=15.04','./class-year.js?v=15.04','./cloud-restore.js','./cloud-sync.js','./update-manager.js?v=15.04','./supabase-config.js','./db.js','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(async cache=>{
        for(const asset of ASSETS){
          const request=new Request(asset,{cache:'reload'});
          const response=await fetch(request);
          if(response.ok) await cache.put(request,response.clone());
        }
      })
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin) return;

  event.respondWith((async()=>{
    try{
      const fresh=await fetch(event.request,{cache:'no-store'});
      if(fresh && fresh.ok){
        const cache=await caches.open(CACHE);
        cache.put(event.request,fresh.clone());
        return fresh;
      }
    }catch{}

    const cached=await caches.match(event.request);
    if(cached) return cached;

    if(event.request.mode==='navigate'){
      return (await caches.match('./index.html')) || Response.error();
    }
    return Response.error();
  })());
});
