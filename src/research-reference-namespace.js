import {recordOrigin,recordOrigins} from './record-owner-provenance.js';
// Legacy addresses are accepted only for identities explicitly transferred to
// this authenticated project. Sharing an old workspace namespace alone grants
// neither ownership nor access to another project's records or evidence.
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export const referenceOriginKey=ref=>'project:reference-origin:'+ref.kind+':'+ref.id;
export async function referenceNamespaceMatches(store,ref){
 const current=(await store.snapshot()).metadata.id;
 if(!ref?.workspaceId||ref.workspaceId===current)return true;
 if(await recordOrigin(store,ref))return true;
 const projectId=store.workspace.projectId;
 if(!projectId||!researchId(ref.workspaceId)||!researchId(ref.id)||!['record','artifact','dataset','analysis','collection'].includes(ref.kind))return false;
 const receipt=await store.object('project:research-migration');
 if(receipt?.version!==1||receipt.projectId!==projectId||receipt.namespaceId!==current||receipt.sourceNamespace!==ref.workspaceId)return false;
 const origin=await store.object(referenceOriginKey(ref));
 return !!origin&&Object.keys(origin).sort().join()==='id,kind,namespaceId,projectId,sourceNamespace,version'&&origin.version===1&&origin.projectId===projectId&&origin.namespaceId===current&&origin.sourceNamespace===ref.workspaceId&&origin.kind===ref.kind&&origin.id===ref.id;
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
 const receipt=store.workspace.projectId?await store.object('project:research-migration'):null;
 return recordNamespaces(store,ref,{current,receipt,empty:false});
}
async function recordNamespaces(store,ref,{current,receipt,empty}){
 if(!researchId(ref.id))throw new AppError('INVALID');
 const prior=receipt?.sourceNamespace;
 const names=new Set(prior&&prior!==current&&await referenceNamespaceMatches(store,{...ref,workspaceId:prior})?[current,prior]:[current]);
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
   const receipt=store.workspace.projectId?await store.object('project:research-migration'):null;
   // This page authenticates both the index range and its SQL row count. An
   // empty range proves absence for every identity without a per-record scan.
   const page=await store.objectIdPage('record:reference-origin:record:',{limit:1,signal});
   return {current,receipt,empty:page.items.length===0};
  })();
  const context=await facts;check();const ref={...reference,kind:'record'};
  if(ref.workspaceId!==context.current&&!await referenceNamespaceMatches(store,ref)){check();return [ref.workspaceId];}
  const result=await recordNamespaces(store,ref,context);check();return result;
 };
 try{check();return await consume(resolve);}finally{active=false;}
}

// Carry every authenticated former owner of this identity when its content
// moves again. A project-level witness never grants aliases to other identities.
export async function* referenceSourceOwners(store,ref){
 for await(const origin of recordOrigins(store,ref.kind,ref.id))yield origin.sourceOwner;
 const receipt=store.workspace.projectId?await store.object('project:research-migration'):null,prior=receipt?.sourceNamespace;
 if(prior&&await referenceNamespaceMatches(store,{...ref,workspaceId:prior}))yield {projectId:null,labBookId:null,workspaceId:prior};
}
