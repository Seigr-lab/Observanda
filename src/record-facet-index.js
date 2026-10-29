import {ObjectIndex,validIndexRef} from './object-index.js';
import {SnapshotIndex} from './snapshot-index.js';
import {buildIndex} from './index-builder.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
// Counts and domain choices belong to the immutable snapshot, not to a cached
// authorization result. Each record contributes two authenticated entries.
export class RecordFacetIndex extends ObjectIndex{
 constructor(store,{cacheSize=128,metadata=null}={}){super(store,{namespace:'record-facet-index:',immutable:true,cacheSize});this.membership=new SnapshotIndex(store,{cacheSize});this.metadata=metadata;}
 static valid(value){return value?.version===1&&Object.keys(value).sort().join()==='root,version'&&validIndexRef(value.root);}
 async keys(row){
  const metadata=this.metadata??=(await this.store.snapshot()).metadata;
  const values=await Array.fromAsync(this.store.queryDocuments([row],metadata,{search:false}));if(values.length!==1)fail();
  const value=values[0];if(value.id!==row.id||row.notebookId!==undefined&&value.notebookId!==row.notebookId)fail();
  const kind=value.type==='run'?'runs':value.type==='experiment'&&!value.template?'experiments':'other',domain=value.template?.profileId??'';
  return [value.notebookId+':count:'+kind+':'+row.id,value.notebookId+':domain:'+encodeURIComponent(domain)+':'+row.id];
 }
 async build(snapshot){
  this.metadata=snapshot.metadata;const self=this;
  async function* entries(){for await(const row of self.store.members(snapshot))for(const id of await self.keys(row))yield {id,revision:await self.membership.retain(row)};}
  return {version:1,root:await buildIndex(this.store,this,entries(),fail)};
 }
 async replace(value,before,after){
  if(!RecordFacetIndex.valid(value))fail();let root=value.root;const next=new Map();
  for(const row of after)for(const id of await this.keys(row))next.set(id,await this.membership.retain(row));
  for(const row of before)for(const id of await this.keys(row))if(!next.has(id))root=await this.change(root,id,null);
  for(const [id,revision] of next)root=await this.change(root,id,revision);
  await this.flush(root);return {version:1,root};
 }
 async summary(snapshot,notebooks,{signal}={}){
  const head=snapshot.facetIndex;if(!RecordFacetIndex.valid(head)||(head.root?.count??0)!==snapshot.count*2)fail();
  const counts={experiments:0,runs:0,other:0},domains=new Set();
  for(const notebook of notebooks){
   for(const kind of Object.keys(counts)){signal?.throwIfAborted();counts[kind]+=await this.prefixCount(head,notebook+':count:'+kind+':');}
   const start=notebook+':domain:',upper=await this.rank(head,start+'\uffff');let at=await this.rank(head,start);
   while(at<upper){
    signal?.throwIfAborted();const entry=await this.entryAt(head,at);if(!entry?.id.startsWith(start))fail();
    const encoded=entry.id.slice(start.length,-37);let domain;try{domain=decodeURIComponent(encoded);}catch{fail();}if(domain)domains.add(domain);
    const next=await this.rank(head,start+encoded+':\uffff');if(next<=at||next>upper)fail();at=next;
   }
  }
  return {counts,domains:[...domains].sort(),total:Object.values(counts).reduce((a,b)=>a+b,0)};
 }
 async verify(snapshot){
  this.metadata=snapshot.metadata;let count=0;
  for await(const row of this.store.members(snapshot))for(const id of await this.keys(row)){
   if((await this.find(snapshot.facetIndex,id))?.revision!==hash(row))fail();count++;
  }
  if(count!==snapshot.count*2||count!==(snapshot.facetIndex.root?.count??0))fail();
 }
}
