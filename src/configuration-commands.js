// Selected configuration checkpoints belong to the authenticated storage owner.
// Reading never allocates a draft. Immutable schema content and the draft head
// commit together; a lost response can replay the exact command.
import {randomUUID} from 'node:crypto';
import {ConfigurationDocuments} from './configuration-documents.js';
import {emptyConfiguration} from './web/notebook-schema.js';
import {profileById} from './web/laboratory/catalog.js';
import {starterTemplate} from './web/project-templates.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';

const invalid=()=>{throw new AppError('INVALID');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const same=(a,b)=>serialize(a)===serialize(b);
const stamp=value=>digest(serialize(value));
const ownerKeys=['workspaceId','projectId','notebookId','slot'];
const slot=owner=>'configuration-draft:'+stamp(owner);
const stateRead=async(store,key)=>{const row=await store.db.get('SELECT payload FROM state WHERE slot=$1',key);return row?store.decode('state',key,row.payload):null;};
const stateWrite=(store,key,value)=>store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',key,store.encode('state',key,value));
const nameValid=value=>typeof value==='string'&&value.length<=160&&!/[\x00-\x1f]/.test(value);
export function configurationOwner(data){
 const owner=Object.fromEntries(ownerKeys.map(key=>[key,data?.[key]]));
 if(!researchId(owner.workspaceId)||!researchId(owner.projectId)||!['configuration','labBookTemplate'].includes(owner.slot)||
  (owner.slot==='configuration'?!researchId(owner.notebookId):owner.notebookId!==null))invalid();return owner;
}
function selected(metadata,owner,{create=false}={}){
 if(metadata.id!==owner.workspaceId)throw new AppError('WORKSPACE_CHANGED');
 const project=metadata.projects.find(value=>value.id===owner.projectId),book=metadata.notebooks.find(value=>value.id===owner.notebookId);
 const member=owner.slot==='configuration'?book:project;
 if(owner.slot==='configuration'&&(!project||book&&book.projectId!==owner.projectId))throw new AppError('NOT_FOUND');
 if(create){if(member)throw new AppError('EXISTS');return {configuration:emptyConfiguration(),name:owner.slot==='labBookTemplate'?'':null};}
 if(!member)throw new AppError('NOT_FOUND');
 return owner.slot==='configuration'?{configuration:member.configuration??emptyConfiguration(),name:null}:{configuration:member.labBookTemplate?.configuration??emptyConfiguration(),name:member.labBookTemplate?.name??''};
}
const pinFor=(owner,snapshotId,value)=>({...owner,snapshotId,revision:stamp(value)});
async function pinned(store,owner,pin){
 if(!exact(pin,[...ownerKeys,'snapshotId','revision'])||!same(configurationOwner(pin),owner)||!revisionId(pin.snapshotId)||!revisionId(pin.revision))invalid();
 const snapshot=await store.snapshot(pin.snapshotId),value=selected(snapshot.metadata,owner);if(stamp(value)!==pin.revision)throw new AppError('CONFLICT');return value;
}
async function readDraft(store,owner){
 const value=await stateRead(store,slot(owner));if(value===null)return null;
 if(!exact(value,['version','id','owner','base','configuration','name','updatedAt'])||value.version!==1||!researchId(value.id)||!same(value.owner,owner)||
  !exact(value.base,['create','pin'])||typeof value.base.create!=='boolean'||(value.base.create?value.base.pin!==null:!value.base.pin)||!nameValid(value.name??'')||typeof value.updatedAt!=='string'||!Number.isFinite(Date.parse(value.updatedAt)))throw new AppError('CATALOGUE_DAMAGED');
 return {value,revision:stamp(value)};
}
function expectDraft(current,data){
 if(current?(data.draftId!==current.value.id||data.expectedRevision!==current.revision):(data.draftId!=null||data.expectedRevision!=null))throw new AppError('CONFLICT');
}
export async function configurationCheckpoint(store,owner,checkpoint,pin,{create=false,signal,validate=true}={}){
 if(checkpoint==null){
  if(create)invalid();signal?.throwIfAborted();const saved=await pinned(store,owner,pin),snapshot=await store.snapshot(),now=selected(snapshot.metadata,owner);
  if(stamp(now)!==pin.revision)throw new AppError('CONFLICT');
  const member=owner.slot==='configuration'?snapshot.metadata.notebooks.find(value=>value.id===owner.notebookId):snapshot.metadata.projects.find(value=>value.id===owner.projectId),absent=!Object.hasOwn(member,owner.slot);
  if(validate){const documents=new ConfigurationDocuments(store);await documents.validate(await documents.open(owner,saved.configuration,{signal}),{signal});}
  return {...saved,absent,draft:null,revision:null};
 }
 if(!exact(checkpoint,['id','revision']))invalid();const {id,revision}=checkpoint;
 if(!researchId(id)||!revisionId(revision))invalid();const current=await readDraft(store,owner);
 if(!current||current.value.id!==id||current.revision!==revision||current.value.base.create!==create||!same(current.value.base.pin,pin??null))throw new AppError('CONFLICT');
 const now=selected((await store.snapshot()).metadata,owner,{create});
 if(!create&&stamp(now)!==pin.revision)throw new AppError('CONFLICT');
 // Combined metadata saves validate once at their admission boundary. Rename
 // and creation still validate before retaining a recoverable intent.
 if(validate){const documents=new ConfigurationDocuments(store);await documents.validate(await documents.open(owner,current.value.configuration,{signal,draft:true}),{signal});}
 if(owner.slot==='labBookTemplate'&&!current.value.name?.trim())invalid();
 return {configuration:current.value.configuration,name:current.value.name,draft:current.value,revision:current.revision};
}
export async function discardConfigurationCheckpoint(store,owner,checkpoint){
 const current=await readDraft(store,owner);if(current?.value.id===checkpoint.id&&current.revision===checkpoint.revision)await store.db.run('DELETE FROM state WHERE slot=$1',slot(owner));
}
export class ConfigurationCommands{
 constructor(workspace){this.workspace=workspace;}
 scope(data){
  const owner=configurationOwner(data),storage=this.workspace;
  if(storage.projectId&&storage.projectId!==owner.projectId||storage.labBookId&&(owner.slot!=='configuration'||storage.labBookId!==owner.notebookId)||data.create!==undefined&&typeof data.create!=='boolean')invalid();return owner;
 }
 async context(store,data,{mutable=false,signal}={}){
  const owner=this.scope(data),snapshotId=await store.head(),snapshot=await store.snapshot(snapshotId);selected(snapshot.metadata,owner,{create:data.create===true});
  const current=await readDraft(store,owner),draft=current&&data.draftId===current.value.id?current:null;
  if(data.draftId&&(!draft||data.draftRevision!==undefined&&data.draftRevision!==draft.revision))throw new AppError('CONFLICT');
  const base=data.create===true?{configuration:emptyConfiguration(),name:owner.slot==='labBookTemplate'?'':null}:data.configurationPin?await pinned(store,owner,data.configurationPin):selected(snapshot.metadata,owner);
  const pin=data.create===true?null:data.configurationPin??pinFor(owner,snapshotId,base);
  if(draft&&(draft.value.base.create!==(data.create===true)||!same(draft.value.base.pin,pin)))throw new AppError('CONFLICT');
  const reader=await new ConfigurationDocuments(store).open(owner,draft?.value.configuration??base.configuration,{mutable,signal,draft:!!draft});
  return {owner,pin,base,draft,reader,name:draft?.value.name??base.name};
 }
 async envelope(context){return {native:true,configurationPin:context.pin,header:{...await context.reader.header(),...(context.name===null?{}:{name:context.name})},draft:context.draft?{id:context.draft.value.id,revision:context.draft.revision,dirty:true}:null};}
 async open(data,options={}){
  if(await this.workspace.storageKind()!=='catalogue')return {native:false};
  return this.workspace.catalogue(async store=>{
   const owner=this.scope(data),current=await readDraft(store,owner);
   const request=current&&data.saved!==true?{...data,configurationPin:current.value.base.pin,create:current.value.base.create,draftId:current.value.id,draftRevision:current.revision}:data;
   return this.envelope(await this.context(store,request,options));
  });
 }
 async window(data,options={}){return this.workspace.catalogue(async store=>{const context=await this.context(store,data,options);return {...await context.reader.window({collection:data.collection,sectionId:data.sectionId,fieldKey:data.fieldKey,offset:data.offset??0,limit:data.limit??20,query:data.search,available:data.enabled,profileId:data.profileId,allowedProfiles:data.allowedProfiles,...options}),configurationPin:context.pin,draft:context.draft?{id:context.draft.value.id,revision:context.draft.revision}:null};});}
 async item(data,options={}){return this.workspace.catalogue(async store=>{const context=await this.context(store,data,options);return {item:await context.reader.item({collection:data.collection,key:data.key,sectionId:data.sectionId,fieldKey:data.fieldKey,...options}),configurationPin:context.pin,draft:context.draft?{id:context.draft.value.id,revision:context.draft.revision}:null};});}
 async section(data,options={}){return this.workspace.catalogue(async store=>{const context=await this.context(store,data,options);return {item:await context.reader.section(data.sectionId?{id:data.sectionId}:{profileId:data.profileId,key:data.key},options),configurationPin:context.pin,draft:context.draft?{id:context.draft.value.id,revision:context.draft.revision}:null};});}
 async profiles(data,options={}){
  if(!Array.isArray(data.ids)||data.ids.length>32||data.ids.some(id=>typeof id!=='string'||!/^[a-z][a-z0-9-]{0,79}$/.test(id)))invalid();
  return this.workspace.catalogue(async store=>{const context=await this.context(store,data,options),profiles=[];for(const id of data.ids){const item=await context.reader.item({collection:'profiles',key:id,...options}).catch(error=>{if(error.code==='NOT_FOUND')return null;throw error;});profiles.push({id,present:!!item,enabled:item?.value.enabled===true,version:item?.value.version??null});}return {profiles,configurationPin:context.pin,draft:context.draft?{id:context.draft.value.id,revision:context.draft.revision}:null};});
 }
 async write(data,method,action,{signal}={}){
  if(!researchId(data.commandId))invalid();const owner=this.scope(data),key='configuration-command:'+data.commandId,fingerprint=stamp({method,data});
  return this.workspace.withLock(()=>this.workspace.catalogue(async store=>{
   signal?.throwIfAborted();const prior=await stateRead(store,key);
   if(prior){if(!exact(prior,['version','owner','fingerprint','result'])||prior.version!==1)throw new AppError('CATALOGUE_DAMAGED');if(!same(prior.owner,owner)||prior.fingerprint!==fingerprint)throw new AppError('CONFLICT');return prior.result;}
   const result=await action(store,owner);signal?.throwIfAborted();await stateWrite(store,key,{version:1,owner,fingerprint,result});return result;
  }));
 }
 async change(data,options={}){
  if(!Array.isArray(data.operations)||!data.operations.length||data.operations.length>32)invalid();
  return this.write(data,'change',async(store,owner)=>{
   const current=await readDraft(store,owner);expectDraft(current,data);let context=await this.context(store,{...data,draftRevision:data.expectedRevision},{mutable:true,...options}),reader=context.reader,name=context.name;
   const documents=new ConfigurationDocuments(store);let reference=reader.descriptor??await documents.retainInline(owner,context.base.configuration,{draft:true,...options});
   const apply=async operations=>{reference=await documents.applySelected(reader,operations,{draft:true,...options});reader=await documents.open(owner,reference,{mutable:true,draft:true,...options});};
   for(const operation of data.operations){
    if(!operation||typeof operation.type!=='string')invalid();
    if(operation.type==='header'){if(owner.slot!=='labBookTemplate'||!exact(operation,['type','key','value'])||operation.key!=='name'||!nameValid(operation.value))invalid();name=operation.value;}
    else if(operation.type==='source'){
     if(Object.keys(operation).some(key=>!['type','source','name'].includes(key)))invalid();
     if(operation.name!==undefined){if(owner.slot!=='labBookTemplate'||!nameValid(operation.name))invalid();name=operation.name;}
     if(operation.source===null)reference=await documents.retainInline(owner,emptyConfiguration(),{draft:true,...options});
     else if(exact(operation.source,['profileId'])){const source=starterTemplate(operation.source.profileId);reference=await documents.retainInline(owner,source.configuration,{draft:true,...options});if(owner.slot==='labBookTemplate'&&operation.name===undefined)name=source.name;}
     else{
      const sourceOwner=configurationOwner(operation.source),copy=async sourceStore=>{const source=await pinned(sourceStore,sourceOwner,operation.source);reference=await documents.clone(owner,await new ConfigurationDocuments(sourceStore).open(sourceOwner,source.configuration,options),{freshSectionIds:true,uuid:randomUUID,...options});if(owner.slot==='labBookTemplate'&&operation.name===undefined)name=source.name??name;};
      if(sourceOwner.workspaceId===owner.workspaceId)await copy(store);
      else{if(typeof options.withConfigurationSource!=='function')throw new AppError('ACCESS_DENIED');await options.withConfigurationSource(operation.source,source=>source.catalogue(copy));}
     }
     reader=await documents.open(owner,reference,{mutable:true,draft:true,...options});
    }else if(operation.type==='profile-enable'){
     if(!exact(operation,['type','key','enabled'])||typeof operation.enabled!=='boolean')invalid();const profile=profileById(operation.key);if(!profile)invalid();
     const chosen=await reader.item({collection:'profiles',key:profile.id}).catch(error=>{if(error.code==='NOT_FOUND')return null;throw error;});
     await apply([{type:chosen?'replace':'append',collection:'profiles',...(chosen?{key:profile.id}:{}),value:{id:profile.id,version:chosen?.value.version??profile.version,enabled:operation.enabled}}]);
     if(operation.enabled)for(const starter of profile.sections){const present=await reader.section({profileId:profile.id,key:starter.key}).catch(error=>{if(error.code==='NOT_FOUND')return null;throw error;});if(!present)await apply([{type:'append',collection:'sections',value:{...structuredClone(starter),id:randomUUID(),profileId:profile.id,enabled:true}}]);}
    }else if(operation.type==='section-move'){if(!exact(operation,['type','key','direction'])||![-1,1].includes(operation.direction))invalid();await apply([{type:'move',collection:'sections',key:operation.key,direction:operation.direction}]);}
    else await apply([operation]);
   }
   const value={version:1,id:current?.value.id??randomUUID(),owner,base:{create:data.create===true,pin:context.pin},configuration:reference,name,updatedAt:new Date().toISOString()};await stateWrite(store,slot(owner),value);
   return this.envelope({...context,reader,name,draft:{value,revision:stamp(value)}});
  },options);
 }
 async save(data,options={}){
  if(data.create===true)invalid();return this.write(data,'save',async(store,owner)=>{
   const checkpoint=await configurationCheckpoint(store,owner,{id:data.draftId,revision:data.expectedRevision},data.configurationPin,{...options,validate:false}),etag=await store.head(),snapshot=await store.snapshot(etag),metadata=structuredClone(snapshot.metadata);
   if(owner.slot==='configuration')metadata.notebooks.find(value=>value.id===owner.notebookId).configuration=checkpoint.configuration;
   else metadata.projects.find(value=>value.id===owner.projectId).labBookTemplate={name:checkpoint.name,configuration:checkpoint.configuration};
   await store.validateMetadata(snapshot,metadata);await store.commitChanges(etag,await store.indexed(snapshot),metadata,[]);
   await discardConfigurationCheckpoint(store,owner,{id:checkpoint.draft.id,revision:checkpoint.revision});
   const context=await this.context(store,{...owner},options);return this.envelope(context);
  },options);
 }
 async discard(data,options={}){return this.write(data,'discard',async(store,owner)=>{const current=await readDraft(store,owner);expectDraft(current,data);if(current)await store.db.run('DELETE FROM state WHERE slot=$1',slot(owner));return this.envelope(await this.context(store,{...owner,create:data.create===true},options));},options);}
}
