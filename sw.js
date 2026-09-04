const CACHE='volleyball-coach-hub-v10';
const ASSETS=['./','./index.html','./coach.css?v=10','./coach.js?v=10','./history-delete.js?v=10','./manual-results.js?v=10','./conference.js?v=10','./update-manager.js?v=10','./db.js','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png'];

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

  // Network-first while online prevents an old installed PWA shell from masking
  // a newly deployed GitHub Pages build. Cached files remain the offline fallback.
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
