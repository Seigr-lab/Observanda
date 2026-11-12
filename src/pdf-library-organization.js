import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {validTableRef} from './retained-table-index.js';
import {indexPdfLibraryMembership,selectedPdfLibraryRow,verifyPdfLibrary} from './pdf-library-index.js';
import {requirePdfDomainFormat} from './pdf-domain-format.js';
import {reviewPdfExport} from './pdf-library-export-review.js';
import {checkPdfSources} from './pdf-publication-files.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';

const hash=value=>digest(serialize(value));
const fail=code=>{throw new AppError(code);};
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===names;
const groupKey=id=>'pdf-library:group:'+id;
const titleKey=group=>group.kind+':'+group.name.normalize('NFC').toLowerCase();
const identity=({id,name,kind})=>({id,name,kind});
const validName=name=>typeof name==='string'&&name.length>0&&name.length<=100&&name===name.normalize('NFC').trim()&&!/[\u0000-\u001f\u007f]/u.test(name);
const labelKind=kind=>kind==='tag'||kind==='collection';
const validGroup=group=>exact(group,'id,kind,name,names,pinned,recent')&&researchId(group.id)&&validName(group.name)&&labelKind(group.kind)&&[group.names,group.recent,group.pinned].every(validTableRef);
const orderedRoots=group=>[group.names,group.recent,group.pinned];
const memberKey=(documentId,groupId)=>documentId+':'+groupId;
const MAX_BATCH=100;
export function validatePdfLabelEdit(input){
 const {operation,commandId}=input??{};
 if(!exact(input,'commandId,operation')||!researchId(commandId)||!operation||!researchId(operation.id))fail('INVALID');
 const {type,name,kind}=operation;
 if(type==='create'){if(!exact(operation,'id,kind,name,type')||!labelKind(kind)||!validName(name))fail('INVALID');}
 else if(type==='rename'){if(!exact(operation,'expected,id,name,type')||!revisionId(operation.expected)||!validName(name))fail('INVALID');}
 else if(type==='remove'){if(!exact(operation,'expected,id,type')||!revisionId(operation.expected))fail('INVALID');}
 else fail('INVALID');
}
export function validatePdfLabelQuery(input){
 if(!exact(input,'cursor,kind,limit,search')||!labelKind(input.kind)||typeof input.search!=='string'||input.search.length>100||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100)fail('INVALID');
 const {cursor}=input;
 if(cursor!==null&&(!exact(cursor,'offset,pin')||!Number.isSafeInteger(cursor.offset)||cursor.offset<0||!revisionId(cursor.pin)))fail('INVALID');
}

// A collection or tag is organization metadata of this PDF owner. Its
// document indexes point to the same authenticated rows as the full library.
// Each group has its own page namespace, so index pruning cannot delete
// identical pages still in use by another collection.
export class PdfLibraryOrganization{
 constructor(owner,library){this.owner=owner;this.store=owner.store;this.library=library;this.index=owner.index('organization');}
 get registry(){return this.library?.organization;}
 async group(id){
  if(!researchId(id))fail('INVALID');
  const value=await this.store.object(groupKey(id));
  if(!value)fail('NOT_FOUND');
  if(!this.registry||!validGroup(value)||value.id!==id||(await this.index.find({root:this.registry.labels},titleKey(value)))?.revision!==hash(identity(value)))fail('CATALOGUE_DAMAGED');
  return value;
 }
 async labels(input,{signal}={}){
  validatePdfLabelQuery(input);
  const root=this.registry?.labels??null,prefix=input.kind+':'+input.search.trim().normalize('NFC').toLowerCase(),pin=hash([root?.hash??null,prefix]),cursor=input.cursor;
  if(cursor&&cursor.pin!==pin)fail('CONFLICT');
  const items=[];let offset=cursor?.offset??await this.index.rank({root},prefix);
  for(;items.length<input.limit;offset++){
   signal?.throwIfAborted();const row=await this.index.entryAt({root},offset);
   if(!row?.id.startsWith(prefix))return {items,next:null};
   const label=await this.store.object('pdf-library:label:'+row.revision);
   if(!label||hash(label)!==row.revision||titleKey(label)!==row.id)fail('CATALOGUE_DAMAGED');
   const group=await this.group(label.id);items.push({...label,revision:row.revision,count:group.names?.count??0});
  }
  const more=await this.index.entryAt({root},offset);
  return {items,next:more?.id.startsWith(prefix)?{pin,offset}:null};
 }
 async persist(){
  await this.index.flushRoots([this.registry.labels,this.registry.members]);
  const directory=await this.owner.directory();await this.store.putObject('pdf:directory',{...directory,library:this.library});
 }
 async edit(input,{signal,check}={}){
  validatePdfLabelEdit(input);const {operation,commandId}=input;
  const {type,id,name,kind}=operation;
  if(!this.library||this.library.backfill)fail('CONFLICT');
  const key='pdf-library:organize-command:'+commandId,fingerprint=hash(operation),prior=await this.store.object(key);
  if(prior){if(prior.fingerprint!==fingerprint)fail('MODULE_REPLAY');return prior.result;}
  await requirePdfDomainFormat(this.store,8);
  if(!this.registry){this.library.version=2;this.library.organization={labels:null,members:null};}
  const group=type==='create'?{id,kind,name,names:null,recent:null,pinned:null}:await this.group(id);
  if(type==='create'){if(await this.store.object(groupKey(id)))fail('CONFLICT');}
  else if(operation.expected!==hash(identity(group)))fail('CONFLICT');
  const current=name??group.name,oldKey=titleKey(group),nextKey=titleKey({...group,name:current});
  if(type!=='remove'&&(type==='create'||oldKey!==nextKey)&&await this.index.find({root:this.registry.labels},nextKey))fail('PDF_LIBRARY_NAME_USED');
  if(type==='remove'&&group.names)fail('PDF_LIBRARY_GROUP_USED');
  if(type!=='create'){
   this.registry.labels=await this.index.remove(this.registry.labels,oldKey);
   await this.store.deleteObject('pdf-library:label:'+hash(identity(group)));
  }
  group.name=current;
  const label=identity(group),revision=hash(label);
  if(type==='remove')await this.store.deleteObject(groupKey(id));
  else{
   this.registry.labels=await this.index.change(this.registry.labels,nextKey,revision);
   await this.store.putObject('pdf-library:label:'+revision,label);await this.store.putObject(groupKey(id),group);
  }
  await this.persist();const result={...label,revision};await this.store.putObject(key,{fingerprint,result});
  signal?.throwIfAborted();await check?.();return result;
 }
 async *memberships(documentId,{signal}={}){
  if(!this.registry)return;
  const root=this.registry.members,prefix=documentId+':';let offset=await this.index.rank({root},prefix);
  for(;;){
   signal?.throwIfAborted();const row=await this.index.entryAt({root},offset++);if(!row?.id.startsWith(prefix))return;
   const id=row.id.slice(prefix.length);if(!researchId(id)||row.revision!==hash([documentId,id]))fail('CATALOGUE_DAMAGED');yield id;
  }
 }
 async updateDocument(previous,row,options){
  for await(const id of this.memberships(row.id,options)){
   const group=await this.group(id),index=this.owner.index('group-'+id);
   await indexPdfLibraryMembership(index,group,previous,row);
   await index.flushRoots(orderedRoots(group),options);
   await this.store.putObject(groupKey(id),group);
  }
 }
 async verify({signal}={}){
  let groups=0,labels=0,members=0;
  for await(const key of this.store.objectIdEntries('pdf-library:group:',{signal})){
   signal?.throwIfAborted();
   const group=await this.group(key.slice('pdf-library:group:'.length));
   const label=identity(group),saved=await this.store.object('pdf-library:label:'+hash(label));
   if(!saved||hash(saved)!==hash(label))fail('CATALOGUE_DAMAGED');
   members+=await verifyPdfLibrary(this.owner,group,{signal,groupId:group.id,member:async row=>{
    const link=await this.index.find({root:this.registry.members},memberKey(row.id,group.id));
    if(link?.revision!==hash([row.id,group.id])||!await selectedPdfLibraryRow(this.owner,this.library,row.id))fail('CATALOGUE_DAMAGED');
   }});
   groups++;
  }
  for await(const key of this.store.objectIdEntries('pdf-library:label:',{signal})){signal?.throwIfAborted();labels++;}
  if(groups!==labels||groups!==(this.registry.labels?.count??0)||members!==(this.registry.members?.count??0))fail('CATALOGUE_DAMAGED');
 }
 async review(input,{signal,publicationFiles,prepared,collect}={}){
  if(!exact(input,'action,groupId,selection')||!Array.isArray(input.selection)||!input.selection.length||input.selection.length>MAX_BATCH||new Set(input.selection.map(item=>item?.id)).size!==input.selection.length)fail('INVALID');
  const {action,selection,groupId}=input,labelAction=['assign','unassign'].includes(action);
  if(!['assign','unassign','pin','unpin','archive','restore','export'].includes(action)||(labelAction?!researchId(groupId):groupId!==null))fail('INVALID');
  if(selection.some(pin=>!exact(pin,'id,revision')||!researchId(pin.id)||!revisionId(pin.revision)))fail('INVALID');
  const group=labelAction?await this.group(groupId):null,items=[];
  for(const pin of selection){
   signal?.throwIfAborted();
   const row=this.library?await selectedPdfLibraryRow(this.owner,this.library,pin.id):null;
   if(!row){items.push({...pin,state:'unavailable'});continue;}
   let state=row.revision!==pin.revision?'changed':row.archived!==(action==='restore')?'lifecycle':'ready';
   if(state==='ready'&&group){
    const membership=await this.index.find({root:this.registry.members},memberKey(pin.id,group.id));
    if(membership&&membership.revision!==hash([pin.id,group.id]))fail('CATALOGUE_DAMAGED');
    if((action==='assign')===Boolean(membership))state='unchanged';
   }else if(state==='ready'&&['pin','unpin'].includes(action)&&(action==='pin')===row.pinned)state='unchanged';
   const item={...pin,name:row.name,state,...(state==='changed'?{currentRevision:row.revision}:{})};
   if(action==='export'&&state==='ready'){
    if(prepared){
     const prior=prepared.get(pin.id);
     if(!prior||prior.revision!==pin.revision)fail('CONFLICT');
     Object.assign(item,prior.details);
    }else{
     const selected=await this.owner.open(pin.id,{revision:pin.revision}),details={profile:selected.header.outputProfile??'standard',edition:selected.sequence+1};
     try{
      const {audience,included,pending,ready,sources,pins}=await reviewPdfExport(this.owner,publicationFiles,pin.id,selected,{signal});
      Object.assign(details,{audience,included,pending,sources});if(!ready)details.state='review';
      collect?.set(pin.id,{revision:pin.revision,details,pins});
     }catch(error){if(error.code!=='PDF_SOURCE_CONTENT')throw error;details.state='unavailable';}
     Object.assign(item,details);
    }
   }
   items.push(item);
  }
  const label=group?identity(group):null;
  return {group:label,items,token:hash([this.store.namespaceId,action,label,items])};
 }
 async receipt(input){
  if(!exact(input,'commandId,review,token')||!researchId(input.commandId)||!revisionId(input.token))fail('INVALID');
  const {commandId,review,token}=input,key='pdf-library:batch-command:'+commandId,fingerprint=hash([review,token]),previous=await this.store.object(key);
  if(previous&&previous.fingerprint!==fingerprint)fail('MODULE_REPLAY');
  return {key,fingerprint,result:previous?.result};
 }
 async apply(input,options={}){
  const {key,fingerprint,result:prior}=await this.receipt(input);
  if(prior)return prior;
  const {commandId,review,token}=input;
  const checked=await this.review(review,options),{action,groupId}=review;
  if(checked.token!==token||checked.items.some(item=>!['ready','unchanged'].includes(item.state)))fail('CONFLICT');
  if(action==='export'&&typeof options.queue!=='function')fail('INVALID');
  const group=groupId?await this.group(groupId):null,index=group?this.owner.index('group-'+group.id):null;
  let count=0;const jobs=[];
  for(const item of checked.items){
   options.signal?.throwIfAborted();if(item.state==='unchanged')continue;
   if(action==='export')jobs.push(await options.queue(item));
   else if(group){
    const row=await selectedPdfLibraryRow(this.owner,this.library,item.id),add=action==='assign';
    await indexPdfLibraryMembership(index,group,add?null:row,add?row:null);
    const key=memberKey(row.id,group.id);
    this.registry.members=add?await this.index.change(this.registry.members,key,hash([row.id,group.id])):await this.index.remove(this.registry.members,key);
   }else if(action==='pin'||action==='unpin')await this.owner.pinDocument({id:item.id,expectedRevision:item.revision,pinned:action==='pin'},options);
   else await this.owner.change({id:item.id,expectedRevision:item.revision,commandId,operation:{type:action==='archive'?'remove':'restore-document'}},options);
   count++;
  }
  if(group){
   await index.flushRoots(orderedRoots(group),options);
   await this.store.putObject(groupKey(group.id),group);await this.persist();
  }
  if(options.prepared)for(const item of options.prepared.values()){options.signal?.throwIfAborted();await checkPdfSources(options.publicationFiles,item.pins);}
  await requirePdfDomainFormat(this.store,8);const result=action==='export'?{count,jobs}:{count};await this.store.putObject(key,{fingerprint,result});
  options.signal?.throwIfAborted();await options.check?.();return result;
 }
}
