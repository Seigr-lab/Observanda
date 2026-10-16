import {verifyProjectDomains} from '../project-domain-verification.js';
import {moduleDomainContext,moduleDomainRoute} from '../module-domain-context.js';
import {readProjectDomainRegistry} from '../project-domain-registry.js';
import {ProjectModuleCommands} from '../project-module-commands.js';
import {moduleCommandFingerprint as fingerprint} from './command-fingerprint.js';
import path from 'node:path';
import {hasCatalogue} from '../postgres.js';
import {randomUUID} from 'node:crypto';
import {assertRegular,privateDirectory,digest,serialize} from '../storage.js';
import {ENCRYPTION_OVERHEAD} from '../encryption.js';
import {AppError} from '../errors.js';
import {exact,uuid,instant,requireValue,object} from './validation.js';
import {moduleResearchContext} from './research-context.js';
import {ModuleCatalogue} from './catalogue.js';
import {executeModuleCommand} from './command.js';
import {balance} from '../web/modules/quantities.js';
import {MODULE_BYTES} from './capacity.js';

const MAX_BYTES=MODULE_BYTES;
export function validateModuleEvent(event){
 if(!exact(event,['id','commandId','fingerprint','action','at','changes'])||!uuid(event.id)||!uuid(event.commandId)||!/^[a-f0-9]{64}$/.test(event.fingerprint)||typeof event.action!=='string'||!instant(event.at)||!Array.isArray(event.changes)||!event.changes.length||!event.changes.every(e=>uuid(e.id)&&Number.isSafeInteger(e.revision)&&e.revision>0&&object(e.data))||new Set(event.changes.map(e=>e.id)).size!==event.changes.length)throw new AppError('MODULE_FORMAT');
 return event;
}
// Validators are shared by dedicated domain owners and the legacy reader.
export class ModuleStore{
 constructor(workspace,definitions){this.workspace=workspace;this.definitions=definitions;this.file=path.join(workspace.root,'.observanda','modules.json');}
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
  for(const validate of this.definitions.validate??[])validate(data.entities);
  return data;
 }
 async read(book){
  book??=(await this.workspace.outline()).metadata;
  if(await hasCatalogue(this.workspace.root))return this.workspace.catalogue(async store=>{if((await readProjectDomainRegistry(store))?.commandVersion===1)throw new AppError('ACCESS_UPGRADE');return this.validate(await store.moduleData(book.id));});
  await assertRegular(path.dirname(this.file),{directory:true,missing:true});
  const stat=await assertRegular(this.file,{missing:true});
  if(!stat)return {formatVersion:1,workspaceId:book.id,revision:0,entities:[],events:[]};
  if(stat.size>MAX_BYTES+ENCRYPTION_OVERHEAD)throw new AppError('LIMIT');
  let data;try{data=JSON.parse(await this.workspace.readFile(this.file,'utf8'));}catch(error){if(error instanceof AppError)throw error;throw new AppError('MODULE_FORMAT');}
  this.validate(data);if(data.workspaceId!==book.id)throw new AppError('WORKSPACE_CHANGED');return data;
 }
 async current(book){
  book??=(await this.workspace.outline()).metadata;
  if(await hasCatalogue(this.workspace.root))return this.workspace.catalogue(async store=>{
   const owned=await moduleDomainContext(store,async c=>{const entities=[];for await(const member of c.members())entities.push(await c.selected(member.id));return {formatVersion:1,workspaceId:book.id,revision:c.head.revision,revisions:c.revisions,entities};},{scoped:false});
   return owned?owned.value:this.validate(await store.moduleData(book.id,{history:false}),{history:false});
  });
  const {events,...data}=await this.read(book);void events;return data;
 }
 async version(){
  const {metadata:book}=await this.workspace.outline();
  if(await hasCatalogue(this.workspace.root))return this.workspace.catalogue(async store=>{
   const owned=await moduleDomainContext(store,c=>({workspaceId:book.id,revision:c.head.revision,revisions:c.revisions}),{scoped:false});if(owned)return owned.value;
   const {workspaceId,revision}=await new ModuleCatalogue(store).head(book.id);return {workspaceId,revision};
  });
  const {workspaceId,revision}=await this.read(book);return {workspaceId,revision};
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
   if(await hasCatalogue(this.workspace.root))return this.workspace.catalogue(store=>executeModuleCommand(this,store,research,command,fingerprint(command),{compact}));
   const data=await this.read(book),hash=fingerprint(command);
   const receipt=data.events.find(e=>e.commandId===command.commandId);
   if(receipt)validateModuleEvent(receipt);
   if(receipt){if(receipt.fingerprint!==hash)throw new AppError('MODULE_REPLAY');const changedIds=receipt.changes.map(e=>e.id);return compact?{modulePatch:{workspaceId:book.id,baseRevision:data.revision,revision:data.revision,entities:changedIds.map(id=>data.entities.find(e=>e.id===id))},replayed:true,changedIds}:{data,replayed:true,changedIds};}
   const before=serialize(data),now=new Date().toISOString(),changed=new Set(),entities=new Map(data.entities.map(e=>[e.id,e]));
   const tx={
    workspace:this.workspace,book,hasRecord:research.hasRecord,recordSummary:research.recordSummary,now,get:id=>entities.get(id),
    has:(type,id)=>entities.get(id)?.type===type,
    some:(types,predicate)=>[...entities.values()].some(e=>(!types||(Array.isArray(types)?types.includes(e.type):e.type===types))&&predicate(e)),
    balance:(id,projects)=>balance([...entities.values()],id,projects),
    expect(id,revision){if((entities.get(id)?.revision??null)!==revision)throw new AppError('MODULE_CHANGED',[{field:id}]);},
    put(type,id,value){
     requireValue(uuid(id)&&!!this.definitions.types[type],'item');const old=entities.get(id);requireValue(!old||old.type===type,'item type');
     const e={id,type,revision:old?(changed.has(id)?old.revision:old.revision+1):1,createdAt:old?.createdAt??now,updatedAt:now,data:structuredClone(value)};
     this.definitions.types[type](e.data);entities.set(id,e);changed.add(id);return e;
    }
   };tx.put=tx.put.bind(this);
   await handler(tx,command.payload);
   requireValue(changed.size>0,'No changes');
   data.entities=[...entities.values()];
   const event=validateModuleEvent({id:randomUUID(),commandId:command.commandId,fingerprint:hash,action:command.action,at:now,changes:[...changed].map(id=>structuredClone(entities.get(id)))});
   data.events.push(event);
   data.revision++;this.validate(data);const bytes=serialize(data);
   if(Buffer.byteLength(bytes)>MAX_BYTES)throw new AppError('LIMIT');
   if(data.revision>1){
    const history=await privateDirectory(this.workspace.root,'.observanda/module-history'),file=path.join(history,digest(before)+'.json');
    if(!await assertRegular(file,{missing:true}))await this.workspace.writeFile(file,before);
   }
   await this.workspace.writeFile(this.file,bytes);
   return compact?{modulePatch:{workspaceId:book.id,baseRevision:data.revision-1,revision:data.revision,entities:[...changed].map(id=>entities.get(id))},changedIds:[...changed],replayed:false}:{data,changedIds:[...changed],replayed:false};
  });
 }
}
