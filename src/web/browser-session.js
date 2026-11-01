import {browserSession} from './session-store.js';
async function bounded(work){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Browser authorization is unavailable.')),10000);})]);}finally{clearTimeout(timer);}}

// Fail closed if the browser cannot retain origin-scoped authorization or
// control native resource requests. Reload can retry a lost launch receipt.
export async function authorizeBrowser(session){
 if(!navigator.serviceWorker)throw Error('Browser authorization is unavailable.');
 if(session!==undefined)await bounded(browserSession(session));
 await bounded(navigator.serviceWorker.register('/session-worker.js',{type:'module',scope:'/',updateViaCache:'none'}));
 const registration=await bounded(navigator.serviceWorker.ready);
 if(!navigator.serviceWorker.controller)registration.active.postMessage({type:'observanda-session-refresh'});
 if(!navigator.serviceWorker.controller)await new Promise((resolve,reject)=>{
  const changed=()=>{if(navigator.serviceWorker.controller){clearTimeout(timer);navigator.serviceWorker.removeEventListener('controllerchange',changed);resolve();}},timer=setTimeout(()=>{navigator.serviceWorker.removeEventListener('controllerchange',changed);reject(Error('Browser authorization is unavailable.'));},10000);
  navigator.serviceWorker.addEventListener('controllerchange',changed);changed();
 });
 await new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),done=error=>{clearTimeout(timer);channel.port1.close();error?reject(error):resolve();},timer=setTimeout(()=>done(Error('Browser authorization is unavailable.')),10000);
  channel.port1.onmessage=event=>done(event.data?.ok?null:Error('Browser authorization is unavailable.'));
  navigator.serviceWorker.controller.postMessage({type:'observanda-session-refresh'},[channel.port2]);
 });
 await import('./session-download.js');
}
