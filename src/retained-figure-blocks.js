import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RecordValueTree} from './record-value-tree.js';
import {validTableRef} from './retained-table-index.js';
import {retainRecordOwnerMetadata} from './record-owner-resources.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
const prefix='.observanda/materials/figures';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=()=>{throw new AppError('MATERIAL_MISSING');};
export function retainedFigureBlockPath(kind,revision){if(!['value','index'].includes(kind)||!hash(revision))throw new AppError('INVALID');return prefix+'/'+kind+'/'+revision+'.json';}
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
 constructor(workspace,{write,signal,readOnly=false}={}){this.workspace=workspace;this.write=write??(operation=>operation());this.signal=signal;this.readOnly=readOnly;this.cache=new Map();this.bytes=0;this.pending=new Map();this.pendingBytes=0;}
 tree(){return new RecordValueTree(this);}
 async readSnapshot(operation){this.check();const read=async()=>{const result=await operation();this.check();return result;};return typeof this.workspace.catalogue==='function'?this.workspace.catalogue(read):read();}
 check(){this.signal?.throwIfAborted();}
 decode(text,revision){if(typeof text!=='string'||Buffer.byteLength(text)>65536||digest(text)!==revision)fail();let node;try{node=JSON.parse(text);}catch{fail();}if(serialize(node)!==text)fail();return node;}
 keep(key,text){if(this.cache.has(key))return;const size=Buffer.byteLength(text);while(this.cache.size>=1024||this.bytes+size>1048576){const first=this.cache.keys().next().value;if(first===undefined)break;this.bytes-=Buffer.byteLength(this.cache.get(first));this.cache.delete(first);}this.cache.set(key,text);this.bytes+=size;}
 async read(kind,revision){this.check();const key=retainedFigureBlockPath(kind,revision),text=this.pending.get(key)?.text??this.cache.get(key)??await this.workspace.readMetadata(key,65536);this.check();const node=this.decode(text,revision);this.keep(key,text);return node;}
 async put(kind,node){
  this.check();if(this.readOnly)throw new AppError('INVALID');const text=serialize(node),bytes=Buffer.byteLength(text);if(bytes>65536)throw new AppError('LIMIT');const revision=digest(text),key=retainedFigureBlockPath(kind,revision);
  if(this.pending.has(key)||this.cache.has(key))return revision;
  if(this.pending.size>=32||this.pendingBytes+bytes>262144)await this.flush();
  this.pending.set(key,{kind,revision,text});this.pendingBytes+=bytes;return revision;
 }
 async flush(){
  if(!this.pending.size)return;this.check();const batch=[...this.pending];
  const flush=async()=>{if(typeof this.workspace.catalogue==='function')await this.workspace.catalogue(async store=>{const {requireRetainedFigures}=await import('./catalogue-format.js');await requireRetainedFigures(store.db);});for(const [key,item] of batch){this.check();const prior=await this.workspace.readMetadata(key,65536);if(prior!==null&&prior!==undefined){this.decode(prior,item.revision);if(prior!==item.text)fail();}else{if(typeof this.workspace.catalogue==='function')await retainRecordOwnerMetadata(this.workspace,key,item.text,{dependencies:retainedFigureBlockChildren(item.kind,JSON.parse(item.text)).map(child=>retainedFigureBlockPath(child.kind,child.revision))});await this.workspace.writeMetadata(key,item.text);}}};
  await this.write(()=>typeof this.workspace.catalogue==='function'?withWorkspaceMetadataBatch(this.workspace,flush):flush());
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
