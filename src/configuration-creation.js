// Creation intents retain an authenticated source address, never a client tree
// root. The new owner receives its own exact immutable nodes before attachment.
import {ConfigurationDocuments} from './configuration-documents.js';
import {configurationCheckpoint,discardConfigurationCheckpoint} from './configuration-commands.js';
import {validConfigurationOwner,validConfigurationReference,isConfigurationReference} from './web/configuration-reference.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {starterTemplate} from './web/project-templates.js';
import {emptyConfiguration} from './web/notebook-schema.js';
import {digest,serialize} from './storage-format.js';
import {AppError} from './errors.js';
const invalid=()=>{throw new AppError('INVALID');};
const same=(a,b)=>serialize(a)===serialize(b),stamp=value=>digest(serialize(value));
const ownerKeys=['workspaceId','projectId','notebookId','slot'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys.slice().sort().join();
const ownerOf=value=>Object.fromEntries(ownerKeys.map(key=>[key,value?.[key]]));
export const configurationCreationOptions=['configurationDraft','configurationPin','configurationSource'];
export const hasConfigurationCreation=command=>configurationCreationOptions.some(key=>Object.hasOwn(command,key));
function validPin(pin){return exact(pin,[...ownerKeys,'snapshotId','revision'])&&validConfigurationOwner(ownerOf(pin))&&revisionId(pin.snapshotId)&&revisionId(pin.revision);}
async function pinned(store,pin){
 if(!validPin(pin))invalid();const snapshot=await store.snapshot(pin.snapshotId);if(snapshot.metadata.id!==pin.workspaceId)throw new AppError('WORKSPACE_CHANGED');
 const owner=ownerOf(pin),member=owner.slot==='configuration'?snapshot.metadata.notebooks.find(value=>value.id===owner.notebookId&&value.projectId===owner.projectId):snapshot.metadata.projects.find(value=>value.id===owner.projectId);if(!member)throw new AppError('NOT_FOUND');
 const selected=owner.slot==='configuration'?{configuration:member.configuration??emptyConfiguration(),name:null}:{configuration:member.labBookTemplate?.configuration??emptyConfiguration(),name:member.labBookTemplate?.name??''};
 if(stamp(selected)!==pin.revision)throw new AppError('CONFLICT');return {owner,...selected};
}
export const localConfigurationSource=storage=>async(pin,operation)=>{
 if((await storage.outline()).metadata.id!==pin.workspaceId)throw new AppError('DATABASE_LOCATION');return operation(storage);
};
export function validCreationConfiguration(value){
 if(!exact(value,['version','kind','owner','reference','name','sourcePin','checkpoint'])||value.version!==1||!['source','draft'].includes(value.kind)||!validConfigurationOwner(value.owner)||value.reference!==null&&!validConfigurationReference(value.reference,value.owner)||value.name!==null&&(typeof value.name!=='string'||value.name.length>160||/[\x00-\x1f]/.test(value.name)))return false;
 return value.kind==='source'?validPin(value.sourcePin)&&same(ownerOf(value.sourcePin),value.owner)&&value.checkpoint===null:value.sourcePin===null&&!!value.reference&&exact(value.checkpoint,['id','revision'])&&researchId(value.checkpoint.id)&&revisionId(value.checkpoint.revision);
}
export async function prepareCreationConfiguration(storage,command,target,{withConfigurationSource=localConfigurationSource(storage),check=async()=>{}}={}){
 if(!hasConfigurationCreation(command))return null;
 if(Object.hasOwn(command,'configurationSource')){
  if(Object.hasOwn(command,'configurationDraft')||Object.hasOwn(command,'configurationPin'))invalid();
  const source=command.configurationSource;if(source===null)return {inline:null};
  if(exact(source,['profileId'])){let template;try{template=starterTemplate(source.profileId);}catch{invalid();}return {inline:template};}
  if(!validPin(source))invalid();await check();
  return withConfigurationSource(source,sourceStorage=>sourceStorage.catalogue(async store=>{
   const chosen=await pinned(store,source),documents=new ConfigurationDocuments(store),reader=await documents.open(chosen.owner,chosen.configuration);await documents.validate(reader);await check();
   const frozen={version:1,kind:'source',owner:chosen.owner,reference:reader.descriptor,name:chosen.name,sourcePin:structuredClone(source),checkpoint:null};if(!validCreationConfiguration(frozen))invalid();return {frozen};
  }));
 }
 if(!exact(command.configurationDraft,['id','revision'])||command.configurationPin!=null)invalid();
 return storage.catalogue(async store=>{
  const owner={workspaceId:(await store.snapshot()).metadata.id,...target},checkpoint=await configurationCheckpoint(store,owner,command.configurationDraft,null,{create:true});await check();
  const frozen={version:1,kind:'draft',owner,reference:checkpoint.configuration,name:checkpoint.name,sourcePin:null,checkpoint:structuredClone(command.configurationDraft)};if(!validCreationConfiguration(frozen))invalid();return {frozen};
 });
}
const clonedId=(commandId,sourceId)=>{
 const bytes=Buffer.from(digest('configuration-creation:'+commandId+':'+sourceId).slice(0,32),'hex');bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
};
export async function populateCreationConfiguration(storage,parent,frozen,{commandId,projectId,notebookId,slot,withConfigurationSource=localConfigurationSource(parent),check=async()=>{}}){
 if(!validCreationConfiguration(frozen)||!researchId(commandId))invalid();await check();
 const apply=async reader=>storage.catalogue(async store=>{
  const head=await store.head(),current=await store.indexed(await store.snapshot(head)),metadata=structuredClone(current.metadata),owner={workspaceId:metadata.id,projectId,notebookId,slot};
  const configuration=await new ConfigurationDocuments(store,{write:async operation=>{await check();return operation(store);}}).clone(owner,reader,{freshSectionIds:true,uuid:sourceId=>clonedId(commandId,sourceId)});
  if(slot==='configuration'){const book=metadata.notebooks.find(value=>value.id===notebookId&&value.projectId===projectId);if(!book)throw new AppError('CATALOGUE_DAMAGED');book.configuration=configuration;}
  else{const project=metadata.projects.find(value=>value.id===projectId);if(!project)throw new AppError('CATALOGUE_DAMAGED');project.labBookTemplate={name:frozen.name?.trim()?frozen.name:project.title,configuration};}
  await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[]);await check();
 });
 if(frozen.kind==='draft')return parent.catalogue(async store=>apply(await new ConfigurationDocuments(store).open(frozen.owner,frozen.reference)));
 return withConfigurationSource(frozen.sourcePin,source=>source.catalogue(async store=>{
  const chosen=await pinned(store,frozen.sourcePin);if(!same(chosen.owner,frozen.owner)||chosen.name!==frozen.name||!same(isConfigurationReference(chosen.configuration)?chosen.configuration:null,frozen.reference))throw new AppError('CONFLICT');
  return apply(await new ConfigurationDocuments(store).open(chosen.owner,chosen.configuration));
 }));
}
export async function discardCreationConfiguration(storage,frozen){
 if(!frozen||frozen.kind!=='draft')return;if(!validCreationConfiguration(frozen))throw new AppError('CATALOGUE_DAMAGED');
 await storage.withLock(()=>storage.catalogue(store=>discardConfigurationCheckpoint(store,frozen.owner,frozen.checkpoint)));
}
