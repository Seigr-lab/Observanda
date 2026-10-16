// Export ownership and file reviews grow independently of their small journal.
// Immutable packed pages retain exact filenames and fingerprints; the journal
// publishes a root only after all its pages have reached durable storage.
import {MaterialSequence} from './material-sequence.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {outputName,sameFile} from './local-export-files.js';
import {AppError} from './errors.js';
const fail=()=>{throw new AppError('LOCAL_EXPORT_DAMAGED');};
const natural=n=>Number.isSafeInteger(n)&&n>=0;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const descriptor=value=>value&&natural(value.bytes)&&hash(value.sha256);
export const exportKinds=['added','replaced','removed','unchanged','conflict'];
export const emptyExportCounts=()=>Object.fromEntries(exportKinds.map(kind=>[kind,0]));
export const validExportCounts=(counts,total)=>counts&&Object.keys(counts).length===exportKinds.length&&exportKinds.every(kind=>natural(counts[kind]))&&Object.values(counts).reduce((a,b)=>a+b,0)===total;
export function validateExportMember(item,type){
 if(!item||typeof item!=='object'||Array.isArray(item))fail();outputName(item.path);
 if(type==='files'){if(!descriptor(item)||Object.keys(item).sort().join()!=='bytes,path,sha256')fail();}
 else if(type==='changes'){
  if(Object.keys(item).sort().join()!=='after,before,kind,path'||!exportKinds.includes(item.kind)||![item.before,item.after].every(value=>value===null||descriptor(value)&&Object.keys(value).sort().join()==='bytes,sha256')||!item.before&&!item.after)fail();
  const expected=sameFile(item.before,item.after)?'unchanged':!item.before?'added':!item.after?'removed':'replaced';
  if(item.kind!=='conflict'&&item.kind!==expected)fail();
 }else fail();return item;
}
const key=item=>item.path.toLowerCase();
export class LocalExportManifest{
 constructor(workspace,{write}={}){
  this.sequences=new MaterialSequence(workspace);this.cache=new Map();
  this.write=write??(fn=>workspace.withLock(()=>withWorkspaceMetadataBatch(workspace,fn)));
  this.reader=this.tree();
 }
 tree(){return new RetainedTableIndex({read:async(kind,id)=>{try{return await this.sequences.read(kind,id);}catch(error){if(error.code==='MATERIAL_MISSING')fail();throw error;}},put:(kind,value)=>this.sequences.put(kind,value)},{namespace:'local-export-nodes'});}
 validate(ref,type=ref?.type){if(!ref||ref.version!==1||!['files','changes'].includes(type)||ref.type!==type||!validTableRef(ref.root))fail();return ref;}
 async row(entry,type){
  let page=this.cache.get(entry.revision);
  if(!page){
   let stored;try{stored=await this.sequences.read('local-export-values',entry.revision,262144);}catch(error){if(error.code==='MATERIAL_MISSING')fail();throw error;}
   if(stored?.version!==1||stored.type!==type||!Array.isArray(stored.items)||!stored.items.length||stored.items.length>64)fail();
   page=new Map();for(const item of stored.items){validateExportMember(item,type);if(page.has(key(item)))fail();page.set(key(item),item);}
   if(this.cache.size===4)this.cache.delete(this.cache.keys().next().value);this.cache.set(entry.revision,page);
  }
  const value=page.get(entry.id);if(!value)fail();validateExportMember(value,type);return structuredClone(value);
 }
 async checked(operation){try{return await operation();}catch(error){if(error.code==='MATERIAL_MISSING')fail();throw error;}}
 async find(ref,name){this.validate(ref);outputName(name);return this.checked(async()=>{const entry=await this.reader.find({root:ref.root},name.toLowerCase());return entry?this.row(entry,ref.type):null;});}
 async page(ref,{offset=0,limit=50}={}){
  this.validate(ref);if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>128)throw new AppError('INVALID');
  return this.checked(async()=>{const items=[];for(let at=offset;at<Math.min(ref.root?.count??0,offset+limit);at++)items.push(await this.row(await this.reader.entryAt({root:ref.root},at),ref.type));return items;});
 }
 async *entries(ref){
  this.validate(ref);try{for await(const entry of this.reader.entries({root:ref.root}))yield await this.row(entry,ref.type);}catch(error){if(error.code==='MATERIAL_MISSING')fail();throw error;}
 }
 builder(type){
  if(!['files','changes'].includes(type))throw new AppError('INVALID');
  const owner=this,tree=this.tree();let root=null,items=[],names=new Set(),finished=false,failed=false;
  const flush=async()=>{
   if(!items.length)return;
   try{await owner.write(async()=>{const revision=await owner.sequences.put('local-export-values',{version:1,type,items});for(const item of items)root=await tree.change(root,key(item),revision);await tree.flush(root);});}
   catch(error){failed=true;throw error;}
   items=[];names=new Set();
  };
  return {async append(item){
   if(finished||failed)throw new AppError('INVALID');validateExportMember(item,type);const id=key(item);
   if(names.has(id)||await tree.find({root},id))fail();names.add(id);items.push(structuredClone(item));if(items.length===64)await flush();
  },async finish(){if(finished||failed)throw new AppError('INVALID');await flush();finished=true;return {version:1,type,root};}};
 }
}
