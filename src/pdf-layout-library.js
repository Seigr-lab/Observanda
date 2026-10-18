import {copyPdfDocumentFont,readPdfDocumentFont} from './pdf-document-fonts.js';
import {validPdfFontPin} from './web/pdf-font-model.js';
import {customFontId} from './web/font-catalogue.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {RetainedTableIndex,validTableRef} from './retained-table-index.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validPdfLayout} from './web/pdf-layout-model.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.split(',').sort().join();
const hash=value=>digest(serialize(value));
const fail=code=>{throw new AppError(code);};
const name=value=>typeof value==='string'&&value.length<=240&&!!value.trim()&&!/[\u0000-\u001f]/.test(value);
export function validatePdfLayoutCommand(command){
 if(!exact(command,'id,commandId,expectedRevision,operation')||!researchId(command.id)||!researchId(command.commandId)||command.expectedRevision!==null&&!revisionId(command.expectedRevision))fail('INVALID');
 const o=command.operation;
 if(o?.type==='save'){if(!exact(o,'type,name,layout'+(Object.hasOwn(o,'fontSource')?',fontSource':''))||!name(o.name)||!validPdfLayout(o.layout))fail('INVALID');if(customFontId(o.layout.font)){if(!exact(o.fontSource,'documentId,pin')||!researchId(o.fontSource.documentId)||!validPdfFontPin(o.fontSource.pin)||o.fontSource.pin.id!==o.layout.font)fail('FONT_MISSING');}else if(Object.hasOwn(o,'fontSource'))fail('INVALID');}
 else if(o?.type!=='remove'||!exact(o,'type')||command.expectedRevision===null)fail('INVALID');
 return command;
}
// Layouts belong to the publication owner. Applying one copies its physical
// settings into a document revision; later template edits cannot alter it.
export class PdfLayoutLibrary{
 constructor(store){if(store.domain!=='pdf')fail('INVALID');this.store=store;}
 index(){
  const store=this.store;
  return new RetainedTableIndex({
   async put(kind,value){if(kind!=='index')fail('INVALID');const revision=hash(value);await store.putObject('pdf-layout:index:'+revision,value);return revision;},
   async read(kind,revision){if(kind!=='index'||!revisionId(revision))fail('CATALOGUE_DAMAGED');const value=await store.object('pdf-layout:index:'+revision);if(!value||hash(value)!==revision)fail('CATALOGUE_DAMAGED');return value;}
  },{namespace:'index',allowSparseBranches:true});
 }
 async directory(){
  const value=await this.store.object('pdf-layout:directory');
  if(value){if(!exact(value,'version,root')||value.version!==1||!validTableRef(value.root))fail('CATALOGUE_DAMAGED');return value;}
  for await(const key of this.store.objectIdEntries('pdf-layout:')){void key;fail('CATALOGUE_DAMAGED');}
  return {version:1,root:null};
 }
 async value(revision){
  if(!revisionId(revision))fail('CATALOGUE_DAMAGED');const value=await this.store.object('pdf-layout:value:'+revision);
  if(!exact(value,'version,id,name,layout,previous,removed'+(Object.hasOwn(value??{},'fontPin')?',fontPin':''))||hash(value)!==revision||value.version!==1||!researchId(value.id)||!name(value.name)||!validPdfLayout(value.layout)||value.previous!==null&&!revisionId(value.previous)||typeof value.removed!=='boolean'||Object.hasOwn(value,'fontPin')&&(!validPdfFontPin(value.fontPin)||value.fontPin.id!==value.layout.font))fail('CATALOGUE_DAMAGED');return value;
 }
 async head(id){
  if(!researchId(id))fail('INVALID');const head=await this.store.object('pdf-layout:head:'+id);if(!head)return null;
  if(!exact(head,'version,revision')||head.version!==1||!revisionId(head.revision))fail('CATALOGUE_DAMAGED');const value=await this.value(head.revision);if(value.id!==id)fail('CATALOGUE_DAMAGED');return {revision:head.revision,value};
 }
 async list({after=null,limit=20}={}){
  if(after!==null&&!researchId(after)||!Number.isInteger(limit)||limit<1||limit>100)fail('INVALID');
  const directory=await this.directory(),index=this.index(),start=after===null?0:await index.rank(directory,after)+(await index.find(directory,after)?1:0),items=[];
  for(let offset=start;offset<(directory.root?.count??0)&&items.length<limit;offset++){
   const row=await index.entryAt(directory,offset),value=await this.value(row.revision);if(value.id!==row.id||value.removed)fail('CATALOGUE_DAMAGED');items.push({id:row.id,revision:row.revision,name:value.name,layout:value.layout,...(value.fontPin?{fontPin:value.fontPin}:{})});
  }
  return {items,next:start+items.length<(directory.root?.count??0)?items.at(-1).id:null};
 }
 async change(command,{signal}={}){
  const {id,commandId,expectedRevision,operation}=validatePdfLayoutCommand(command);signal?.throwIfAborted();
  const key='pdf-layout:command:'+id+':'+commandId,fingerprint=hash(command),receipt=await this.store.object(key);
  if(receipt){if(!exact(receipt,'fingerprint,revision')||!revisionId(receipt.revision))fail('CATALOGUE_DAMAGED');if(receipt.fingerprint!==fingerprint)fail('MODULE_REPLAY');await this.value(receipt.revision);return {revision:receipt.revision,replayed:true};}
  const current=await this.head(id);if((current?.revision??null)!==expectedRevision)fail('CONFLICT');
  if(operation.type==='remove'&&(!current||current.value.removed))fail('NOT_FOUND');
  const directory=await this.directory(),removed=operation.type==='remove';
  let revision=current?.revision;
  if(removed||!current||current.value.removed||operation.name!==current.value.name||hash(operation.layout)!==hash(current.value.layout)){
   const fontPin=removed?current.value.fontPin:customFontId(operation.layout.font)?await copyPdfDocumentFont(this.store,operation.fontSource.documentId,operation.fontSource.pin,id,{signal}):null;
   const value={version:1,id,...(fontPin?{fontPin}:{}),name:removed?current.value.name:operation.name,layout:removed?current.value.layout:operation.layout,previous:current?.revision??null,removed};revision=hash(value);
   await this.store.putObject('pdf-layout:value:'+revision,value);await this.store.putObject('pdf-layout:head:'+id,{version:1,revision});
   const index=this.index();directory.root=removed?await index.remove(directory.root,id):await index.change(directory.root,id,revision);await index.flush(directory.root);await this.store.putObject('pdf-layout:directory',directory);
  }
  await this.store.putObject(key,{fingerprint,revision});signal?.throwIfAborted();return {revision,replayed:false};
 }
 async verify({signal}={}){
  const directory=await this.directory(),index=this.index();let layouts=0;
  for await(const key of this.store.objectIdEntries('pdf-layout:head:',{signal})){
   signal?.throwIfAborted();const id=key.slice('pdf-layout:head:'.length),head=await this.head(id),listed=await index.find(directory,id);if(head.value.removed?listed:!listed||listed.revision!==head.revision)fail('CATALOGUE_DAMAGED');
   let value=head.value;const seen=new Set([head.revision]),fonts=new Set();const verifyFont=async entry=>{if(entry.fontPin&&!fonts.has(entry.fontPin.revision)){await readPdfDocumentFont(this.store,id,entry.fontPin,{signal});fonts.add(entry.fontPin.revision);}};await verifyFont(value);
   while(value.previous!==null){signal?.throwIfAborted();if(seen.has(value.previous))fail('CATALOGUE_DAMAGED');seen.add(value.previous);value=await this.value(value.previous);await verifyFont(value);if(value.id!==id)fail('CATALOGUE_DAMAGED');}
   if(!head.value.removed)layouts++;
  }
  if(layouts!==(directory.root?.count??0))fail('CATALOGUE_DAMAGED');return {layouts};
 }
}
