// Immutable JSON content addressed by semantic values. Arrays/objects use
// counted pages, while long strings use byte chunks. An ordinal lookup reads
// only its index path; earlier revisions can share unchanged values/pages.
import {AppError} from './errors.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {serialize} from './storage-format.js';
import {canonicalValue} from './web/revision-model.js';
import {recordStringJSON,recordStringText,recordTextJSON} from './record-string-stream.js';
import {jsonChunks,jsonFitsBytes} from './web/json-chunks.js';

const fail=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const ordinal=value=>String(value).padStart(16,'0');
const arrayType=node=>['array','keyed-array'].includes(node.type);
const inlineBytes=8192,chunkBytes=32768;
const keys=(value,expected)=>value&&Object.keys(value).sort().join()===expected;
function jsonValue(value,ancestors=new Set()){
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(!value||typeof value!=='object'||ancestors.has(value)||Object.getOwnPropertySymbols(value).length)return false;
 if(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
 ancestors.add(value);
 try{
  let count=0;
  for(const key in value){
   if(!Object.hasOwn(value,key))continue;
   if(Array.isArray(value)&&key!==String(count))return false;
   const descriptor=Object.getOwnPropertyDescriptor(value,key);
   if(!Object.hasOwn(descriptor,'value')||!jsonValue(descriptor.value,ancestors))return false;
   count++;
  }
  return !Array.isArray(value)||count===value.length;
 }finally{ancestors.delete(value);}
}
export class RecordValueTree{
 #selections=new Map();
 #selectionBytes=0;
 constructor(storage){this.storage=storage;this.index=new RetainedTableIndex(storage,{namespace:'index',allowSparseBranches:true});}
 async retain(value){if(!jsonValue(value))throw new AppError('INVALID');return this.#retain(value);}
 async #retain(value){
  if(jsonFitsBytes(value,inlineBytes-1,{pretty:true}))return this.storage.put('value',{type:'inline',value});
  let count=0;const levels=[],index=new RetainedTableIndex(this.storage,{namespace:'index',allowSparseBranches:true});
  const emit=async level=>{const ref=index.make({[level?'children':'entries']:levels[level]});await index.flush(ref);levels[level]=[];return ref;};
  const append=async(level,item)=>{(levels[level]??=[]).push(item);if(levels[level].length===32)await append(level+1,await emit(level));};
  const add=async node=>append(0,{id:ordinal(count++),revision:await this.storage.put('value',node)});
  const finish=async()=>{
   for(let level=0;level<levels.length;level++){
    if(!levels[level].length)continue;
    if(level&&levels[level].length===1&&!levels.slice(level+1).some(items=>items.length))return levels[level][0];
    const ref=await emit(level);if(!levels.slice(level+1).some(items=>items.length))return ref;await append(level+1,ref);
   }return null;
  };
  if(typeof value==='string'){
   let bytes=0,last=null;
   for(const chunk of jsonChunks(value,{size:chunkBytes})){
    bytes+=chunk.length;
    if(chunk.length===chunkBytes)await add({type:'bytes',value:Buffer.from(chunk).toString('base64')});else last=chunk;
   }
   // serialize()'s final newline belongs to the last byte block. Retain the
   // same boundaries and hashes as older writers, including an exact multiple.
   const tail=Buffer.alloc((last?.length??0)+1);if(last)tail.set(last);tail[tail.length-1]=10;
   await add({type:'bytes',value:tail.toString('base64')});
   return this.storage.put('value',{type:'string',root:await finish(),bytes:bytes+1});
  }
  if(Array.isArray(value))for(const child of value)await add({type:'item',value:await this.#retain(child)});
  else if(value&&typeof value==='object')for(const name of Object.keys(value))await add({type:'property',name,value:await this.#retain(value[name])});
  else throw new AppError('INVALID');
  return this.storage.put('value',{type:Array.isArray(value)?'array':'object',root:await finish()});
 }
 async node(revision){
  if(!hash(revision))fail();const node=await this.storage.read('value',revision);
  if(!node||typeof node!=='object')fail();
  if(node.type==='inline'){if(!keys(node,'type,value')||!jsonValue(node.value)||Buffer.byteLength(serialize(node.value))>inlineBytes)fail();}
  else if(['array','keyed-array','object','joined-string'].includes(node.type)){if(!keys(node,'root,type')||!validTableRef(node.root))fail();}
  else if(node.type==='string'){if(!keys(node,'bytes,root,type')||!validTableRef(node.root)||!natural(node.bytes)||node.bytes===0||node.root?.count!==Math.ceil(node.bytes/chunkBytes))fail();}
  else if(node.type==='item'){if(!keys(node,'type,value')||!hash(node.value))fail();}
  else if(node.type==='property'){if(!keys(node,'name,type,value')||typeof node.name!=='string'||!hash(node.value))fail();}
  else if(node.type==='bytes'){if(!keys(node,'type,value')||typeof node.value!=='string'||!node.value||node.value.length>Math.ceil(chunkBytes/3)*4||Buffer.from(node.value,'base64').toString('base64')!==node.value)fail();}
  else fail();return node;
 }
 async *children(node){
  let position=0;for await(const {node:page} of this.index.nodes(node.root)){
   if(!page.entries)continue;
   if(arrayType(node)||node.type==='object'){
    await this.storage.prefetch?.('value',page.entries.map(entry=>entry.revision));
    const children=[];for(const entry of page.entries){if(node.type!=='keyed-array'&&entry.id!==ordinal(position))fail();position++;children.push(await this.node(entry.revision));}
    await this.storage.prefetch?.('value',[...new Set(children.filter(child=>['item','property'].includes(child.type)).map(child=>child.value))]);
    yield* children;
   }else for(const entry of page.entries){
    if(entry.id!==ordinal(position++))fail();yield await this.node(entry.revision);
   }
  }if(position!==(node.root?.count??0))fail();
 }
 async read(revision){
  const node=await this.node(revision);
  if(node.type==='inline')return structuredClone(node.value);
  if(node.type==='joined-string'){let value='';for await(const text of this.joinedText(node))value+=text;return value;}
  if(node.type==='string'){
   const chunks=[];for await(const chunk of this.stringBytes(node))chunks.push(chunk);
   const buffer=Buffer.concat(chunks),encoded=buffer.toString('utf8');if(!Buffer.from(encoded).equals(buffer))fail();
   let value;try{value=JSON.parse(encoded);}catch{fail();}if(typeof value!=='string'||serialize(value)!==encoded)fail();return value;
  }
  if(arrayType(node)){
   const result=[];for await(const child of this.children(node)){if(child.type!=='item')fail();result.push(await this.read(child.value));}return result;
  }
  if(node.type==='object'){
   const result={};for await(const child of this.children(node)){
    if(child.type!=='property'||Object.hasOwn(result,child.name))fail();
    Object.defineProperty(result,child.name,{value:await this.read(child.value),enumerable:true,writable:true,configurable:true});
   }return result;
  }fail();
 }
 async *stringBytes(node){
  let bytes=0;for await(const child of this.children(node)){
   if(child.type!=='bytes')fail();const chunk=Buffer.from(child.value,'base64');
   if(chunk.length!==Math.min(chunkBytes,node.bytes-bytes))fail();bytes+=chunk.length;yield chunk;
  }
  if(bytes!==node.bytes)fail();
 }
 async select(revision,path){
  if(!Array.isArray(path)||path.some(part=>typeof part!=='string'))throw new AppError('INVALID');
  let inline=false,value;
  for(const part of path){
   if(!inline){const node=await this.node(revision);
    if(node.type==='inline'){inline=true;value=node.value;}
    else if(arrayType(node)){
     if(!/^(0|[1-9][0-9]*)$/.test(part)||!natural(Number(part)))return null;
     const entry=await this.index.entryAt({root:node.root},Number(part));if(!entry)return null;if(node.type!=='keyed-array'&&entry.id!==ordinal(Number(part)))fail();
     const child=await this.node(entry.revision);if(child.type!=='item')fail();revision=child.value;continue;
    }else if(node.type==='object'){
     // A content hash pins the entire property list. Reuse the checked lookup
     // within this tree owner, keeping references only, never decoded bodies.
     const key=revision+':'+part,cached=this.#selections.get(key);let found;
     if(cached){this.#selections.delete(key);this.#selections.set(key,cached);found=cached.value;}
     else{
      found=null;for await(const child of this.children(node)){if(child.type!=='property')fail();if(child.name===part){if(found)fail();found=child.value;}}
      const bytes=Buffer.byteLength(key)+64;
      if(bytes<=4096){
       while(this.#selections.size>=128||this.#selectionBytes+bytes>65536){const first=this.#selections.keys().next().value;this.#selectionBytes-=this.#selections.get(first).bytes;this.#selections.delete(first);}
       this.#selections.set(key,{value:found,bytes});this.#selectionBytes+=bytes;
      }
     }
     if(!found)return null;revision=found;continue;
    }else return null;
   }
   if(value===null||typeof value!=='object'||!Object.hasOwn(value,part))return null;value=value[part];
  }
  return inline?{inline:true,value:structuredClone(value)}:{inline:false,revision};
 }
 async selected(revision,path){const target=await this.select(revision,path);return target?{found:true,value:target.inline?target.value:await this.read(target.revision)}:{found:false};}
 async *text(revision,path,{signal}={}){
  signal?.throwIfAborted();const target=await this.select(revision,path);if(!target)fail();
  const node=target.inline?{type:'inline',value:target.value}:await this.node(target.revision);
  if(node.type==='inline'){if(typeof node.value!=='string')fail();yield node.value;return;}
  if(node.type==='joined-string'){yield* this.joinedText(node,{signal});return;}
  if(node.type!=='string')fail();yield* recordStringText(this.stringBytes(node),{signal});
 }
 async *joinedText(node,{signal}={}){
  let count=0;
  for await(const {node:page} of this.index.nodes(node.root,{signal})){
   if(!page.entries)continue;await this.storage.prefetch?.('value',page.entries.map(entry=>entry.revision));
   for(const entry of page.entries){
    signal?.throwIfAborted();const child=await this.node(entry.revision);if(child.type!=='item')fail();const part=await this.node(child.value);
    if(count++)yield ' ';
    if(part.type==='inline'){if(typeof part.value!=='string')fail();yield part.value;}
    else if(part.type==='string')yield* recordStringText(this.stringBytes(part),{signal});
    else fail();
   }
  }
  if(count!==(node.root?.count??0))fail();
 }
 async propertyNames(revision){
  const node=await this.node(revision);
  if(node.type==='inline'&&node.value&&typeof node.value==='object'&&!Array.isArray(node.value))return Object.keys(node.value);
  if(node.type!=='object')fail();
  const names=[];for await(const child of this.children(node)){if(child.type!=='property'||names.includes(child.name))fail();names.push(child.name);}return names;
 }
 async arrayLength(revision,path){
  const target=await this.select(revision,path);if(!target)fail();
  const node=target.inline?{type:'inline',value:target.value}:await this.node(target.revision);
  if(node.type==='inline'&&Array.isArray(node.value))return node.value.length;
  if(!arrayType(node))fail();return node.root?.count??0;
 }
 async replace(revision,path,value){
  if(!Array.isArray(path)||path.some(part=>typeof part!=='string'))throw new AppError('INVALID');
  if(!path.length)return this.retain(value);
  const node=await this.node(revision),[part,...rest]=path;
  if(node.type==='inline'){
   const copy=structuredClone(node.value);let target=copy;
   for(const name of path.slice(0,-1)){if(!target||typeof target!=='object'||!Object.hasOwn(target,name))throw new AppError('INVALID');target=target[name];}
   if(!target||typeof target!=='object'||!Object.hasOwn(target,path.at(-1)))throw new AppError('INVALID');
   Object.defineProperty(target,path.at(-1),{value:structuredClone(value),enumerable:true,writable:true,configurable:true});return this.retain(copy);
  }
  let entry,child;
  if(arrayType(node)){
   if(!/^(0|[1-9][0-9]*)$/.test(part)||!natural(Number(part)))throw new AppError('INVALID');
   entry=await this.index.entryAt({root:node.root},Number(part));if(!entry)throw new AppError('INVALID');if(node.type!=='keyed-array'&&entry.id!==ordinal(Number(part)))fail();
   child=await this.node(entry.revision);if(child.type!=='item')fail();
  }else if(node.type==='object'){
   for await(const candidate of this.index.entries({root:node.root})){
    const property=await this.node(candidate.revision);if(property.type!=='property')fail();
    if(property.name===part){if(entry)fail();entry=candidate;child=property;}
   }
   if(!entry)throw new AppError('INVALID');
  }else throw new AppError('INVALID');
  const changed=await this.replace(child.value,rest,value);
  if(changed===child.value)return revision;
  const member=await this.storage.put('value',{...child,value:changed}),root=await this.index.change(node.root,entry.id,member);await this.index.flush(root);
  return this.storage.put('value',{...node,root});
 }
 // Stream either the exact storage serialization or canonical revision input.
 // Container contents are visited in order; no whole record is assembled.
 // Long scalar strings are checked and emitted in their existing byte windows.
 async *json(revision,{canonical=false,depth=0,signal}={}){
  signal?.throwIfAborted();
  const node=await this.node(revision),indent='  '.repeat(depth);
  if(node.type==='string'){yield* recordStringJSON(this.stringBytes(node),{signal});return;}
  if(node.type==='joined-string'){yield* recordTextJSON(this.joinedText(node,{signal}),{signal});return;}
  if(node.type==='inline'){
   const value=node.value,encoded=JSON.stringify(canonical?canonicalValue(value):value,null,canonical?0:2);
   yield canonical?encoded:encoded.replaceAll('\n','\n'+indent);return;
  }
  if(!arrayType(node)&&node.type!=='object')fail();
  const object=node.type==='object';yield object?'{':'[';
  let children=this.children(node);
  if(object&&canonical){
   const properties=Object.create(null);for await(const child of children){signal?.throwIfAborted();if(child.type!=='property'||Object.hasOwn(properties,child.name))fail();properties[child.name]=child;}
   children=Object.values(Object.fromEntries(Object.keys(properties).sort().map(name=>[name,properties[name]])));
  }
  let count=0;
  for await(const child of children){
   signal?.throwIfAborted();
   if(child.type!==(object?'property':'item'))fail();
   yield (count++?',':'')+(canonical?'':'\n'+indent+'  ');
   if(object)yield JSON.stringify(child.name)+(canonical?':':': ');
   yield* this.json(child.value,{canonical,depth:depth+1,signal});
  }
  if(count&&!canonical)yield '\n'+indent;yield object?'}':']';
  if(count!==(node.root?.count??0))fail();
 }
 async page(revision,path,{offset=0,limit=4}={}){
  if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');
  const target=await this.select(revision,path);if(!target)throw new AppError('INVALID');
  const node=target.inline?{type:'inline',value:target.value}:await this.node(target.revision);
  if(node.type==='inline'){if(!Array.isArray(node.value))throw new AppError('INVALID');return {total:node.value.length,offset,values:structuredClone(node.value.slice(offset,offset+limit))};}
  if(!arrayType(node))throw new AppError('INVALID');
  const values=[],total=node.root?.count??0;
  for(let i=offset;i<Math.min(offset+limit,total);i++){
   const entry=await this.index.entryAt({root:node.root},i);if(!entry||node.type!=='keyed-array'&&entry.id!==ordinal(i))fail();const child=await this.node(entry.revision);if(child.type!=='item')fail();values.push(await this.read(child.value));
  }return {total,offset,values};
 }
}
