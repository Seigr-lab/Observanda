// Immutable, counted publication collections. Values share the record value
// tree format; primary, insertion and scoped order use RetainedTableIndex.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {PublicationDocumentBlocks,validPublicationDocumentOwner,publicationDocumentHash,publicationDocumentFailure as fail,ownPublicationJSON} from './publication-document-blocks.js';
export {publicationDocumentPrefix,publicationDocumentBlockName,publicationDocumentBlockPath,isPublicationDocumentBlockName,isPublicationDocumentBlockPath,validPublicationDocumentOwner} from './publication-document-blocks.js';
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const name=value=>typeof value==='string'&&/^[a-z][a-zA-Z0-9]{0,63}$/.test(value)&&!['__proto__','constructor','prototype','key'].includes(value);
const key=value=>typeof value==='string'&&value.length>0&&!value.includes('\0')&&Buffer.byteLength(JSON.stringify(value))<=384;
const ordinal=value=>String(value).padStart(16,'0');
const same=(a,b)=>serialize(a)===serialize(b);
const fields=(value,keys)=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys;
const ownerIdentity=owner=>[owner.kind,owner.workspaceId,owner.websiteId,owner.jobId,owner.attemptId];
const sameOwner=(a,b)=>validPublicationDocumentOwner(a)&&validPublicationDocumentOwner(b)&&same(ownerIdentity(a),ownerIdentity(b));
const indexKey=(value,id)=>value+'\0'+id;
const collectionRoots=collection=>[collection.keys,collection.order,...Object.values(collection.indexes)];
async function boundedValue(tree,revision,limit,signal){
 let text='',bytes=0;for await(const chunk of tree.json(revision,{signal})){bytes+=Buffer.byteLength(chunk);if(bytes>limit)fail();text+=chunk;}
 try{return JSON.parse(text);}catch{fail();}
}
async function boundedField(tree,root,path,limit,signal){const value=await tree.select(root,path);if(!value)fail();if(value.inline){if(Buffer.byteLength(serialize(value.value))>limit)fail();return value.value;}return boundedValue(tree,value.revision,limit,signal);}
function upper(prefix){for(let i=prefix.length-1;i>=0;i--)if(prefix.charCodeAt(i)<65535)return prefix.slice(0,i)+String.fromCharCode(prefix.charCodeAt(i)+1);return null;}
function bindWorkspace(workspace,owner,expected){
 if(expected!==undefined){if(!sameOwner(owner,expected))fail();return;}
 if(owner.websiteId!==(workspace.websiteId??null)||typeof workspace.id==='string'&&workspace.id!==owner.workspaceId)fail();
}
function validCollection(value){
 if(!fields(value,'count,indexes,keys,order')||!natural(value.count)||!validTableRef(value.keys)||!validTableRef(value.order)||(value.keys?.count??0)!==value.count||(value.order?.count??0)!==value.count||!value.indexes||typeof value.indexes!=='object'||Array.isArray(value.indexes)||Object.keys(value.indexes).length>8)return false;
 return Object.entries(value.indexes).every(([id,root])=>name(id)&&validTableRef(root)&&(root?.count??0)<=value.count);
}
export function validPublicationDocument(value){return fields(value,'owner,root,version')&&value.version===1&&validPublicationDocumentOwner(value.owner)&&publicationDocumentHash(value.root);}
function collectionSchema(collections){
 if(!collections||typeof collections!=='object'||Array.isArray(collections)||Object.keys(collections).length>64)throw new AppError('INVALID');
 const result=Object.create(null);
 for(const [id,definition] of Object.entries(collections)){
  if(!name(id)||!fields(definition,'indexes')||!Array.isArray(definition.indexes)||definition.indexes.length>8||definition.indexes.some((item,i)=>!name(item)||definition.indexes.indexOf(item)!==i))throw new AppError('INVALID');
  result[id]={count:0,keys:null,order:null,indexes:Object.fromEntries(definition.indexes.map(item=>[item,null]))};
 }return result;
}
function rowsRoot(collection,index){if(index===null)return collection.order;if(index==='key')return collection.keys;if(!Object.hasOwn(collection.indexes,index))throw new AppError('INVALID');return collection.indexes[index];}
class PublicationDocumentReader{
 constructor(blocks,collections,binding){this.blocks=blocks;this.tree=blocks.tree();this.index=new RetainedTableIndex(blocks,{namespace:'index',allowSparseBranches:true});this.collections=collections;this.binding=binding;this.snapshots=new Set();}
 collection(id){if(!name(id)||!Object.hasOwn(this.collections,id))throw new AppError('INVALID');return this.collections[id];}
 count(id){return this.collection(id).count;}
 collectionNames(){return Object.keys(this.collections);}
 check(signal){this.blocks.check();signal?.throwIfAborted();}
 pinRoots(roots){const scope=roots.filter(Boolean);this.snapshots.add(scope);return ()=>this.snapshots.delete(scope);}
 async useRoots(roots,operation){const release=this.pinRoots(roots);try{return await operation();}finally{release();}}
 async row(ref,collection,{signal}={}){
  this.check(signal);const row=await boundedValue(this.tree,ref,8192,signal);this.check(signal);
  if(!fields(row,'indexes,key,position,value')||!key(row.key)||!natural(row.position)||row.position>=collection.count||!publicationDocumentHash(row.value)||!row.indexes||typeof row.indexes!=='object'||Array.isArray(row.indexes)||Object.entries(row.indexes).some(([id,value])=>!Object.hasOwn(collection.indexes,id)||!key(value)))fail();
  return row;
 }
 get(id,identifier,{signal}={}){return this.blocks.withSignal(signal,()=>this.getValue(id,identifier,{signal}));}
 async getValue(id,identifier,{signal}={}){
  if(!key(identifier))throw new AppError('INVALID');this.check(signal);const collection=this.collection(id);
  return this.useRoots([collection.keys],async()=>{
   const entry=await this.index.find({root:collection.keys},identifier);if(!entry){this.check(signal);return null;}
   const row=await this.row(entry.revision,collection,{signal});if(row.key!==identifier)fail();const value=await this.tree.read(row.value);this.check(signal);return value;
  });
 }
 async has(id,identifier,{signal}={}){
  if(!key(identifier))throw new AppError('INVALID');this.check(signal);const root=this.collection(id).keys;return this.useRoots([root],async()=>{const entry=await this.blocks.withSignal(signal,()=>this.index.find({root},identifier));this.check(signal);return entry!==null;});
 }
 async position(id,identifier,{index=null,prefix='',reverse=false,signal}={}){
  if(!key(identifier))throw new AppError('INVALID');
  return this.blocks.withSignal(signal,async()=>{
   const query=this.query(id,this.snapshot(id),{index,prefix,reverse,signal});return this.useRoots([query.root,query.collection.keys],async()=>{
   const entry=await this.index.find({root:query.collection.keys},identifier);if(!entry){this.check(signal);return null;}
   const row=await this.row(entry.revision,query.collection,{signal});if(row.key!==identifier)fail();
   const ordered=index===null?ordinal(row.position):index==='key'?identifier:row.indexes[index]===undefined?null:indexKey(row.indexes[index],identifier);
   if(ordered===null||prefix&&!ordered.startsWith(prefix))return null;
   if((await this.index.find({root:query.root},ordered))?.revision!==entry.revision)fail();
   const {start,end}=await this.bounds(query),position=await this.index.rank({root:query.root},ordered);this.check(signal);return reverse?end-position-1:position-start;
   });
  });
 }
 snapshot(id){const collection=this.collection(id);return {collection:structuredClone(collection),binding:this.binding??digest(serialize({owner:ownerIdentity(this.blocks.owner),id,collection}))};}
 query(id,snapshot,{offset=0,cursor=null,limit=32,index=null,prefix='',reverse=false,signal}={}){
  this.check(signal);if(!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>128||typeof reverse!=='boolean'||typeof prefix!=='string'||Buffer.byteLength(JSON.stringify(prefix))>384||prefix.includes('\0')||index!==null&&typeof index!=='string'||index===null&&prefix!=='')throw new AppError('INVALID');
  const root=rowsRoot(snapshot.collection,index),binding=digest(serialize({owner:ownerIdentity(this.blocks.owner),root:snapshot.binding}));
  if(cursor!==null){
   if(typeof cursor!=='string'||cursor.length>4096)throw new AppError('INVALID');let value;
   try{const bytes=Buffer.from(cursor,'base64url');if(bytes.toString('base64url')!==cursor)throw new Error();value=JSON.parse(bytes.toString('utf8'));}catch{throw new AppError('INVALID');}
   if(!fields(value,'binding,id,index,offset,prefix,reverse,version')||value.version!==1||value.binding!==binding||value.id!==id||value.index!==index||value.prefix!==prefix||value.reverse!==reverse||!natural(value.offset))throw new AppError('INVALID');offset=value.offset;
  }
  return {id,collection:snapshot.collection,root,binding,offset,limit,index,prefix,reverse,signal};
 }
 async bounds(query){
  const start=query.prefix?await this.index.rank({root:query.root},query.prefix):0,next=query.prefix?upper(query.prefix):null,end=next===null?(query.root?.count??0):await this.index.rank({root:query.root},next);return {start,end,total:end-start};
 }
 page(query){return this.useRoots([query.root],()=>this.blocks.withSignal(query.signal,()=>this.pageValues(query)));}
 async rowAt(query,position){
  this.check(query.signal);const entry=await this.index.entryAt({root:query.root},position);if(!entry)fail();const row=await this.row(entry.revision,query.collection,{signal:query.signal});
  if(query.index===null?entry.id!==ordinal(row.position):query.index==='key'?entry.id!==row.key:entry.id!==indexKey(row.indexes[query.index],row.key))fail();
  if(query.index===null&&row.position!==position)fail();return row;
 }
 async pageValues(query){
  this.check(query.signal);const {start,end,total}=await this.bounds(query),items=[];
  for(let at=query.offset;at<Math.min(total,query.offset+query.limit);at++){
   const row=await this.rowAt(query,query.reverse?end-1-at:start+at),value=await this.tree.read(row.value);this.check(query.signal);items.push({key:row.key,value});
  }
  const nextOffset=query.offset+items.length,next=nextOffset<total?Buffer.from(JSON.stringify({version:1,binding:query.binding,id:query.id,index:query.index,prefix:query.prefix,reverse:query.reverse,offset:nextOffset})).toString('base64url'):null;
  return {items,total,offset:query.offset,next};
 }
 async window(id,options={}){return this.page(this.query(id,this.snapshot(id),options));}
 async *iterate(id,options,values){
  const query=this.query(id,this.snapshot(id),options),release=this.pinRoots([query.root]);
  try{
   const {start,end,total}=await this.blocks.withSignal(query.signal,()=>this.bounds(query));
   for(let at=query.offset;at<total;at++){
    const item=await this.blocks.withSignal(query.signal,async()=>{
     const row=await this.rowAt(query,query.reverse?end-1-at:start+at);if(!values)return row.key;
     const value=await this.tree.read(row.value);this.check(query.signal);return {key:row.key,value};
    });this.check(query.signal);yield item;
   }
  }finally{release();}
 }
 items(id,options={}){return this.iterate(id,options,true);}
 keys(id,options={}){return this.iterate(id,options,false);}
}
export class PublicationDocumentBuilder extends PublicationDocumentReader{
 static async open(workspace,descriptor,{owner,write,signal}={}){
  const previous=await PublicationDocument.open(workspace,descriptor,{owner,signal}),collections=Object.fromEntries(previous.collectionNames().map(id=>[id,{indexes:Object.keys(previous.collection(id).indexes)}]));
  const builder=new PublicationDocumentBuilder(workspace,{owner:previous.blocks.owner,collections,write,signal,expectedOwner:previous.blocks.owner});builder.collections=structuredClone(previous.collections);return builder;
 }
 constructor(workspace,{owner,collections,write,signal,expectedOwner}={}){
  if(!validPublicationDocumentOwner(owner))throw new AppError('INVALID');bindWorkspace(workspace,owner,expectedOwner);
  const blocks=new PublicationDocumentBlocks(workspace,owner,{write,signal});super(blocks,collectionSchema(ownPublicationJSON(collections)),null);this.finished=false;this.busy=false;this.pendingChanges=0;
 }
 async flushIndexes(extra=[],{signal}={}){
  const roots=[...Object.values(this.collections).flatMap(collectionRoots),...extra,...[...this.snapshots].flat()];
  await this.index.flushRoots(roots,{signal});this.pendingChanges=0;
 }
 async boundIndexes(next,signal){
  if(this.index.pending.size>=512||this.index.pendingBytes>=4*1024*1024)await this.flushIndexes(collectionRoots(next),{signal});
 }
 change(id,identifier,value,{indexes={},signal}={},replace){return this.blocks.withSignal(signal,()=>this.changeValue(id,identifier,value,{indexes,signal},replace));}
 async changeValue(id,identifier,value,{indexes={},signal}={},replace){
  if(this.finished||this.busy||!key(identifier))throw new AppError('INVALID');this.check(signal);
  const collection=this.collection(id),owned=ownPublicationJSON(value),ownedIndexes=ownPublicationJSON(indexes);
  if(!ownedIndexes||typeof ownedIndexes!=='object'||Array.isArray(ownedIndexes)||Object.entries(ownedIndexes).some(([index,value])=>!Object.hasOwn(collection.indexes,index)||!key(value)))throw new AppError('INVALID');
  this.busy=true;
  try{
   const prior=await this.index.find({root:collection.keys},identifier);if(prior&&!replace)throw new AppError('PUBLICATION_IDENTITY');
   const previous=prior?await this.row(prior.revision,collection,{signal}):null;if(previous&&previous.key!==identifier)fail();
   const position=previous?.position??collection.count;if(!natural(position+1))throw new AppError('LIMIT');
   const row={key:identifier,position,value:await this.tree.retain(owned),indexes:ownedIndexes},revision=await this.tree.retain(row),next=structuredClone(collection);
   next.count=collection.count+(previous?0:1);
   next.keys=await this.index.change(collection.keys,identifier,revision);await this.boundIndexes(next,signal);
   next.order=await this.index.change(collection.order,ordinal(position),revision);await this.boundIndexes(next,signal);
   for(const index of Object.keys(collection.indexes)){
    let root=collection.indexes[index];if(previous?.indexes[index]!==undefined)root=await this.index.remove(root,indexKey(previous.indexes[index],identifier));
    if(ownedIndexes[index]!==undefined)root=await this.index.change(root,indexKey(ownedIndexes[index],identifier),revision);
    next.indexes[index]=root;await this.boundIndexes(next,signal);
   }
   // Persist the new and previous frontiers together before acknowledging a
   // checkpoint. A failed method leaves the previous collection readable.
   const checkpoint=this.pendingChanges+1>=32;if(checkpoint)await this.flushIndexes(collectionRoots(next),{signal});
   this.check(signal);this.collections[id]=next;if(!checkpoint)this.pendingChanges++;return {key:identifier,position};
  }finally{this.busy=false;}
 }
 append(id,key,value,options){return this.change(id,key,value,options,false);}
 upsert(id,key,value,options){return this.change(id,key,value,options,true);}
 finish({header={},signal}={}){return this.blocks.withSignal(signal,()=>this.finishValue({header,signal}));}
 async finishValue({header={},signal}={}){
  if(this.finished||this.busy)throw new AppError('INVALID');this.check(signal);const owned=ownPublicationJSON(header);this.busy=true;
  try{
   await this.flushIndexes([],{signal});
   const root=new RecordContainerBuilder(this.blocks,'object');
   for(const [name,value] of [['owner',this.blocks.owner],['header',owned],['collections',this.collections]]){this.check(signal);await root.add({name,value:await this.tree.retain(value)});}
   const revision=await root.finish();this.check(signal);this.finished=true;
   return Object.freeze({version:1,owner:Object.freeze({...this.blocks.owner}),root:revision});
  }finally{this.busy=false;}
 }
}
export class PublicationDocument extends PublicationDocumentReader{
 static async open(workspace,descriptor,{owner,signal}={}){
  if(!validPublicationDocument(descriptor))fail();const receipt=ownPublicationJSON(descriptor);bindWorkspace(workspace,receipt.owner,owner);
  const blocks=new PublicationDocumentBlocks(workspace,receipt.owner,{signal,readOnly:true}),tree=blocks.tree();signal?.throwIfAborted();
  const root=await tree.node(receipt.root);if(root.type!=='object'||root.root?.count!==3)fail();
  const names=[];for await(const child of tree.children(root)){if(child.type!=='property')fail();names.push(child.name);}if(names.join()!=='owner,header,collections')fail();
  const storedOwner=await boundedField(tree,receipt.root,['owner'],1024,signal),collections=await boundedField(tree,receipt.root,['collections'],2*1024*1024,signal);
  if(!sameOwner(storedOwner,receipt.owner)||!collections||typeof collections!=='object'||Array.isArray(collections)||Object.keys(collections).length>64||Object.entries(collections).some(([id,value])=>!name(id)||!validCollection(value)))fail();
  signal?.throwIfAborted();const result=new PublicationDocument(blocks,collections,receipt.root);result.descriptor=Object.freeze({version:1,owner:Object.freeze({...receipt.owner}),root:receipt.root});return result;
 }
 header({signal}={}){return this.blocks.withSignal(signal,async()=>{this.check(signal);const result=await this.tree.selected(this.descriptor.root,['header']);this.check(signal);if(!result.found)fail();return result.value;});}
 async verify({signal,onItem}={}){
  // Reopen for verification so no earlier selected-read cache can hide damage.
  const fresh=await PublicationDocument.open(this.blocks.workspace,this.descriptor,{owner:this.blocks.owner,signal});
  await fresh.header({signal});let total=0;
  for(const id of fresh.collectionNames()){
   const collection=fresh.collection(id),counts=Object.fromEntries(Object.keys(collection.indexes).map(index=>[index,0]));let position=0;
   for await(const entry of fresh.index.entries({root:collection.order})){
    fresh.check(signal);const row=await fresh.row(entry.revision,collection,{signal});if(entry.id!==ordinal(position)||row.position!==position++)fail();
    if((await fresh.index.find({root:collection.keys},row.key))?.revision!==entry.revision)fail();
    for(const [index,value] of Object.entries(row.indexes)){counts[index]++;if((await fresh.index.find({root:collection.indexes[index]},indexKey(value,row.key)))?.revision!==entry.revision)fail();}
    for await(const chunk of fresh.tree.json(row.value,{signal})){void chunk;fresh.check(signal);}
    if(onItem){const value=await fresh.tree.read(row.value);fresh.check(signal);await onItem(id,{key:row.key,value});}total++;
   }
   if(position!==collection.count||Object.entries(counts).some(([index,count])=>(collection.indexes[index]?.count??0)!==count))fail();
  }
  fresh.check(signal);return {collections:fresh.collectionNames().length,items:total};
 }
}
