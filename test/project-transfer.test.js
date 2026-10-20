import {ProjectCopies} from '../src/project-copy.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat,mkdir,writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {ProjectMoves} from '../src/project-move.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {Workspace,serialize} from '../src/storage.js';
import {initializeLocation} from '../src/locations.js';
import {copyProjectLocation,projectTransferReceipt} from '../src/project-transfer.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {RecordWriting} from '../src/record-writing.js';
import {RecordHistory} from '../src/record-history.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from '../src/postgres-activation.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-project-transfer-')),book=sampleNotebook(),id=book.projects[0].id,device=new TestDeviceStore({file:path.join(root,'device')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);
 const owner=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await owner.close();detach();clearVault(vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-project-transfer-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 book.title=book.projects[0].title='source';
 const source=await initializeProjectLocation(path.join(root,'source'),id,book,access,vault),target={workspaceId:book.id,recordId:book.entries[0].id,sectionId:null};
 const first=await new RecordWriting(source).read(target);await new RecordWriting(source).save({...target,expectedRevision:first.revision,value:{body:'Retained project writing'}});
 await source.writeFile(path.join(source.root,'.observanda/custom-evidence.bin'),'Original project bytes '.repeat(50000));
 return {root,book,id,owner,vault,access,source,target};
}
async function destinationFor(f,name){const parent=path.join(f.root,name);await mkdir(parent,{recursive:true});return path.join(parent,path.basename(f.source.root));}

test('project copy streams a complete portable owner without creating a database archive',async t=>{
 const f=await fixture(t),id=randomUUID(),destination=await destinationFor(f,'copy'),before=await f.source.read(),history=await new RecordHistory(f.source,{}).list({workspaceId:f.book.id,recordId:f.target.recordId});
 const copied=await copyProjectLocation(f.source,destination,{id});assert.ok(copied instanceof ProjectStorage);assert.deepEqual(await copied.read(),before);
 const copiedHistory=await new RecordHistory(copied,{}).list({workspaceId:f.book.id,recordId:f.target.recordId});assert.deepEqual({...copiedHistory,cursor:null},{...history,cursor:null});
 assert.deepEqual(await readFile(path.join(destination,'.observanda/custom-evidence.bin')),await readFile(path.join(f.source.root,'.observanda/custom-evidence.bin')));
 assert.equal((await catalogueBinding(destination)).placement,'project');assert.notEqual((await catalogueBinding(destination)).id,(await catalogueBinding(f.source.root)).id);
 for(const location of [destination,f.source.root])await assert.rejects(stat(path.join(location,CATALOGUE_ARCHIVE)),{code:'ENOENT'});
 await f.owner.closeProject(destination);assert.deepEqual(await new ProjectStorage(destination,f.id,f.vault).read(),before);
 const writing=new RecordWriting(copied),current=await writing.read(f.target);await writing.save({...f.target,expectedRevision:current.revision,value:{body:'Only the copied project changed'}});
 assert.equal((await new RecordWriting(await copyProjectLocation(f.source,destination,{id})).read(f.target)).value.body,'Only the copied project changed');assert.deepEqual(await f.source.read(),before);
});
test('interrupted project copies resume their claimed destination and reject unrelated roots',async t=>{
 const f=await fixture(t),id=randomUUID(),destination=await destinationFor(f,'resumed');let stopped=false;
 await assert.rejects(copyProjectLocation(f.source,destination,{id,checkpoint:async stage=>{if(stage==='files'&&!stopped){stopped=true;throw Error('Interrupted after files');}}}),/Interrupted after files/);
 await assert.rejects(new ProjectStorage(destination,f.id,f.vault).outline(),{code:'STORAGE_INCOMPLETE'});
 await assert.rejects(copyProjectLocation(f.source,destination,{id:randomUUID()}),{code:'CONFLICT'});
 const legacyTarget=new ProjectStorage(destination,f.id,f.vault),legacy=await projectTransferReceipt(legacyTarget);legacy.version=1;delete legacy.boundaries;await legacyTarget.writeFile(path.join(destination,'.observanda/project-transfer.observanda'),serialize(legacy));
 const copied=await copyProjectLocation(f.source,destination,{id,checkpoint:async stage=>{if(stage==='database')throw Error('Interrupted after database');}}).then(()=>assert.fail('Expected interruption'),error=>{assert.match(error.message,/Interrupted after database/);return null;});assert.equal(copied,null);
 await f.owner.closeProject(destination);const resumed=await copyProjectLocation(f.source,destination,{id});assert.deepEqual(await resumed.read(),await f.source.read());
 await assert.rejects(copyProjectLocation(f.source,f.source.root,{id:randomUUID()}),{code:'STORAGE_PATH'});
});

async function registryFor(f){
 const root=path.join(f.root,'registry'),book=sampleNotebook();book.title='registry';book.projects=[];book.notebooks=[];book.entries=[];
 await initializeLocation(root,book,f.access,f.vault);
 const registry=new ProjectRegistry(new Workspace(root,f.vault),book.id);await registry.attach(f.source,{expected:'new'});return registry;
}
test('moving a project adopts its portable database and removes only its original owner',async t=>{
 const f=await fixture(t),registry=await registryFor(f),moves=new ProjectMoves(registry),id=randomUUID(),destination=await destinationFor(f,'moved'),before=await f.source.read();
 const result=await moves.run(f.id,f.vault,{id,path:destination});assert.equal(result.phase,'complete');assert.equal((await registry.locate(f.id)).root,destination);
 await assert.rejects(stat(f.source.root),{code:'ENOENT'});await assert.rejects(stat(path.join(f.root,'.observanda-project-move-'+id)),{code:'ENOENT'});
 const target=new ProjectStorage(destination,f.id,f.vault);assert.deepEqual(await target.read(),before);
 await f.owner.closeProject(destination);assert.deepEqual(await target.read(),before);
 assert.deepEqual(await moves.run(f.id,f.vault,{id,resume:true}),result);
});
test('move recovery finishes adoption and cleanup without deleting a reused source path',async t=>{
 const f=await fixture(t),registry=await registryFor(f),moves=new ProjectMoves(registry),before=await f.source.read();
 for(const [index,stage] of ['verified','frozen','registry','renamed','removed'].entries()){
  const id=randomUUID(),destination=await destinationFor(f,'recovery-'+index),source=(await registry.locate(f.id)).root;
  await assert.rejects(moves.run(f.id,f.vault,{id,path:destination,checkpoint:async point=>{if(point===stage)throw Error('Stop '+stage);}}),new RegExp('Stop '+stage));
  assert.notEqual((await moves.status(f.id)).phase,'complete');
  if(['renamed','removed'].includes(stage)){await mkdir(source);await writeFile(path.join(source,'unrelated.txt'),'Keep this replacement folder');}
  assert.equal((await moves.run(f.id,f.vault,{id,resume:true})).phase,'complete');
  assert.equal((await registry.locate(f.id)).root,destination);assert.deepEqual(await new ProjectStorage(destination,f.id,f.vault).read(),before);
  if(['renamed','removed'].includes(stage))assert.equal(await readFile(path.join(source,'unrelated.txt'),'utf8'),'Keep this replacement folder');
 }
});
async function legacyPendingMove(f,moves,id,destination){
 await mkdir(path.dirname(moves.file(f.id)),{recursive:true});const sourceId=(await catalogueBinding(f.source.root)).id;await moves.save({version:2,boundaries:[],id,projectId:f.id,source:f.source.root,destination,vaultId:f.vault.id,namespaceId:(await f.source.outline()).metadata.id,sourceId,phase:'copying'});
}
test('a changed original refreshes the unpublished destination before move retirement',async t=>{
 const f=await fixture(t),registry=await registryFor(f),moves=new ProjectMoves(registry),id=randomUUID(),destination=await destinationFor(f,'stale');await legacyPendingMove(f,moves,id,destination);
 await assert.rejects(moves.run(f.id,f.vault,{id,path:destination,checkpoint:async stage=>{if(stage==='verified')throw Error('Stop before freezing');}}),/Stop before freezing/);
 // A draft/settings object does not change the research head.
 const before=(await f.source.outline()).etag;
 await f.source.withLock(()=>f.source.catalogue(store=>store.putObject('metadata:preferences/test.json',{text:'New preference'})));
 assert.equal((await f.source.outline()).etag,before);
 assert.equal((await moves.run(f.id,f.vault,{id,resume:true})).phase,'complete');
 assert.equal((await registry.locate(f.id)).root,destination);await assert.rejects(stat(f.source.root),{code:'ENOENT'});
 assert.deepEqual(await new ProjectStorage(destination,f.id,f.vault).catalogue(store=>store.object('metadata:preferences/test.json')),{text:'New preference'});
});

test('force termination during move adoption releases leases and recovers both project runtimes',async t=>{
 let child,exited,f,destination;
 t.after(async()=>{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}if(f&&destination)for(const root of [f.source.root,destination])await f.owner.environment(root,{projectId:f.id,vault:f.vault}).catch(()=>{});});
 f=await fixture(t);const registry=await registryFor(f),id=randomUUID();destination=await destinationFor(f,'terminated');const before=await f.source.read();await f.owner.closeProject(f.source.root);
 const {spawn}=await import('node:child_process');
 const script=`import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {Workspace} from './src/storage.js';import {ProjectRegistry} from './src/project-registry.js';import {ProjectMoves} from './src/project-move.js';let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw),vault={id:input.vault.id,key:Buffer.from(input.vault.key,'base64')},owner=new WorkspaceDatabases({directory:input.directory,ownerId:input.ownerId,env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});installDatabaseProvider(owner);const registry=new ProjectRegistry(new Workspace(input.registry,vault),input.workspaceId);await new ProjectMoves(registry).run(input.projectId,vault,{id:input.id,path:input.destination,checkpoint:async stage=>{if(stage==='frozen'){process.stdout.write('ready');await new Promise(()=>{});}}});`;
 child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});exited=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Move checkpoint timeout: '+errors)),60000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Move exited early: '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.stdin.end(JSON.stringify({directory:f.owner.directory,ownerId:f.owner.instances.ownerId,registry:registry.workspace.root,workspaceId:registry.workspaceId,projectId:f.id,id,destination,vault:{id:f.vault.id,key:f.vault.key.toString('base64')}}));});
 child.kill('SIGKILL');await exited;
 assert.equal((await new ProjectMoves(registry).status(f.id)).running,false);
 assert.equal((await new ProjectMoves(registry).run(f.id,f.vault,{id,resume:true})).phase,'complete');
 const moved=new ProjectStorage(destination,f.id,f.vault);assert.deepEqual(await moved.read(),before);const writing=new RecordWriting(moved),current=await writing.read(f.target);await writing.save({...f.target,expectedRevision:current.revision,value:{body:'Writable after force termination'}});assert.equal((await writing.read(f.target)).value.body,'Writable after force termination');
});


test('interrupted copy and move commands cannot overlap or replay against an old project location',async t=>{
 const f=await fixture(t),registry=await registryFor(f),copies=new ProjectCopies(registry),moves=new ProjectMoves(registry),copyId=randomUUID(),moveId=randomUUID(),copyRoot=await destinationFor(f,'lifecycle-copy'),moveRoot=await destinationFor(f,'lifecycle-move');
 await assert.rejects(copies.run(f.source,{id:copyId,path:copyRoot,checkpoint:async stage=>{if(stage==='files')throw Error('Interrupted copy');}}),/Interrupted copy/);
 await assert.rejects(moves.run(f.id,f.vault,{id:moveId,path:moveRoot}),{code:'STORAGE_PROJECT_BUSY'});await assert.rejects(stat(moveRoot),{code:'ENOENT'});
 assert.equal((await copies.run(f.source,{id:copyId,resume:true})).phase,'complete');
 await assert.rejects(moves.run(f.id,f.vault,{id:moveId,path:moveRoot,checkpoint:async stage=>{if(stage==='copy:files')throw Error('Interrupted move');}}),/Interrupted move/);
 const anotherCopy=path.join(f.root,'must-not-copy');await assert.rejects(copies.run(f.source,{id:randomUUID(),path:anotherCopy}),{code:'STORAGE_PROJECT_BUSY'});await assert.rejects(stat(anotherCopy),{code:'ENOENT'});
 assert.equal((await moves.run(f.id,f.vault,{id:moveId,resume:true})).phase,'complete');
 await assert.rejects(copies.run(f.source,{id:randomUUID(),path:anotherCopy}),{code:'CONFLICT'});assert.equal((await copies.read(f.id)).id,copyId);await assert.rejects(stat(anotherCopy),{code:'ENOENT'});
 assert.deepEqual(await new ProjectStorage(moveRoot,f.id,f.vault).read(),await new ProjectStorage(copyRoot,f.id,f.vault).read());
});


test('an interrupted file batch reconciles newer files and writing without repeating unchanged bytes',async t=>{
 const f=await fixture(t),id=randomUUID(),destination=await destinationFor(f,'changed copy'),drop=path.join(f.source.root,'.observanda/drop.bin'),change=path.join(f.source.root,'.observanda/change.bin');
 await f.source.writeFile(drop,'Remove after interrupted copy');await f.source.writeFile(change,'Old bytes');
 await assert.rejects(copyProjectLocation(f.source,destination,{id,checkpoint:async stage=>{if(stage==='file-receipt')throw Error('Interrupted batch');}}),/Interrupted batch/);
 const writing=new RecordWriting(f.source),prior=await writing.read(f.target);await writing.save({...f.target,expectedRevision:prior.revision,value:{body:'New source record'}});
 await unlink(drop);await f.source.writeFile(change,'Current bytes');await f.source.writeFile(path.join(f.source.root,'.observanda/new.bin'),'New file');
 const copied=await copyProjectLocation(f.source,destination,{id});assert.equal((await new RecordWriting(copied).read(f.target)).value.body,'New source record');
 assert.equal(await copied.readFile(path.join(destination,'.observanda/change.bin'),'utf8'),'Current bytes');await assert.rejects(stat(path.join(destination,'.observanda/drop.bin')),{code:'ENOENT'});
 assert.equal(await copied.readFile(path.join(destination,'.observanda/new.bin'),'utf8'),'New file');
});

test('changed-source recovery preserves independently edited destination data',async t=>{
 const f=await fixture(t),registry=await registryFor(f),moves=new ProjectMoves(registry),id=randomUUID(),destination=await destinationFor(f,'edited destination');await legacyPendingMove(f,moves,id,destination);
 await assert.rejects(moves.run(f.id,f.vault,{id,path:destination,checkpoint:async stage=>{if(stage==='verified')throw Error('Before adoption');}}),/Before adoption/);
 const target=new ProjectStorage(destination,f.id,f.vault),writing=new RecordWriting(target),before=await writing.read(f.target);await writing.save({...f.target,expectedRevision:before.revision,value:{body:'Independent destination observation'}});
 await assert.rejects(moves.run(f.id,f.vault,{id,resume:true}),{code:'CONFLICT'});
 assert.equal((await new RecordWriting(target).read(f.target)).value.body,'Independent destination observation');assert.equal((await registry.locate(f.id)).root,f.source.root);assert.ok(await stat(f.source.root));
});

test('changed-source recovery survives interruption after the replacement database commits',async t=>{
 const f=await fixture(t),id=randomUUID(),destination=await destinationFor(f,'replacement commit');
 await assert.rejects(copyProjectLocation(f.source,destination,{id,checkpoint:async stage=>{if(stage==='database')throw Error('First database');}}),/First database/);
 const unchanged=path.join(destination,'.observanda/custom-evidence.bin'),stamp=await stat(unchanged);
 const writing=new RecordWriting(f.source),prior=await writing.read(f.target);await writing.save({...f.target,expectedRevision:prior.revision,value:{body:'Latest source observation'}});
 await assert.rejects(copyProjectLocation(f.source,destination,{id,checkpoint:async stage=>{if(stage==='database-committed')throw Error('Committed replacement');}}),/Committed replacement/);
 const copied=await copyProjectLocation(f.source,destination,{id});assert.equal((await new RecordWriting(copied).read(f.target)).value.body,'Latest source observation');assert.deepEqual(await copied.read(),await f.source.read());assert.equal((await stat(unchanged)).mtimeMs,stamp.mtimeMs);assert.equal((await stat(unchanged)).ino,stamp.ino);
});
