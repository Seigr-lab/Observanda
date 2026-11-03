import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {libraryStamp,scanEligibleWebsiteRows} from './website-file-library.js';
import {removeLiveFeedSource,releasePreviousFeedSource} from './website-feed-source.js';

function owner(receipt){
 const {id,projectId,labBookId=null,namespaceId}=receipt;
 if(!researchId(id)||!researchId(projectId)||!researchId(namespaceId)||labBookId!==null&&!researchId(labBookId))throw new AppError('INVALID');
 return {id,projectId,labBookId,namespaceId};
}
function belongs(row,scope){
 return row.projectId===scope.projectId&&(!scope.labBookId||row.workspaceId===scope.namespaceId&&row.notebookId===scope.labBookId);
}
async function boundary(store,receipt,signal){
 const scope=owner(receipt),key=createHash('sha256').update('feed-owner-removal:'+JSON.stringify(scope)).digest('hex');
 const file='.observanda/website-files/feed-deletions/'+scope.id+'.json',prior=await store.control(file,{missing:true,signal});
 if(prior&&prior.key!==key)throw new AppError('CONFLICT');
 if(prior?.complete){await store.fence(key,false,signal);return {complete:true};}
 for(const id of await store.pendingSources()){
  if(id===key)continue;
  const {source,pending}=await store.sourceStatus(id),provenance=source?.provenance??pending?.previous?.provenance;
  if(provenance&&belongs(provenance,scope))throw new AppError('CONFLICT');
 }
 await store.fence(key,true,signal,{kind:'owner',target:'website',projectId:scope.projectId,notebookId:scope.labBookId});
 if(!prior)await store.writeControl(file,{key,scope,complete:false},{signal});
 return {key,file,scope};
}
export function feedOwnerDeletionHooks(store){
 return {
  beforeFreeze:receipt=>store.scope(()=>boundary(store,receipt),{write:true}),
  onFrozen:receipt=>store.scope(async fs=>{
   const {complete,key,file,scope}=await boundary(store,receipt);if(complete)return;
   const stamp=await libraryStamp(store),sources=[],retire=[];
   for await(const row of scanEligibleWebsiteRows(store,fs,stamp)){
    if(!belongs(row,scope))continue;
    const base=await store.source(row.id,{pending:true});if(!base?.visible||!belongs(base.provenance,scope))throw new AppError('CONFLICT');
    const {live,retired,retained}=await removeLiveFeedSource(store,base);
    sources.push(live);if(retired)retire.push({retired,retained});
   }
   const {refreshFeedBatch}=await import('./website-dynamic-feeds.js');await refreshFeedBatch(store,sources,{});
   for(const {retired,retained} of retire)await releasePreviousFeedSource(store,retired,retained);
   await store.writeControl(file,{key,scope,complete:true});await store.fence(key,false);
  },{write:true})
 };
}
