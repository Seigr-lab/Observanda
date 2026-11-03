import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';

const root='.observanda/website-files';
export const pendingScopeFile=id=>root+'/pending-scopes/'+id+'.json';
export function sourceFenceScope(target,provenance){
 return {kind:'source',target:target??null,known:Boolean(provenance?.notebookId),
  projectId:provenance?.projectId??null,notebookId:provenance?.notebookId??null};
}
async function pendingScope(store,id){
 const marked=await store.control(pendingScopeFile(id),{missing:true});
 if(marked){
  if(!['source','owner'].includes(marked.kind)||marked.target!=null&&!['website','pdf'].includes(marked.target)||
   marked.projectId!=null&&!researchId(marked.projectId)||marked.notebookId!=null&&!researchId(marked.notebookId))throw new AppError('FORMAT');
  if(marked.kind==='source'&&marked.known&&!researchId(marked.notebookId)||marked.kind==='owner'&&!researchId(marked.projectId))throw new AppError('FORMAT');
  return marked;
 }
 // A missing scope may be an interrupted or historical writer. Its sealed
 // previous source can establish a target and owner; otherwise block feeds.
 const journal=await store.control(root+'/sources/'+id+'/pending.json',{missing:true});
 return sourceFenceScope(journal?.target??journal?.previous?.target,journal?.previous?.provenance);
}
const mightMatch=(q,scope)=>{
 if(scope.target==='pdf')return false;
 if(q.projectId&&(scope.projectId||scope.known)&&scope.projectId!==q.projectId)return false;
 if(q.notebookId&&(scope.notebookId||scope.known)&&scope.notebookId!==q.notebookId)return false;
 return true;
};
export async function siteHasPendingSources(store,manifest,pending,cache=new Map()){
 if(!pending.size)return false;
 if(manifest.sources.some(row=>pending.has(row.id)))return true;
 if(!manifest.feeds?.length)return false;
 for(const feed of manifest.feeds)if(feed.members.some(row=>pending.has(row.id)))return true;
 for(const id of pending){
  if(!cache.has(id))cache.set(id,await pendingScope(store,id));
  if(manifest.feeds.some(feed=>mightMatch(feed.criteria??{},cache.get(id))))return true;
 }
 return false;
}
