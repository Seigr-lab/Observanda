// A pinned record document exposes fields and counted collection windows.
// Readers and writers share this owner; omitted values are never empty values.
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {RecordBlockStore} from './record-block-store.js';
import {withStoredRecord} from './record-storage.js';
import {retainRecordContainer} from './record-tree-values.js';
import {digest,serialize} from './storage-format.js';
const invalid=()=>{throw new AppError('INVALID');};
const natural=v=>Number.isSafeInteger(v)&&v>=0;
export class RecordDocument{
 #attemptAppend=null;
 constructor(blocks,root,{mutable=false,attemptIndex=null,methodIndex=null,resultIndex=null}={}){this.blocks=blocks;this.tree=blocks.tree();this.root=root;this.mutable=mutable;this.attemptIndex=attemptIndex;this.methodIndex=methodIndex;this.resultIndex=resultIndex;}
 attemptAppendBase(){return this.#attemptAppend?.root===this.root?structuredClone(this.#attemptAppend.base):null;}
 async #derived(root,{attemptChanged=false,append=false,signal}={}){
  const next=new RecordDocument(this.blocks,root,{mutable:true,attemptIndex:this.attemptIndex,methodIndex:this.methodIndex,resultIndex:this.resultIndex});let base=this.attemptAppendBase();
  if(append&&!base&&this.attemptIndex?.source===await this.reference(['attempt'],{signal}))base=this.attemptIndex;
  if(base&&(!attemptChanged||append))next.#attemptAppend={root,base:structuredClone(base)};
  return next;
 }
 async field(path,{signal}={}){signal?.throwIfAborted();return this.tree.selected(this.root,path);}
 async reference(path,{signal}={}){
  signal?.throwIfAborted();const value=await this.tree.select(this.root,path);if(!value)return null;
  return value.inline?this.tree.retain(value.value):value.revision;
 }
 async *properties(path,{signal}={}){
  signal?.throwIfAborted();const target=await this.tree.select(this.root,path);if(!target)invalid();
  const node=target.inline?{type:'inline',value:target.value}:await this.tree.node(target.revision);
  if(node.type==='inline'){
   if(!node.value||typeof node.value!=='object'||Array.isArray(node.value))invalid();
   for(const name of Object.keys(node.value)){signal?.throwIfAborted();yield {name,value:await this.tree.retain(node.value[name])};}return;
  }
  if(node.type!=='object')invalid();
  for await(const child of this.tree.children(node)){signal?.throwIfAborted();if(child.type!=='property')throw new AppError('CATALOGUE_DAMAGED');yield {name:child.name,value:child.value};}
 }
 async *items(path,{offset=0,limit=Infinity,signal}={}){
  if(!natural(offset)||limit!==Infinity&&!natural(limit))invalid();
  const target=await this.tree.select(this.root,path);if(!target)invalid();
  const node=target.inline?{type:'inline',value:target.value}:await this.tree.node(target.revision);
  if(node.type==='inline'){
   if(!Array.isArray(node.value))invalid();
   for(let i=offset;i<Math.min(node.value.length,offset+limit);i++){signal?.throwIfAborted();yield {index:i,value:await this.tree.retain(node.value[i])};}return;
  }
  if(node.type!=='array')invalid();
  for(let i=offset;i<Math.min(node.root?.count??0,offset+limit);i++){
   signal?.throwIfAborted();const entry=await this.tree.index.entryAt({root:node.root},i);
   if(entry?.id!==String(i).padStart(16,'0'))throw new AppError('CATALOGUE_DAMAGED');
   const child=await this.tree.node(entry.revision);if(child.type!=='item')throw new AppError('CATALOGUE_DAMAGED');yield {index:i,value:child.value};
  }
 }
 async replace(path,value,{signal}={}){if(!this.mutable)invalid();signal?.throwIfAborted();return this.#derived(await this.tree.replace(this.root,path,value),{attemptChanged:!path.length||path[0]==='attempt',signal});}
 async property(path,name,value,{remove=false,signal}={}){
  if(!this.mutable||typeof name!=='string')invalid();signal?.throwIfAborted();
  const parent=await this.reference(path,{signal});if(!parent)invalid();
  const document=this;let found=false;
  async function* children(){
   for await(const child of document.properties(path,{signal})){
    if(child.name===name){if(found)throw new AppError('CATALOGUE_DAMAGED');found=true;if(remove)continue;yield {name,value:await document.tree.retain(value)};}
    else yield child;
   }
   if(!remove&&!found)yield {name,value:await document.tree.retain(value)};
  }
  const child=await retainRecordContainer(this.blocks,'object',children(),{signal});
  return this.#derived(await this.replaceReference(this.root,path,child,{signal}),{attemptChanged:path[0]==='attempt'||!path.length&&name==='attempt',signal});
 }
 async splice(path,offset,remove,values,{signal}={}){
  if(!this.mutable||!natural(offset)||!natural(remove)||!Array.isArray(values))invalid();
  signal?.throwIfAborted();const length=await this.tree.arrayLength(this.root,path);if(offset>length||remove>length-offset||!natural(length-remove+values.length))invalid();
  if(!remove&&!values.length)return this;
  const append=offset===length&&remove===0,derived={attemptChanged:!path.length||path[0]==='attempt',append:append&&path.length===2&&path[0]==='attempt'&&['preparations','events','assessments'].includes(path[1]),signal};
  if(append){
   const target=await this.tree.select(this.root,path),node=target.inline?null:await this.tree.node(target.revision);
   if(node?.type==='array'){
    // Existing children retain their ordinal keys and references. Append only
    // the new tail and index paths; never enumerate the immutable prefix.
    const index=this.tree.index;let root=node.root,pending=0;
    for(const [position,value] of values.entries()){
     signal?.throwIfAborted();const child=await this.blocks.put('value',{type:'item',value:await this.tree.retain(value)});
     root=await index.change(root,String(length+position).padStart(16,'0'),child);
     if(++pending===32){await index.flush(root);pending=0;}
    }
    await index.flush(root);const child=await this.blocks.put('value',{type:'array',root});
    return this.#derived(await this.replaceReference(this.root,path,child,{signal}),derived);
   }
  }
  const document=this;
  async function* children(){
   for await(const item of document.items(path,{limit:offset,signal}))yield item;
   for(const value of values){signal?.throwIfAborted();yield {value:await document.tree.retain(value)};}
   yield* document.items(path,{offset:offset+remove,signal});
  }
  const child=await retainRecordContainer(this.blocks,'array',children(),{signal});
  return this.#derived(await this.replaceReference(this.root,path,child,{signal}),derived);
 }
 async replaceReference(root,path,reference,{signal}={}){
  if(!this.mutable||!Array.isArray(path)||path.some(v=>typeof v!=='string'))invalid();signal?.throwIfAborted();if(!path.length)return reference;
  const node=await this.tree.node(root),[part,...rest]=path;
  if(node.type==='inline'){
   // Inline containers have a fixed encoding budget. Expand only this small
   // container; its siblings remain referenced when the replacement is large.
   const value=node.value;if(!value||typeof value!=='object'||!Object.hasOwn(value,part))invalid();
   const document=this,type=Array.isArray(value)?'array':'object';
   async function* children(){for(const key of Object.keys(value)){signal?.throwIfAborted();let child=await document.tree.retain(value[key]);if(key===part)child=await document.replaceReference(child,rest,reference,{signal});yield {name:key,value:child};}}
   return retainRecordContainer(this.blocks,type,children(),{signal});
  }
  if(!['array','object'].includes(node.type))invalid();
  let entry,child;
  if(node.type==='array'){
   if(!/^(0|[1-9][0-9]*)$/.test(part)||!natural(Number(part)))invalid();
   entry=await this.tree.index.entryAt({root:node.root},Number(part));if(!entry)invalid();
   if(entry.id!==String(Number(part)).padStart(16,'0'))throw new AppError('CATALOGUE_DAMAGED');
   child=await this.tree.node(entry.revision);if(child.type!=='item')throw new AppError('CATALOGUE_DAMAGED');
  }else{
   for await(const candidate of this.tree.index.entries({root:node.root})){
    signal?.throwIfAborted();const value=await this.tree.node(candidate.revision);if(value.type!=='property')throw new AppError('CATALOGUE_DAMAGED');
    if(value.name===part){if(entry)throw new AppError('CATALOGUE_DAMAGED');entry=candidate;child=value;}
   }
   if(!entry)invalid();
  }
  const changed=await this.replaceReference(child.value,rest,reference,{signal});if(changed===child.value)return root;
  const member=await this.blocks.put('value',{...child,value:changed}),next=await this.tree.index.change(node.root,entry.id,member);await this.tree.index.flush(next);
  return this.blocks.put('value',{...node,root:next});
 }
 async encoding({signal}={}){
  const storage=createHash('sha256'),canonical=createHash('sha256');let bytes=0,lines=1;
  for await(const text of this.tree.json(this.root,{signal})){storage.update(text);bytes+=Buffer.byteLength(text);for(const c of text)if(c==='\n')lines++;}
  storage.update('\n');for await(const text of this.tree.json(this.root,{canonical:true,signal}))canonical.update(text);
  return {revision:storage.digest('hex'),contentRevision:canonical.digest('hex'),bytes:bytes+1,memberBytes:bytes+4*lines};
 }
}
export async function withRecordDocument(store,id,revision,consume,{mutable=false}={}){
 return withStoredRecord(store,id,revision,async({store:owner=store,value,blocks,row,key})=>{
  if(mutable&&owner!==store)throw new AppError('PROJECT_RELOCATED',[{projectId:owner.workspace.projectId}]);
  blocks??=new RecordBlockStore(owner,row.scope_id,row.generation,key);
  if(!mutable){
   // Decomposing an old envelope or an inline leaf during a read must not
   // publish blocks. Its temporary values live only for this pinned callback.
   const source=blocks,temporary=new Map();
   blocks=Object.create(source);
   blocks.put=async(kind,node)=>{const version=digest(serialize(node));temporary.set(kind+':'+version,structuredClone(node));return version;};
   blocks.read=async(kind,version)=>temporary.has(kind+':'+version)?structuredClone(temporary.get(kind+':'+version)):source.read(kind,version);
   blocks.prefetch=async(kind,versions)=>source.prefetch(kind,versions.filter(version=>!temporary.has(kind+':'+version)));
   blocks.flush=async()=>{};
  }
  const root=value.format==='observanda-record-blocks'?value.root:await blocks.tree().retain(value);
  return consume(new RecordDocument(blocks,root,{mutable,attemptIndex:value.attemptIndex??null,methodIndex:value.methodIndex??null,resultIndex:value.resultIndex??null}));
 });
}
