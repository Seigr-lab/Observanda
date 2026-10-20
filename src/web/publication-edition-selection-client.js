import {validRetainedEditionSelection} from './publication-selection.js';
// The browser keeps only the displayed selection windows and one uncertain
// checkpoint. The durable owner retains all other choices across restarts.
export function publicationEditionSelectionClient(api){
 let selection=null,tail=Promise.resolve(),pending=null;const known=new Map();
 const key=value=>value.collection+':'+value.id,call=(operation,data)=>api('/api/publication-selections/'+operation,data,{adopt:false});
 const queue=operation=>{const next=tail.catch(()=>{}).then(operation);tail=next;return next;};

 function accept(response){if(!validRetainedEditionSelection(response?.selection)||selection&&response.selection.id!==selection.id)throw Error('Invalid publication selection response');selection=response.selection;return response;}
 async function retry(){if(pending){accept(await call('checkpoint',pending));for(const change of pending.changes)known.set(key(change),JSON.stringify(change.value));pending=null;}}
 return {
  async open(source){return queue(async()=>{const response=accept(await call('open',{source}));known.clear();return response;});},
  save(changes){const owned=structuredClone(changes);return queue(async()=>{
   await retry();const changed=owned.filter(change=>known.get(key(change))!==JSON.stringify(change.value));
   for(let at=0;at<changed.length;){const batch=[];let size=0;while(at<changed.length&&batch.length<32){const next=changed[at],bytes=new TextEncoder().encode(JSON.stringify(next)).length;if(bytes>900000)throw Error('This individual content choice exceeds the supported size.');if(batch.length&&size+bytes>900000)break;batch.push(next);size+=bytes;at++;}
    pending={selection:structuredClone(selection),commandId:crypto.randomUUID(),changes:batch};await retry();
   }
   return selection;
  });},
  read(keys){return queue(async()=>{await retry();const items=[];for(let at=0;at<keys.length;at+=64){const response=accept(await call('read',{selection,keys:keys.slice(at,at+64)}));if(!Array.isArray(response.items))throw Error('Invalid publication selection response');items.push(...response.items);for(const item of response.items)known.set(key(item),JSON.stringify(item.value));}return items;});},
  forget(){known.clear();},
  pin:()=>structuredClone(selection),
  discard(){return queue(async()=>{await retry();const result=await call('discard',{selection});selection=null;known.clear();return result;});}
 };
}
