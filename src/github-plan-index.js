// Immutable, website-scoped GitHub review rows. Headers and deployment cursors
// remain bounded; paths are hashed as keys and retained verbatim in each row.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
const prefix='.observanda/publishing-plan-blocks/';
const fail=()=>{throw new AppError('PUBLISH_OWNERSHIP');};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const name=value=>typeof value==='string'&&/^[a-z][a-zA-Z]{0,31}$/.test(value);
export const githubReviewKinds=['added','replaced','removed','unchanged','preserved','conflicts'];
export const githubPlanCollections=['remote','entries','uploads','ancestors','targets','preservedEntries',...githubReviewKinds];
export function validGithubPlanIndex(value){return !!value&&value.version===1&&Object.keys(value).sort().join()==='collections,version'&&value.collections&&Object.keys(value.collections).length<=16&&Object.entries(value.collections).every(([key,root])=>name(key)&&validTableRef(root));}
export function requireGithubPlanCollections(document,{ownership=false}={}){
 const required=ownership?['entries']:githubPlanCollections.filter(key=>!['remote','ancestors','targets'].includes(key));
 if(!validGithubPlanIndex(document)||Object.keys(document.collections).sort().join()!==required.sort().join())fail();return document;
}
export class GithubPlanIndex{
 constructor(workspace,descriptor,{signal,write}={}){
  if(!validGithubPlanIndex(descriptor))fail();this.workspace=workspace;this.descriptor=structuredClone(descriptor);this.signal=signal;
  this.write=write??(fn=>workspace.withLock(()=>withWorkspaceMetadataBatch(workspace,fn)));
  this.tree=new RetainedTableIndex({read:(kind,id)=>this.readBlock(kind,id),put:(kind,value)=>this.putBlock(kind,value)},{namespace:'index',allowSparseBranches:true});this.pending=new Map();this.cache=new Map();this.cacheBytes=0;this.ordinalCache=null;this.lookups=new Map();this.lookupBytes=0;
 }
 static builder(workspace,options){return new GithubPlanIndex(workspace,{version:1,collections:Object.fromEntries(githubPlanCollections.map(key=>[key,null]))},options);}
 check(){this.signal?.throwIfAborted();}
 root(kind){if(!Object.hasOwn(this.descriptor.collections,kind))fail();return this.descriptor.collections[kind];}
 count(kind){return this.root(kind)?.count??0;}
 keep(key,text){if(this.cache.has(key))return;const size=Buffer.byteLength(text);while(this.cache.size>=256||this.cacheBytes+size>1048576){const first=this.cache.keys().next().value;if(first===undefined)break;this.cacheBytes-=Buffer.byteLength(this.cache.get(first));this.cache.delete(first);}this.cache.set(key,text);this.cacheBytes+=size;}
 snapshot(operation){return this.workspace.catalogue(operation);}
 async readBlock(kind,id){this.check();if(!hash(id)||!['index','value'].includes(kind))fail();const key=kind+'-'+id,cached=this.cache.get(key),raw=cached??await this.workspace.readMetadata(prefix+key+'.json',65536);this.check();if(typeof raw!=='string'||digest(raw)!==id)fail();let value;try{value=JSON.parse(raw);}catch{fail();}if(serialize(value)!==raw)fail();if(cached===undefined)this.keep(key,raw);return value;}
 async putBlock(kind,value){this.check();const raw=serialize(value);if(Buffer.byteLength(raw)>65536)fail();const id=digest(raw),file=prefix+kind+'-'+id+'.json',prior=await this.workspace.readMetadata(file,65536);if(prior!==null&&prior!==undefined&&prior!==raw)fail();if(prior==null)await this.workspace.writeMetadata(file,raw);this.keep(kind+'-'+id,raw);return id;}
 async value(entry){if(!entry) return null;const row=await this.readBlock('value',entry.revision);if(typeof row.key!=='string'||digest(row.key)!==entry.id)fail();return row.value;}
 async get(kind,key){
  this.check();const pending=this.pending.get(kind+':'+key);if(pending)return pending.value;
  const lookup=kind+':'+(this.root(kind)?.hash??'empty')+':'+digest(key);if(this.lookups.has(lookup))return JSON.parse(this.lookups.get(lookup));
  const value=await this.value(await this.tree.find({root:this.root(kind)},digest(key))),text=serialize(value),bytes=Buffer.byteLength(text);
  while(this.lookups.size>=256||this.lookupBytes+bytes>1048576){const first=this.lookups.keys().next().value;if(first===undefined)break;this.lookupBytes-=Buffer.byteLength(this.lookups.get(first));this.lookups.delete(first);}this.lookups.set(lookup,text);this.lookupBytes+=bytes;return value;
 }
 async add(kind,key,value){this.check();this.root(kind);if(typeof key!=='string'||!key||Buffer.byteLength(serialize({key,value}))>65536)fail();const prior=await this.get(kind,key);if(prior!==null){if(serialize(prior)!==serialize(value))fail();return;}this.pending.set(kind+':'+key,{kind,key,value:structuredClone(value)});if(this.pending.size===32)await this.flush();}
 async flush(){if(!this.pending.size)return;this.check();await this.write(async()=>{for(const {kind,key,value} of this.pending.values()){const revision=await this.putBlock('value',{key,value});this.descriptor.collections[kind]=await this.tree.change(this.root(kind),digest(key),revision);}await this.tree.flushRoots(Object.values(this.descriptor.collections),{signal:this.signal});});this.pending.clear();}
 async finish(){await this.flush();return structuredClone(this.descriptor);}
 async at(kind,offset){this.check();if(!Number.isSafeInteger(offset)||offset<0||offset>=this.count(kind))fail();let cached=this.ordinalCache;if(!cached||cached.kind!==kind||cached.root!==this.root(kind)?.hash||offset<cached.offset||offset>=cached.offset+cached.items.length){const page=await this.page(kind,{offset:Math.floor(offset/32)*32});cached=this.ordinalCache={kind,root:this.root(kind)?.hash,...page};}return cached.items[offset-cached.offset];}
 async *values(kind,{offset=0}={}){if(!Number.isSafeInteger(offset)||offset<0||offset>this.count(kind))fail();while(offset<this.count(kind)){const page=await this.page(kind,{offset});for(const value of page.items){this.check();yield value;}offset+=page.items.length;}}
 async page(kind,{offset=0,limit=32}={}){if(!Number.isSafeInteger(offset)||offset<0||offset>this.count(kind)||!Number.isSafeInteger(limit)||limit<1||limit>64)throw new AppError('INVALID');return this.snapshot(async()=>{const items=[];for(let at=offset;at<Math.min(this.count(kind),offset+limit);at++)items.push(await this.value(await this.tree.entryAt({root:this.root(kind)},at)));return {items,offset,total:this.count(kind),next:offset+items.length<this.count(kind)?offset+items.length:null};});}
 async verify(){const fresh=new GithubPlanIndex(this.workspace,this.descriptor,{signal:this.signal});for(const kind of Object.keys(this.descriptor.collections))for await(const value of fresh.values(kind))void value;}
}
// Read already-retained inline plans, but every newly-created plan is indexed.
export function githubPlanReader(workspace,plan,options){
 if(plan?.document){const index=new GithubPlanIndex(workspace,plan.document,options);return index;}
 if(!plan)throw new AppError('PUBLISH_STALE');
 const rows=kind=>kind==='uploads'?[...new Map((plan.entries??[]).map(row=>[row.sha,row])).values()]:kind==='entries'||kind==='preservedEntries'?plan[kind]??[]:(plan[kind]??[]).map(path=>({path}));
 return {count:kind=>rows(kind).length,get:async(kind,path)=>rows(kind).find(row=>row.path===path)??null,at:async(kind,at)=>rows(kind)[at],async *values(kind,{offset=0}={}){yield* rows(kind).slice(offset);},async page(kind,{offset=0,limit=32}={}){const all=rows(kind),items=all.slice(offset,offset+limit);return {items,offset,total:all.length,next:offset+items.length<all.length?offset+items.length:null};}};
}
export async function* githubRemovedPaths(workspace,plan,directory=''){
 if(!plan)return;for await(const row of githubPlanReader(workspace,plan).values('removed'))yield directory?row.path.slice(directory.length+1):row.path;
}

// Archives and fresh-key recovery verify current reviews, retained ownership
// and every interrupted deployment, including descriptors not yet activated.
export async function verifyGithubPublishingPlans(workspace){
 for(const folder of ['publishing-plan','publishing-ownership','deployments']){
  for await(const name of workspace.metadataNames('.observanda/'+folder)){
   if(!/^(?:[a-f0-9]{64}|[a-f0-9-]{36})\.json$/.test(name))fail();
   const raw=await workspace.readMetadata('.observanda/'+folder+'/'+name,16*1024*1024);let value;try{value=JSON.parse(raw);}catch{fail();}
   if(!value)fail();
   const replacement=folder==='publishing-plan'?value:value.intent?.plan;
   if(replacement?.version===3)(await import('./github-publication-plan.js')).admitGithubPlan(replacement);
   if([2,3].includes(value.version)&&folder!=='deployments')requireGithubPlanCollections(value.document,{ownership:folder==='publishing-ownership'});
   if([2,3].includes(value.intent?.plan?.version))requireGithubPlanCollections(value.intent.plan.document);
   if(value.journal?.document)requireGithubPlanCollections(value.journal.document);
   for(const descriptor of [value.document,value.intent?.plan?.document,value.journal?.document])if(descriptor)await new GithubPlanIndex(workspace,descriptor).verify();
  }
 }
}
