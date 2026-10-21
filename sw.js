const C='agenda-v12';
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.json','icon-180.png','icon-192.png'])));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp)).catch(()=>{});return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./'))))});

// Notificação push (resumo diário) — payload é um JSON {title,body,url}.
self.addEventListener('push',e=>{
  let data={title:'Minha Agenda',body:''};
  try{if(e.data)data=Object.assign(data,e.data.json())}catch(err){}
  e.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'icon-192.png',badge:'icon-192.png',data:{url:data.url||'./'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=e.notification.data&&e.notification.data.url||'./';
  e.waitUntil(self.clients.matchAll({type:'window'}).then(list=>{
    for(const c of list)if('focus' in c)return c.focus();
    if(self.clients.openWindow)return self.clients.openWindow(url);
  }));
});
