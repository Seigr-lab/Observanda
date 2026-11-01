import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {TestDeviceStore} from './device-fixture.js';
import {ProjectApplication} from '../src/project-application.js';
import {withWorkspaceCopySession} from '../src/workspace-copy-session.js';
import {workspaceEncryptedCopyAccess} from '../src/workspace-encrypted-copy.js';
import {workspaceManifest} from '../src/locations.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {clearVault,encrypted} from '../src/encryption.js';

test('encrypting a document workspace completes its empty credential handoff and preserves the source',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-session-')),workspace=new Workspace(path.join(directory,'source')),destination=path.join(directory,'encrypted'),deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),application=new ProjectApplication(workspace,{deviceStore}),client={};
 let targetApplication,vault,reopened;
 try{
  const initial=await workspace.create({...sampleNotebook(),title:'source'});initial.book.description='Retained revision';await workspace.save(initial.book,initial.etag);
  const before=await workspaceManifest(workspace.root);
  await withWorkspaceCopySession(application,client,async copy=>{
   const plan=await copy.plan(destination),created=await workspaceEncryptedCopyAccess(workspace,plan,{password:'synthetic copy password',deviceStore});vault=created.vault;
   assert.equal(await copy.encrypted(plan,created.access,vault),destination);
   targetApplication=new ProjectApplication(new Workspace(destination,vault),{deviceStore});
   await copy.install(targetApplication);
  });
  assert.deepEqual(await workspaceManifest(workspace.root),before);
  for(const file of await workspaceManifest(destination))if(file.path!=='.observanda/access.json')assert.ok(encrypted(await readFile(path.join(destination,file.path))),file.path);
  reopened=await verifyAccess(await readAccess(destination),'','synthetic copy password',{deviceStore});
  assert.equal((await new Workspace(destination,reopened).read()).book.description,'Retained revision');
 }finally{await targetApplication?.close();await application.close();await clearVault(vault);await clearVault(reopened);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-copy-session-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
