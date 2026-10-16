import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {mkdtemp,rm,rename,mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {ProjectDomains} from '../src/project-domains.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {workspaceModules} from '../src/modules/index.js';
import {executeModuleCommand} from '../src/modules/command.js';
import {moduleCommandFingerprint} from '../src/modules/command-fingerprint.js';
const detached=AsyncLocalStorage.snapshot();
async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-project-domains-')),vaults=[];
 const runtime=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime);
 t.after(async()=>{await runtime.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-project-domains-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook(),projectId=book.projects[0].id,access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(root,'device')})),vault=takeCreatedVault(access);vaults.push(vault);
 book.title=book.projects[0].title='project';
 const storage=await initializeProjectLocation(path.join(root,'project'),projectId,book,access,vault),domains=new ProjectDomains(storage,book.id);
 return {root,runtime,book,projectId,access,vault,storage,domains};
}
const calculation=f=>({workspaceId:f.book.id,commandId:randomUUID(),action:'calculation.save',payload:{id:randomUUID(),expectedRevision:null,data:{name:'Independent calculation',links:[],engine:1,mode:'expression',angle:'rad',expression:'2+3',digits:'',fromBase:10,toBase:16}}});
const calendar=f=>({workspaceId:f.book.id,commandId:randomUUID(),action:'calendar.save',payload:{id:randomUUID(),expectedRevision:null,data:{name:'Independent calendar',projectId:f.projectId,color:'#123456',archived:false}}});
async function command(f,domain,value){return f.domains.run([domain],get=>executeModuleCommand(workspaceModules(f.storage),get(domain),{book:f.book},value,moduleCommandFingerprint(value),{compact:true}),{write:[domain]});}
function gate(){let enter,release;return {started:new Promise(resolve=>enter=resolve),hold:new Promise(resolve=>release=resolve),enter:()=>enter(),release:()=>release()};}

test('project domains commit actual calculator and calendar commands independently of research and each other', {timeout:120000},async t=>{
 const f=await fixture(t);await f.domains.initialize(['calculator','calendars']);const original=await f.storage.read(),first=calculation(f),second=calculation(f),scheduled=calendar(f),research=gate();
 const researchWrite=detached(()=>f.storage.withLock(async()=>{research.enter();await research.hold;}));await research.started;
 try{const saved=await command(f,'calculator',first);assert.equal(saved.modulePatch.revision,1);assert.equal(saved.replayed,false);}
 finally{research.release();await researchWrite;}
 const calculator=gate(),calculatorWrite=detached(()=>f.domains.run(['calculator'],async get=>{
  await executeModuleCommand(workspaceModules(f.storage),get('calculator'),{book:f.book},second,moduleCommandFingerprint(second),{compact:true});calculator.enter();await calculator.hold;
 },{write:['calculator']}));await calculator.started;
 try{
  assert.equal((await command(f,'calendars',scheduled)).modulePatch.revision,1);
  await assert.rejects(command(f,'calculator',calculation(f)),{code:'LOCKED'});
  await f.domains.run(['calculator'],async get=>{const owner=new ModuleCatalogue(get('calculator')),head=await owner.head(f.book.id);assert.equal(head.revision,1);assert.equal(await owner.selected(head,second.payload.id),null);});
 }finally{calculator.release();await calculatorWrite;}
 const replay=await command(f,'calculator',first);assert.equal(replay.replayed,true);assert.equal(replay.modulePatch.revision,2);
 await assert.rejects(command(f,'calculator',{...first,payload:{...first.payload,data:{...first.payload.data,name:'Changed retry'}}}),{code:'MODULE_REPLAY'});
 assert.deepEqual(await f.storage.read(),original);
 await f.storage.catalogue(async store=>assert.equal((await new ModuleCatalogue(store).head(f.book.id)).revision,0));
 await f.domains.run(['calculator','calendars'],async get=>{
  for(const domain of ['calculator','calendars']){const store=get(domain);await workspaceModules(f.storage).verifyCatalogue(store,f.book.id);const names=(await store.db.all('SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname=$1',store.db.schema)).map(r=>r.tablename);assert.deepEqual(names.sort(),['domain_format','module_entities','module_events','objects','state']);}
 });
 await f.runtime.closeProject(f.storage.root);const moved=path.join(f.root,'relocated');await rename(f.storage.root,moved);f.storage=new ProjectStorage(moved,f.projectId,f.vault);f.domains=new ProjectDomains(f.storage,f.book.id);
 assert.equal((await command(f,'calculator',first)).replayed,true);assert.deepEqual(await f.storage.read(),original);
});

test('declared domain participants commit together and reject undeclared or read-only mutations', {timeout:120000},async t=>{
 const f=await fixture(t);await f.domains.initialize(['calculator','calendars']);
 await assert.rejects(f.domains.run(['calculator','calendars'],async get=>{
  await Promise.all(['calculator','calendars'].map(domain=>get(domain).putObject('probe',{domain,sequence:1})));
  throw new Error('interrupt before commit');
 },{write:['calculator','calendars']}),/interrupt before commit/);
 await f.domains.run(['calculator','calendars'],async get=>{for(const domain of ['calculator','calendars'])assert.equal(await get(domain).object('probe'),null);assert.throws(()=>get('inventory'),{code:'INVALID'});});
 await f.domains.run(['calculator','calendars'],get=>Promise.all(['calculator','calendars'].map(domain=>get(domain).putObject('probe',{domain,sequence:2}))),{write:['calendars','calculator']});
 await f.domains.run(['calculator','calendars'],async get=>{
  assert.deepEqual(await Promise.all(['calculator','calendars'].map(domain=>get(domain).object('probe'))),[{domain:'calculator',sequence:2},{domain:'calendars',sequence:2}]);
  await assert.rejects(get('calendars').putObject('probe',{}),{code:'INVALID'});
 },{write:['calculator']});
 await assert.rejects(command(f,'calculator',calendar(f)),{code:'MODULE_FORMAT'});
 await f.domains.run(['calendars'],async get=>assert.equal((await new ModuleCatalogue(get('calendars')).head(f.book.id)).revision,0));
 // Cursor declarations keep their schema even while another domain is queried.
 await f.domains.run(['calculator','calendars'],async get=>{
  for await(const row of get('calculator').db.rows('SELECT id,payload FROM objects ORDER BY id',[],{batchSize:1})){
   await get('calendars').object('probe');const value=get('calculator').decode('object',row.id,row.payload);assert.equal(value.domain,'calculator');
  }
 });
 let escaped;await f.domains.run(['calculator'],get=>{escaped=get('calculator');});assert.throws(()=>escaped.encode('object','probe',{}),{code:'ACCESS_LOCKED'});await assert.rejects(escaped.object('probe'),{code:'INVALID'});
});

test('domain ownership binds encrypted rows to feature, project and namespace', {timeout:120000},async t=>{
 const f=await fixture(t);await f.domains.initialize(['calculator','calendars']);
 await assert.rejects(new ProjectDomains(f.storage,randomUUID()).initialize(['calculator']),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(new ProjectDomains(new ProjectStorage(f.storage.root,randomUUID(),f.vault),f.book.id).initialize(['calculator']),{code:'DATABASE_LOCATION'});
 await assert.rejects(f.domains.run(['unregistered'],()=>{}),{code:'INVALID'});
 await assert.rejects(f.domains.run(['inventory'],()=>{}),{code:'CATALOGUE_UNAVAILABLE'});
 await f.domains.run(['calculator','calendars'],async get=>{
  const source=get('calculator'),other=get('calendars'),bytes=source.encode('object','probe',{secret:'private field'});
  assert.equal(bytes.includes(Buffer.from('private field')),false);
  assert.throws(()=>other.decode('object','probe',bytes));assert.throws(()=>source.decode('object','another-id',bytes));
 });
 // A corrupt owner descriptor never becomes an empty replacement domain.
 await f.domains.run(['calculator'],get=>get('calculator').putObject('owner',{version:1,projectId:randomUUID(),namespaceId:f.book.id,domain:'calculator',vaultId:f.vault.id}),{write:['calculator']});
 await assert.rejects(f.domains.initialize(['calculator']),{code:'CATALOGUE_DAMAGED'});
});


test('force-terminated and cancelled domain writes release locks without publishing partial state', {timeout:120000},async t=>{
 let child,exited; t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const f=await fixture(t);await f.domains.initialize(['calculator','calendars']);await command(f,'calculator',calculation(f));await f.runtime.closeProject(f.storage.root);
 const {spawn}=await import('node:child_process');
 const script=`import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {ProjectStorage} from './src/project-storage.js';import {ProjectDomains} from './src/project-domains.js';let raw='';for await(const bytes of process.stdin)raw+=bytes;const input=JSON.parse(raw),vault={id:input.vault.id,key:Buffer.from(input.vault.key,'base64')};const runtime=new WorkspaceDatabases({directory:input.directory,ownerId:input.ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(runtime);const domains=new ProjectDomains(new ProjectStorage(input.root,input.projectId,vault),input.namespaceId);await domains.run(['calculator','calendars'],async get=>{await get('calculator').putObject('uncommitted',{value:1});await get('calendars').putObject('uncommitted',{value:1});process.stdout.write('ready');await new Promise(()=>{});},{write:['calendars','calculator']});`;
 child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Domain checkpoint timeout: '+errors)),45000);
  child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Domain child exited early: '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});
  child.stdin.end(JSON.stringify({directory:f.runtime.directory,ownerId:f.runtime.instances.ownerId,root:f.storage.root,projectId:f.projectId,namespaceId:f.book.id,vault:{id:f.vault.id,key:f.vault.key.toString('base64')}}));
 });
 child.kill('SIGKILL');await exited;await f.runtime.environment(f.storage.root,{projectId:f.projectId,vault:f.vault});
 await f.domains.run(['calendars','calculator'],async get=>{for(const domain of ['calculator','calendars']){assert.equal(await get(domain).object('uncommitted'),null);await get(domain).putObject('recovered',{value:2});}},{write:['calendars','calculator']});
 const abort=new AbortController();
 await assert.rejects(f.domains.run(['calculator','calendars'],async get=>{await get('calculator').putObject('cancelled',{value:3});abort.abort(new Error('cancel command'));},{write:['calculator'],signal:abort.signal}),/cancel command/);
 await f.domains.run(['calculator'],async get=>{assert.equal(await get('calculator').object('cancelled'),null);assert.deepEqual(await get('calculator').object('recovered'),{value:2});assert.equal((await new ModuleCatalogue(get('calculator')).head(f.book.id)).revision,1);});
 assert.equal((await command(f,'calendars',calendar(f))).replayed,false);
});


test('independent module schemas survive archived and rekeyed project copies with full verification', {timeout:180000},async t=>{
 const f=await fixture(t);await f.domains.initialize(['calculator','calendars']);const saved=calculation(f),scheduled=calendar(f);await command(f,'calculator',saved);await command(f,'calendars',scheduled);
 const {workspaceFile,atomicWrite,serialize}=await import('../src/storage.js'),{backupCatalogue,CATALOGUE_ARCHIVE}=await import('../src/postgres.js'),{verifyCatalogueArchive,rekeyCatalogue}=await import('../src/research-catalogue.js'),{catalogueBinding}=await import('../src/postgres-activation.js');
 const descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8'),before=await f.storage.read();await verifyCatalogueArchive(f.storage,JSON.parse(descriptor));
 const copyRoot=path.join(f.root,'archive-copy');await mkdir(path.join(copyRoot,'.observanda'),{recursive:true});
 for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(copyRoot,file));
 const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,copyRoot,{connection:db});}finally{await db.close();}
 const header=JSON.parse((await readFile(path.join(copyRoot,CATALOGUE_ARCHIVE),'utf8')).split(String.fromCharCode(10))[0]);assert.deepEqual(header,{format:'observanda-postgresql-archive',version:4,catalogueVersion:22,domains:['calculator','calendars']});
 const copied=new ProjectStorage(copyRoot,f.projectId,f.vault);assert.deepEqual(await copied.read(),before);await verifyCatalogueArchive(copied,JSON.parse(descriptor));assert.notEqual((await catalogueBinding(copied.root)).id,(await catalogueBinding(f.storage.root)).id);
 const copyContext={...f,storage:copied,domains:new ProjectDomains(copied,f.book.id)};assert.equal((await command(copyContext,'calculator',saved)).replayed,true);assert.equal((await command(copyContext,'calendars',scheduled)).replayed,true);
 const access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(f.root,'fresh-device')})),vault=takeCreatedVault(access);
 try{
  const target=new ProjectStorage(path.join(f.root,'rekeyed'),f.projectId,vault);await mkdir(path.join(target.root,'.observanda'),{recursive:true});await atomicWrite(path.join(target.root,'.observanda/access.json'),serialize(access));await target.writeFile(await workspaceFile(target.root,{secure:true}),descriptor);
  await rekeyCatalogue(f.storage,target,JSON.parse(descriptor));await verifyCatalogueArchive(target,JSON.parse(descriptor));assert.deepEqual(await target.read(),before);
  const context={...f,storage:target,domains:new ProjectDomains(target,f.book.id)};assert.equal((await command(context,'calculator',saved)).replayed,true);
  const updated={...saved,commandId:randomUUID(),payload:{...saved.payload,expectedRevision:1,data:{...saved.payload.data,expression:'7*8'}}};await command(context,'calculator',updated);
  await f.domains.run(['calculator'],async get=>{const module=new ModuleCatalogue(get('calculator'));assert.equal((await module.selected(await module.head(f.book.id),saved.payload.id)).data.expression,'2+3');});
  await verifyCatalogueArchive(target,JSON.parse(descriptor));
 }finally{clearVault(vault);}
 // Missing complete domains and missing metadata rows are both corruption.
 await copyContext.domains.run(['calculator'],get=>get('calculator').db.run("DELETE FROM objects WHERE id='owner'"),{write:['calculator']});
 await assert.rejects(verifyCatalogueArchive(copied,JSON.parse(descriptor)),{code:'CATALOGUE_DAMAGED'});
 const {projectDomainSchema}=await import('../src/project-domain-schema.js'),damaged=await copied.openCatalogue();try{await damaged.run('DROP SCHEMA "'+projectDomainSchema(damaged.id,'calculator')+'" CASCADE');}finally{await damaged.close();}
 await assert.rejects(verifyCatalogueArchive(copied,JSON.parse(descriptor)),{code:'CATALOGUE_DAMAGED'});
 await verifyCatalogueArchive(f.storage,JSON.parse(descriptor));
});


test('project copy move and deletion fence module writes and carry retained domain history', {timeout:180000},async t=>{
 const f=await fixture(t);await f.domains.initialize(['calculator','calendars']);const saved=calculation(f);await command(f,'calculator',saved);await command(f,'calendars',calendar(f));
 const {copyProjectLocation}=await import('../src/project-transfer.js'),{ProjectRegistry}=await import('../src/project-registry.js'),{ProjectMoves}=await import('../src/project-move.js'),{ProjectDeletions}=await import('../src/project-deletion.js'),{Workspace}=await import('../src/storage.js'),{databaseRetention,validDatabaseRetention,verifyDatabaseRetention}=await import('../src/workspace-database-retention.js');
 const destination=path.join(f.root,'stream-copy'),copyId=randomUUID(),held=gate();
 const writer=detached(()=>f.domains.run(['calculator'],async get=>{await get('calculator').putObject('checkpoint',{value:1});held.enter();await held.hold;},{write:['calculator']}));await held.started;
 try{await assert.rejects(copyProjectLocation(f.storage,destination,{id:copyId}),{code:'LOCKED'});}
 finally{held.release();await writer;}
 const copied=await copyProjectLocation(f.storage,destination,{id:copyId}),copiedDomains=new ProjectDomains(copied,f.book.id);
 assert.equal((await command({...f,storage:copied,domains:copiedDomains},'calculator',saved)).replayed,true);
 await copiedDomains.run(['calculator'],async get=>assert.deepEqual(await get('calculator').object('checkpoint'),{value:1}));
 const proof=await f.storage.catalogue(store=>databaseRetention(store.db));assert.ok(validDatabaseRetention(proof));assert.equal(proof.domains.calculator.count,1);assert.equal(proof.domains.calendars.count,1);await verifyDatabaseRetention(copied,proof);
 const {initializeLocation}=await import('../src/locations.js'),registryRoot=path.join(f.root,'registry'),registryBook=sampleNotebook();await initializeLocation(registryRoot,registryBook,f.access,f.vault);const registry=new ProjectRegistry(new Workspace(registryRoot,f.vault),registryBook.id);await registry.attach(f.storage,{expected:'new'});
 const movedRoot=path.join(f.root,'moved-project'),moves=new ProjectMoves(registry),move=await moves.run(f.projectId,f.vault,{id:randomUUID(),path:movedRoot});assert.equal(move.phase,'complete');
 const moved=new ProjectStorage(movedRoot,f.projectId,f.vault),movedContext={...f,storage:moved,domains:new ProjectDomains(moved,f.book.id)};assert.equal((await command(movedContext,'calculator',saved)).replayed,true);await verifyDatabaseRetention(moved,proof);
 const deleting=new ProjectDeletions(registry,f.projectId),pending=gate(),pendingWriter=detached(()=>movedContext.domains.run(['calendars'],async get=>{await get('calendars').putObject('before-delete',{value:2});pending.enter();await pending.hold;},{write:['calendars']}));await pending.started;
 try{await assert.rejects(deleting.run(f.vault,{id:randomUUID(),expectedRoot:movedRoot}),{code:'LOCKED'});}
 finally{pending.release();await pendingWriter;}
 assert.equal((await deleting.run(f.vault,{id:randomUUID(),expectedRoot:movedRoot})).complete,true);
 assert.equal((await command({...f,storage:copied,domains:copiedDomains},'calculator',saved)).replayed,true);
 // A destination may add history, but cannot erase a source domain's events
 // while a pending move still relies on that retained-history proof.
 await copiedDomains.run(['calculator'],get=>get('calculator').db.run('DELETE FROM module_events'),{write:['calculator']});
 await assert.rejects(verifyDatabaseRetention(copied,proof,{verify:false}),{code:'STORAGE_COPY'});
});


test('damaged domain archives remain unpublished and restore cleanly on retry', {timeout:180000},async t=>{
 const f=await fixture(t);await f.domains.initialize(['calculator','calendars']);await command(f,'calculator',calculation(f));await command(f,'calendars',calendar(f));
 const {workspaceFile}=await import('../src/storage.js'),{backupCatalogue,CATALOGUE_ARCHIVE}=await import('../src/postgres.js'),{catalogueBinding}=await import('../src/postgres-activation.js');
 const archiveRoot=path.join(f.root,'archive');await mkdir(path.join(archiveRoot,'.observanda'),{recursive:true});const connection=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,archiveRoot,{connection});}finally{await connection.close();}
 const original=await readFile(path.join(archiveRoot,CATALOGUE_ARCHIVE),'utf8'),lines=original.trimEnd().split(String.fromCharCode(10)).map(line=>JSON.parse(line)),source=await f.storage.read();
 const withoutDomain=values=>{
  values[0].domains=['calculator'];const result=[values[0]];let skip=false,rows=0;
  for(const value of values.slice(1,-1)){if(value.table)skip=value.domain==='calendars';if(!skip){result.push(value);if(value.rowEnd)rows++;}if(value.rowEnd)skip=false;}
  const body=result.slice(1).map(value=>JSON.stringify(value)+String.fromCharCode(10)).join('');result.push({end:true,rows,digest:createHash('sha256').update(body).digest('hex')});return result;
 };
 const broken=[values=>{values[0].domains.push('invalid-owner');return values;},withoutDomain];
 for(let i=0;i<broken.length;i++){
  const root=path.join(f.root,'restore-'+i);await mkdir(path.join(root,'.observanda'),{recursive:true});for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(root,file));
  const file=path.join(root,CATALOGUE_ARCHIVE),values=broken[i](structuredClone(lines));await writeFile(file,values.map(value=>JSON.stringify(value)+String.fromCharCode(10)).join(''));
  const target=new ProjectStorage(root,f.projectId,f.vault);await assert.rejects(target.read(),{code:'CATALOGUE_DAMAGED'});assert.equal(await catalogueBinding(root),null);
  await writeFile(file,original);assert.deepEqual(await target.read(),source);
  await new ProjectDomains(target,f.book.id).run(['calculator','calendars'],async get=>{for(const domain of ['calculator','calendars'])assert.equal((await new ModuleCatalogue(get(domain)).head(f.book.id)).revision,1);});
 }
});


test('small module edits update authenticated size totals without scanning unrelated members', {timeout:120000},async t=>{
 const f=await fixture(t);await f.domains.initialize(['calculator']);const commands=Array.from({length:80},()=>calculation(f));
 await f.domains.run(['calculator'],async get=>{
  const store=get('calculator'),owner=workspaceModules(f.storage);
  for(const value of commands)await executeModuleCommand(owner,store,{book:f.book},value,moduleCommandFingerprint(value),{compact:true});
 },{write:['calculator']});
 const value={...commands[0],commandId:randomUUID(),payload:{...commands[0].payload,expectedRevision:1,data:{...commands[0].payload.data,name:'Changed once'}}},members=ModuleCatalogue.prototype.members;
 ModuleCatalogue.prototype.members=async function*(){throw Error('An ordinary edit scanned all members');};
 try{assert.equal((await command(f,'calculator',value)).modulePatch.revision,81);}
 finally{ModuleCatalogue.prototype.members=members;}
 await f.domains.run(['calculator'],async get=>{
  const store=get('calculator');await workspaceModules(f.storage).verifyCatalogue(store,f.book.id);
  // Simulate a valid older head that predates size totals. The first subsequent
  // edit establishes its total once; later edits take the bounded path again.
  const head=await new ModuleCatalogue(store).head(f.book.id);delete head.totalBytes;await store.db.run("UPDATE state SET payload=$1 WHERE slot='modules'",store.encode('state','modules',head));
 },{write:['calculator']});
 let scans=0;ModuleCatalogue.prototype.members=async function*(...args){scans++;yield* members.apply(this,args);};
 const next={...value,commandId:randomUUID(),payload:{...value.payload,expectedRevision:2,data:{...value.payload.data,name:'Upgrade old total'}}};
 try{await command(f,'calculator',next);assert.equal(scans,1);}
 finally{ModuleCatalogue.prototype.members=members;}
 await f.domains.run(['calculator'],async get=>{
  const store=get('calculator');await workspaceModules(f.storage).verifyCatalogue(store,f.book.id);const head=await new ModuleCatalogue(store).head(f.book.id);head.totalBytes++;
  await store.db.run("UPDATE state SET payload=$1 WHERE slot='modules'",store.encode('state','modules',head));
  await assert.rejects(workspaceModules(f.storage).verifyCatalogue(store,f.book.id),{code:'CATALOGUE_DAMAGED'});
  throw Error('roll back deliberate corruption');
 },{write:['calculator']}).then(()=>assert.fail('expected rollback'),error=>assert.match(error.message,/roll back deliberate corruption/));
 await f.domains.run(['calculator'],get=>workspaceModules(f.storage).verifyCatalogue(get('calculator'),f.book.id));
});
