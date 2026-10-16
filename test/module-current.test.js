import {moduleDomainStore} from './module-domain-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {serialize} from '../src/storage-format.js';
import {workspaceModules} from '../src/modules/index.js';
import {ModuleCatalogue,moduleCurrentBytes,moduleEntityBytes} from '../src/modules/catalogue.js';
import {ModuleReader} from '../src/modules/reader.js';
import {PlanningDashboard} from '../src/modules/dashboard.js';
import {seedModuleCurrent} from './module-current-fixture.js';
import {researchReference} from '../src/web/research-reference.js';
const task=title=>({title,description:'Private task body. '.repeat(4500),status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[]});
async function fixture(t,count=3,decorate=(entity)=>entity,prepareBook=book=>book){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-current-')),book=prepareBook(sampleNotebook()),f=await encryptedFixture(directory,book),modules=workspaceModules(f.workspace),now=new Date().toISOString();
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const entities=Array.from({length:count},(_,i)=>decorate({id:randomUUID(),type:'task',revision:1,createdAt:now,updatedAt:now,data:task('Task '+i)},i,book));
 const data=await seedModuleCurrent(f.workspace,book.id,entities);
 const command=(entity,values={})=>({workspaceId:book.id,commandId:randomUUID(),action:'task.save',payload:{id:entity.id,expectedRevision:entity.revision,data:{...entity.data,...values}}});
 return {...f,book,modules,data,command};
}
test('incremental module capacity equals the serialized current representation',()=>{
 for(const entities of [[],[{id:'x',data:{text:'à\n🙂'}}],[{id:'x'}, {id:'y',data:['long\ntext',null]}]])for(const revision of [0,9,10,100]){
  const data={formatVersion:1,workspaceId:randomUUID(),revision,entities};
  assert.equal(moduleCurrentBytes(data.workspaceId,revision,entities.map(entity=>({bytes:moduleEntityBytes(entity)}))),Buffer.byteLength(serialize(data)));
 }
});
for(const count of [65,650])test('selected module commands do not read '+count+' unrelated originals',async t=>{
 const f=await fixture(t,count,(e,i,book)=>({...e,data:{...e.data,links:[{workspaceId:book.id,type:'record',id:book.entries[i%2].id}]}})),original=ModuleCatalogue.prototype.selected,read=ModuleCatalogue.prototype.read,loaded=[];
 ModuleCatalogue.prototype.selected=async function(head,id){const entity=await original.call(this,head,id);if(entity)loaded.push(id);return entity;};
 ModuleCatalogue.prototype.read=()=>{throw Error('Full module read during selected command');};
 t.after(()=>{ModuleCatalogue.prototype.selected=original;ModuleCatalogue.prototype.read=read;});
 const reader=new ModuleReader(f.workspace),pageStart=performance.now(),page=await reader.list({workspaceId:f.book.id,type:'task'}),pageMs=performance.now()-pageStart;
 assert.equal(page.items.length,25);assert.equal(page.total,count);assert.deepEqual(loaded,[]);assert.ok(JSON.stringify(page).length<24000);assert.ok(pageMs<1500);
 const second=await reader.list({workspaceId:f.book.id,type:'task',cursor:page.nextCursor});assert.equal(second.offset,25);
 const first=await reader.list({workspaceId:f.book.id,type:'task',cursor:second.previousCursor});assert.deepEqual(first.items,page.items);
 const labels=await reader.labels({workspaceId:f.book.id,ids:[page.items[0].id,randomUUID()]});assert.equal(labels.items.length,1);assert.equal(labels.missing.length,1);assert.deepEqual(loaded,[]);
 const reference={workspaceId:f.book.id,type:'record',id:f.book.entries[0].id},linkedStart=performance.now(),linked=await reader.list({workspaceId:f.book.id,types:['task'],reference}),linkedMs=performance.now()-linkedStart;
 assert.equal(linked.total,Math.ceil(count/2));assert.equal(linked.items.length,25);assert.deepEqual(loaded,[]);assert.ok(linkedMs<1500);
 await assert.rejects(reader.list({workspaceId:f.book.id,types:['sheet'],reference,cursor:linked.nextCursor}),{code:'MODULE_QUERY_CURSOR'});
 const searched=await reader.list({workspaceId:f.book.id,type:'task',query:'Private task body'});assert.equal(searched.total,count);assert.deepEqual(loaded,[]);
 const dashboard=new PlanningDashboard(f.workspace),discovery=await dashboard.discover({workspaceId:f.book.id,type:'task',offset:20,limit:12});
 assert.equal(discovery.total,count);assert.equal(discovery.items.length,12);assert.deepEqual(loaded,[]);
 const cards=await dashboard.page({workspaceId:f.book.id,type:'task',scopeIds:[null],limit:7});assert.equal(cards.items.length,7);assert.equal(cards.total,count);assert.equal(loaded.length,7);assert.deepEqual(new Set(loaded),new Set(cards.items.map(i=>i.key)));assert.ok(Buffer.byteLength(JSON.stringify(cards))<1024*1024);loaded.length=0;
 assert.equal((await dashboard.page({workspaceId:f.book.id,type:'task',scopeIds:[],limit:7})).items.length,0);assert.deepEqual(loaded,[]);
 const nextCards=await dashboard.page({workspaceId:f.book.id,type:'task',scopeIds:[null],limit:7,cursor:cards.nextCursor});assert.equal(nextCards.offset,7);assert.ok(nextCards.items.every(i=>!cards.items.some(p=>p.key===i.key)));loaded.length=0;
 const chosen=await reader.selected({workspaceId:f.book.id,id:page.items[0].id});assert.equal(chosen.entity.id,page.items[0].id);assert.deepEqual(loaded,[page.items[0].id]);loaded.length=0;
 const target=f.data.entities[0],command=f.command(target,{title:'Changed selected task',description:'Shorter description'}),started=performance.now();
 const result=await f.modules.execute(command,{compact:true}),elapsed=performance.now()-started;
 assert.deepEqual(loaded,[target.id]);assert.equal(result.data,undefined);assert.equal(result.entities.length,1);
 assert.equal(result.entities[0].data.title,'Changed selected task');assert.ok(Buffer.byteLength(JSON.stringify(result))<1500);
 assert.ok(elapsed<2500,'Selected edit exceeds 2.5 seconds');assert.ok(process.memoryUsage().heapUsed<512*1024*1024);
 assert.equal((await f.modules.current()).entities.length,count);assert.equal(result.revisions.tasks,result.baseRevisions.tasks+1);
 loaded.length=0;const replay=await f.modules.execute(command,{compact:true});assert.equal(replay.replayed,true);assert.deepEqual(loaded,[target.id]);
 const later=await f.modules.execute(f.command(replay.entities[0],{title:'Subsequent save'}),{compact:true});
 assert.equal((await f.modules.execute(command,{compact:true})).entities[0].data.title,'Subsequent save');
 assert.equal(later.baseRevisions.tasks,result.revisions.tasks);assert.equal(later.revisions.tasks,result.revisions.tasks+1);
 await assert.rejects(reader.list({workspaceId:f.book.id,type:'task',cursor:page.nextCursor}),{code:'MODULE_QUERY_CURSOR'});
 await assert.rejects(f.modules.execute({...command,payload:{...command.payload,data:{...command.payload.data,title:'Different retry'}}},{compact:true}),{code:'MODULE_REPLAY'});
 t.diagnostic(JSON.stringify({entities:count,currentBytes:Buffer.byteLength(serialize(f.data)),pageMs:Math.round(pageMs),linkedMs:Math.round(linkedMs),pageBytes:Buffer.byteLength(JSON.stringify(page)),editMs:Math.round(elapsed),replyBytes:Buffer.byteLength(JSON.stringify(result)),heapMiB:Math.round(process.memoryUsage().heapUsed/1024/1024)}));
});

test('connected work includes prose links, respects project adoption and rejects damaged reference facts',async t=>{
 const f=await fixture(t,4,(e,i,book)=>{
  const reference={workspaceId:book.id,kind:'record',id:book.entries[0].id};
  return {...e,data:{...e.data,projectId:i===3?book.projects[0].id:null,description:i===2?{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Original method',marks:[{type:'link',attrs:{href:researchReference(reference),title:'',target:'_self',nofollow:false}}]}]}]}:'',links:i===2?[]:[{workspaceId:book.id,type:'record',id:reference.id}]}};
 }),reader=new ModuleReader(f.workspace),command={workspaceId:f.book.id,types:['task'],reference:{workspaceId:f.book.id,type:'record',id:f.book.entries[0].id}},read=ModuleCatalogue.prototype.read,selected=ModuleCatalogue.prototype.selected;
 ModuleCatalogue.prototype.read=()=>{throw Error('Whole current module data loaded');};ModuleCatalogue.prototype.selected=()=>{throw Error('Original loaded for connected work');};
 try{
  const result=await reader.list(command);assert.equal(result.total,3);assert.deepEqual(new Set(result.items.map(e=>e.id)),new Set(f.data.entities.slice(0,3).map(e=>e.id)));
  assert.equal((await reader.list({workspaceId:f.book.id,type:'task',moduleId:'planning'})).total,3);
  const scoped=await reader.list({workspaceId:f.book.id,type:'task',projectId:f.book.projects[0].id,recursive:false});assert.deepEqual(scoped.items.map(e=>e.id),[f.data.entities[3].id]);
  assert.equal((await reader.list({workspaceId:f.book.id,type:'task',projectId:f.book.projects[0].id,moduleId:'planning'})).total,0);
  for(const query of [{kind:'equipment'},{archived:false},{moduleId:'invalid'},{projectId:'bad'},{recursive:'yes'}])await assert.rejects(reader.list({workspaceId:f.book.id,type:'task',...query}),{code:'INVALID'});
 }finally{ModuleCatalogue.prototype.selected=selected;ModuleCatalogue.prototype.read=read;}
 // Audit streams current originals as well as historical events.
 ModuleCatalogue.prototype.read=()=>{throw Error('Whole current module data loaded by audit');};
 try{await f.workspace.catalogue(store=>f.modules.verifyCatalogue(store,f.book.id));}finally{ModuleCatalogue.prototype.read=read;}
 await moduleDomainStore(f.workspace,f.book.id,'tasks',async store=>{
  const catalogue=new ModuleCatalogue(store),head=await catalogue.head(f.book.id),slot='module-references:'+(await catalogue.member(head,f.data.entities[0].id)).referencesHash;
  await store.db.run('DELETE FROM state WHERE slot=$1',slot);
 },{write:true});
 await assert.rejects(reader.list(command),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.workspace.catalogue(store=>f.modules.verifyCatalogue(store,f.book.id)),{code:'CATALOGUE_DAMAGED'});
});
test('planning cards inherit event ownership, exclude archived calendar choices and retain selected page scope',async t=>{
 const ids=Array.from({length:4},()=>randomUUID());
 const f=await fixture(t,4,(e,i,book)=>({...e,id:ids[i],type:i<2?'calendar':'event',data:i<2?
  {name:i?'Archived calendar':'Project calendar',projectId:i?null:book.projects[0].id,color:'#3958ba',archived:i===1}:
  {title:'Event '+i,calendarId:ids[i-2],startsAt:'2026-10-01',endsAt:'2026-10-02',allDay:true,timeZone:'UTC',location:'',notes:'Selected event notes',status:'confirmed'}}),book=>{book.projects[0].tools=['planning'];return book;}),reader=new ModuleReader(f.workspace),dashboard=new PlanningDashboard(f.workspace);
 const selected=ModuleCatalogue.prototype.selected,loaded=[];t.mock.method(ModuleCatalogue.prototype,'selected',async function(head,id){loaded.push(id);return selected.call(this,head,id);});
 const choices=await reader.list({workspaceId:f.book.id,type:'calendar',archived:false,moduleId:'planning'});assert.deepEqual(choices.items.map(i=>i.id),[ids[0]]);assert.deepEqual(loaded,[]);
 const page=await dashboard.page({workspaceId:f.book.id,type:'event',scopeIds:[f.book.projects[0].id],limit:5});assert.deepEqual(page.items.map(i=>i.key),[ids[2]]);assert.deepEqual(loaded,[ids[2]]);assert.ok(page.items[0].data.owner.includes(f.book.projects[0].title));
 assert.ok(page.items[0].action.data.modulePath.includes(f.book.projects[0].id));
 await assert.rejects(dashboard.page({workspaceId:f.book.id,type:'event',scopeIds:[null],cursor:page.cursor,limit:5}),{code:'MODULE_QUERY_CURSOR'});
});

test('constraint checks include unopened tasks; failed receipt writes roll back facts and originals',async t=>{
 const f=await fixture(t),a=f.data.entities[0],b=f.data.entities[1],save=command=>f.modules.execute(command,{compact:true});
 const changed=await save(f.command(a,{dependencies:[b.id]}));
 await assert.rejects(save(f.command(b,{dependencies:[a.id]})),{code:'MODULE_INVALID'});
 await assert.rejects(save(f.command(changed.entities[0],{status:'done'})),{code:'TASK_BLOCKED'});
 const before=await f.modules.current(),command=f.command(b,{title:'Interrupted'}),write=ModuleCatalogue.prototype.writeChanges;
 ModuleCatalogue.prototype.writeChanges=async function(...args){
  const run=this.store.db.run.bind(this.store.db);this.store.db.run=async(sql,...values)=>{if(sql.startsWith('INSERT INTO module_events'))throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});return run(sql,...values);};
  try{return await write.apply(this,args);}finally{this.store.db.run=run;}
 };
 try{await assert.rejects(save(command),{code:'ENOSPC'});}finally{ModuleCatalogue.prototype.writeChanges=write;}
 assert.deepEqual(await f.modules.current(),before);
 assert.equal((await save(command)).replayed,false);
 await f.workspace.catalogue(store=>f.modules.verifyCatalogue(store,f.book.id));
});
test('missing or changed constraint facts fail closed and verification checks body agreement',async t=>{
 const f=await fixture(t),target=f.data.entities[0];
 await moduleDomainStore(f.workspace,f.book.id,'tasks',async store=>{
  const catalogue=new ModuleCatalogue(store),head=await catalogue.head(f.book.id),member=await catalogue.member(head,target.id),slot='module-constraint:'+member.constraintHash;
  const value=store.decode('state',slot,(await store.db.get('SELECT payload FROM state WHERE slot=$1',slot)).payload);value.data.status='done';
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,value),slot);
 },{write:true});
 await assert.rejects(f.modules.execute(f.command(f.data.entities[1]),{compact:true}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.workspace.catalogue(store=>f.modules.verifyCatalogue(store,f.book.id)),{code:'CATALOGUE_DAMAGED'});
});
