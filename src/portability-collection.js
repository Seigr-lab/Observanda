// Immutable paged portability state in the existing encrypted catalogue. Small
// control files retain roots; a collection owns its blocks, including old roots.
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {OwnerDirectoryBlocks} from './owner-directory-blocks.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {projectDomainHandoff,projectDomainLock} from './project-domain-lock.js';
import {catalogueFormat,configurationCatalogueFeatures} from './catalogue-format.js';
import {inspectCatalogueArchive} from './postgres-archive.js';
import {catalogueArchiveTables} from './postgres-archive-tables.js';
import {CATALOGUE_ARCHIVE} from './postgres-activation.js';
import {withScratch} from './scratch-work.js';
import {AppError} from './errors.js';
const indexes=['order','path','project','identity','namespace','vault'];
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const prefix=id=>'portability:'+id+':';
const ordinal=value=>String(value).padStart(16,'0');
const folded=(value,policy)=>policy==='folded'?value.normalize('NFC').toLowerCase():value;
export const validPortabilityCollection=ref=>!!ref&&Object.keys(ref).sort().join()==='count,id,namePolicy,roots,version'&&ref.version===1&&['folded','exact'].includes(ref.namePolicy)&&researchId(ref.id)&&Number.isSafeInteger(ref.count)&&ref.count>=0&&ref.roots&&Object.keys(ref.roots).sort().join()===indexes.toSorted().join()&&Object.values(ref.roots).every(validTableRef)&&(ref.roots.order?.count??0)===ref.count;
class Blocks extends OwnerDirectoryBlocks{
 constructor(store,id){super(store);this.prefix=prefix(id);}
 slot(kind,revision){const slot=super.slot(kind,revision);return this.prefix+slot.slice(slot.indexOf('block:'));}
}
export class NativePortabilityCollection{
 constructor(store,id){if(!researchId(id))throw new AppError('INVALID');this.store=store;this.id=id;this.blocks=new Blocks(store,id);this.index=new RetainedTableIndex(this.blocks,{namespace:'index',allowSparseBranches:true});}
 empty(){return {version:1,id:this.id,count:0,namePolicy:['win32','darwin'].includes(process.platform)?'folded':'exact',roots:Object.fromEntries(indexes.map(name=>[name,null]))};}
 keys(row,ref){
  const value=row?.value;if(row?.version!==1||!Number.isSafeInteger(row.ordinal)||row.ordinal<0||!value||typeof value.relative!=='string'||value.relative.length>16384)damaged();
  const keys={order:ordinal(row.ordinal),path:digest(folded(value.relative,ref.namePolicy))};
  if(value.projectId&&value.kind!=='lab-book')keys.project=value.projectId;
  if(value.labBookId||value.projectId)keys.identity=value.labBookId??value.projectId;
  for(const field of ['namespace','vault'])if(value[field+'Id'])keys[field]=value[field+'Id'];
  for(const [name,key] of Object.entries(keys))if(!['order','path'].includes(name)&&!researchId(key))damaged();return keys;
 }
 async checked(ref){
  if(!validPortabilityCollection(ref)||ref.id!==this.id)damaged();
  if(configurationCatalogueFeatures(await catalogueFormat(this.store.db))?.portability!==true)damaged();
  const slot=prefix(this.id)+'head',row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot),current=row?this.store.decode('state',slot,row.payload):null;
  if(!validPortabilityCollection(current)||current.id!==ref.id||current.namePolicy!==ref.namePolicy)damaged();for(const root of Object.values(ref.roots))if(root)await this.index.node(root);return ref;
 }
 async row(revision){const row=await this.blocks.read('row',revision);return row;}
 async find(ref,index,key){
  if(index==='relative')index='path';if(!indexes.includes(index))throw new AppError('INVALID');if(index==='path')key=digest(folded(key,ref.namePolicy));
  const found=await this.index.find({root:ref.roots[index]},key);if(!found)return null;const row=await this.row(found.revision);if(this.keys(row,ref)[index]!==key)damaged();return row.value;
 }
 async put(ref,value,{replace=false}={}){
  const prior=await this.index.find({root:ref.roots.path},digest(folded(value.relative,ref.namePolicy))),old=prior?await this.row(prior.revision):null;
  if(old&&!replace)throw new AppError('STORAGE_COPY');if(old&&old.value.relative!==value.relative)throw new AppError('STORAGE_COPY');
  const row={version:1,ordinal:old?.ordinal??ref.count,value:structuredClone(value)},keys=this.keys(row,ref),next=structuredClone(ref),revision=await this.blocks.put('row',row);
  if(old){const oldKeys=this.keys(old,ref);if(serialize(oldKeys)!==serialize(keys))throw new AppError('CONFLICT');}
  for(const [name,key] of Object.entries(keys)){
   const duplicate=await this.index.find({root:next.roots[name]},key);if(duplicate&&duplicate.revision!==prior?.revision)throw new AppError('STORAGE_COPY');next.roots[name]=await this.index.change(next.roots[name],key,revision);
  }
  if(!old)next.count++;this.index.pruneRoots(Object.values(next.roots));return next;
 }
 async flush(ref){await this.index.flushRoots(Object.values(ref.roots));await this.blocks.flush();}
 async publish(ref){
  if(!validPortabilityCollection(ref)||ref.id!==this.id)damaged();await this.flush(ref);
  const slot=prefix(this.id)+'head',prior=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);if(prior&&serialize(this.store.decode('state',slot,prior.payload))===serialize(ref))return ref;await this.store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',slot,this.store.encode('state',slot,ref));return ref;
 }
 async page(ref,{offset=0,limit=32,reverse=false,index='order'}={}){
  if(!indexes.includes(index)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>32)throw new AppError('INVALID');
  const root=ref.roots[index],count=root?.count??0,items=[];let bytes=0;
  for(let i=offset;i<count&&items.length<limit;i++){
   const entry=await this.index.entryAt({root},reverse?count-1-i:i),row=await this.row(entry.revision);if(this.keys(row,ref)[index]!==entry.id)damaged();const value=row.value,size=Buffer.byteLength(serialize(value));if(items.length&&bytes+size>256*1024)break;items.push(value);bytes+=size;
  }return {items,next:offset+items.length<count?offset+items.length:null};
 }
 async verify(ref){
  const counts=Object.fromEntries(indexes.map(name=>[name,0]));let count=0;
  for await(const item of this.index.entries({root:ref.roots.order})){
   const row=await this.row(item.revision),keys=this.keys(row,ref);if(row.ordinal!==count++||keys.order!==item.id)damaged();
   for(const [name,key] of Object.entries(keys)){counts[name]++;if((await this.index.find({root:ref.roots[name]},key))?.revision!==item.revision)damaged();}
  }
  for(const name of indexes){if((ref.roots[name]?.count??0)!==counts[name])damaged();for await(const ignored of this.index.nodes(ref.roots[name]))void ignored;}if(count!==ref.count)damaged();
 }
}
async function write(storage,operation){
 const db=await storage.openCatalogue();try{
  await db.run('BEGIN');await projectDomainHandoff(db,{shared:true});await projectDomainLock(db,'Observanda/portability/'+db.id);await storage.requireStorageKey();
  // The writer stays unavailable until admission and recovery understand it.
  const formats=await import('./catalogue-format.js');if(typeof formats.requirePortabilityCollections!=='function')throw new AppError('INVALID');await formats.requirePortabilityCollections(db);
  const result=await operation(storage.catalogueStore(db));await db.run('COMMIT');return result;
 }catch(error){await db.run('ROLLBACK').catch(()=>{});throw error;}finally{await db.close();}
}
export async function createPortabilityCollection(storage,values,{id=randomUUID()}={}){
 return write(storage,async store=>{const collection=new NativePortabilityCollection(store,id);let ref=collection.empty();const append=async value=>{ref=await collection.put(ref,value);if(ref.count%64===0)await collection.flush(ref);};if(typeof values==='function')await values(append);else for await(const value of values)await append(value);return collection.publish(ref);});
}
export function portabilityCollection(storage,ref){
 if(!validPortabilityCollection(ref))throw new AppError('STORAGE_COPY');
 const read=operation=>storage.catalogue(async store=>{const collection=new NativePortabilityCollection(store,ref.id);await collection.checked(ref);return operation(collection);});
 return {get count(){return ref.count;},
  async *entries(options={}){let offset=0;do{const page=await read(collection=>collection.page(ref,{...options,offset}));yield* page.items;offset=page.next;}while(offset!==null);},
  page:options=>read(collection=>collection.page(ref,options)),
  get:relative=>read(collection=>collection.find(ref,'relative',relative)),find:(index,key)=>read(collection=>collection.find(ref,index,key)),
  async append(value){return this.appendAll([value]);},
  async appendAll(values){const next=await write(storage,async store=>{const collection=new NativePortabilityCollection(store,ref.id);await collection.checked(ref);let result=structuredClone(ref),count=0;for await(const value of values){result=await collection.put(result,value);if(++count%64===0)await collection.flush(result);}return collection.publish(result);});Object.assign(ref,next);return ref;},
  async update(relative,patch){const next=await write(storage,async store=>{const collection=new NativePortabilityCollection(store,ref.id);await collection.checked(ref);const before=await collection.find(ref,'relative',relative);if(!before)throw new AppError('NOT_FOUND');return collection.publish(await collection.put(ref,{...before,...patch},{replace:true}));});Object.assign(ref,next);return this.get(relative);},
  verify:()=>read(collection=>collection.verify(ref))
 };
}
export async function releasePortabilityCollection(storage,ref){if(!validPortabilityCollection(ref))throw new AppError('INVALID');await write(storage,store=>store.db.run('DELETE FROM state WHERE slot LIKE $1',prefix(ref.id)+'%'));}
export async function verifyPortabilityCollections(store){
 const required=configurationCatalogueFeatures(await catalogueFormat(store.db))?.portability===true;
 for await(const row of store.db.rows("SELECT slot,payload FROM state WHERE slot LIKE 'portability:%:head' ORDER BY slot")){
  if(!required)damaged();const ref=store.decode('state',row.slot,row.payload);if(!validPortabilityCollection(ref)||row.slot!==prefix(ref.id)+'head')damaged();await new NativePortabilityCollection(store,ref.id).verify(ref);
 }
 if(!required&&await store.db.get("SELECT 1 FROM state WHERE slot LIKE 'portability:%' LIMIT 1"))damaged();
}
export async function withArchivedPortabilityCollection(storage,archiveDigest,ref,operation){
 if(!validPortabilityCollection(ref))throw new AppError('STORAGE_COPY');return withScratch(async rows=>{
  let format=null;await inspectCatalogueArchive(path.join(storage.root,CATALOGUE_ARCHIVE),catalogueArchiveTables,{
   header:value=>{format=value.catalogueVersion??3;},async row(domain,table,values){if(domain===null&&table==='state'&&values[0].startsWith(prefix(ref.id))&&!await rows.add(values[0],values[1].toString('base64')))damaged();}
  },{expectedDigest:archiveDigest});
  const db={async get(sql,slot){if(sql!=='SELECT payload FROM state WHERE slot=$1'||!slot.startsWith(prefix(ref.id)))damaged();const value=await rows.get(slot);return value===undefined?undefined:{payload:Buffer.from(value,'base64')};},async all(sql){if(sql!=='SELECT version FROM catalogue_format')damaged();return [{version:format}];}};
  const archived={catalogue:operation=>operation(storage.catalogueStore(db))},collection=portabilityCollection(archived,ref);await collection.verify();return operation(collection);
 });
}
