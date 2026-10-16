import {ProjectMoves} from '../src/project-move.js';
import {ProjectOpening} from '../src/project-opening.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access,rename,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {ProjectStorage,initializeProjectLocation} from '../src/project-storage.js';
import {copyProjectLocation,projectTransferReceipt} from '../src/project-transfer.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {createWorkspaceAccess,takeCreatedVault,verifyAccess,readAccess} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from '../src/postgres-activation.js';

test('portable project archives resume verification and open without either source database or device',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-portable-project-')),book=sampleNotebook(),id=book.projects[0].id,password='Independent project export password',device=new TestDeviceStore({file:path.join(directory,'device')}),grant=await createWorkspaceAccess('',password,device),vault=takeCreatedVault(grant);
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 t.after(async()=>{await owner.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-portable-project-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 book.title=book.projects[0].title='source';
 const source=await initializeProjectLocation(path.join(directory,'source'),id,book,grant,vault),destination=path.join(directory,'export',book.title),command=randomUUID();await mkdir(path.dirname(destination));
 await source.writeFile(path.join(source.root,'.observanda/evidence.bin'),'Retained project evidence');const before=await source.read();
 let stopped=false;await assert.rejects(copyProjectLocation(source,destination,{id:command,portable:true,checkpoint:async phase=>{if(phase==='database'&&!stopped){stopped=true;throw Error('Export interrupted');}}}),/Export interrupted/);
 const archive=await readFile(path.join(destination,CATALOGUE_ARCHIVE));assert.equal(await catalogueBinding(destination),null);await assert.rejects(access(path.join(destination,'.observanda/postgresql')),{code:'ENOENT'});
 await copyProjectLocation(source,destination,{id:command,portable:true});assert.deepEqual(await readFile(path.join(destination,CATALOGUE_ARCHIVE)),archive);
 await assert.rejects(copyProjectLocation(source,destination,{id:command}),{code:'CONFLICT'});
 assert.equal((await projectTransferReceipt(new ProjectStorage(destination,id,vault))).portable,true);
 // A completed receipt is idempotent, while corruption is never acknowledged.
 await copyProjectLocation(source,destination,{id:command,portable:true});await writeFile(path.join(destination,CATALOGUE_ARCHIVE),Buffer.from('damaged'));
 await assert.rejects(copyProjectLocation(source,destination,{id:command,portable:true}),{code:'STORAGE_COPY'});await writeFile(path.join(destination,CATALOGUE_ARCHIVE),archive);
 await owner.closeProject(source.root);await rename(source.root,path.join(directory,'source unavailable'));const moved=path.join(directory,'Another installation',book.title);await mkdir(path.dirname(moved));await rename(destination,moved);
 const stranger=new TestDeviceStore({file:path.join(directory,'other-device')});await stranger.identity();await assert.rejects(verifyAccess(await readAccess(moved),'','',{deviceStore:stranger}),{code:'DEVICE_UNKNOWN'});
 const key=await verifyAccess(await readAccess(moved),'',password,{deviceStore:stranger});
 const receiver=await encryptedFixture(path.join(directory,'receiver'),sampleNotebook());
 try{const registry=new ProjectRegistry(receiver.workspace,(await receiver.workspace.outline()).metadata.id);const opened=await new ProjectOpening(registry,stranger).open({id:randomUUID(),path:moved,username:'',password,recovery:''});assert.equal(opened.project.projectId,id);const restored=new ProjectStorage(opened.project.root,id,key);assert.deepEqual(await restored.read(),before);assert.equal(await restored.readFile(path.join(opened.project.root,'.observanda/evidence.bin'),'utf8'),'Retained project evidence');assert.equal((await catalogueBinding(opened.project.root)).placement,'project');await assert.rejects(access(path.join(opened.project.root,CATALOGUE_ARCHIVE)),{code:'ENOENT'});const next=path.join(directory,'Moved restored project',book.title);await mkdir(path.dirname(next));assert.equal((await new ProjectMoves(registry).run(id,key,{id:randomUUID(),path:next})).phase,'complete');await assert.rejects(access(opened.project.root),{code:'ENOENT'});assert.deepEqual(await new ProjectStorage(next,id,key).read(),before);}
 finally{clearVault(key);clearVault(receiver.vault);}
});
