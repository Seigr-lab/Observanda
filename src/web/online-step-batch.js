// Keep the original step order and version: the host acknowledges a prefix,
// then ProseMirror rebases the remaining local steps against that response.
// Leave space for the signed request envelope below the host's 2 MiB limit.
export function onlineStepBatch(steps,{maxSteps=250,maxBytes=1500000}={}){
 const batch=[];let bytes=2;const encoder=new TextEncoder();
 for(const step of steps){const size=encoder.encode(JSON.stringify(step)).length+(batch.length?1:0);if(bytes+size>maxBytes)break;batch.push(step);bytes+=size;if(batch.length===maxSteps)break;}
 return batch;
}
