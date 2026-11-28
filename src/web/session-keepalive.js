import {sessionHeaders} from './session-store.js';

// An open window keeps its session: it renews it regularly and whenever the owner
// returns to it, so the session never ends while the window is in use or left open
// for agents. If it has ended anyway (for example after the computer slept for
// longer than the session lasts), the window asks to be reconnected. The desktop
// app answers that request with a fresh launch; a plain browser shows the
// reconnect page.
const RENEW_EVERY=10*60*1000;
export const RECONNECT_PARAMETER='observanda-reconnect';

export function reconnectUrl(location=window.location){
 const url=new URL('/',location.href);url.searchParams.set(RECONNECT_PARAMETER,'1');
 if(new URLSearchParams(location.search).get('view')==='website')url.searchParams.set('view','website');
 return url.href;
}
export const reconnectRequested=(location=window.location)=>new URLSearchParams(location.search).has(RECONNECT_PARAMETER);
export function reconnect(location=window.location){
 // A reconnect page that is itself unauthorized stays put instead of reloading in a loop.
 if(reconnectRequested(location))return false;
 location.assign(reconnectUrl(location));return true;
}

export function keepSessionAlive({location=window.location,interval=RENEW_EVERY}={}){
 let busy=false;
 const renew=async()=>{
  if(busy)return;busy=true;
  try{
   const response=await fetch('/api/session/renew',{method:'POST',headers:await sessionHeaders({'Content-Type':'application/json'}),body:'{}'});
   if(response.status===401)reconnect(location);
  }catch{/* The next renewal tries again; a closing service needs no reconnect. */}
  finally{busy=false;}
 };
 setInterval(()=>void renew(),interval);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void renew();});
 window.addEventListener('focus',()=>void renew());
 return renew;
}
