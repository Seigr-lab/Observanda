import {AppError} from './errors.js';
import {publicationResearchWorkspace} from './publication-pin.js';
import {assertPublicationPreviewPermissions} from './publication-permission-admission.js';

// Keep only page-sized permission identities, never source bodies or open stores.
// A successful head check is reusable until that owner changes again.
export function capturePreviewPermissions(records){
 const local=records.local??records,owners=[local,...(records.local?records.owners:[])];
 return owners.map(owner=>({workspaceId:owner.metadata.id,snapshotId:owner.snapshotId,checkedHead:owner.snapshotId,
  metadata:{notebooks:owner.metadata.notebooks.map(({id,share})=>({id,share}))},
  descriptors:[...owner.descriptors.values()].map(value=>{
   const sourceMedia=new Map(Object.entries(value.mediaIdentities??{}).map(([sourceId,id])=>[id,sourceId]));
   return {id:value.id,recordId:value.recordId,revision:value.revision,
    selectors:(value.selectors??[]).map(({id,kind,sourceId})=>({id,kind,sourceId})),
    media:(value.media??[]).map(({id})=>({id:sourceMedia.get(id)??id}))};
  })}));
}
export async function assertPreviewPermissions(workspace,proof,{signal,sourceReader}={}){
 if(!Array.isArray(proof)||!proof.length)throw new AppError('NOT_FOUND');
 const check=async(store,owner)=>{
  signal?.throwIfAborted();const head=await store.head();if(head===owner.checkedHead)return;
  await assertPublicationPreviewPermissions(store,owner.snapshotId,owner.metadata,null,{signal});
  for(const descriptor of owner.descriptors)await assertPublicationPreviewPermissions(store,owner.snapshotId,owner.metadata,descriptor,{signal});
  owner.checkedHead=head;
 };
 await publicationResearchWorkspace(workspace).catalogue(async store=>{
  if((await store.snapshot()).metadata.id!==proof[0].workspaceId)throw new AppError('WORKSPACE_CHANGED');
  await check(store,proof[0]);
 });
 if(proof.length===1)return;
 const reader=await sourceReader?.({signal});if(!reader)throw new AppError('ACCESS_LOCKED');
 try{for(const owner of proof.slice(1))await reader.use(owner.workspaceId,undefined,store=>check(store,owner));await reader.verify();}
 finally{await reader.close();}
}
