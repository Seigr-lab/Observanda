import {browserSession} from './session-store.js';
import {sessionPreview} from './session-preview.js';

let session;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 if(event.data?.type!=='observanda-session-refresh'||!event.source?.url||new URL(event.source.url).origin!==self.location.origin)return;
 // Acknowledge only after the committed origin-local credential is available.
 // Keep it in memory thereafter: media ranges and API reads do not reread disk.
 event.waitUntil((async()=>{session=browserSession();await session;await self.clients.claim();event.ports[0]?.postMessage({ok:true});})().catch(()=>{session=undefined;event.ports[0]?.postMessage({ok:false});}));
});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||url.pathname==='/api/session'||!/^\/(?:api|preview|appearance-preview)\//.test(url.pathname))return;
 event.respondWith((async()=>{
  const credential=await(session??=browserSession()),headers=new Headers(event.request.headers);
  headers.delete('X-Observanda-Session');if(credential)headers.set('X-Observanda-Session',credential);
  // Never forward the header through a redirect or attach host cookies. This
  // also covers native image, audio, video, iframe and download requests.
  const response=await fetch(new Request(event.request,{headers,mode:'same-origin',credentials:'omit',redirect:'error'}));
  return /^\/(?:preview|appearance-preview)\//.test(url.pathname)?sessionPreview(response):response;
 })());
});
