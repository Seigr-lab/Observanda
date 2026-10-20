// Projects and lab books share one bounded native directory representation.
// The independently locked state head authenticates immutable indexed rows;
// ordinary directory edits never revise the research snapshot or object head.
import {createHash} from 'node:crypto';
import {withScratch} from './scratch-work.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex} from './retained-table-index.js';
import {OwnerDirectoryBlocks} from './owner-directory-blocks.js';
import {OWNER_DIRECTORY_PREFIX,OWNER_DIRECTORY_HEAD,OWNER_DIRECTORY_INDEXES,validOwnerDirectoryHead,ownerDirectoryRow,ownerDirectoryKeys,ownerDirectoryEntryId} from './owner-directory-model.js';
import {catalogueFormat,catalogueRequiresOwnerDirectories,requireOwnerDirectories} from './catalogue-format.js';
import {cataloguePrefixExists} from './postgres-indexes.js';
import {researchId} from './web/research-reference.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const hash=value=>digest(serialize(value));
const ordinal=value=>String(value).padStart(16,'0');
const same=(a,b)=>serialize(a)===serialize(b);
export class NativeOwnerDirectory{
 constructor(store,{kind,ownerId,root=store.workspace.root}){
  if(!['projects','books'].includes(kind)||!researchId(ownerId))throw new AppError('INVALID');
  this.store=store;this.kind=kind;this.ownerId=ownerId;this.root=root;this.blocks=new OwnerDirectoryBlocks(store);this.index=new RetainedTableIndex(this.blocks,{namespace:'index',allowSparseBranches:true});
 }
 async head({required=false}={}){
  const row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',OWNER_DIRECTORY_HEAD);
  if(!row){if(required)damaged();return null;}
  const value=this.store.decode('state',OWNER_DIRECTORY_HEAD,row.payload);
  if(!validOwnerDirectoryHead(value)||value.kind!==this.kind||value.ownerId!==this.ownerId||!catalogueRequiresOwnerDirectories(await catalogueFormat(this.store.db)))damaged();
  return {value,revision:hash(value)};
 }
 keys(head,row){return ownerDirectoryKeys(this.kind,row,{namePolicy:head.namePolicy});}
 async row(revision){
  const value=await this.blocks.read('row',revision);if(!value||Object.keys(value).sort().join()!=='entry,state')damaged();
  try{const decoded=ownerDirectoryRow(this.kind,value.state,value.entry,this.root,{stored:true}),encoded=ownerDirectoryRow(this.kind,decoded.state,decoded.entry,this.root);
   // A retained absolute location can become internal after its workspace moves.
   // Preserve that authenticated representation; new writes still use relative roots.
   if(this.kind==='projects'&&value.state==='active'&&typeof value.entry.root==='string')encoded.entry.root=decoded.entry.root;
   if(!same(encoded,value))damaged();}catch{damaged();}
  return value;
 }
 decoded(row){return ownerDirectoryRow(this.kind,row.state,row.entry,this.root,{stored:true});}
 async find(head,id,{index='identity',decode=true}={}){
  if(!OWNER_DIRECTORY_INDEXES.includes(index)||typeof id!=='string')throw new AppError('INVALID');
  const entry=await this.index.find({root:head.roots[index]},id);if(!entry)return null;
  const row=await this.row(entry.revision);if(this.keys(head,row)[index]!==id)damaged();return decode?this.decoded(row):row;
 }
 async *rows(head,{index='identity',after=null,prefix='',signal}={}){
  if(!OWNER_DIRECTORY_INDEXES.includes(index)||after!==null&&typeof after!=='string'||typeof prefix!=='string')throw new AppError('INVALID');
  const root=head.roots[index];let position=await this.index.rank({root},after??prefix);
  for(;position<(root?.count??0);position++){
   signal?.throwIfAborted();const entry=await this.index.entryAt({root},position);if(after!==null&&entry.id<=after)continue;if(prefix&&!entry.id.startsWith(prefix))break;
   const row=await this.row(entry.revision);if(this.keys(head,row)[index]!==entry.id)damaged();yield {key:entry.id,...this.decoded(row)};
  }
 }
 async page(head,{index='active',after=null,offset=0,limit=50,prefix='',signal}={}){
  if(!OWNER_DIRECTORY_INDEXES.includes(index)||after!==null&&typeof after!=='string'||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof prefix!=='string')throw new AppError('INVALID');
  const root=head.roots[index],start=prefix?await this.index.rank({root},prefix):0,end=prefix?await this.index.rank({root},prefix+'\uffff'):(root?.count??0),from=Math.max(start,after===null?start:await this.index.rank({root},after));
  let position=from+offset;if(after!==null&&(await this.index.entryAt({root},from))?.id===after)position++;
  const items=[];for(;position<end&&items.length<limit;position++){signal?.throwIfAborted();const selected=await this.index.entryAt({root},position),row=await this.row(selected.revision);if(this.keys(head,row)[index]!==selected.id)damaged();items.push({key:selected.id,...this.decoded(row)});}
  return {items,total:end-start,next:position<end?items.at(-1)?.key??null:null};
 }
 async ancestors(head,id,{legacy=[]}={}){
  const result=[],seen=new Set();for(let next=id;next!==null;){
   if(seen.has(next))throw new AppError('FORMAT');seen.add(next);const row=await this.find(head,next);
   if(row&&row.state!=='active')throw new AppError('FORMAT');const entry=row?.entry??legacy.find(value=>value.projectId===next);
   if(!entry)throw new AppError('NOT_FOUND');result.push(entry);next=entry.parentId;
  }return result;
 }
 async hierarchy(head,entries,{legacy=[],signal}={}){
  if(this.kind!=='projects')return;
  const inherited=new Map(legacy.map(entry=>[entry.projectId,entry]));
  // Keep exact traversal state in encrypted temporary storage. A long chain is
  // resolved once, without an owner-count JS set or quadratic ancestry walks.
  return withScratch(async resolved=>{
   let walk=0;for await(const entry of entries){
    signal?.throwIfAborted();if(entry.parentId===null)continue;walk++;let id=entry.projectId;
    while(id!==null){
     const known=await resolved.get(id);if(known?.done)break;if(known?.walk===walk)throw new AppError('FORMAT');
     const row=await this.find(head,id);if(row&&row.state!=='active')throw new AppError('FORMAT');const value=row?.entry??inherited.get(id);if(!value)throw new AppError('NOT_FOUND');
     await resolved.put(id,{walk,parentId:value.parentId});id=value.parentId;
    }
    id=entry.projectId;while(id!==null){const value=await resolved.get(id);if(value?.done)break;if(!value)throw new AppError('FORMAT');await resolved.put(id,{done:true});id=value.parentId;}
   }
  },{signal});
 }
 async applyBatch(head,changes,{legacy=[],signal,validateRelations=true}={}){
  if(!changes?.[Symbol.iterator]&&!changes?.[Symbol.asyncIterator])throw new AppError('INVALID');
  return withScratch(async staged=>{
   const next=structuredClone(head);let count=0;
   for await(const change of changes){
    signal?.throwIfAborted();let row=null,id;
    if(change?.remove===true&&Object.keys(change).sort().join()==='id,remove'){id=change.id;if(!researchId(id))throw new AppError('INVALID');}
    else{row=ownerDirectoryRow(this.kind,change?.state,change?.entry,this.root);id=ownerDirectoryEntryId(this.kind,row.entry);if(row.entry.namespaceId===this.ownerId||row.state==='relocated'&&row.entry[this.kind==='projects'?'workspaceId':'projectId']===this.ownerId)throw new AppError('FORMAT');}
    if(!await staged.add(id,{id,row}))throw new AppError('INVALID');
    const prior=await this.find(next,id,{decode:false});if(prior)for(const [index,key] of Object.entries(this.keys(next,prior)))next.roots[index]=await this.index.remove(next.roots[index],key);
    if(++count%128===0){await this.index.flushRoots(Object.values(next.roots));await this.blocks.flush();this.index.pruneRoots([...Object.values(next.roots),next.receipt.original]);}
   }
   count=0;for await(const {row} of staged.items()){
    if(!row)continue;signal?.throwIfAborted();const revision=await this.blocks.put('row',row);
    for(const [index,key] of Object.entries(this.keys(next,row))){if(await this.index.find({root:next.roots[index]},key))throw new AppError('EXISTS');next.roots[index]=await this.index.change(next.roots[index],key,revision);}
    if(++count%128===0){await this.index.flushRoots(Object.values(next.roots));await this.blocks.flush();this.index.pruneRoots([...Object.values(next.roots),next.receipt.original]);}
   }
   if(validateRelations&&this.kind==='projects'){
    const active=async function*(){for await(const {row} of staged.items())if(row?.state==='active')yield row.entry;};await this.hierarchy(next,active(),{legacy,signal});
    for await(const {id,row} of staged.items())if(row?.state!=='active'&&(await this.page(next,{index:'parent',prefix:id+':',limit:1,signal})).total)throw new AppError('CONFLICT');
   }
   this.index.pruneRoots([...Object.values(next.roots),next.receipt.original]);return next;
  },{signal});
 }
 async apply(head,changes,{legacy=[],signal,validateRelations=true}={}){
  if(!Array.isArray(changes))throw new AppError('INVALID');if(changes.length>128)return this.applyBatch(head,changes,{legacy,signal,validateRelations});
  const next=structuredClone(head),ids=new Set(),prepared=[];
  for(const change of changes){
   signal?.throwIfAborted();let row=null,id;
   if(change?.remove===true&&Object.keys(change).sort().join()==='id,remove'){id=change.id;if(!researchId(id))throw new AppError('INVALID');}
   else{row=ownerDirectoryRow(this.kind,change?.state,change?.entry,this.root);id=ownerDirectoryEntryId(this.kind,row.entry);if(row.entry.namespaceId===this.ownerId||row.state==='relocated'&&row.entry[this.kind==='projects'?'workspaceId':'projectId']===this.ownerId)throw new AppError('FORMAT');}
   if(ids.has(id))throw new AppError('INVALID');ids.add(id);prepared.push({id,row});
   const prior=await this.find(next,id,{decode:false});if(prior)for(const [index,key] of Object.entries(this.keys(next,prior)))next.roots[index]=await this.index.remove(next.roots[index],key);
  }
  for(const {row} of prepared){
   if(!row)continue;signal?.throwIfAborted();const revision=await this.blocks.put('row',row);
   for(const [index,key] of Object.entries(this.keys(next,row))){if(await this.index.find({root:next.roots[index]},key))throw new AppError('EXISTS');next.roots[index]=await this.index.change(next.roots[index],key,revision);}
  }
  if(validateRelations&&this.kind==='projects')for(const {row} of prepared)if(row?.state==='active')await this.ancestors(next,row.entry.projectId,{legacy});
  // Removing or retiring a parent cannot silently orphan native children.
  if(validateRelations&&this.kind==='projects')for(const {id,row} of prepared)if(row?.state!=='active'){
   const children=await this.page(next,{index:'parent',prefix:id+':',limit:1,signal});if(children.total)throw new AppError('CONFLICT');
  }
  this.index.pruneRoots([...Object.values(next.roots),next.receipt.original]);return next;
 }
 async retainOriginal(raw,{signal}={}){
  if(raw===null)return null;const bytes=Buffer.from(raw,'utf8');let root=null;
  for(let offset=0;offset<bytes.length;offset+=32768){signal?.throwIfAborted();const revision=await this.blocks.put('original',{base64:bytes.subarray(offset,offset+32768).toString('base64')});root=await this.index.change(root,ordinal(offset/32768),revision);if(offset%(32768*32)===0)await this.index.flush(root);}
  await this.index.flush(root);return root;
 }
 async initialize({raw,entries,aliases=null,legacy=[],signal}){
  if(raw!==null&&typeof raw!=='string'||!entries?.[Symbol.asyncIterator]&&!entries?.[Symbol.iterator])throw new AppError('INVALID');
  await requireOwnerDirectories(this.store.db);
  let head={version:1,kind:this.kind,ownerId:this.ownerId,namePolicy:process.platform==='win32'||process.platform==='darwin'?'folded':'exact',receipt:{legacyDigest:raw===null?'new':digest(raw),original:await this.retainOriginal(raw,{signal})},aliases,roots:Object.fromEntries(OWNER_DIRECTORY_INDEXES.map(name=>[name,null]))};
  // Build membership before checking ancestry; imported rows may be in any order.
  for await(const item of entries){
   signal?.throwIfAborted();const row=ownerDirectoryRow(this.kind,item.state,item.entry,this.root),revision=await this.blocks.put('row',row);
   if(row.entry.namespaceId===this.ownerId||row.state==='relocated'&&row.entry[this.kind==='projects'?'workspaceId':'projectId']===this.ownerId)throw new AppError('FORMAT');
   for(const [index,key] of Object.entries(this.keys(head,row))){if(await this.index.find({root:head.roots[index]},key))throw new AppError('FORMAT');head.roots[index]=await this.index.change(head.roots[index],key,revision);}
   if((head.roots.identity?.count??0)%64===0){await this.index.flushRoots(Object.values(head.roots));await this.blocks.flush();}
  }
  if(this.kind==='projects'){const entries=async function*(rows){for await(const {entry} of rows)yield entry;};await this.hierarchy(head,entries(this.rows(head,{index:'active',signal})),{legacy,signal});}
  return this.publish(head,{signal});
 }
 async publish(head,{signal}={}){
  if(!validOwnerDirectoryHead(head)||head.kind!==this.kind||head.ownerId!==this.ownerId)throw new AppError('INVALID');signal?.throwIfAborted();
  await this.index.flushRoots([...Object.values(head.roots),head.receipt.original],{signal});await this.blocks.flush();
  await this.store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',OWNER_DIRECTORY_HEAD,this.store.encode('state',OWNER_DIRECTORY_HEAD,head));return {value:head,revision:hash(head)};
 }
 async verify(head,{signal,legacy=[]}={}){
  if(!validOwnerDirectoryHead(head))damaged();const counts=Object.fromEntries(OWNER_DIRECTORY_INDEXES.map(name=>[name,0]));
  for await(const {node} of this.index.nodes(head.roots.identity,{signal}))if(node.entries)for(const selected of node.entries){
   signal?.throwIfAborted();const row=await this.row(selected.revision),keys=this.keys(head,row);if(keys.identity!==selected.id||row.entry.namespaceId===head.ownerId||row.state==='relocated'&&row.entry[this.kind==='projects'?'workspaceId':'projectId']===head.ownerId)damaged();
   for(const [index,key] of Object.entries(keys)){counts[index]++;if((await this.index.find({root:head.roots[index]},key))?.revision!==selected.revision)damaged();}
  }
  for(const index of OWNER_DIRECTORY_INDEXES){if((head.roots[index]?.count??0)!==counts[index])damaged();for await(const ignored of this.index.nodes(head.roots[index],{signal}))signal?.throwIfAborted();}
  if(this.kind==='projects')try{const entries=async function*(rows){for await(const {entry} of rows)yield entry;};await this.hierarchy(head,entries(this.rows(head,{index:'active',signal})),{legacy,signal});}catch(error){signal?.throwIfAborted();damaged();}
  const original=createHash('sha256');let count=0;for await(const row of this.index.entries({root:head.receipt.original})){
   signal?.throwIfAborted();if(row.id!==ordinal(count++))damaged();const value=await this.blocks.read('original',row.revision);
   if(!value||Object.keys(value).join()!=='base64'||typeof value.base64!=='string')damaged();const bytes=Buffer.from(value.base64,'base64');if(!bytes.length||bytes.length>32768||bytes.toString('base64')!==value.base64)damaged();original.update(bytes);
  }
  if(head.receipt.legacyDigest==='new'){if(head.receipt.original!==null)damaged();}else if(original.digest('hex')!==head.receipt.legacyDigest)damaged();
 }
}
// Catalogue recovery validates the candidate without a filesystem marker: a
// rekeyed database is verified before its other encrypted files are installed.
// Registry admission separately requires the matching marker before adopting it.
export async function verifyOwnerDirectories(store,{signal}={}){
 const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',OWNER_DIRECTORY_HEAD),required=catalogueRequiresOwnerDirectories(await catalogueFormat(store.db));
 if(!row){if(required||await cataloguePrefixExists(store.db,'state',OWNER_DIRECTORY_PREFIX))damaged();return;}
 const head=store.decode('state',OWNER_DIRECTORY_HEAD,row.payload);if(!required||!validOwnerDirectoryHead(head))damaged();
 const metadata=(await store.snapshot()).metadata,kind=store.workspace.projectId?'books':'projects',ownerId=store.workspace.projectId??metadata.id;
 if(store.workspace.labBookId||head.kind!==kind||head.ownerId!==ownerId)damaged();
 await new NativeOwnerDirectory(store,{kind,ownerId}).verify(head,{signal,legacy:metadata.projects.map(value=>({projectId:value.id,parentId:value.parentId??null}))});
}
