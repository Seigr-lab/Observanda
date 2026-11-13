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

async function fixture(t,{registered=false}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-project-transfer-')),book=sampleNotebook(),id=book.projects[0].id,device=new TestDeviceStore({file:path.join(root,'device')}),access=await createWorkspaceAccess('','',device),vault=takeCreatedVault(access);
 const owner=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await owner.close();detach();await clearVault(vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-project-transfer-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 book.title=book.projects[0].title='source';
 // Every project lives inside an open workspace and uses its cluster; only a
 // registered fixture also lists the project in that workspace's directory.
 const workspaceRoot=path.join(root,'registry'),workspaceBook=sampleNotebook();workspaceBook.title='registry';workspaceBook.projects=[];workspaceBook.notebooks=[];workspaceBook.entries=[];await initializeLocation(workspaceRoot,workspaceBook,access,vault);const workspace=new Workspace(workspaceRoot,vault);await workspace.outline();
 const registry=registered?new ProjectRegistry(workspace,workspaceBook.id):null;
 const source=await initializeProjectLocation(path.join(workspaceRoot,'source'),id,book,access,vault),target={workspaceId:book.id,recordId:book.entries[0].id,sectionId:null};
 const first=await new RecordWriting(source).read(target);await new RecordWriting(source).save({...target,expectedRevision:first.revision,value:{body:'Retained project writing'}});
 await source.writeFile(path.join(source.root,'.observanda/custom-evidence.bin'),'Original project bytes '.repeat(50000));
 if(registry)await registry.attach(source,{expected:'new'});
 return {root,book,id,owner,vault,access,source,target,registry,workspace};
}
// A copy inside the workspace is a live owner in its cluster; a destination
// outside every workspace is only ever named by a refused move.
async function destinationFor(f,name){const parent=path.join(f.workspace.root,name);await mkdir(parent,{recursive:true});return path.join(parent,path.basename(f.source.root));}
async function outsideFor(f,name){const parent=path.join(f.root,name);await mkdir(parent,{recursive:true});return path.join(parent,path.basename(f.source.root));}

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

async function legacyPendingMove(f,moves,id,destination){
 await mkdir(path.dirname(moves.file(f.id)),{recursive:true});const sourceId=(await catalogueBinding(f.source.root)).id;const value={version:2,boundaries:[],id,projectId:f.id,source:f.source.root,destination,vaultId:f.vault.id,namespaceId:(await f.source.outline()).metadata.id,sourceId,phase:'copying'};await moves.save(value);return value;
}
test('a project is never moved out of its workspace and an earlier unfinished outside move is refused unchanged',async t=>{
 const f=await fixture(t,{registered:true}),registry=f.registry,moves=new ProjectMoves(registry),before=await f.source.read(),revision=(await registry.read()).revision,destination=await outsideFor(f,'moved');
 await assert.rejects(moves.run(f.id,f.vault,{id:randomUUID(),path:destination}),error=>error.code==='STORAGE_OUTSIDE_WORKSPACE'&&error.operationNotStarted===true);
 assert.equal(await moves.status(f.id),null);await assert.rejects(stat(destination),{code:'ENOENT'});assert.equal((await registry.read()).revision,revision);assert.equal((await registry.locate(f.id)).root,f.source.root);
 // A move out begun by an earlier version is not resumed: it stays recorded
 // as it was, and the project stays usable at its folder inside the workspace.
 const id=randomUUID(),saved=await legacyPendingMove(f,moves,id,destination);
 await assert.rejects(moves.run(f.id,f.vault,{id,resume:true}),error=>error.code==='STORAGE_OUTSIDE_WORKSPACE'&&error.operationNotStarted===false);
 assert.deepEqual(await moves.read(f.id),saved);await assert.rejects(stat(destination),{code:'ENOENT'});assert.equal((await registry.locate(f.id)).root,f.source.root);assert.deepEqual(await f.source.read(),before);
});


test('an interrupted project copy resumes its destination while a move out of the workspace stays refused',async t=>{
 const f=await fixture(t,{registered:true}),registry=f.registry,copies=new ProjectCopies(registry),moves=new ProjectMoves(registry),copyId=randomUUID(),copyRoot=await destinationFor(f,'lifecycle-copy'),moveRoot=await outsideFor(f,'lifecycle-move');
 await assert.rejects(copies.run(f.source,{id:copyId,path:copyRoot,checkpoint:async stage=>{if(stage==='files')throw Error('Interrupted copy');}}),/Interrupted copy/);
 await assert.rejects(moves.run(f.id,f.vault,{id:randomUUID(),path:moveRoot}),{code:'STORAGE_PROJECT_BUSY'});await assert.rejects(stat(moveRoot),{code:'ENOENT'});
 assert.equal((await copies.run(f.source,{id:copyId,resume:true})).phase,'complete');
 await assert.rejects(moves.run(f.id,f.vault,{id:randomUUID(),path:moveRoot}),{code:'STORAGE_OUTSIDE_WORKSPACE'});await assert.rejects(stat(moveRoot),{code:'ENOENT'});
 assert.equal((await registry.locate(f.id)).root,f.source.root);assert.deepEqual(await new ProjectStorage(copyRoot,f.id,f.vault).read(),await f.source.read());
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


test('changed-source recovery survives interruption after the replacement database commits',async t=>{
 const f=await fixture(t),id=randomUUID(),destination=await destinationFor(f,'replacement commit');
 await assert.rejects(copyProjectLocation(f.source,destination,{id,checkpoint:async stage=>{if(stage==='database')throw Error('First database');}}),/First database/);
 const unchanged=path.join(destination,'.observanda/custom-evidence.bin'),stamp=await stat(unchanged);
 const writing=new RecordWriting(f.source),prior=await writing.read(f.target);await writing.save({...f.target,expectedRevision:prior.revision,value:{body:'Latest source observation'}});
 await assert.rejects(copyProjectLocation(f.source,destination,{id,checkpoint:async stage=>{if(stage==='database-committed')throw Error('Committed replacement');}}),/Committed replacement/);
 const copied=await copyProjectLocation(f.source,destination,{id});assert.equal((await new RecordWriting(copied).read(f.target)).value.body,'Latest source observation');assert.deepEqual(await copied.read(),await f.source.read());assert.equal((await stat(unchanged)).mtimeMs,stamp.mtimeMs);assert.equal((await stat(unchanged)).ino,stamp.ino);
});
