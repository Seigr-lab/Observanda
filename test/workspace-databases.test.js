import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {catalogueBinding,publishCatalogueBinding} from '../src/postgres-activation.js';
import {withScratch} from '../src/scratch-work.js';

test('normal workspace creation, editing and scratch queries use independent workspace databases',async t=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-owned-databases-')),owner=new WorkspaceDatabases({directory:path.join(parent,'application'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);let a,b;
 t.after(async()=>{await owner.close();detach();clearVault(a?.vault);clearVault(b?.vault);await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 a=await encryptedFixture(path.join(parent,'a'),sampleNotebook());b=await encryptedFixture(path.join(parent,'b'),sampleNotebook());
 for(const f of [a,b])assert.equal((await catalogueBinding(f.workspace.root)).placement,'workspace');
 await a.workspace.update(book=>{book.title='Changed only A';return book;});assert.equal((await a.workspace.read()).book.title,'Changed only A');assert.notEqual((await b.workspace.read()).book.title,'Changed only A');
 const envA=await owner.instances.cached(a.workspace.root),envB=await owner.instances.cached(b.workspace.root);assert.notEqual(envA.OBSERVANDA_DATABASE_URL,envB.OBSERVANDA_DATABASE_URL);
 await a.workspace.catalogue(()=>withScratch(async work=>{assert.equal(await work.add('a',{value:37}),true);assert.equal(work.size,1);}));
 await owner.closeWorkspace(a.workspace.root);assert.equal((await b.workspace.read()).book.title,'A closer look');assert.equal((await a.workspace.read()).book.title,'Changed only A');
 assert.equal((await readFile(path.join(a.workspace.root,'.observanda','postgresql','service.observanda'))).includes(Buffer.from('Changed only A')),false);
});


test('managed storage refuses an obsolete shared binding without starting or modifying a database',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-unsupported-owner-')),owner=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId:randomUUID()});
 t.after(async()=>{await owner.close();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await mkdir(path.join(root,'.observanda'));await publishCatalogueBinding(root,randomUUID());const binding=await readFile(path.join(root,'.observanda/research.observanda'));
 await assert.rejects(owner.environment(root),{code:'ACCESS_UPGRADE'});await assert.rejects(owner.details({root}),{code:'ACCESS_UPGRADE'});
 assert.equal(owner.instances.instances.size,0);assert.equal(owner.projects.stats().open,0);
 assert.deepEqual(await readFile(path.join(root,'.observanda/research.observanda')),binding);assert.deepEqual(await readdir(root),['.observanda']);assert.deepEqual(await readdir(path.join(root,'.observanda')),['research.observanda']);
});
