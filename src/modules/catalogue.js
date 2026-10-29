import {hasStructuredCalculator} from '../structured-calculator-format.js';
import {catalogueFormat,catalogueRequiresCalculationPolicies,requireCalculationPolicies,catalogueRequiresStructuredCalculator,requireStructuredCalculator} from '../catalogue-format.js';
import {hasCalculationPolicy} from '../web/tools/calculation-policy.js';
import {resolveModuleEvent,resolveModuleEntity} from '../project-retired-modules.js';
import {assertProjectSourceModuleWrite} from '../project-source-module-authority.js';
// Current module entities and retained command receipts have separate read
// paths. A normal view or command never materializes the full event history.
import {AppError} from '../errors.js';
import {digest,serialize} from '../storage-format.js';
import {withScratch} from '../scratch-work.js';
import {ModuleHistoryIndex} from './history-index.js';
import {moduleConstraint} from './constraints.js';
import {moduleConstraintSource} from './constraint-source.js';
import {moduleView,moduleSearch} from './view.js';
import {moduleReferences} from './references.js';
import {calendarFacts} from '../calendar/facts.js';
import {inventoryFacts} from './inventory-facts.js';
import {ModuleMemberIndex,validModuleMember} from './member-index.js';
import {ModuleBrowseIndex} from './browse-index.js';
import {InventoryProjection} from './inventory-projection.js';
const hash=value=>digest(serialize(value));
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const moduleEntityBytes=entity=>{
 const text=JSON.stringify(entity,null,2);let lines=1,offset=-1;
 while((offset=text.indexOf('\n',offset+1))!==-1)lines++;
 return Buffer.byteLength(text)+4*lines;
};
export const moduleCurrentBytes=(workspaceId,revision,members)=>{
 const count=Array.isArray(members)?members.length:members.count,bytes=Array.isArray(members)?members.reduce((sum,m)=>sum+m.bytes,0):members.bytes;
 return Buffer.byteLength(serialize({formatVersion:1,workspaceId,revision,entities:[]}))+bytes+(count?2*count+2:0);
};
export class ModuleCatalogue{
 constructor(store){this.store=store;this.currentSizes=new WeakMap();this.membersIndex=new ModuleMemberIndex(store);}
 async checkPolicy(entity){if(hasStructuredCalculator(entity?.type,entity?.data)&&!catalogueRequiresStructuredCalculator(await catalogueFormat(this.store.catalogueDb??this.store.db)))damaged();if(hasCalculationPolicy(entity?.type,entity?.data)&&!catalogueRequiresCalculationPolicies(await catalogueFormat(this.store.catalogueDb??this.store.db)))damaged();}
 async head(workspaceId){
  const s=this.store,row=await s.db.get("SELECT payload FROM state WHERE slot='modules'");
  const counts=await s.db.get('SELECT (SELECT count(*) FROM module_entities)::text AS entities,count(*)::text AS events,COALESCE(max(ordinal),0)::text AS last FROM module_events');
  if(!row){
   if(counts.entities!=='0'||counts.events!=='0')damaged();
   await this.membersIndex.check({memberVersion:1,root:null},'0');
   return {workspaceId,revision:0,entities:[]};
  }
  const head=s.decode('state','modules',row.payload);
  if(head.workspaceId!==workspaceId||!Number.isSafeInteger(head.revision)||head.revision<0||String(head.revision)!==counts.events||counts.last!==counts.events)damaged();
  if(head.historyVersion!==undefined&&head.historyVersion!==1)damaged();
  if(head.currentVersion!==undefined&&head.currentVersion!==1)damaged();
  if(head.totalBytes!==undefined&&(!Number.isSafeInteger(head.totalBytes)||head.totalBytes<0||counts.entities==='0'&&head.totalBytes!==0))damaged();
  if(head.viewVersion!==undefined&&head.viewVersion!==1)damaged();
  if(head.memberVersion!==undefined){if(Object.hasOwn(head,'entities'))damaged();await this.membersIndex.check(head,counts.entities);}
  else if(!Array.isArray(head.entities)||String(head.entities.length)!==counts.entities||new Set(head.entities.map(e=>e.id)).size!==head.entities.length||!head.entities.every(e=>validModuleMember(e,head)))damaged();
  new ModuleBrowseIndex(this).check(head);new InventoryProjection(this).check(head);return head;
 }
 stockProjection(head){const index=new InventoryProjection(this);return index.available(head)?[{index,head}]:null;}
 member(head,id){return head.memberVersion===1?this.membersIndex.find(head,id):Promise.resolve(head.entities.find(e=>e.id===id)??null);}
 async *members(head,options){if(head.memberVersion===1)yield* this.membersIndex.members(head,options);else for(const member of head.entities){options?.signal?.throwIfAborted();yield member;}}
 async currentSize(head){
  const count=head.memberVersion===1?head.root?.count??0:head.entities.length;
  if(head.totalBytes!==undefined)return {count,bytes:head.totalBytes};
  if(this.currentSizes.has(head))return this.currentSizes.get(head);
  let bytes=0;for await(const member of this.members(head))bytes+=head.currentVersion===1?member.bytes:moduleEntityBytes(await this.selected(head,member.id));
  const size=Object.freeze({count,bytes});this.currentSizes.set(head,size);return size;
 }
 async selected(head,id,stored=null){
  const member=await this.member(head,id);
  const row=stored??await this.store.db.get('SELECT id,revision,payload FROM module_entities WHERE id=$1',id);if(row&&row.id!==id)damaged();
  if(!member){if(row)damaged();return null;}
  if(!row||row.revision!==member.revision)damaged();
  const entity=await resolveModuleEntity(this.store,row,this.store.decode('module-entity',id+'/'+row.revision,row.payload));this.store.assertModuleType?.(entity.type);await this.checkPolicy(entity);
  if(entity.id!==id||entity.revision!==member.revision||hash(entity)!==member.hash)damaged();
  if(head.currentVersion===1&&(moduleEntityBytes(entity)!==member.bytes||hash(moduleConstraint(entity))!==member.constraintHash))damaged();
  if(head.viewVersion===1&&(entity.type!==member.type||hash(moduleView(entity))!==member.viewHash||hash(moduleSearch(entity))!==member.searchHash))damaged();
  if(member.referencesHash&&hash(moduleReferences(entity))!==member.referencesHash)damaged();
  if(member.calendarHash!==undefined&&(calendarFacts(entity)?hash(calendarFacts(entity)):null)!==member.calendarHash)damaged();
  if(member.inventoryHash!==undefined&&(inventoryFacts(entity)?hash(inventoryFacts(entity)):null)!==member.inventoryHash)damaged();
  return entity;
 }
 async inventory(head,member){
  if(member.inventoryHash===null)return null;
  if(member.inventoryHash===undefined)return inventoryFacts(await this.selected(head,member.id));
  const slot='module-inventory:'+member.inventoryHash,row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(!row)damaged();const value=this.store.decode('state',slot,row.payload);
  if(hash(value)!==member.inventoryHash||value.id!==member.id||value.type!==member.type)damaged();return value;
 }
 async calendar(head,member){
  if(member.calendarHash===null)return null;
  if(member.calendarHash===undefined)return calendarFacts(await this.selected(head,member.id));
  const slot='module-calendar:'+member.calendarHash,row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(!row)damaged();const value=this.store.decode('state',slot,row.payload);
  if(hash(value)!==member.calendarHash||value.id!==member.id||value.type!==member.type)damaged();return value;
 }
 async references(head,member){
  if(!member.referencesHash)return moduleReferences(await this.selected(head,member.id));
  const slot='module-references:'+member.referencesHash,row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(!row)damaged();const value=this.store.decode('state',slot,row.payload);
  if(hash(value)!==member.referencesHash)damaged();return value;
 }
 async view(head,member){
  if(head.viewVersion!==1)return moduleView(await this.selected(head,member.id));
  const slot='module-view:'+member.viewHash,row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(!row)damaged();const value=this.store.decode('state',slot,row.payload);
  if(hash(value)!==member.viewHash||value.id!==member.id||value.revision!==member.revision)damaged();return value;
 }
 async search(head,member){
  if(head.viewVersion!==1)return moduleSearch(await this.selected(head,member.id));
  const slot='module-search:'+member.searchHash,row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(!row)damaged();const value=this.store.decode('state',slot,row.payload);
  if(typeof value!=='string'||hash(value)!==member.searchHash)damaged();return value;
 }
 async constraint(head,member){
  if(head.currentVersion!==1)return moduleConstraint(await this.selected(head,member.id));
  const slot='module-constraint:'+member.constraintHash,row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(!row)damaged();const value=this.store.decode('state',slot,row.payload);
  if(hash(value)!==member.constraintHash||value.id!==member.id)damaged();return value;
 }
 async read(workspaceId,{history=true}={}){
  const s=this.store,head=await this.head(workspaceId);
  const entities=[];
  for await(const row of s.db.rows('SELECT id,revision,payload FROM module_entities ORDER BY id',[],{batchSize:16})){
   const entity=await resolveModuleEntity(s,row,s.decode('module-entity',row.id+'/'+row.revision,row.payload)),member=await this.member(head,row.id);
   await this.checkPolicy(entity);if(!member||entity.id!==row.id||entity.revision!==row.revision||member.revision!==row.revision||member.hash!==hash(entity))damaged();
   if(head.currentVersion===1&&(moduleEntityBytes(entity)!==member.bytes||hash(moduleConstraint(entity))!==member.constraintHash))damaged();
   if(head.viewVersion===1&&(entity.type!==member.type||hash(moduleView(entity))!==member.viewHash||hash(moduleSearch(entity))!==member.searchHash))damaged();
   if(member.referencesHash&&hash(moduleReferences(entity))!==member.referencesHash)damaged();
   if(member.calendarHash!==undefined&&(calendarFacts(entity)?hash(calendarFacts(entity)):null)!==member.calendarHash)damaged();
   if(member.inventoryHash!==undefined&&(inventoryFacts(entity)?hash(inventoryFacts(entity)):null)!==member.inventoryHash)damaged();
   entities.push(entity);
  }
  const data={formatVersion:1,workspaceId,revision:head.revision,entities};
  if(history){
   data.events=[];
   for await(const row of s.db.rows('SELECT command_id,ordinal,payload FROM module_events ORDER BY ordinal',[],{batchSize:8})){
    if(row.ordinal!==data.events.length+1)damaged();data.events.push(await this.event(row));
   }
  }
  return data;
 }
 async event(row){const event=await resolveModuleEvent(this.store,row,this.store.decode('module-event',row.command_id+'/'+row.ordinal,row.payload));if(event.commandId!==row.command_id)damaged();if(Array.isArray(event.changes))for(const entity of event.changes)await this.checkPolicy(entity);return event;}
 async receipt(commandId,revision){
  const row=await this.store.db.get('SELECT command_id,ordinal,payload FROM module_events WHERE command_id=$1',commandId);
  if(!row)return null;if(row.ordinal>revision)damaged();return this.event(row);
 }
 async verify(workspaceId,validate){
  const head=await this.head(workspaceId),history=new ModuleHistoryIndex(this.store);
  // Validate each original against its authenticated derived facts, then drop
  // the body. Cross-entity checks consume only their explicit constraint data.
  await validate.constraints(moduleConstraintSource(this,head));
  await new ModuleBrowseIndex(this).verify(head);
  await new InventoryProjection(this).verify(head);
  await withScratch(async work=>{
  let count=0,bytes=0;
  for await(const member of this.members(head)){
   const entity=await this.selected(head,member.id);validate.entity(entity);
   count++;bytes+=moduleEntityBytes(entity);
   if(moduleCurrentBytes(workspaceId,head.revision,{count,bytes})>64*1024*1024)damaged();
   await work.put('entity:'+entity.id,{revision:entity.revision,hash:member.hash,type:entity.type,createdAt:entity.createdAt,base:head.historyVersion===1?member.historyFrom:member.revision});
   await this.view(head,member);await this.search(head,member);await this.references(head,member);await this.calendar(head,member);await this.inventory(head,member);
  }
   if(head.totalBytes!==undefined&&head.totalBytes!==bytes)damaged();
   let ordinal=head.revision;
   // One event at a time: an audit does not assemble all past module bodies.
   for await(const row of this.store.db.rows('SELECT command_id,ordinal,payload FROM module_events ORDER BY ordinal DESC',[],{batchSize:1})){
    if(row.ordinal!==ordinal--)damaged();const event=await this.event(row);validate.event(event);
    if(!await work.add('event:'+event.id))damaged();const eventHash=hash(event);
    for(const entity of event.changes){
     const expected=await work.get('entity:'+entity.id);
     if(!expected||entity.revision!==expected.revision||entity.type!==expected.type||entity.createdAt!==expected.createdAt||expected.hash&&hash(entity)!==expected.hash)damaged();
     if(entity.revision>expected.base)await history.verify(event,entity,row.ordinal,eventHash);
     expected.revision--;expected.hash=null;await work.put('entity:'+entity.id,expected);
    }
   }
   if(ordinal!==0)damaged();for await(const expected of work.items())if(expected&&expected.revision!==0)damaged();
  });
 }
 async write(data,changed,event=data.events?.at(-1)){
  const previous=await this.head(data.workspaceId);
  if(data.revision!==previous.revision+1)damaged();
  const values=data.entities.filter(e=>changed.has(e.id));
  await this.writeChanges(previous,values,event);
 }
 async writeChanges(previous,entities,event){
  await this.store.assertModuleWrite?.(entities,event);
  await assertProjectSourceModuleWrite(this,previous,entities);
  if(entities.some(entity=>hasStructuredCalculator(entity.type,entity.data)))await requireStructuredCalculator(this.store.catalogueDb??this.store.db);
  if(entities.some(entity=>hasCalculationPolicy(entity.type,entity.data)))await requireCalculationPolicies(this.store.catalogueDb??this.store.db);
  const s=this.store,empty=(previous.memberVersion===1?previous.root?.count??0:previous.entities.length)===0;
  let root=previous.root??null,{bytes:totalBytes}=await this.currentSize(previous);
  const browse=new ModuleBrowseIndex(this);let browseRoot=await browse.prepare(previous);
  const stock=new InventoryProjection(this);let stockRoot=await stock.prepare(previous);
  if(previous.memberVersion!==1)for await(const member of this.members(previous))root=await this.membersIndex.put(root,{...member,historyFrom:previous.historyVersion===1?member.historyFrom:member.revision});
  for(const e of entities){
   const priorMember=await this.member({...previous,memberVersion:1,root},e.id);
   const previousView=priorMember?await this.view(previous,priorMember):null;
   const previousConstraint=priorMember?await this.constraint(previous,priorMember):null;
   if(priorMember)totalBytes-=previous.currentVersion===1?priorMember.bytes:moduleEntityBytes(await this.selected(previous,e.id));totalBytes+=moduleEntityBytes(e);
   const constraint=moduleConstraint(e),constraintHash=hash(constraint),slot='module-constraint:'+constraintHash;
   const prior=await s.db.get('SELECT payload FROM state WHERE slot=$1',slot);
   if(prior){if(hash(s.decode('state',slot,prior.payload))!==constraintHash)damaged();}
   else await s.db.run('INSERT INTO state VALUES ($1,$2)',slot,s.encode('state',slot,constraint));
   const view=moduleView(e),viewHash=hash(view),viewSlot='module-view:'+viewHash;
   const priorView=await s.db.get('SELECT payload FROM state WHERE slot=$1',viewSlot);
   if(priorView){if(hash(s.decode('state',viewSlot,priorView.payload))!==viewHash)damaged();}
   else await s.db.run('INSERT INTO state VALUES ($1,$2)',viewSlot,s.encode('state',viewSlot,view));
   const search=moduleSearch(e),searchHash=hash(search),searchSlot='module-search:'+searchHash,priorSearch=await s.db.get('SELECT payload FROM state WHERE slot=$1',searchSlot);
   if(priorSearch){if(hash(s.decode('state',searchSlot,priorSearch.payload))!==searchHash)damaged();}
   else await s.db.run('INSERT INTO state VALUES ($1,$2)',searchSlot,s.encode('state',searchSlot,search));
   const references=moduleReferences(e),referencesHash=hash(references),referenceSlot='module-references:'+referencesHash,priorReferences=await s.db.get('SELECT payload FROM state WHERE slot=$1',referenceSlot);
   if(priorReferences){if(hash(s.decode('state',referenceSlot,priorReferences.payload))!==referencesHash)damaged();}
   else await s.db.run('INSERT INTO state VALUES ($1,$2)',referenceSlot,s.encode('state',referenceSlot,references));
   const schedule=calendarFacts(e),calendarHash=schedule?hash(schedule):null;
   if(schedule){
    const slot='module-calendar:'+calendarHash,prior=await s.db.get('SELECT payload FROM state WHERE slot=$1',slot);
    if(prior){if(hash(s.decode('state',slot,prior.payload))!==calendarHash)damaged();}
    else await s.db.run('INSERT INTO state VALUES ($1,$2)',slot,s.encode('state',slot,schedule));
   }
   const inventory=inventoryFacts(e),inventoryHash=inventory?hash(inventory):null;
   if(inventory){
    const slot='module-inventory:'+inventoryHash,prior=await s.db.get('SELECT payload FROM state WHERE slot=$1',slot);
    if(prior){if(hash(s.decode('state',slot,prior.payload))!==inventoryHash)damaged();}
    else await s.db.run('INSERT INTO state VALUES ($1,$2)',slot,s.encode('state',slot,inventory));
   }
   const member={id:e.id,type:e.type,revision:e.revision,hash:hash(e),historyFrom:priorMember?(previous.historyVersion===1?priorMember.historyFrom:priorMember.revision):0,bytes:moduleEntityBytes(e),constraintHash,viewHash,searchHash,referencesHash,calendarHash,inventoryHash};
   root=await this.membersIndex.put(root,member);browseRoot=await browse.replace(browseRoot,previousView,view,member);
   stockRoot=await stock.replace(stockRoot,previousConstraint,constraint,previous.workspaceId);
   await s.db.run('INSERT INTO module_entities VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload',e.id,e.revision,s.encode('module-entity',e.id+'/'+e.revision,e));
  }
  const data={workspaceId:previous.workspaceId,revision:previous.revision+1,historyVersion:1,memberVersion:1,root,totalBytes,browseIndex:{version:1,root:browseRoot},stockIndex:{version:1,root:stockRoot}};
  if(previous.currentVersion===1||empty)data.currentVersion=1;
  if(previous.viewVersion===1||empty)data.viewVersion=1;
  await s.db.run('INSERT INTO module_events VALUES ($1,$2,$3)',event.commandId,data.revision,s.encode('module-event',event.commandId+'/'+data.revision,event));
  await new ModuleHistoryIndex(s).append(event,data.revision);
  await s.db.run("INSERT INTO state VALUES ('modules',$1) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload",s.encode('state','modules',data));
 }
}
