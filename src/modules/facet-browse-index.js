import {ObjectIndex,validIndexRef} from '../object-index.js';
import {writeCatalogueRows} from '../catalogue-writes.js';
import {digest,serialize} from '../storage-format.js';
import {AppError} from '../errors.js';
import {resourceTagKey,validResourceTags} from '../web/modules/resource-tags.js';
import {moduleDomainOf} from './domains.js';
import {moduleBrowsePoint as point} from './browse-order.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');},hash=value=>digest(serialize(value));
const prefix=(type,facet,sort)=>hash([type,facet]) + ':'+sort+':';
const facets=(view,constraint)=>{
 const result=[['status',view.status??null]];
 if(view.type==='resource'){
  const kind=constraint?.data?.kind;if(!['object','material','equipment','software'].includes(kind)||!validResourceTags(view.tags??[]))fail();
  result.push(['kind',kind],['status-kind',[view.status??null,kind]],...(view.tags??[]).map(tag=>['tag',resourceTagKey(tag)]));
 }
 return result;
};
const keys=(view,constraint)=>facets(view,constraint).flatMap(facet=>['title','created-desc'].map(sort=>prefix(view.type,facet,sort)+point(view,sort)));
const matches=(view,constraint,[kind,value])=>kind==='status'?view.status===value:kind==='kind'?constraint?.data?.kind===value:kind==='status-kind'?view.status===value[0]&&constraint?.data?.kind===value[1]:(view.tags??[]).some(tag=>resourceTagKey(tag)===value);

// Common filters have authenticated ordered membership. Other combinations
// choose the smallest proved candidate range and retain the existing exact
// matcher/count semantics. No full entity or query-sized result is cached.
export class ModuleFacetBrowseIndex{
 constructor(catalogue){this.catalogue=catalogue;this.store=catalogue.store;this.tree=new ObjectIndex(this.store,{namespace:'module-facet-index:',cacheReads:true});}
 check(head){
  const value=head.facetIndex;if(value===undefined)return;
  const count=head.memberVersion===1?head.root?.count??0:head.entities.length,entries=value?.root?.count??0;
  if(!value||value.version!==1||Object.keys(value).sort().join()!=='root,types,version'||!validIndexRef(value.root)||!Array.isArray(value.types)||value.types.some(type=>!moduleDomainOf(type))||new Set(value.types).size!==value.types.length||value.types.join()!==[...value.types].sort().join()||entries<count*2||entries>count*54||!count&&value.types.length||count&&!value.types.length)fail();
 }
 async flush(){
  const {tree,store}=this;function* rows(){for(const [key,node] of tree.writes)yield [key,node===null?null:store.encode('state',key,node)];}
  await writeCatalogueRows(store.db,'state',rows());for(const node of tree.writes.values())if(node)tree.cacheNode({key:digest(node.id),hash:hash(node)},node);
  tree.pending.clear();tree.pendingBytes=0;tree.writes.clear();
 }
 async replace(index,before,after,beforeConstraint,afterConstraint,member){
  let root=index.root;const next=new Set(keys(after,afterConstraint));
  if(before)for(const key of keys(before,beforeConstraint))if(!next.has(key))root=await this.tree.change(root,key,null);
  for(const key of next)root=await this.tree.change(root,key,hash(member));await this.flush();
  return {version:1,root,types:[...new Set([...index.types,after.type])].sort()};
 }
 async prepare(head){
  this.check(head);if(head.facetIndex)return head.facetIndex;
  let index={version:1,root:null,types:[]};
  // As with the existing browse projection, the first command upgrades within
  // its fenced transaction. Reads of older layouts remain strictly read-only.
  for await(const member of this.catalogue.members(head)){const view=await this.catalogue.view(head,member),constraint=view.type==='resource'?await this.catalogue.constraint(head,member):null;index=await this.replace(index,null,view,null,constraint,member);}
  return index;
 }
 async plan(head,{types=null,sort='title',after=null,status='',kind=null,tags=[],tagMode='all',signal}={}){
  this.check(head);if(!head.facetIndex)return null;if(!['title','created-desc'].includes(sort))throw new AppError('INVALID');
  const index=head.facetIndex,selected=types??index.types,groups=[];
  if(status||kind)groups.push([{facet:status&&kind?['status-kind',[status,kind]]:status?['status',status]:['kind',kind],exact:!tags.length}]);
  if(tags.length){const choices=tags.map(tag=>({facet:['tag',resourceTagKey(tag)],exact:tags.length===1&&!status&&!kind}));if(tagMode==='any')groups.push(choices);else for(const choice of choices)groups.push([choice]);}
  if(!groups.length)return null;
  let chosen;
  for(const group of groups){
   const lanes=[];let total=0,offset=0;
   for(const type of selected)for(const choice of group){
    signal?.throwIfAborted();const start=prefix(type,choice.facet,sort),lower=await this.tree.rank(index,start),upper=await this.tree.rank(index,start+'\uffff'),at=after?await this.tree.rank(index,start+point(after,sort)+'\0'):lower;
    if(at<lower||at>upper)fail();total+=upper-lower;offset+=at-lower;lanes.push({start,lower,upper,at,type,facet:choice.facet});
   }
   if(!chosen||total<chosen.total)chosen={lanes,total,offset,exact:group.length===1&&group[0].exact};
  }
  const self=this;
  async function* candidates(backward=false){
   const active=chosen.lanes.map(lane=>({...lane,at:backward?lane.at-1:lane.at,value:null}));let previous=null;
   const next=async lane=>{
    signal?.throwIfAborted();if(lane.at<lane.lower||lane.at>=lane.upper){lane.value=null;return;}
    const entry=await self.tree.entryAt(index,lane.at),id=entry?.id.slice(-36),member=await self.catalogue.member(head,id);if(!member||hash(member)!==entry.revision)fail();
    const view=await self.catalogue.view(head,member),constraint=['kind','status-kind'].includes(lane.facet[0])?await self.catalogue.constraint(head,member):null;
    if(view.type!==lane.type||entry.id!==lane.start+point(view,sort)||!matches(view,constraint,lane.facet))fail();lane.value={member,view,...(constraint?{constraint}:{})};
   };
   for(const lane of active)await next(lane);
   for(;;){
    signal?.throwIfAborted();let selected;
    for(const lane of active)if(lane.value&&(!selected||(backward?point(lane.value.view,sort)>point(selected.value.view,sort):point(lane.value.view,sort)<point(selected.value.view,sort))))selected=lane;
    if(!selected)return;const key=point(selected.value.view,sort);if(key!==previous){previous=key;yield selected.value;}
    selected.at+=backward?-1:1;await next(selected);
   }
  }
  return {total:chosen.total,offset:chosen.offset,exact:chosen.exact,candidates,async *rows(backward=false){for await(const value of candidates(backward))yield value.view;}};
 }
 async verify(head){
  this.check(head);if(!head.facetIndex)return;let count=0;const types=new Set();
  for await(const member of this.catalogue.members(head)){
   const view=await this.catalogue.view(head,member),constraint=view.type==='resource'?await this.catalogue.constraint(head,member):null;types.add(view.type);
   for(const key of keys(view,constraint)){if((await this.tree.find(head.facetIndex,key))?.revision!==hash(member))fail();count++;}
  }
  if(count!==(head.facetIndex.root?.count??0)||[...types].sort().join()!==head.facetIndex.types.join())fail();
 }
}
