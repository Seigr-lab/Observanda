import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {researchId} from './web/research-reference.js';

const directory='.observanda/website-files/feed-usage',head=directory+'/head.json';
const hex=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
const fail=()=>{throw new AppError('FORMAT');};
const nodeFile=id=>{if(!hex(id))fail();return directory+'/nodes/'+id+'.json';};
const siteHead=id=>'.observanda/website-files/sites/'+id+'/head.json';
const marker=(id,site)=>'.observanda/website-files/sources/'+id+'/placements/'+site+'.json';
const empty={version:1,root:null};
function members(site){
 const direct=new Set(site?.sources.map(s=>s.id)),result=new Set();
 for(const feed of site?.feeds??[])if(!feed.unavailable)for(const m of feed.members)if(!direct.has(m.id))result.add(m.id);
 return result;
}
async function state(store){
 let value=await store.control(head,{missing:true});
 if(value===null){
  const nodes=await store.scope(scope=>scope.stat(store.absolute(directory+'/nodes'),{directory:true,missing:true}));
  if(!nodes)return empty;
  // An empty, unused index has no nodes directory. Existing pages require
  // their authenticated head; never rebuild from an incomplete site census.
  value=await store.control(head,{missing:true});if(!value)fail();
 }
 const p=value.pending;
 if(value.version!==1||!validTableRef(value.root))fail();
 if(p!==undefined){
  if(!p||!researchId(p.site)||p.before!==null&&!hex(p.before)||!hex(p.after)||!validTableRef(p.next)||typeof p.ready!=='boolean')fail();
  if(![p.created,p.retired,p.markers].every(list=>Array.isArray(list)&&list.every(hex)))fail();
 }
 return value;
}
function table(store,signal){
 const read=new Map();
 const index=new RetainedTableIndex({
  async read(_kind,id){if(!read.has(id))read.set(id,await store.control(nodeFile(id)));return read.get(id);},
  async put(_kind,node){const hash=digest(serialize(node));await store.writeControl(nodeFile(hash),node,{signal});return hash;}
 },{allowSparseBranches:true});
 return {index,read};
}
async function published(store,p){
 const site=await store.control(siteHead(p.site),{missing:true}),revision=site===null?null:site.revision;
 if(site!==null&&!hex(revision))fail();
 if(revision===p.after&&p.ready)return true;
 if(revision!==p.before)throw new AppError('CONFLICT');return false;
}
// The actual site head decides which side of an interrupted index change is
// visible. The losing pages stay named in the journal until removal completes.
async function settle(store,state,signal){
 const p=state.pending;if(!p)return state;
 const applied=await published(store,p);
 for(const id of applied?p.retired:p.created){signal?.throwIfAborted();await store.remove(nodeFile(id));}
 if(applied)for(const id of p.markers){signal?.throwIfAborted();await store.remove(marker(id,p.site));}
 const next={version:1,root:applied?p.next:state.root};await store.writeControl(head,next,{signal});return next;
}
// A page is reachable only along the search path for its first key. This
// protects shared immutable subtrees without walking the rest of the index.
async function reachable(index,root,hash,node){
 const key=node.entries?.[0].id??node.children[0].first;
 while(root&&root.first<=key&&root.last>=key){
  if(root.hash===hash)return true;
  const current=await index.node(root);root=current.children?.find(ref=>ref.last>=key);
 }
 return false;
}
export async function prepareFeedUsage(store,previous,site,signal){
 const prior=await settle(store,await state(store),signal);
 if(!previous?.feeds?.length&&!site.feeds?.length)return null;
 const nextMembers=members(site),oldMembers=members(previous);
 const registered=previous?.feedPlacementsIndexed===2?oldMembers:new Set();
 if(registered.size&&!prior.root)fail();
 const changes=[];
 for(const id of nextMembers)if(!registered.has(id))changes.push({id:id+'/'+site.id,revision:id});
 for(const id of registered)if(!nextMembers.has(id))changes.push({id:id+'/'+site.id,revision:null});
 const currentDirect=new Set(site.sources.map(s=>s.id));
 const markers=previous?.feedPlacementsIndexed===true?[...oldMembers].filter(id=>!currentDirect.has(id)):[];
 if(!changes.length&&!markers.length)return null;
 const {index,read}=table(store,signal),next=await index.changeMany(prior.root,changes.sort((a,b)=>a.id<b.id?-1:1),{signal});
 const touched=[...read];index.pruneRoots([next],{signal});
 const created=[],retired=[];
 for(const [hash,node] of index.pending)if(!await reachable(index,prior.root,hash,node))created.push(hash);
 for(const [hash,node] of touched)if(!await reachable(index,next,hash,node))retired.push(hash);
 const pending={site:site.id,before:previous?.revision??null,after:site.revision,next,created,retired,markers,ready:false};
 const prepared={...prior,pending};await store.writeControl(head,prepared,{signal});
 await index.flushRoots([next],{signal});pending.ready=true;await store.writeControl(head,prepared,{signal});return prepared;
}
export function finishFeedUsage(store,prepared,signal){if(prepared)return settle(store,prepared,signal);}

async function currentRoot(store){
 const value=await state(store);
 try{return value.pending&&await published(store,value.pending)?value.pending.next:value.root;}
 catch(error){if(error.code==='CONFLICT')throw new AppError('WEBSITE_CHANGED');throw error;}
}
export async function checkFeedUsageRoot(store,stamp){
 if(((await currentRoot(store))?.hash??null)!==stamp)throw new AppError('WEBSITE_CHANGED');
}
export async function feedUsageWindow(store,sourceId,after,limit,signal){
 const root=await currentRoot(store),stamp=root?.hash??null;
 const prefix=sourceId+'/',key=prefix+(after?after+'\0':''),{index}=table(store,signal),ids=[];
 try{
  const start=await index.rank({root},key);
  for(let n=start;n<(root?.count??0)&&ids.length<=limit;n++){
   signal?.throwIfAborted();const entry=await index.entryAt({root},n);if(!entry.id.startsWith(prefix))break;
   const site=entry.id.slice(prefix.length);if(!researchId(site)||entry.revision!==sourceId)fail();ids.push(site);
  }
 }catch(error){await checkFeedUsageRoot(store,stamp);throw error;}
 return {ids,stamp};
}
