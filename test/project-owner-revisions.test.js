import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {ProjectOwnerHistory} from '../src/project-owner-history.js';
import {ProjectOwnerRevisions} from '../src/project-owner-revisions.js';
import {writerLeaseHeld} from '../src/writer-lease.js';

test('ownership revision reads reuse only their held project lease',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-owner-revisions-')),vault={id:randomUUID(),key:randomBytes(32)},workspace=new Workspace(root,vault),namespace=randomUUID(),id=randomUUID(),other=randomUUID();await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{clearVault(vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-owner-revisions-'));await rm(root,{recursive:true,force:true});});
 const owner=new ProjectOwnerRevisions(workspace,namespace);assert.equal(await owner.revision(id),'new');
 await owner.checked(id,'new',async()=>{
  assert.equal(writerLeaseHeld(owner.file(id)+'.lock'),true);assert.equal(await new ProjectOwnerRevisions(workspace,namespace).revision(id),'new');
  const revision=await owner.advanceLocked(id);assert.equal(await owner.revision(id),revision);assert.equal(await owner.revision(other),'new');assert.equal(writerLeaseHeld(owner.file(other)+'.lock'),false);
  await assert.rejects(owner.withProjects([id],()=>assert.fail('Reentrant mutation lease')), {code:'LOCKED'});
 });
 assert.notEqual(await owner.revision(id),'new');
});


test('ownership history rejects a discontinuous chain and remains scoped to its namespace',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-owner-history-')),vault={id:randomUUID(),key:randomBytes(32)},workspace=new Workspace(root,vault),namespace=randomUUID(),id=randomUUID(),item=randomUUID();await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{clearVault(vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-owner-history-'));await rm(root,{recursive:true,force:true});});
 const owner=new ProjectOwnerRevisions(workspace,namespace),history=new ProjectOwnerHistory(workspace,namespace),first=await owner.withProjects([id],()=>owner.advanceLocked(id,{domain:'media',id:item,before:'new'})),second=await owner.withProjects([id],()=>owner.advanceLocked(id,{domain:'media',id:item,before:'a'.repeat(64)}));
 const changes=[];for await(const change of history.since(id,'new',second))changes.push(change);assert.equal(changes.length,2);assert.equal(changes[1].before,'new');
 await assert.rejects(new ProjectOwnerHistory(workspace,randomUUID()).read(id,second),{code:'FORMAT'});
 const value=await history.read(id,second);await workspace.writeFile(history.file(id,second),JSON.stringify({...value,ordinal:value.ordinal+1}));
 await assert.rejects(async()=>{for await(const change of history.since(id,'new',second))void change;},{code:'FORMAT'});
 await workspace.writeFile(history.file(id,second),JSON.stringify(value));const controller=new AbortController();controller.abort(Error('Cancelled ownership audit'));
 await assert.rejects(async()=>{for await(const change of history.since(id,first,second,{signal:controller.signal}))void change;},/Cancelled ownership audit/);
});
