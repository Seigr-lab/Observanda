// Ephemeral readers may retire their own work when a vault is locked. Listeners
// must abort synchronously; cleanup can drain afterwards without delaying key
// destruction. No listener is allowed to retain a copy of the retired key.
const listeners=new WeakMap(),draining=new WeakMap();
export function onVaultRetire(vault,listener){
 let values=listeners.get(vault);if(!values){values=new Set();listeners.set(vault,values);}values.add(listener);
 return ()=>{values.delete(listener);if(!values.size&&listeners.get(vault)===values)listeners.delete(vault);};
}
export function retireVault(vault){
 if(!vault)return;const values=listeners.get(vault);listeners.delete(vault);if(!values)return;
 const pending=[];for(const listener of values){try{pending.push(Promise.resolve(listener()));}catch(error){pending.push(Promise.reject(error));}}
 const prior=draining.get(vault);if(prior)pending.push(prior.then(results=>{const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;}));
 const result=Promise.allSettled(pending);draining.set(vault,result);void result.finally(()=>{if(draining.get(vault)===result)draining.delete(vault);});
}
export async function drainRetiredVault(vault){const results=await draining.get(vault),failed=results?.find(result=>result.status==='rejected');if(failed)throw failed.reason;}
