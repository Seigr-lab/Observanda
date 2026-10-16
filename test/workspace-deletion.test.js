import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,link} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDeletions} from '../src/workspace-deletion.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {catalogueBinding,publishCatalogueBinding} from '../src/postgres-activation.js';
import {openCatalogue} from '../src/postgres.js';
import {workspaceDeletion,DELETE_MARKER} from '../src/workspace-delete-state.js';
import {initializeLocation} from '../src/locations.js';
import {createAccess} from '../src/access.js';

async function fixture(t,{owned=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-delete-test-'));
 let owner,detach;
 if(owned){owner=new WorkspaceDatabases({directory:path.join(directory,'application'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});detach=installDatabaseProvider(owner);}
 const f=await encryptedFixture(directory,sampleNotebook()),deletions=new WorkspaceDeletions(path.join(directory,'deletions'));
 t.after(async()=>{await owner?.close();detach?.();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await writeFile(path.join(f.workspace.root,'.observanda','original.img'),Buffer.alloc(70000,37));
 return {...f,directory,deletions,owner};
}
const interrupt=phase=>async stage=>{if(stage===phase)throw Error('interrupted '+phase);};

test('deletes an older catalogue and evidence without touching another catalogue or copy',async t=>{
 const f=await fixture(t),other=await encryptedFixture(path.join(f.directory,'other'),sampleNotebook());t.after(()=>clearVault(other.vault));
 const before=await other.workspace.read(),binding=await catalogueBinding(f.workspace.root),alias=path.join(f.directory,'alias');await mkdir(path.join(alias,'.observanda'),{recursive:true});await publishCatalogueBinding(alias,binding.id);
 const plan=await f.deletions.review(f.workspace),progress=[];
 const result=await f.deletions.begin(f.workspace,plan,{onProgress:p=>progress.push(p)});
 assert.equal(result.complete,true);await assert.rejects(access(f.workspace.root),{code:'ENOENT'});
 await assert.rejects(openCatalogue(alias,{detached:true}),{code:'CATALOGUE_UNAVAILABLE'});assert.deepEqual(await other.workspace.read(),before);
 assert.ok(progress.some(p=>p.stage==='delete-files'&&p.total>0&&p.completed===p.total));
 await f.deletions.acknowledge(result.id);assert.deepEqual(await f.deletions.list(),[]);
});
test('stops and removes the dedicated database as well as all workspace files',async t=>{
 const f=await fixture(t,{owned:true}),plan=await f.deletions.review(f.workspace);
 assert.equal(plan.binding.placement,'workspace');await access(path.join(f.workspace.root,'.observanda/postgresql/data/PG_VERSION'));
 const result=await f.deletions.begin(f.workspace,plan);
 assert.equal(result.complete,true);assert.equal(f.owner.instances.instances.size,0);await assert.rejects(access(f.workspace.root),{code:'ENOENT'});
});
test('a frozen owned workspace can finish after its database owner has restarted',async t=>{
 const f=await fixture(t,{owned:true});await assert.rejects(f.deletions.begin(f.workspace,await f.deletions.review(f.workspace),{checkpoint:interrupt('frozen')}),/interrupted/);
 const [receipt]=await f.deletions.list();await f.owner.closeWorkspace(f.workspace.root);
 await assert.rejects(f.owner.instances.open(f.workspace.root,f.vault),{code:'STORAGE_DELETING'});
 assert.equal((await new WorkspaceDeletions(f.deletions.directory).finish(receipt.id,{vault:f.vault})).complete,true);
});
test('deletion refuses an unfinished conversion even when it started after the review',async t=>{
 const f=await fixture(t),plan=await f.deletions.review(f.workspace);
 await f.workspace.writeFile(path.join(f.workspace.root,'.observanda/database-conversion.observanda'),JSON.stringify({version:1,sourceId:plan.binding.id,targetId:randomUUID(),archiveSha256:'0'.repeat(64),phase:'prepared'}));
 await assert.rejects(f.deletions.begin(f.workspace,plan),{code:'STORAGE_DELETE_BUSY'});assert.equal(await workspaceDeletion(f.workspace.root),null);
 await assert.rejects(f.deletions.review(f.workspace),{code:'STORAGE_DELETE_BUSY'});await access(f.workspace.root);
});
test('a live deletion excludes the same owner while another workspace can be deleted',async t=>{
 const f=await fixture(t),other=await encryptedFixture(path.join(f.directory,'independent'),sampleNotebook());t.after(()=>clearVault(other.vault));
 let release,notifyFrozen;const gate=new Promise(resolve=>release=resolve),frozen=new Promise(resolve=>notifyFrozen=resolve),id=randomUUID();
 const running=f.deletions.begin(f.workspace,await f.deletions.review(f.workspace),{id,checkpoint:async stage=>{if(stage==='frozen'){notifyFrozen();await gate;}}});
 await Promise.race([frozen,running.then(()=>{throw Error('Deletion did not reach the checkpoint');})]);
 try{
  await assert.rejects(new WorkspaceDeletions(f.deletions.directory).finish(id),{code:'DATABASE_RUNNING'});await access(f.workspace.root);
  const result=await f.deletions.begin(other.workspace,await f.deletions.review(other.workspace));assert.equal(result.complete,true);
  await assert.rejects(access(other.workspace.root),{code:'ENOENT'});await access(f.workspace.root);
 }finally{release();assert.equal((await running).complete,true);}
 await assert.rejects(access(f.workspace.root),{code:'ENOENT'});
});

test('legacy database access failure leaves files and deletion state intact for retry',async t=>{
 const f=await fixture(t);await assert.rejects(f.deletions.begin(f.workspace,await f.deletions.review(f.workspace),{checkpoint:interrupt('frozen')}),/interrupted/);
 const [receipt]=await f.deletions.list();
 const detached=installDatabaseProvider({environment:async()=>{throw Object.assign(Error('unavailable'),{code:'CATALOGUE_UNAVAILABLE'});}});
 try{await assert.rejects(f.deletions.finish(receipt.id),{code:'CATALOGUE_UNAVAILABLE'});await access(f.workspace.root);assert.equal((await f.deletions.read(receipt.id)).databaseRemoved,false);}
 finally{detached();}
 assert.equal((await f.deletions.finish(receipt.id)).complete,true);
});
test('interruption after freezing blocks reads and edits and resumes after process restart',async t=>{
 const f=await fixture(t),plan=await f.deletions.review(f.workspace);
 await assert.rejects(f.deletions.begin(f.workspace,plan,{checkpoint:interrupt('frozen')}),/interrupted frozen/);
 const marker=await workspaceDeletion(f.workspace.root);assert.ok(marker);
 await assert.rejects(f.workspace.read(),{code:'STORAGE_DELETING'});await assert.rejects(f.workspace.update(book=>book),{code:'STORAGE_DELETING'});
 const restarted=new WorkspaceDeletions(f.deletions.directory);assert.equal((await restarted.list())[0].phase,'frozen');
 assert.equal((await restarted.finish(marker.id)).complete,true);await assert.rejects(access(f.workspace.root),{code:'ENOENT'});
});
test('partial removal resumes only in its retired folder and preserves a reused original path',async t=>{
 const f=await fixture(t,{owned:true}),source=f.workspace.root;
 await assert.rejects(f.deletions.begin(f.workspace,await f.deletions.review(f.workspace),{checkpoint:interrupt('file')}),/interrupted file/);
 const receipt=(await f.deletions.list())[0];assert.equal(receipt.phase,'retired');
 await mkdir(source);await writeFile(path.join(source,'new-data.txt'),'do not remove');
 const restarted=new WorkspaceDeletions(f.deletions.directory);assert.equal((await restarted.finish(receipt.id)).complete,true);
 assert.equal(await readFile(path.join(source,'new-data.txt'),'utf8'),'do not remove');
 assert.equal((await restarted.finish(receipt.id)).complete,true);
});
test('refuses stale reviews, unrelated files, linked files, shared aliases and protected app paths',async t=>{
 const f=await fixture(t),plan=await f.deletions.review(f.workspace),before=await f.workspace.read();
 await f.workspace.update(book=>({...book,title:'Changed after review'}));
 await assert.rejects(f.deletions.begin(f.workspace,plan),{code:'CONFLICT'});
 await writeFile(path.join(f.workspace.root,'unrelated.txt'),'not workspace data');await assert.rejects(f.deletions.review(f.workspace),{code:'STORAGE_DELETE_CONTENTS'});await rm(path.join(f.workspace.root,'unrelated.txt'));
 await assert.rejects(f.deletions.review(f.workspace,{protectedPaths:[path.join(f.workspace.root,'app')]}),{code:'STORAGE_DELETE_CONTENTS'});
 const alias=path.join(f.directory,'alias');await mkdir(path.join(alias,'.observanda'),{recursive:true});await publishCatalogueBinding(alias,plan.binding.id);
 await assert.rejects(f.deletions.review(f.workspace,{recent:[{path:alias}]}),{code:'STORAGE_DELETE_SHARED'});
 const external=path.join(f.directory,'external');await writeFile(external,'external');await link(external,path.join(f.workspace.root,'.observanda','linked'));
 await assert.rejects(f.deletions.begin(f.workspace,await f.deletions.review(f.workspace)),{code:'UNSAFE'});assert.equal(await readFile(external,'utf8'),'external');
 assert.equal((await f.workspace.read()).book.id,before.book.id);assert.deepEqual(await f.deletions.list(),[]);
});
test('a prepared-only interruption can be cleared without deleting anything',async t=>{
 const f=await fixture(t),before=await f.workspace.read();await assert.rejects(f.deletions.begin(f.workspace,await f.deletions.review(f.workspace),{checkpoint:interrupt('prepared')}),/interrupted prepared/);
 const receipt=(await f.deletions.list())[0];assert.equal((await f.deletions.finish(receipt.id)).cancelled,true);assert.deepEqual(await f.workspace.read(),before);assert.deepEqual(await f.deletions.list(),[]);
});
test('legacy document workspace without a database is removed without creating one',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-delete-document-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const root=path.join(directory,'workspace');await initializeLocation(root,sampleNotebook(),await createAccess('',''));
 const workspace=new Workspace(root),deletions=new WorkspaceDeletions(path.join(directory,'deletions'));
 assert.equal((await deletions.begin(workspace,await deletions.review(workspace))).complete,true);await assert.rejects(access(root),{code:'ENOENT'});
});
test('final-marker interruption only removes empty directories, never new files',async t=>{
 const f=await fixture(t);await assert.rejects(f.deletions.begin(f.workspace,await f.deletions.review(f.workspace),{checkpoint:interrupt('files')}),/interrupted files/);
 const receipt=(await f.deletions.list())[0],target=path.join(f.directory,'.observanda-delete-'+receipt.id);
 await rm(path.join(target,DELETE_MARKER));await writeFile(path.join(target,'new.txt'),'preserve');
 await assert.rejects(f.deletions.finish(receipt.id));assert.equal(await readFile(path.join(target,'new.txt'),'utf8'),'preserve');
 await rm(path.join(target,'new.txt'));assert.equal((await f.deletions.finish(receipt.id)).complete,true);
});


test('workspace deletion rejects a project binding before freezing any files',async t=>{
 const f=await fixture(t),review=await f.deletions.review(f.workspace);
 review.binding={format:'observanda-postgresql',version:3,id:randomUUID(),placement:'project',projectId:randomUUID()};
 await assert.rejects(f.deletions.begin(f.workspace,review),{code:'DATABASE_LOCATION'});assert.equal(await workspaceDeletion(f.workspace.root),null);await access(f.workspace.root);
});
