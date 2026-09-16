const CACHE='multigestion-mr-v1-4-5';

const CORE=[
  './index.html?v=146',
  './style.css?v=146',
  './cloud.js?v=146',
  './app.js?v=146',
  './manifest.json?v=146'
];

self.addEventListener('install',e=>{
  self.skipWaiting();

  e.waitUntil(
    caches.open(CACHE)
      .then(c=>c.addAll(CORE))
      .catch(()=>{})
  );
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>
        Promise.all(
          keys
            .filter(k=>k!==CACHE)
            .map(k=>caches.delete(k))
        )
      )
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;

  const url=new URL(e.request.url);

  if(url.origin!==location.origin)return;

  e.respondWith(
    fetch(e.request)
      .then(response=>{
        const copy=response.clone();

        caches.open(CACHE)
          .then(cache=>cache.put(e.request,copy))
          .catch(()=>{});

        return response;
      })
      .catch(()=>
        caches.match(e.request)
          .then(
            cached=>
              cached||
              caches.match('./index.html?v=146')
          )
      )
  );
});
