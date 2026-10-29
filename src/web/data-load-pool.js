// Share only pending work inside one open data session. Each consumer owns
// cancellation; dropping the last consumer cancels the provider's request.
export function createDataLoadPool(){
 const providers=new WeakMap();
 return (provider,key,load,signal)=>{
  signal.throwIfAborted();let requests=providers.get(provider);if(!requests){requests=new Map();providers.set(provider,requests);}
  let entry=requests.get(key);
  if(!entry){
   entry={controller:new AbortController(),users:new Set()};requests.set(key,entry);
   entry.promise=Promise.resolve().then(()=>{entry.controller.signal.throwIfAborted();return load(entry.controller.signal);});
   const forget=()=>{if(requests.get(key)===entry)requests.delete(key);};entry.promise.then(forget,forget);
  }
  return new Promise((resolve,reject)=>{
   const user={};entry.users.add(user);
   const release=()=>{signal.removeEventListener('abort',cancel);return entry.users.delete(user);};
   const cancel=()=>{if(!release())return;reject(signal.reason);if(!entry.users.size){if(requests.get(key)===entry)requests.delete(key);entry.controller.abort(signal.reason);}};
   signal.addEventListener('abort',cancel,{once:true});
   entry.promise.then(value=>{if(release())resolve(value);},error=>{if(release())reject(error);});
   if(signal.aborted)cancel();
  });
 };
}
