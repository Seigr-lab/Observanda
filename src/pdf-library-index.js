import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';

const fail=code=>{throw new AppError(code);};
const scope=archived=>archived?'archived:':'active:';
const normalized=text=>text.normalize('NFC').toLowerCase();
const hash=value=>digest(serialize(value));
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const keys=(value,names)=>!!value&&typeof value==='object'&&Object.keys(value).sort().join()===names;
const batchSize=32;

// Only the current derived indexes are addressable. Editions own their
// document trees, and an old library cursor must restart after a write.
export class PdfLibraryIndex extends RetainedTableIndex{
 constructor(blocks,options){super(blocks,options);this.previousPages=new Map();}
 async node(ref){
  if(!this.pending.has(ref.hash))this.previousPages.set(ref.hash,ref);
  return super.node(ref);
 }
 async reachable(candidate,root){
  while(root&&root.height>=candidate.height&&root.first<=candidate.first&&root.last>=candidate.last){
   if(root.height===candidate.height)return root.hash===candidate.hash;
   const node=await super.node(root);
   root=node.children.find(child=>child.first<=candidate.first&&child.last>=candidate.last);
  }
  return false;
 }
 async flushRoots(roots,{signal}={}){
  await super.flushRoots(roots,{signal});
  for(const candidate of this.previousPages.values()){
   signal?.throwIfAborted();let live=false;
   for(const root of roots)if(await this.reachable(candidate,root)){live=true;break;}
   if(!live)await this.sequences.store.deleteObject(this.sequences.key(this.namespace,candidate.hash));
  }
  this.previousPages.clear();
 }
}

export function validPdfLibrary(value){
 if(!value||![value.names,value.recent,value.pinned].every(validTableRef))return false;
 if(value.version===1){if(!keys(value,'backfill,names,pinned,recent,version'))return false;}
 else if(value.version!==2||!keys(value,'backfill,names,organization,pinned,recent,version')||!keys(value.organization,'labels,members')||![value.organization.labels,value.organization.members].every(validTableRef))return false;
 const b=value.backfill;
 return b===null||value.version===1&&keys(b,'active,archive,offset,scope')&&validTableRef(b.active)&&validTableRef(b.archive)&&['active','archive'].includes(b.scope)&&integer(b.offset)&&b.offset<=(b[b.scope]?.count??0);
}
const titleKey=row=>scope(row.archived)+normalized(row.name)+'\0'+row.id;
const recentKey=row=>scope(row.archived)+(Number.MAX_SAFE_INTEGER-(row.modified??0)).toString().padStart(16,'0')+':'+row.id;
function validRow(row){
 return keys(row,'archived,count,id,modified,name,pinned,revision')&&researchId(row.id)&&revisionId(row.revision)&&typeof row.name==='string'&&row.name.length<=240&&integer(row.count)&&typeof row.archived==='boolean'&&typeof row.pinned==='boolean'&&(row.modified===null||integer(row.modified));
}
const itemKey=id=>'pdf-library:item:'+id;
async function readRow(store,id,revision){
 const row=await store.object(itemKey(id));
 if(!validRow(row)||row.id!==id||hash(row)!==revision)fail('CATALOGUE_DAMAGED');
 return row;
}

// Only authenticated document-header metadata enters these indexes. Source
// prose, section titles, thumbnails and export bytes require their own grants.
export async function indexPdfLibraryMembership(index,roots,previous,next){
 const indexes=[['names',titleKey],['recent',recentKey],['pinned',row=>row.pinned?titleKey(row):null]];
 for(const [name,getKey] of indexes){
  const oldKey=previous&&getKey(previous),newKey=next&&getKey(next);
  if(oldKey){
   if((await index.find({root:roots[name]},oldKey))?.revision!==hash(previous))fail('CATALOGUE_DAMAGED');
   if(oldKey!==newKey)roots[name]=await index.remove(roots[name],oldKey);
  }
  if(newKey)roots[name]=await index.change(roots[name],newKey,hash(next));
 }
}
export async function recordPdfLibraryItem(store,index,library,row,{groups}={}){
 const currentKey=itemKey(row.id),previous=await store.object(currentKey);
 row={...row,pinned:row.pinned??previous?.pinned??false};
 if(!validRow(row)||previous&&(!validRow(previous)||previous.id!==row.id))fail('CATALOGUE_DAMAGED');
 if(previous&&hash(previous)===hash(row))return;
 await indexPdfLibraryMembership(index,library,previous,row);
 if(library.organization)await groups(previous,row);
 await store.putObject(currentKey,row);
}
export async function selectedPdfLibraryRow(owner,library,id){
 const row=await owner.store.object(itemKey(id));if(!row)return null;
 if(!validRow(row)||row.id!==id||(await owner.index('library').find({root:library.names},titleKey(row)))?.revision!==hash(row))fail('CATALOGUE_DAMAGED');
 return row;
}

// Backfill walks two immutable UUID directories from the first request.
// Concurrent edits and lifecycle changes take the normal update path first.
export async function preparePdfLibrary(owner,directory,{signal}={}){
 const index=owner.index('library'),directories={active:owner.index('directory'),archive:owner.index('archive')};
 const library=directory.library??{version:1,names:null,recent:null,pinned:null,backfill:{active:directory.root,archive:(await owner.archiveDirectory()).root,scope:'active',offset:0}};
 let remaining=batchSize;
 while(remaining&&library.backfill){
  signal?.throwIfAborted();const pending=library.backfill,root=pending[pending.scope];
  if(pending.offset===(root?.count??0)){
   if(pending.scope==='archive'){library.backfill=null;break;}
   pending.scope='archive';pending.offset=0;continue;
  }
  const source=directories[pending.scope],item=await source.entryAt({root},pending.offset++);
  if(!await owner.store.object(itemKey(item.id))){
   const head=await owner.head(item.id,{removed:true}),value=await owner.revision(item.id,head.revision);
   await recordPdfLibraryItem(owner.store,index,library,{id:item.id,name:value.header.name,count:value.order?.count??0,revision:head.revision,archived:head.removed,modified:null});
  }
  remaining--;
 }
 await index.flushRoots([library.names,library.recent,library.pinned],{signal});
 signal?.throwIfAborted();
 return library;
}

export function validatePdfLibraryQuery(data={}){
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).some(key=>!['search','sort','match','archived','limit','cursor','groupId'].includes(key)))fail('INVALID');
 const {search='',sort='name',match='prefix',archived=false,limit=20,cursor=null,groupId=null}=data;
 if(typeof search!=='string'||search.length>240||!['prefix','contains'].includes(match)||!['name','recent','pinned'].includes(sort)||typeof archived!=='boolean'||!Number.isSafeInteger(limit)||limit<1||limit>100)fail('INVALID');
 if(groupId!==null&&!researchId(groupId))fail('INVALID');
 if(cursor!==null&&(!keys(cursor,'offset,pin')||!integer(cursor.offset)||!revisionId(cursor.pin)))fail('INVALID');
 return {search,sort,match,archived,limit,cursor,groupId};
}
export async function queryPdfLibrary(owner,library,data,{signal,group}={}){
 const {search,sort,match,archived,limit,cursor,groupId}=validatePdfLibraryQuery(data);
 if(!library||library.backfill)return {ready:false,items:[],next:null};
 const roots=groupId?await group(groupId):library;
 const byTitle=sort!=='recent',root=sort==='name'?roots.names:roots[sort],term=normalized(search.trim()),prefix=scope(archived),index=owner.index(groupId?'group-'+groupId:'library');
 const pin=hash({root:root?.hash??null,term,match,sort,archived,groupId});
 if(cursor!==null&&cursor.pin!==pin)fail('CONFLICT');
 if(researchId(term)){
  const row=await selectedPdfLibraryRow(owner,library,term);
  if(!row)return {ready:true,items:[],next:null};
  if(groupId){const entry=await index.find({root:roots.names},titleKey(row));if(!entry)return {ready:true,items:[],next:null};if(entry.revision!==hash(row))fail('CATALOGUE_DAMAGED');}
  return {ready:true,items:row.archived===archived&&(sort!=='pinned'||row.pinned)?[row]:[],next:null};
 }
 const keyPrefix=byTitle&&match==='prefix'?prefix+term:prefix;
 let offset=cursor?.offset??await index.rank({root},keyPrefix);
 const items=[];
 // Bound encrypted index and metadata reads even for an infrequent substring.
 // The caller can continue scanning without changing its filters or ordering.
 for(let scanned=0;offset<(root?.count??0)&&items.length<limit&&scanned<Math.max(limit,64);scanned++){
  signal?.throwIfAborted();const entry=await index.entryAt({root},offset++);
  if(!entry.id.startsWith(keyPrefix))return {ready:true,items,next:null};
  if(byTitle&&term&&!entry.id.slice(prefix.length).includes(term))continue;
  const row=await readRow(owner.store,entry.id.slice(-36),entry.revision);
  if((byTitle?titleKey(row):recentKey(row))!==entry.id||sort==='pinned'&&!row.pinned)fail('CATALOGUE_DAMAGED');
  const title=normalized(row.name);
  if(!term||(match==='contains'?title.includes(term):title.startsWith(term)))items.push(row);
 }
 const more=await index.entryAt({root},offset);
 return {ready:true,items,next:more?.id.startsWith(keyPrefix)?{pin,offset}:null};
}

export async function verifyPdfLibrary(owner,library,{signal,groupId,member}={}){
 const index=owner.index(groupId?'group-'+groupId:'library');
 let rows=0,pins=0;
 for await(const entry of index.entries({root:library.names})){
  signal?.throwIfAborted();const row=await readRow(owner.store,entry.id.slice(-36),entry.revision);
  if(titleKey(row)!==entry.id||(await index.find({root:library.recent},recentKey(row)))?.revision!==entry.revision)fail('CATALOGUE_DAMAGED');
  if(row.pinned){if((await index.find({root:library.pinned},titleKey(row)))?.revision!==entry.revision)fail('CATALOGUE_DAMAGED');pins++;}
  if(member)await member(row);
  else{
   const head=await owner.head(row.id,{removed:true}),value=await owner.revision(row.id,head.revision);
   if(head.revision!==row.revision||head.removed!==row.archived||value.header.name!==row.name||(value.order?.count??0)!==row.count)fail('CATALOGUE_DAMAGED');
  }
  rows++;
 }
 if(rows!==(library.recent?.count??0)||pins!==(library.pinned?.count??0))fail('CATALOGUE_DAMAGED');
 return rows;
}
