import {moduleDomainStore,moduleDraftOwners} from './module-domain-fixture.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {Client} from 'pg';
import {ResearchMaterials} from '../src/research-materials.js';
import {contentBuffer} from '../src/file-content.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {initializeLocation,copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {workspaceModules} from '../src/modules/index.js';
import {Laboratory} from '../src/laboratory.js';
import {clearVault} from '../src/encryption.js';
import {databaseCapacity,openCatalogue} from '../src/postgres.js';
async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-module-sql-')),root=path.join(parent,'workspace'),a=await createAccess('','synthetic module password'),vault=takeCreatedVault(a);
 await initializeLocation(root,sampleNotebook(),a,vault);const ws=new Workspace(root,vault),book=(await ws.read()).book,store=workspaceModules(ws);
 t.after(async()=>{clearVault(vault);await rm(parent,{recursive:true,force:true});});
 return {parent,root,vault,ws,book,store,command:(action,payload)=>({workspaceId:book.id,commandId:randomUUID(),action,payload})};
}
const task=()=>({title:'Private task sentinel',description:'',status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[]});
test('failed module transactions roll back entities and receipts while preserving research',async t=>{
 const f=await fixture(t),before=await f.ws.read(),command=f.command('task.save',{id:randomUUID(),expectedRevision:null,data:task()}),write=ModuleCatalogue.prototype.writeChanges;
 t.mock.method(ModuleCatalogue.prototype,'writeChanges',async function(...args){await write.apply(this,args);throw Error('Interrupted after entity write');});
 await assert.rejects(f.store.execute(command),/Interrupted after entity write/);t.mock.restoreAll();
 assert.deepEqual(await f.ws.read(),before);assert.equal((await f.store.current()).entities.length,0);
 await assert.rejects(access(path.join(f.root,'.observanda/modules.json')),{code:'ENOENT'});
 const saved=await f.store.execute(command);assert.equal(saved.revisions.tasks,1);assert.equal(saved.replayed,false);
});
test('module receipts, laboratory records and metadata retain identity through ordinary and rekeyed backups',async t=>{
 const f=await fixture(t),command=f.command('task.save',{id:randomUUID(),expectedRevision:null,data:task()});await f.store.execute(command);
 const lab=new Laboratory(f.root,f.vault);await lab.change({etag:'new',action:'create-sample',sample:{code:'Synthetic sample',material:'Private material',source:'',collectedOn:'2026-09-01',receivedOn:'2026-09-02'}});
 const draftId=randomUUID(),checkpoint={workspaceId:f.book.id,moduleId:'planning',id:draftId,etag:null,drafts:[{id:command.payload.id,type:'task',expectedRevision:1,baseRevision:1,data:{...task(),title:'Prepared next observation'}}]};
 await moduleDraftOwners(f.ws,f.book.id,'planning').drafts.write(checkpoint);
 const before=await f.store.current(),labBefore=await lab.read(),plan=await copyPlan(f.root,path.join(f.parent,'stale'));
 await f.ws.withLock(()=>f.ws.writeMetadata('.observanda/qualification.json','changed metadata'));
 await assert.rejects(copyWorkspace(plan),{code:'CONFLICT'});
 const backup=await copyWorkspace(await copyPlan(f.root,path.join(f.parent,'backup')),{vault:f.vault});
 const a=await createAccess('','different synthetic password'),key=takeCreatedVault(a);t.after(()=>clearVault(key));
 const rekeyed=await encryptedCopy(await copyPlan(f.root,path.join(f.parent,'rekeyed')),a,key,f.vault);
 for(const [root,vault] of [[backup,f.vault],[rekeyed,key]]){
  const ws=new Workspace(root,vault),store=workspaceModules(ws);assert.deepEqual(await store.current(),before);assert.deepEqual(await new Laboratory(root,vault).read(),labBefore);
  assert.equal((await store.execute(command)).replayed,true);assert.equal(await ws.readMetadata('.observanda/qualification.json',100),'changed metadata');assert.deepEqual((await moduleDraftOwners(ws,f.book.id,'planning').drafts.read(draftId)).draft.drafts[0].data,checkpoint.drafts[0].data);
 }
});
test('deleted encrypted module entities are detected instead of restoring silently incomplete data',async t=>{
 const f=await fixture(t);await f.store.execute(f.command('task.save',{id:randomUUID(),expectedRevision:null,data:task()}));
 await moduleDomainStore(f.ws,f.book.id,'tasks',store=>store.db.run('DELETE FROM module_entities'),{write:true});
 await assert.rejects(f.store.current(),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(copyWorkspace(await copyPlan(f.root,path.join(f.parent,'broken')),{vault:f.vault}),{code:'CATALOGUE_DAMAGED'});
});
test('PostgreSQL connection pressure waits and cancellation releases its admission',async t=>{
 const f=await fixture(t),connections=[];
 try{
  for(let i=0;i<databaseCapacity().limit;i++)connections.push(await openCatalogue(f.root));
  assert.equal(databaseCapacity().active,databaseCapacity().limit);const controller=new AbortController();
  const pending=openCatalogue(f.root,{signal:controller.signal}),rejected=assert.rejects(pending,{name:'AbortError'});
  await new Promise(resolve=>setTimeout(resolve,30));controller.abort();await rejected;assert.equal(databaseCapacity().queued,0);
  const next=openCatalogue(f.root);await connections.pop().close();connections.push(await next);
 }finally{await Promise.all(connections.map(db=>db.close()));}
 assert.equal(databaseCapacity().active,0);assert.equal((await f.ws.read()).book.id,f.book.id);
});

test('failed evidence manifest commit retains staged chunks and retries from the exact original bytes',async t=>{
 const f=await fixture(t),materials=new ResearchMaterials(f.ws),bytes=Buffer.from('original opaque bytes'),session=await materials.startImport({recordId:f.book.entries[0].id,name:'capture.bin',size:bytes.length});
 await materials.appendImport(session.id,0,[bytes]);const query=Client.prototype.query;
 Client.prototype.query=async function(sql,...args){if(sql==='COMMIT')throw Error('Synthetic commit loss');return query.call(this,sql,...args);};
 try{await assert.rejects(materials.finishImport(session.id),/Synthetic commit loss/);}finally{Client.prototype.query=query;}
 assert.equal((await materials.importState(session.id)).completed,null);await access(path.join(f.root,'.observanda/materials/imports',session.id,'0.chunk'));
 const ref=await materials.finishImport(session.id);assert.deepEqual(await contentBuffer((await materials.artifact(ref)).content),bytes);
 await assert.rejects(access(path.join(f.root,'.observanda/materials/imports',session.id,'0.chunk')),{code:'ENOENT'});
});


test('metadata listings detect missing rows and a missing authenticated index before hiding drafts or writing replacements',async t=>{
 const f=await fixture(t),relative='.observanda/drafts/'+randomUUID()+'.json';
 await f.ws.withLock(()=>f.ws.writeMetadata(relative,'private draft'));
 const db=await openCatalogue(f.root);
 try{
  const row=await db.get('SELECT payload FROM objects WHERE id=$1','metadata:'+relative);
  await db.run('DELETE FROM objects WHERE id=$1','metadata:'+relative);
  await assert.rejects(f.ws.listMetadata('.observanda/drafts'),{code:'CATALOGUE_DAMAGED'});
  await db.run('INSERT INTO objects VALUES ($1,$2)','metadata:'+relative,row.payload);
  await db.run("DELETE FROM state WHERE slot='objects'");
  await assert.rejects(f.ws.listMetadata('.observanda/drafts'),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(f.ws.withLock(()=>f.ws.writeMetadata('.observanda/replacement.json','must not replace the index')),{code:'CATALOGUE_DAMAGED'});
  assert.ok(await db.get('SELECT 1 FROM objects WHERE id=$1','metadata:'+relative));
  assert.equal(await db.get('SELECT 1 FROM objects WHERE id=$1','metadata:.observanda/replacement.json'),undefined);
 }finally{await db.close();}
});

test('calculation engine revisions remain reproducible after exact upgrade, copy and fresh-key recovery',async t=>{
 const {ModuleHistory}=await import('../src/modules/history.js'),{calculate,spreadsheet}=await import('../src/tools/math.js');
 const f=await fixture(t),id=randomUUID(),legacy={name:'Pinned arithmetic',links:[],engine:1,mode:'expression',angle:'rad',expression:'1/3',digits:'',fromBase:10,toBase:6};
 const first=f.command('calculation.save',{id,expectedRevision:null,data:legacy});await f.store.execute(first);
 const second=f.command('calculation.save',{id,expectedRevision:1,data:{...legacy,engine:2}});await f.store.execute(second);
 const sheet=f.command('sheet.save',{id:randomUUID(),expectedRevision:null,data:{name:'Dependent exact values',links:[],engine:2,cells:[['=1/3','=A1*3'],['=1e100+1','=A2-1e100']],original:null}});await f.store.execute(sheet);
 const backup=await copyWorkspace(await copyPlan(f.root,path.join(f.parent,'copy')),{vault:f.vault});
 const access=await createAccess('','separate synthetic arithmetic password'),key=takeCreatedVault(access);t.after(()=>clearVault(key));
 const rekeyed=await encryptedCopy(await copyPlan(f.root,path.join(f.parent,'rekeyed')),access,key,f.vault);
 for(const [root,vault] of [[f.root,f.vault],[backup,f.vault],[rekeyed,key]]){
  const ws=new Workspace(root,vault),store=workspaceModules(ws),history=new ModuleHistory(ws);
  const previous=(await history.read({id,revision:1})).entity.data,current=(await history.read({id,revision:2})).entity.data;
  assert.deepEqual(previous,legacy);assert.deepEqual(current,{...legacy,engine:2});
  assert.equal(calculate(previous.expression,previous),'0.33333333333333333333333333333333');assert.equal(calculate(current.expression,current),'1/3');
  const restored=(await new ModuleHistory(ws).read({id:sheet.payload.id,revision:1})).entity.data,result=spreadsheet(restored.cells,restored);
  assert.equal(result[0][1].value,'1');assert.equal(result[1][1].value,'1');assert.equal((await store.execute(second)).replayed,true);
 }
});
