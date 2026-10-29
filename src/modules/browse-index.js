import {ObjectIndex,validIndexRef} from '../object-index.js';
import {writeCatalogueRows} from '../catalogue-writes.js';
import {digest,serialize} from '../storage-format.js';
import {AppError} from '../errors.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
const prefix=(type,sort)=>type+':'+sort+':';
// Fixed-width UTF-16 keys preserve ModuleReader's explicit JS string order,
// including prefixes, embedded separators, case folding and surrogate pairs.
const textKey=(value,reverse=false)=>{let key='';for(let i=0;i<value.length;i++)key+=(reverse?65535-value.charCodeAt(i):value.charCodeAt(i)).toString(16).padStart(4,'0');return key;};
const point=(view,sort)=>textKey(sort==='title'?view.title.toLowerCase():view.createdAt,sort==='created-desc')+'!'+view.id;
const keys=view=>['*',view.type].flatMap(type=>['title','created-desc'].map(sort=>prefix(type,sort)+point(view,sort)));

export class ModuleBrowseIndex{
 constructor(catalogue){this.catalogue=catalogue;this.store=catalogue.store;this.tree=new ObjectIndex(this.store,{namespace:'module-browse-index:',cacheReads:true});}
 static valid(value){return value?.version===1&&Object.keys(value).sort().join()==='root,version'&&validIndexRef(value.root);}
 check(head){const value=head.browseIndex;if(value!==undefined&&(!ModuleBrowseIndex.valid(value)||(value.root?.count??0)!==(head.memberVersion===1?head.root?.count??0:head.entities.length)*4))fail();}
 async flush(){
  const {tree,store}=this;
  function* rows(){for(const [key,node] of tree.writes)yield [key,node===null?null:store.encode('state',key,node)];}
  await writeCatalogueRows(store.db,'state',rows());
  for(const node of tree.writes.values())if(node)tree.cacheNode({key:digest(node.id),hash:hash(node)},node);
  tree.pending.clear();tree.pendingBytes=0;tree.writes.clear();
 }
 async replace(root,before,after,member){
  const next=after?new Set(keys(after)):new Set();
  if(before)for(const key of keys(before))if(!next.has(key))root=await this.tree.change(root,key,null);
  for(const key of next)root=await this.tree.change(root,key,hash(member));
  await this.flush();return root;
 }
 async prepare(head){
  this.check(head);if(head.browseIndex)return head.browseIndex.root;
  // Upgrade inside the existing command transaction. Reading an old layout
  // never mutates it, and an interrupted first update cannot publish a root.
  let root=null;for await(const member of this.catalogue.members(head))root=await this.replace(root,null,await this.catalogue.view(head,member),member);return root;
 }
 async plan(head,{types=null,sort='title',after=null,signal}={}){
  this.check(head);if(!head.browseIndex)return (head.memberVersion===1?head.root?.count??0:head.entities.length)===0?{total:0,offset:0,async *rows(){}}:null;
  if(!['title','created-desc'].includes(sort))throw new AppError('INVALID');
  const index=head.browseIndex,lanes=[];let total=0,offset=0;
  for(const type of types??['*']){
   signal?.throwIfAborted();const start=prefix(type,sort),lower=await this.tree.rank(index,start),upper=await this.tree.rank(index,start+'\uffff'),at=after?await this.tree.rank(index,start+point(after,sort)+'\0'):lower;
   if(at<lower||at>upper)fail();total+=upper-lower;offset+=at-lower;lanes.push({start,lower,upper,at});
  }
  const self=this;
  async function* rows(backward=false){
   const active=lanes.map(lane=>({...lane,at:backward?lane.at-1:lane.at,value:null}));
   const next=async lane=>{
    signal?.throwIfAborted();if(lane.at<lane.lower||lane.at>=lane.upper){lane.value=null;return;}
    const entry=await self.tree.entryAt(index,lane.at),id=entry?.id.slice(-36),member=await self.catalogue.member(head,id);
    if(!member||hash(member)!==entry.revision)fail();const view=await self.catalogue.view(head,member);
    if(entry.id!==lane.start+point(view,sort)||!keys(view).includes(entry.id))fail();lane.value=view;
   };
   for(const lane of active)await next(lane);
   for(;;){
    signal?.throwIfAborted();let selected;
    for(const lane of active)if(lane.value&&(!selected||(backward?point(lane.value,sort)>point(selected.value,sort):point(lane.value,sort)<point(selected.value,sort))))selected=lane;
    if(!selected)return;yield selected.value;selected.at+=backward?-1:1;await next(selected);
   }
  }
  return {total,offset,rows};
 }
 async verify(head){
  this.check(head);if(!head.browseIndex)return;
  let count=0;for await(const member of this.catalogue.members(head)){
   for(const key of keys(await this.catalogue.view(head,member))){if((await this.tree.find(head.browseIndex,key))?.revision!==hash(member))fail();count++;}
  }
  if(count!==(head.browseIndex.root?.count??0))fail();
 }
}
