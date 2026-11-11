import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RecordValueTree} from './record-value-tree.js';
import {validTableRef} from './retained-table-index.js';
import {retainRecordOwnerMetadata} from './record-owner-resources.js';
import {withWorkspaceMetadataBatch,withGroupedMetadataBatch} from './metadata-batch.js';
import {GROUPED_METADATA_OBJECTS} from './catalogue-writes.js';
import {researchId} from './web/research-reference.js';
const prefix='.observanda/materials/figures';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
export function retainedFigureBlockPath(kind,revision){if(!['value','index'].includes(kind)||!hash(revision))throw new AppError('INVALID');return prefix+'/'+kind+'/'+revision+'.json';}
// A member run stores an ordered run of one series' point members in one
// block. Each member is today's member object; an inline point body travels
// inside the run as `value` and keeps its own content address (`body`).
export const MEMBER_RUN_MEMBERS=128,MEMBER_RUN_BYTES=24*1024;
const naturalNumber=value=>Number.isSafeInteger(value)&&value>=0;
export function memberRunMembers(node){
 if(node?.type!=='member-run'||node.version!==1||node.collection!=='points'||Object.keys(node).sort().join()!=='collection,members,plotId,seriesId,type,version'||!researchId(node.plotId)||!researchId(node.seriesId)||!Array.isArray(node.members)||!node.members.length||node.members.length>MEMBER_RUN_MEMBERS)fail();
 return node.members.map(entry=>{
  const keys=Object.keys(entry??{});
  if(!entry||typeof entry!=='object'||keys.some(key=>!['id','position','ordinal','categoryId','body','texts','value'].includes(key))||!researchId(entry.id)||!naturalNumber(entry.position)||!naturalNumber(entry.ordinal)||entry.categoryId!==undefined&&!researchId(entry.categoryId)||!hash(entry.body)||!entry.texts||typeof entry.texts!=='object'||Array.isArray(entry.texts))fail();
  const text=Object.hasOwn(entry,'value')?serialize({type:'inline',value:entry.value}):null;if(text!==null&&digest(text)!==entry.body)fail();
  const member={format:'figure-member',version:1,collection:'points',id:entry.id,plotId:node.plotId,seriesId:node.seriesId,position:entry.position,ordinal:entry.ordinal,...(entry.categoryId?{categoryId:entry.categoryId}:{}),body:entry.body,texts:entry.texts};
  return {member,text};
 });
}
export function retainedFigureBlockChildren(kind,node){
 const children=[];
 const index=ref=>{if(ref!==null&&!validTableRef(ref))fail();if(ref)children.push({kind:'index',revision:ref.hash});};
 const value=revision=>{if(!hash(revision))fail();children.push({kind:'value',revision});};
 if(kind==='index'){
  if(node?.entries)for(const entry of node.entries)value(entry.revision);
  else if(node?.children)for(const ref of node.children)index(ref);
  else fail();
 }else if(['array','keyed-array','object','string','joined-string'].includes(node?.type))index(node.root);
 else if(['item','property'].includes(node?.type))value(node.value);
 else if(node?.type==='member-run'){for(const {member,text} of memberRunMembers(node))if(text===null)value(member.body);}
 else if(node?.type==='inline'){
  const body=node.value;
  if(body?.format==='figure-data')for(const collection of Object.values(body.collections))index(collection.root);
  else if(body?.format==='figure-presentation'){value(body.data);value(body.header);for(const collection of Object.values(body.collections))index(collection.root);}
  else if(body?.format==='figure-index')for(const collection of Object.values(body.collections))for(const ref of Object.values(collection))index(ref);
  else if(body?.format==='figure-member')value(body.body);
 }else if(node?.type!=='bytes')fail();
 return children;
}
// The enclosing admitted material/record supplies ownership. The adapter keeps
// only immutable authenticated nodes, with a bounded cache and short writes.
export class RetainedFigureBlocks{
 constructor(workspace,{write,signal,readOnly=false}={}){this.workspace=workspace;this.sharedTransaction=write===undefined&&!readOnly;this.write=write??(operation=>operation());this.signal=signal;this.readOnly=readOnly;this.cache=new Map();this.bytes=0;this.pending=new Map();this.pendingBytes=0;}
 tree(){return new RecordValueTree(this);}
 async readSnapshot(operation){this.check();const read=async()=>{const result=await operation();this.check();return result;};return typeof this.workspace.catalogue==='function'?this.workspace.catalogue(read):read();}
 // Load up to 32 uncached blocks per round trip into the block cache, in a
 // read snapshot or a writer transaction; each block is authenticated again.
 async prefetch(kind,revisions){
  if(typeof this.workspace.readMetadataMany!=='function')return;
  const wanted=[...new Set(revisions)].map(revision=>[retainedFigureBlockPath(kind,revision),revision]).filter(([key])=>!this.pending.has(key)&&!this.cache.has(key));
  for(let at=0;at<wanted.length;at+=32){
   this.check();const batch=wanted.slice(at,at+32),texts=await this.workspace.readMetadataMany(batch.map(([key])=>key),65536);this.check();
   batch.forEach(([key,revision],i)=>{if(typeof texts[i]!=='string')return;this.decode(texts[i],revision);this.keep(key,texts[i]);});
  }
 }
 check(){this.signal?.throwIfAborted();}
 // A save that runs in one writer transaction shares one metadata index
 // batch: block reads walk cached index paths instead of one query per
 // branch, and the index persists every few hundred objects rather than
 // after every block flush. Writers with their own transactions keep theirs.
 withSharedMetadata(operation){return this.sharedTransaction&&typeof this.workspace.catalogue==='function'?withWorkspaceMetadataBatch(this.workspace,operation,{signal:this.signal}):operation();}
 decode(text,revision){if(typeof text!=='string'||Buffer.byteLength(text)>65536||digest(text)!==revision)fail();let node;try{node=JSON.parse(text);}catch{fail();}if(serialize(node)!==text)fail();return node;}
 keep(key,text){if(this.cache.has(key))return;const size=Buffer.byteLength(text);while(this.cache.size>=1024||this.bytes+size>1048576){const first=this.cache.keys().next().value;if(first===undefined)break;this.bytes-=Buffer.byteLength(this.cache.get(first));this.cache.delete(first);}this.cache.set(key,text);this.bytes+=size;}
 async read(kind,revision){
  this.check();const key=retainedFigureBlockPath(kind,revision);let text=this.pending.get(key)?.text??this.cache.get(key)??await this.workspace.readMetadata(key,65536);this.check();
  // An embedded point body is stored only inside its member run.
  if((text===null||text===undefined)&&kind==='value'&&this.embedded?.has(revision)){await this.memberRun(this.embedded.get(revision));text=this.cache.get(key);}
  const node=this.decode(text,revision);this.keep(key,text);return node;
 }
 // Read a member run and make its embedded bodies readable by their own
 // content addresses for later value reads.
 async memberRun(revision){
  const node=await this.read('value',revision),members=memberRunMembers(node);this.embed(revision,members);return {node,members};
 }
 embed(revision,members){
  this.embedded??=new Map();
  for(const {member,text} of members){if(text===null)continue;this.keep(retainedFigureBlockPath('value',member.body),text);this.embedded.delete(member.body);this.embedded.set(member.body,revision);if(this.embedded.size>131072)this.embedded.delete(this.embedded.keys().next().value);}
 }
 async put(kind,node){
  this.check();if(this.readOnly)throw new AppError('INVALID');const text=serialize(node),bytes=Buffer.byteLength(text);if(bytes>65536)throw new AppError('LIMIT');const revision=digest(text),key=retainedFigureBlockPath(kind,revision);
  if(kind==='value')await this.storeEmbeddedBodies(node);
  // A body known only from inside a member run is not stored by itself yet.
  if(this.pending.has(key)||this.cache.has(key)&&!this.embedded?.has(revision))return revision;this.embedded?.delete(revision);
  if(this.pending.size>=GROUPED_METADATA_OBJECTS||this.pendingBytes+bytes>262144)await this.flush();
  this.pending.set(key,{kind,revision,text});this.pendingBytes+=bytes;return revision;
 }
 // Before a single member or another run refers to a body by its address, a
 // body that so far travels only inside a member run is stored as its own block.
 async storeEmbeddedBodies(node){
  if(!this.embedded?.size)return;
  const bodies=node?.type==='inline'&&node.value?.format==='figure-member'?[node.value.body]:node?.type==='member-run'?node.members.filter(entry=>!Object.hasOwn(entry,'value')).map(entry=>entry.body):[];
  for(const body of bodies)if(hash(body)&&this.embedded.has(body))await this.put('value',await this.read('value',body));
 }
 async flush(){
  if(!this.pending.size)return;this.check();const batch=[...this.pending];
  const catalogue=typeof this.workspace.catalogue==='function';
  const store=async([key,item])=>{this.check();const prior=await this.workspace.readMetadata(key,65536);if(prior!==null&&prior!==undefined){this.decode(prior,item.revision);if(prior!==item.text)fail();}else{if(catalogue)await retainRecordOwnerMetadata(this.workspace,key,item.text,{dependencies:retainedFigureBlockChildren(item.kind,JSON.parse(item.text)).map(child=>retainedFigureBlockPath(child.kind,child.revision))});await this.workspace.writeMetadata(key,item.text);}};
  // Figure blocks follow the dataset-preparation write contract.
  const flush=async()=>{
   if(!catalogue){for(const entry of batch)await store(entry);return;}
   await this.workspace.catalogue(async store=>{const {requireRetainedFigures}=await import('./catalogue-format.js');await requireRetainedFigures(store.db);});
   await withGroupedMetadataBatch(this.workspace,batch,{prefetchId:([key])=>'metadata:'+key,apply:store,signal:this.signal});
  };
  await this.write(()=>catalogue?withWorkspaceMetadataBatch(this.workspace,flush):flush());
  for(const [key,item] of batch){this.pending.delete(key);this.pendingBytes-=Buffer.byteLength(item.text);this.keep(key,item.text);}this.check();
 }
 async *closure(roots,{signal=this.signal}={}){
  const seen=new Set();
  const visit=async function*(owner,kind,revision){
   signal?.throwIfAborted();const key=kind+':'+revision;if(seen.has(key))return;const node=await owner.read(kind,revision);
   for(const child of retainedFigureBlockChildren(kind,node))yield* visit(owner,child.kind,child.revision);
   if(seen.size>=1024)seen.delete(seen.values().next().value);seen.add(key);yield {kind,revision,node,path:retainedFigureBlockPath(kind,revision)};
  };
  for(const root of roots)yield* visit(this,'value',root);
 }
}
