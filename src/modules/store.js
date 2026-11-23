import {verifyProjectDomains} from '../project-domain-verification.js';
import {moduleDomainContext,moduleDomainRoute} from '../module-domain-context.js';
import {readProjectDomainRegistry} from '../project-domain-registry.js';
import {ProjectModuleCommands} from '../project-module-commands.js';
import {moduleCommandFingerprint as fingerprint} from './command-fingerprint.js';
import {serialize} from '../storage.js';
import {AppError} from '../errors.js';
import {exact,uuid,instant,requireValue,object} from './validation.js';
import {moduleResearchContext} from './research-context.js';
import {ModuleCatalogue,moduleEntityBytes} from './catalogue.js';
import {executeModuleCommand} from './command.js';
import {MODULE_BYTES} from './capacity.js';

export function validateModuleEvent(event){
 if(!exact(event,['id','commandId','fingerprint','action','at','changes'])||!uuid(event.id)||!uuid(event.commandId)||!/^[a-f0-9]{64}$/.test(event.fingerprint)||typeof event.action!=='string'||!instant(event.at)||!Array.isArray(event.changes)||!event.changes.length||!event.changes.every(e=>uuid(e.id)&&Number.isSafeInteger(e.revision)&&e.revision>0&&object(e.data))||new Set(event.changes.map(e=>e.id)).size!==event.changes.length)throw new AppError('MODULE_FORMAT');
 return event;
}
// Validators are shared by dedicated domain owners and the catalogue reader.
export class ModuleStore{
 constructor(workspace,definitions){this.workspace=workspace;this.definitions=definitions;}
 validateEntity(e){
  if(!exact(e,['id','type','revision','createdAt','updatedAt','data'])||!uuid(e.id)||!Number.isSafeInteger(e.revision)||e.revision<1||!instant(e.createdAt)||!instant(e.updatedAt)||!this.definitions.types[e.type])throw new AppError('MODULE_FORMAT');
  this.definitions.types[e.type](e.data);return e;
 }
 validateEvent(event){validateModuleEvent(event);for(const entity of event.changes)this.validateEntity(entity);return event;}
 async validateSource(source,types=null){
  for(const {accepts,validate} of this.definitions.sourceValidators)if(!types||accepts.some(type=>types.has(type)))await validate(source);
 }
 validate(data,{history=true}={}){
  if(!exact(data,['formatVersion','workspaceId','revision','entities',...(history?['events']:[])])||data.formatVersion!==1||!uuid(data.workspaceId)||!Number.isSafeInteger(data.revision)||data.revision<0||!Array.isArray(data.entities)||history&&!Array.isArray(data.events))throw new AppError('MODULE_FORMAT');
  const ids=new Set();
  for(const e of data.entities){
   this.validateEntity(e);if(ids.has(e.id))throw new AppError('MODULE_FORMAT');ids.add(e.id);
  }
  const commands=new Set();
  for(const event of data.events??[]){
   this.validateEvent(event);if(commands.has(event.commandId))throw new AppError('MODULE_FORMAT');
   commands.add(event.commandId);
  }
  if(history&&data.revision!==data.events.length)throw new AppError('MODULE_FORMAT');
  for(const validate of this.definitions.validate??[])validate(data.entities,{workspaceId:data.workspaceId});
  return data;
 }
 async read(book){
  book??=(await this.workspace.outline()).metadata;
  return this.workspace.catalogue(async store=>{if((await readProjectDomainRegistry(store))?.commandVersion===1)throw new AppError('ACCESS_UPGRADE');return this.validate(await store.moduleData(book.id));});
 }
 async current(book){
  book??=(await this.workspace.outline()).metadata;
  return this.workspace.catalogue(async store=>{
   const owned=await moduleDomainContext(store,async c=>{
    const entities=[];let bytes=Buffer.byteLength(serialize({formatVersion:1,workspaceId:book.id,revision:c.head.revision,revisions:c.revisions,entities:[]}));
    for await(const member of c.members()){
     const entity=await c.selected(member.id);bytes+=moduleEntityBytes(entity)+4;
     if(bytes>MODULE_BYTES)throw new AppError('LIMIT');
     entities.push(entity);
    }
    return {formatVersion:1,workspaceId:book.id,revision:c.head.revision,revisions:c.revisions,entities};
   },{scoped:false});
   return owned?owned.value:this.validate(await store.moduleData(book.id,{history:false}),{history:false});
  });
 }
 async version(){
  const {metadata:book}=await this.workspace.outline();
  return this.workspace.catalogue(async store=>{
   const owned=await moduleDomainContext(store,c=>({workspaceId:book.id,revision:c.head.revision,revisions:c.revisions}),{scoped:false});if(owned)return owned.value;
   const {workspaceId,revision}=await new ModuleCatalogue(store).head(book.id);return {workspaceId,revision};
  });
 }
 async verifyCatalogue(store,workspaceId){
  await new ModuleCatalogue(store).verify(workspaceId,{entity:entity=>this.validateEntity(entity),constraints:source=>this.validateSource(source),event:event=>this.validateEvent(event)});
  await verifyProjectDomains(store);
 }
 async execute(command,{compact=false}={}){
  if(Buffer.byteLength(JSON.stringify(command))>MODULE_BYTES)throw new AppError('LIMIT');
  requireValue(exact(command,['workspaceId','commandId','action','payload'])&&uuid(command.workspaceId)&&uuid(command.commandId)&&typeof command.action==='string'&&object(command.payload),'command');
  const handler=this.definitions.commands[command.action];requireValue(typeof handler==='function','command');
  const namespaceId=await moduleDomainRoute(this.workspace);
  if(namespaceId!==null){if(command.workspaceId!==namespaceId)throw new AppError('WORKSPACE_CHANGED');return new ProjectModuleCommands(this.workspace,namespaceId).execute(command);}
  return this.workspace.withLock(async()=>{
   const research=await moduleResearchContext(this.workspace),{book}=research;if(command.workspaceId!==book.id)throw new AppError('WORKSPACE_CHANGED');
   return this.workspace.catalogue(store=>executeModuleCommand(this,store,research,command,fingerprint(command),{compact}));
  });
 }
}
