import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RecordValueTree} from './record-value-tree.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validPdfDocumentHeader,validPdfSection} from './web/pdf-layout-model.js';
const bad=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const invalid=()=>{throw new AppError('INVALID');};
const hash=value=>digest(serialize(value));
const ordinal=value=>String(value).padStart(16,'0');
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
export function validatePdfCommand(command){
 if(!exact(command,'id,commandId,expectedRevision,operation'))invalid();
 const {id,commandId,expectedRevision,operation:o}=command;
 if(!researchId(id)||!researchId(commandId)||expectedRevision!==null&&!revisionId(expectedRevision)||!o||typeof o!=='object')invalid();
 if(o.type==='create'){if(expectedRevision!==null||!exact(o,'type,header,section')||!validPdfDocumentHeader(o.header)||o.header.id!==id||!validPdfSection(o.section))invalid();}
 else{
  if(expectedRevision===null)invalid();
  if(o.type==='header'){if(!exact(o,'type,header')||!validPdfDocumentHeader(o.header)||o.header.id!==id)invalid();}
  else if(['append','section'].includes(o.type)){if(!exact(o,'type,section')||!validPdfSection(o.section))invalid();}
  else if(o.type==='move'){if(!exact(o,'type,sectionId,direction')||!researchId(o.sectionId)||![-1,1].includes(o.direction))invalid();}
  else if(o.type==='remove-section'){if(!exact(o,'type,sectionId')||!researchId(o.sectionId))invalid();}
  else if(o.type==='restore'){if(!exact(o,'type,revision')||!revisionId(o.revision))invalid();}
  else if(o.type==='remove'){if(!exact(o,'type'))invalid();}
  else invalid();
 }
 return command;
}
class PdfBlocks{
 constructor(store,id){this.store=store;this.id=id;}
 key(kind,revision){if(!['value','index'].includes(kind)||!revisionId(revision))bad();return 'pdf:block:'+this.id+':'+kind+':'+revision;}
 async put(kind,value){const text=serialize(value);if(Buffer.byteLength(text)>65536)invalid();const revision=digest(text);await this.store.putObject(this.key(kind,revision),value);return revision;}
 async read(kind,revision){const value=await this.store.object(this.key(kind,revision));if(!value||hash(value)!==revision)bad();return value;}
}
// One dedicated PDF domain owns these values. All writes run in its transaction;
// immutable section/index nodes preserve prior editions without copying a book.
export class PdfDocumentStore{
 constructor(store){if(store.domain!=='pdf')invalid();this.store=store;}
 async directory(){
  const value=await this.store.object('pdf:directory');
  if(value){if(!exact(value,'version,root')||value.version!==1||!validTableRef(value.root))bad();return value;}
  for await(const id of this.store.objectIdEntries('pdf:')){void id;bad();}
  return {version:1,root:null};
 }
 index(id){return new RetainedTableIndex(new PdfBlocks(this.store,id),{namespace:'index',allowSparseBranches:true});}
 async revision(id,revision){
  if(!researchId(id)||!revisionId(revision))invalid();
  const value=await this.store.object('pdf:revision:'+id+':'+revision);
  if(!exact(value,'version,header,sections,order,nextPosition')||value.version!==1||hash(value)!==revision||!validPdfDocumentHeader(value.header)||value.header.id!==id||!validTableRef(value.sections)||!validTableRef(value.order)||(value.sections?.count??0)!==(value.order?.count??0)||!natural(value.nextPosition)||value.nextPosition<(value.order?.count??0))bad();
  return value;
 }
 async head(id,{removed=false}={}){
  if(!researchId(id))invalid();const value=await this.store.object('pdf:head:'+id);if(!value)throw new AppError('NOT_FOUND');
  if(!exact(value,'version,id,revision,history,versions,sequence,removed')||value.version!==1||value.id!==id||!revisionId(value.revision)||!validTableRef(value.history)||!validTableRef(value.versions)||!value.versions||value.versions.count>value.history?.count||!natural(value.sequence)||value.history?.count!==value.sequence+1||typeof value.removed!=='boolean')bad();
  if(value.removed&&!removed)throw new AppError('NOT_FOUND');return value;
 }
 async open(id,{revision=null}={}){
  const head=await this.head(id);if(revision!==null&&!revisionId(revision))invalid();
  const selected=revision??head.revision;
  if(selected!==head.revision&&!await this.index(id).find({root:head.versions},selected))throw new AppError('NOT_FOUND');
  const value=await this.revision(id,selected);return {revision:selected,header:value.header,count:value.order?.count??0,sequence:head.sequence,currentRevision:head.revision};
 }
 async list({after=null,limit=20}={}){
  if(after!==null&&!researchId(after)||!Number.isInteger(limit)||limit<1||limit>100)invalid();
  const directory=await this.directory(),index=this.index('directory'),start=after===null?0:await index.rank(directory,after)+(await index.find(directory,after)?1:0),items=[];
  for(let offset=start;offset<(directory.root?.count??0)&&items.length<limit;offset++){
   const row=await index.entryAt(directory,offset),value=await this.revision(row.id,row.revision);items.push({id:row.id,name:value.header.name,revision:row.revision,count:value.order?.count??0});
  }
  return {items,next:start+items.length<(directory.root?.count??0)?items.at(-1).id:null};
 }
 async section(id,sectionId,{revision=null}={}){
  if(!researchId(sectionId))invalid();const current=await this.open(id,{revision}),value=await this.revision(id,current.revision),row=await this.index(id).find({root:value.sections},sectionId);
  if(!row)throw new AppError('NOT_FOUND');return this.sectionRow(id,row.revision,sectionId);
 }
 async sectionRow(id,revision,sectionId=null){
  const value=await new RecordValueTree(new PdfBlocks(this.store,id)).read(revision);
  if(!exact(value,'position,section')||!natural(value.position)||!validPdfSection(value.section)||sectionId!==null&&value.section.id!==sectionId)bad();return value;
 }
 async sections(id,{revision=null,offset=0,limit=20}={}){
  if(!natural(offset)||!Number.isInteger(limit)||limit<1||limit>100)invalid();
  const current=await this.open(id,{revision}),value=await this.revision(id,current.revision),items=[],index=this.index(id);
  for(let i=offset;i<current.count&&items.length<limit;i++){
   const row=await index.entryAt({root:value.order},i),section=await this.sectionRow(id,row.revision);if(row.id!==ordinal(section.position))bad();items.push({id:section.section.id,title:section.section.title,position:section.position});
  }
  return {revision:current.revision,items,next:offset+items.length<current.count?offset+items.length:null,total:current.count};
 }
 async change(command, {signal}={}){
  const {id,commandId,expectedRevision,operation}=validatePdfCommand(command);
  if(!researchId(id)||!researchId(commandId)||expectedRevision!==null&&!revisionId(expectedRevision)||!operation||typeof operation!=='object')invalid();signal?.throwIfAborted();
  const receiptKey='pdf:command:'+id+':'+commandId,fingerprint=hash({id,expectedRevision,operation}),receipt=await this.store.object(receiptKey);
  if(receipt){if(!exact(receipt,'fingerprint,revision')||!revisionId(receipt.revision))bad();if(receipt.fingerprint!==fingerprint)throw new AppError('MODULE_REPLAY');await this.revision(id,receipt.revision);return {revision:receipt.revision,replayed:true};}
  let previous=null,current;
  if(expectedRevision===null){if(operation.type!=='create'||!exact(operation,'type,header,section')||!validPdfDocumentHeader(operation.header)||operation.header.id!==id||!validPdfSection(operation.section))invalid();if(await this.store.object('pdf:head:'+id))throw new AppError('EXISTS');current={version:1,header:operation.header,sections:null,order:null,nextPosition:0};}
  else{previous=await this.head(id);if(previous.revision!==expectedRevision)throw new AppError('CONFLICT');current=structuredClone(await this.revision(id,previous.revision));}
  const index=this.index(id),orderIndex=this.index(id),tree=new RecordValueTree(new PdfBlocks(this.store,id)),directory=await this.directory();
  const put=async(section,position)=>{const revision=await tree.retain({section,position});current.sections=await index.change(current.sections,section.id,revision);current.order=await orderIndex.change(current.order,ordinal(position),revision);};
  const selected=async sectionId=>{if(!researchId(sectionId))invalid();const row=await index.find({root:current.sections},sectionId);if(!row)throw new AppError('NOT_FOUND');return this.sectionRow(id,row.revision,sectionId);};
  if(operation.type==='create')await put(operation.section,current.nextPosition++);
  else if(operation.type==='header'){
   if(!exact(operation,'type,header')||!validPdfDocumentHeader(operation.header)||operation.header.id!==id)invalid();current.header=operation.header;
  }else if(operation.type==='append'){
   if(!exact(operation,'type,section')||!validPdfSection(operation.section)||current.nextPosition>=Number.MAX_SAFE_INTEGER)invalid();if(await index.find({root:current.sections},operation.section.id))throw new AppError('EXISTS');await put(operation.section,current.nextPosition++);
  }else if(operation.type==='section'){
   if(!exact(operation,'type,section')||!validPdfSection(operation.section))invalid();const before=await selected(operation.section.id);await put(operation.section,before.position);
  }else if(operation.type==='move'){
   if(!exact(operation,'type,sectionId,direction')||![-1,1].includes(operation.direction))invalid();const before=await selected(operation.sectionId),at=await index.rank({root:current.order},ordinal(before.position)),otherAt=at+operation.direction;
   if(otherAt<0||otherAt>=(current.order?.count??0))invalid();const other=await this.sectionRow(id,(await index.entryAt({root:current.order},otherAt)).revision);await put(before.section,other.position);await put(other.section,before.position);
  }else if(operation.type==='remove-section'){
   if(!exact(operation,'type,sectionId'))invalid();const before=await selected(operation.sectionId);current.sections=await index.remove(current.sections,operation.sectionId);current.order=await orderIndex.remove(current.order,ordinal(before.position));
   }else if(operation.type==='restore'){
   await this.open(id,{revision:operation.revision});current=structuredClone(await this.revision(id,operation.revision));
  }else if(operation.type==='remove'){if(!exact(operation,'type'))invalid();}
  else invalid();
  await index.flush(current.sections);await orderIndex.flush(current.order);
  const revision=hash(current);
  if(previous?.revision===revision&&operation.type!=='remove'){
   await this.store.putObject(receiptKey,{fingerprint,revision});signal?.throwIfAborted();return {revision,replayed:false};
  }
  if(previous?.sequence>=Number.MAX_SAFE_INTEGER-1)invalid();
  const sequence=(previous?.sequence??-1)+1,history=await index.change(previous?.history??null,ordinal(sequence),revision);await index.flush(history);
  const versions=await index.change(previous?.versions??null,revision,revision);await index.flush(versions);
  await this.store.putObject('pdf:revision:'+id+':'+revision,current);
  await this.store.putObject('pdf:head:'+id,{version:1,id,revision,sequence,history,versions,removed:operation.type==='remove'});
  const directoryIndex=this.index('directory');directory.root=operation.type==='remove'?await directoryIndex.remove(directory.root,id):await directoryIndex.change(directory.root,id,revision);await directoryIndex.flush(directory.root);await this.store.putObject('pdf:directory',directory);
  await this.store.putObject(receiptKey,{fingerprint,revision});signal?.throwIfAborted();return {revision,replayed:false};
 }
 async history(id,{before=null,limit=20}={}){
  const head=await this.head(id);if(before!==null&&(!natural(before)||before>head.sequence+1)||!Number.isInteger(limit)||limit<1||limit>100)invalid();
  const index=this.index(id),items=[];let offset=before??head.sequence+1;
  while(offset>0&&items.length<limit){const row=await index.entryAt({root:head.history},--offset);if(row.id!==ordinal(offset))bad();const value=await this.revision(id,row.revision);items.push({sequence:offset,revision:row.revision,name:value.header.name,count:value.order?.count??0});}
  return {items,next:offset>0?offset:null};
 }
 async *content(id,revision,{signal}={}){
  await this.open(id,{revision});const value=await this.revision(id,revision),index=this.index(id);
  for await(const row of index.entries({root:value.order})){signal?.throwIfAborted();const value=await this.sectionRow(id,row.revision);if(row.id!==ordinal(value.position))bad();yield value.section;}
 }
 async verify({signal}={}){
  const directory=await this.directory(),directoryIndex=this.index('directory');let documents=0,editions=0;
  for await(const key of this.store.objectIdEntries('pdf:head:',{signal})){
   signal?.throwIfAborted();const id=key.slice('pdf:head:'.length),head=await this.head(id,{removed:true}),listed=await directoryIndex.find(directory,id);
   if(head.removed?listed:!listed||listed.revision!==head.revision)bad();
   const index=this.index(id);let count=0,currentFound=false;
   for await(const entry of index.entries({root:head.history})){
    signal?.throwIfAborted();if(entry.id!==ordinal(count++))bad();const value=await this.revision(id,entry.revision);if((await index.find({root:head.versions},entry.revision))?.revision!==entry.revision)bad();currentFound=entry.revision===head.revision;
    const sectionRoot=value.sections;let sections=0;for await(const row of index.entries({root:value.order})){signal?.throwIfAborted();const value=await this.sectionRow(id,row.revision);if(row.id!==ordinal(value.position))bad();const named=await index.find({root:sectionRoot},value.section.id);if(named?.revision!==row.revision)bad();sections++;}
    if(sections!==(value.sections?.count??0))bad();editions++;
   }
   if(count!==head.sequence+1||!currentFound)bad();if(!head.removed)documents++;
  }
  if(documents!==(directory.root?.count??0))bad();return {documents,editions};
 }
}
