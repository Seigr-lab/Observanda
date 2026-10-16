import {t} from './i18n/index.js';
// The active form remains in place throughout a structure transaction.
export function structureProgress({cancel}={}){
 const host=document.querySelector('#dialog[open] .dialog-actions');
 const node=document.createElement('span');node.setAttribute('role','status');node.className='muted';
 if(host)host.prepend(node);
 const stop=document.createElement('button');stop.type='button';stop.className='button';stop.textContent=t('structureProgress','stop');
 stop.addEventListener('click',()=>{stop.disabled=true;cancel?.();});if(host&&cancel)host.append(stop);
 return {update(value){
  node.textContent=value.stage==='records'?t('structureProgress','records',{loaded:value.loaded,total:value.total}):t('structureProgress',value.stage==='indexing'?'indexing':'preparing');
 },close(){node.remove();stop.remove();}};
}

// Repeating the same reviewed command after a lost reply uses the same receipt.
// This bounded map contains command identities only, never record originals.
export function structureRequestIds(){
 const ids=new Map();
 return async(route,data)=>{
  const bytes=new TextEncoder().encode(JSON.stringify([route,data]));
  const identity=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(!ids.has(identity)){if(ids.size===20)ids.delete(ids.keys().next().value);ids.set(identity,crypto.randomUUID());}
  return ids.get(identity);
 };
}
