import {ProjectDomainCatalogue} from '../src/project-domain-catalogue.js';
import {test} from 'node:test';
import {withOperationProgress} from '../src/operation-progress.js';
import {moduleDomains} from '../src/modules/domains.js';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fixture,calculation,calendar} from './project-domain-fixture.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {blankBOM,bomLine} from '../src/web/modules/bom-model.js';
import {ProjectModuleIdentities} from '../src/project-module-identities.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {moduleIdentityPrefix} from '../src/project-module-identities.js';
const detached=AsyncLocalStorage.snapshot();
function gate(){let enter,release;return {started:new Promise(resolve=>enter=resolve),hold:new Promise(resolve=>release=resolve),enter:()=>enter(),release:()=>release()};}
async function setup(t){const f=await fixture(t);f.commands=new ProjectModuleCommands(f.storage,f.book.id);await f.commands.initialize();return f;}
const descriptor=f=>({format:'observanda-research-catalogue',version:2,workspaceId:f.book.id});
async function verify(f){return f.storage.catalogue(store=>store.verify(descriptor(f)));}

test('domain command coordinator persists separate revisions, links and exact current replay', {timeout:120000},async t=>{
 const f=await setup(t),first=calculation(f),scheduled=calendar(f);
 const initial=await f.commands.execute(first);assert.equal(initial.revisions.calculator,1);assert.equal(initial.replayed,false);
 const next=await f.commands.execute({...first,commandId:randomUUID(),payload:{...first.payload,expectedRevision:1,data:{...first.payload.data,name:'Updated'}}});assert.equal(next.revisions.calculator,2);
 assert.equal((await f.commands.execute(scheduled)).revisions.calendars,1);
 const replay=await f.commands.execute(first);assert.equal(replay.replayed,true);assert.equal(replay.entities[0].data.name,'Updated');assert.equal(replay.revisions.calculator,2);
 await assert.rejects(f.commands.execute({...scheduled,commandId:first.commandId}),{code:'MODULE_REPLAY'});
 await assert.rejects(f.commands.execute({...scheduled,commandId:randomUUID(),payload:{...scheduled.payload,id:first.payload.id}}),{code:'MODULE_REFERENCE'});
 const linked=calculation(f);linked.payload.data.links=[{workspaceId:f.book.id,type:'calendar',id:scheduled.payload.id}];
 const saved=await f.commands.execute(linked);assert.equal(saved.revisions.calculator,3);assert.equal(saved.revisions.calendars,1);
 const missing=calculation(f);missing.payload.data.links=[{workspaceId:f.book.id,type:'calendar',id:randomUUID()}];await assert.rejects(f.commands.execute(missing),{code:'MODULE_REFERENCE'});
 await f.domains.run(['calculator','calendars'],async get=>{assert.equal((await new ModuleCatalogue(get('calculator')).head(f.book.id)).revision,3);assert.equal((await new ModuleCatalogue(get('calendars')).head(f.book.id)).revision,1);});
 const progress=[];await withOperationProgress(event=>progress.push(event),()=>verify(f));
 const metadata=progress.filter(e=>e.stage==='verify-domain-objects');assert.deepEqual(new Set(metadata.map(e=>e.item)),new Set(moduleDomains));
 for(const domain of moduleDomains){const events=metadata.filter(e=>e.item===domain);assert.equal(events[0].completed,0);assert.ok(events.every(e=>e.total===undefined||e.completed<=e.total));assert.equal(events.at(-1).completed,events.at(-1).total);}
});

test('domain commands run while unrelated research and calculator writers remain active', {timeout:120000},async t=>{
 const f=await setup(t),g=gate(),held=detached(()=>f.storage.withLock(async()=>{g.enter();await g.hold;}));await g.started;
 try{assert.equal((await f.commands.execute(calculation(f))).replayed,false);}finally{g.release();await held;}
 const c=gate(),writing=detached(()=>f.domains.run(['calculator'],async()=>{c.enter();await c.hold;},{write:['calculator']}));await c.started;
 try{assert.equal((await f.commands.execute(calendar(f))).replayed,false);await assert.rejects(f.commands.execute(calculation(f)),{code:'LOCKED'});}finally{c.release();await writing;}
 await verify(f);
});

test('missing identity routes and forged extra directory rows fail verification and retry', {timeout:120000},async t=>{
 const f=await setup(t),first=calculation(f);await f.commands.execute(first);
 const slot=moduleIdentityPrefix+'command:'+first.commandId;
 await assert.rejects(f.storage.withLock(()=>f.storage.catalogue(async store=>{await store.db.run('DELETE FROM state WHERE slot=$1',slot);await store.verify(descriptor(f));})),{code:'CATALOGUE_DAMAGED'});
 await f.storage.withLock(()=>f.storage.catalogue(async store=>{await store.db.run('DELETE FROM state WHERE slot=$1',slot);}));
 await assert.rejects(f.commands.execute(first),{code:'CATALOGUE_DAMAGED'});
});

test('extra identity routes cannot pass a full audit', {timeout:120000},async t=>{
 const f=await setup(t);await assert.rejects(f.storage.withLock(()=>f.storage.catalogue(async store=>{await store.db.run('INSERT INTO state VALUES ($1,$2)',moduleIdentityPrefix+'entity:'+randomUUID(),store.encode('state','junk',{}));await store.verify(descriptor(f));})),{code:'CATALOGUE_DAMAGED'});
});

test('BOM and inventory changes roll back together and replay complete participant receipts', {timeout:120000},async t=>{
 const f=await setup(t),id=randomUUID(),bomId=randomUUID(),line={...bomLine(),resourceId:id,value:'Resistor',quantity:'2'},cmd=(action,payload,commandId=randomUUID())=>({workspaceId:f.book.id,commandId,action,payload});
 await f.commands.execute(cmd('resource.create',{id,data:{projectId:null,placementId:null,name:'Parts',code:id,kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]},openingStock:{quantity:'10',projectId:null}}));
 await f.commands.execute(cmd('bom.save',{id:bomId,expectedRevision:null,data:{...blankBOM(),title:'Build',recordId:f.book.entries[0].id,lines:[line]}}));
 const get=async(domain,id)=>f.domains.run([domain],async access=>{const c=new ModuleCatalogue(access(domain));return c.selected(await c.head(f.book.id),id);});
 const resource=await get('inventory',id),reserve=cmd('bom.reserve',{id:bomId,expectedRevision:1,resources:[{id,revision:resource.revision}]}),original=ModuleCatalogue.prototype.writeChanges;
 let persistedFirst=false;
 ModuleCatalogue.prototype.writeChanges=async function(...args){if(this.store.domain==='inventory'){assert.ok(persistedFirst);throw new Error('isolated failure after first domain persisted');}const value=await original.apply(this,args);if(this.store.domain==='bom')persistedFirst=true;return value;};
 try{await assert.rejects(f.commands.execute(reserve),/isolated failure/);}finally{ModuleCatalogue.prototype.writeChanges=original;}
 assert.equal((await get('bom',bomId)).data.status,'draft');assert.equal((await get('inventory',id)).revision,resource.revision);await verify(f);
 const saved=await f.commands.execute(reserve);assert.equal(saved.revisions.bom,2);assert.equal(saved.revisions.inventory,2);assert.equal(saved.entities.filter(e=>e.type==='reservation').length,1);
 const replay=await f.commands.execute(reserve);assert.equal(replay.replayed,true);assert.deepEqual(new Set(replay.changedIds),new Set(saved.changedIds));
 const cancelled=await f.commands.execute(cmd('bom.cancel',{id:bomId,expectedRevision:2}));assert.equal(cancelled.revisions.bom,3);assert.equal(cancelled.revisions.inventory,3);
 const after=await f.commands.execute(reserve);assert.equal(after.entities.find(e=>e.type==='bom').data.status,'cancelled');assert.equal(after.entities.find(e=>e.type==='reservation').data.status,'released');await verify(f);
 // A truncated descriptor cannot acknowledge only one half of a command.
 await assert.rejects(f.storage.withLock(()=>f.storage.catalogue(async store=>{const slot=moduleIdentityPrefix+'command:'+reserve.commandId,row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),value=store.decode('state',slot,row.payload);value.fragments=value.fragments.filter(p=>p.domain==='bom');await store.db.run('UPDATE state SET payload=$2 WHERE slot=$1',slot,store.encode('state',slot,value));await store.verify(descriptor(f));})),{code:'CATALOGUE_DAMAGED'});
});

test('concurrent command identity collision commits once across otherwise independent owners', {timeout:120000},async t=>{
 const f=await setup(t),a=calculation(f),b={...calendar(f),commandId:a.commandId},original=ProjectModuleIdentities.prototype.claim,barrier=gate();let arrivals=0;
 ProjectModuleIdentities.prototype.claim=async function(kind,id,...args){if(kind==='command'&&id===a.commandId){if(++arrivals===2)barrier.release();await barrier.hold;}return original.call(this,kind,id,...args);};
 let results;try{results=await Promise.allSettled([f.commands.execute(a),f.commands.execute(b)]);}finally{ProjectModuleIdentities.prototype.claim=original;}
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.deepEqual(results.filter(r=>r.status==='rejected').map(r=>r.reason.code),['MODULE_REPLAY']);await verify(f);
});

test('domain receipt coordinator recovers a force-terminated command and a cancelled transaction', {timeout:120000},async t=>{
 let child,exited;t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const f=await setup(t),command=calculation(f);await f.runtime.closeProject(f.storage.root);const {spawn}=await import('node:child_process');
 const script=`import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {ProjectStorage} from './src/project-storage.js';import {ProjectModuleCommands} from './src/project-module-commands.js';import {ModuleCatalogue} from './src/modules/catalogue.js';let raw='';for await(const bytes of process.stdin)raw+=bytes;const input=JSON.parse(raw),vault={id:input.vault.id,key:Buffer.from(input.vault.key,'base64')};const runtime=new WorkspaceDatabases({directory:input.directory,ownerId:input.ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(runtime);const original=ModuleCatalogue.prototype.writeChanges;ModuleCatalogue.prototype.writeChanges=async function(...args){await original.apply(this,args);process.stdout.write('ready');await new Promise(()=>{});};const commands=new ProjectModuleCommands(new ProjectStorage(input.root,input.projectId,vault),input.command.workspaceId);await commands.execute(input.command);`;
 child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Command checkpoint timeout: '+errors)),45000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Command child exited early: '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.stdin.end(JSON.stringify({directory:f.runtime.directory,ownerId:f.runtime.instances.ownerId,root:f.storage.root,projectId:f.projectId,command,vault:{id:f.vault.id,key:f.vault.key.toString('base64')}}));});
 child.kill('SIGKILL');await exited;await f.runtime.environment(f.storage.root,{projectId:f.projectId,vault:f.vault});
 await verify(f);const saved=await f.commands.execute(command);assert.equal(saved.replayed,false);assert.equal(saved.revisions.calculator,1);
 const abort=new AbortController(),original=ModuleCatalogue.prototype.writeChanges;
 ModuleCatalogue.prototype.writeChanges=async function(...args){await original.apply(this,args);abort.abort(Error('isolated cancellation'));};
 const cancelled=calendar(f);try{await assert.rejects(f.commands.execute(cancelled,{signal:abort.signal}),/isolated cancellation/);}finally{ModuleCatalogue.prototype.writeChanges=original;}
 assert.equal((await f.commands.execute(cancelled)).replayed,false);await verify(f);
});

test('domain identity routes and receipts survive archive restoration and fresh-key project copies', {timeout:180000},async t=>{
 const f=await setup(t),command=calculation(f);await f.commands.execute(command);const {mkdir,copyFile}=await import('node:fs/promises'),path=await import('node:path');
 const {workspaceFile,atomicWrite,serialize}=await import('../src/storage.js'),{backupCatalogue}=await import('../src/postgres.js'),{verifyCatalogueArchive,rekeyCatalogue}=await import('../src/research-catalogue.js'),{ProjectStorage}=await import('../src/project-storage.js');
 const originalDescriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8'),copyRoot=path.join(f.root,'archived');await mkdir(path.join(copyRoot,'.observanda'),{recursive:true});
 for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(copyRoot,file));
 const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,copyRoot,{connection:db});}finally{await db.close();}
 const copied=new ProjectStorage(copyRoot,f.projectId,f.vault);await verifyCatalogueArchive(copied,JSON.parse(originalDescriptor));assert.equal((await new ProjectModuleCommands(copied,f.book.id).execute(command)).replayed,true);
 const {createWorkspaceAccess,takeCreatedVault}=await import('../src/access.js'),{TestDeviceStore}=await import('./device-fixture.js'),{clearVault}=await import('../src/encryption.js');
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'new-device')})),vault=takeCreatedVault(access);
 try{const target=new ProjectStorage(path.join(f.root,'rekeyed'),f.projectId,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),originalDescriptor);
  await rekeyCatalogue(f.storage,target,JSON.parse(originalDescriptor));await verifyCatalogueArchive(target,JSON.parse(originalDescriptor));assert.equal((await new ProjectModuleCommands(target,f.book.id).execute(command)).replayed,true);
 }finally{clearVault(vault);}
 await verify(f);
});


test('credentials revoked after domain writes roll back every receipt and original before commit', {timeout:120000},async t=>{
 const f=await setup(t),command=calculation(f);let checks=0;
 await assert.rejects(f.commands.execute(command,{check:async()=>{if(++checks===2)throw Object.assign(Error('Access revoked before commit'),{code:'ACCESS_LOCKED'});}}),{code:'ACCESS_LOCKED'});
 assert.equal(checks,2);await verify(f);
 const saved=await f.commands.execute(command);assert.equal(saved.replayed,false);assert.equal(saved.revisions.calculator,1);assert.deepEqual(saved.changedIds,[command.payload.id]);await verify(f);
});

test('new identities use indexed probes without decrypting unrelated owners', {timeout:120000},async t=>{
 const f=await setup(t),decode=ProjectDomainCatalogue.prototype.decode,opened=new Set();
 t.mock.method(ProjectDomainCatalogue.prototype,'decode',function(...args){opened.add(this.domain);assert.equal(this.domain,'calculator');return decode.apply(this,args);});
 const command=calculation(f);await f.commands.execute(command);assert.deepEqual([...opened],['calculator']);t.mock.restoreAll();
 // A lost route and original must still be detected from retained membership.
 await f.storage.withLock(()=>f.storage.catalogue(store=>store.db.run('DELETE FROM state WHERE slot=$1',moduleIdentityPrefix+'entity:'+command.payload.id)));
 await f.domains.run(['calculator'],get=>get('calculator').db.run('DELETE FROM module_entities WHERE id=$1',command.payload.id),{write:['calculator']});
 await assert.rejects(f.commands.execute({...command,commandId:randomUUID()}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(verify(f),{code:'CATALOGUE_DAMAGED'});
});
