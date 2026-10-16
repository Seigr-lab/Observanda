import {catalogueContext} from './research-catalogue.js';
import {projectSourceModuleOwner} from './project-source-module-owner.js';
import {researchId} from './web/research-reference.js';
import {ModuleCatalogue} from './modules/catalogue.js';
// Compare authenticated metadata identities in two held source snapshots.
// Unchanged branches are skipped; payloads are neither decoded nor duplicated.
// This is a handover primitive, not a durable checkpoint or ownership decision.
import {ObjectIndex} from './object-index.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
export async function projectSourceSnapshots(before,after,{signal}={}){
 const source=before.workspace,target=after.workspace;
 if(source.projectId||target.projectId||source.root!==target.root||source.vault?.id!==target.vault?.id)throw new AppError('INVALID');
 signal?.throwIfAborted();
 for(const store of [before,after]){const isolation=(await store.db.get('SHOW transaction_isolation')).transaction_isolation,held=catalogueContext.getStore(),writer=held?.db===store.db&&held.root===store.workspace.root&&held.vault===store.workspace.vault;if(!['repeatable read','serializable'].includes(isolation)&&!(isolation==='read committed'&&writer))throw new AppError('INVALID');}
 const beforeId=await before.head(),afterId=await after.head(),oldSnapshot=await before.snapshot(beforeId),newSnapshot=await after.snapshot(afterId);
 if(oldSnapshot.metadata.id!==newSnapshot.metadata.id)throw new AppError('WORKSPACE_CHANGED');
 return {namespaceId:oldSnapshot.metadata.id,beforeId,afterId,before:oldSnapshot,after:newSnapshot};
}
function differences(before,after,oldRoot,newRoot,{namespace,prefix='',signal}={}){
 if(typeof prefix!=='string')throw new AppError('INVALID');
 const index=new ObjectIndex(after,{immutable:true,cacheReads:true,cacheSize:256,nodeStorage:{
  async read(ref){
   const slot=namespace+ref.key;
   for(const store of [before,after]){
    signal?.throwIfAborted();const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(!row)continue;
    const value=store.decode('state',slot,row.payload);if(digest(serialize(value))===ref.hash)return value;
   }
   throw new AppError('CATALOGUE_DAMAGED');
  }
 }});
 return index.differences(oldRoot,newRoot,prefix,{signal});
}

export async function* projectMetadataChanges(before,after,{prefix='',signal}={}){
 await projectSourceSnapshots(before,after,{signal});
 const oldHead=await new ObjectIndex(before).head(),newHead=await new ObjectIndex(after).head();
 if(oldHead.legacy||newHead.legacy)throw new AppError('PROJECT_MIGRATION_FORMAT');
 yield* differences(before,after,oldHead.root,newHead.root,{namespace:'object-index:',prefix,signal});
}
export async function* projectModuleChanges(before,after,{projectId=null,signal}={}){
 if(projectId!==null&&!researchId(projectId))throw new AppError('INVALID');
 const {namespaceId}=await projectSourceSnapshots(before,after,{signal}),oldHead=await new ModuleCatalogue(before).head(namespaceId),newHead=await new ModuleCatalogue(after).head(namespaceId);
 for(const head of [oldHead,newHead])if(head.memberVersion!==1&&head.entities?.length)throw new AppError('PROJECT_MIGRATION_FORMAT');
 const oldOwner=moduleOwners(before,oldHead,namespaceId,{signal}),newOwner=moduleOwners(after,newHead,namespaceId,{signal});
 for await(const change of differences(before,after,oldHead.root??null,newHead.root??null,{namespace:'module-member-index:',signal})){
  if(projectId===null){yield change;continue;}
  const previous=change.before?await oldOwner(change.id):null,current=change.after?await newOwner(change.id):null;
  if(previous?.kind==='project'&&previous.projectId===projectId||current?.kind==='project'&&current.projectId===projectId)yield {...change,ownerBefore:previous,ownerAfter:current};
 }
}
function moduleOwners(store,head,namespaceId,{signal}={}){
 const resolve=projectSourceModuleOwner(store,head,namespaceId,{signal});
 return async id=>{const value=await resolve(id);if(!value)throw new AppError('PROJECT_MIGRATION_OWNERSHIP');return value.kind==='project'?{kind:'project',projectId:value.projectId}:{kind:'workspace'};};
}
