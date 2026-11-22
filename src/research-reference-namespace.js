import {recordOrigin,recordOrigins} from './record-owner-provenance.js';
// A former address is accepted only for an identity explicitly transferred to
// this catalogue. Sharing an old namespace alone grants neither ownership nor
// access to another owner's records or evidence.
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export async function referenceNamespaceMatches(store,ref){
 const current=(await store.snapshot()).metadata.id;
 if(!ref?.workspaceId||ref.workspaceId===current)return true;
 return !!await recordOrigin(store,ref);
}
export async function workspaceReferenceNamespaceMatches(workspace,ref){
 if(!ref?.workspaceId)return true;
 return await workspace.storageKind()==='catalogue'?workspace.catalogue(store=>referenceNamespaceMatches(store,ref)):(await workspace.read()).book.id===ref.workspaceId;
}

// Equivalent addresses are granted per identity. A foreign namespace without
// its ownership witness remains a foreign address, even when IDs coincide.
export async function recordReferenceNamespaces(store,reference){
 const current=(await store.snapshot()).metadata.id,ref={...reference,kind:'record'};
 if(ref.workspaceId!==current&&!await referenceNamespaceMatches(store,ref))return [ref.workspaceId];
 return recordNamespaces(store,ref,{current,empty:false});
}
async function recordNamespaces(store,ref,{current,empty}){
 if(!researchId(ref.id))throw new AppError('INVALID');
 const names=new Set([current]);
 if(!empty)for await(const origin of recordOrigins(store,'record',ref.id))names.add(origin.sourceNamespace);return [...names];
}

// Capture calls this inside its authenticated catalogue callback. Only fixed
// readers have a readCache; writers must continue to observe their own changes.
// Facts never escape this callback or substitute a historical metadata snapshot
// for the current catalogue's identity-specific ownership witnesses.
export async function withRecordReferenceNamespaces(store,consume,{signal}={}){
 let active=true,facts;
 const check=()=>{signal?.throwIfAborted();if(!active)throw new AppError('INVALID');};
 const resolve=async reference=>{
  check();
  if(!store.readCache){const result=await recordReferenceNamespaces(store,reference);check();return result;}
  facts??=(async()=>{
   const current=(await store.snapshot()).metadata.id;
   // This page authenticates both the index range and its SQL row count. An
   // empty range proves absence for every identity without a per-record scan.
   const page=await store.objectIdPage('record:reference-origin:record:',{limit:1,signal});
   return {current,empty:page.items.length===0};
  })();
  const context=await facts;check();const ref={...reference,kind:'record'};
  if(ref.workspaceId!==context.current&&!await referenceNamespaceMatches(store,ref)){check();return [ref.workspaceId];}
  const result=await recordNamespaces(store,ref,context);check();return result;
 };
 try{check();return await consume(resolve);}finally{active=false;}
}

// Carry every authenticated former owner of this identity when its content
// moves again.
export async function* referenceSourceOwners(store,ref){
 for await(const origin of recordOrigins(store,ref.kind,ref.id))yield origin.sourceOwner;
}
