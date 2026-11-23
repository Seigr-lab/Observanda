import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {ProjectApplication} from '../src/project-application.js';
import {withWorkspaceCopySession} from '../src/workspace-copy-session.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {captureWorkspaceCopyDirectory} from '../src/workspace-copy-directory.js';
import {workspaceEncryptedCopyAccess} from '../src/workspace-encrypted-copy.js';
import {workspaceManifest} from '../src/locations.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {clearVault,encrypted} from '../src/encryption.js';
import {CATALOGUE_FILE,CATALOGUE_ARCHIVE} from '../src/postgres-activation.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';

test('encrypting a workspace with fresh credentials completes its credential handoff and preserves the source',{timeout:180000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-session-')),destination=path.join(directory,'encrypted'),client={};
 const provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);
 let f,application,targetApplication,vault,reopened;
 try{
  f=await encryptedFixture(directory,{...sampleNotebook(),title:'source'});const {workspace,deviceStore}=f;application=new ProjectApplication(workspace,{deviceStore});
  const initial=await workspace.read();initial.book.description='Retained revision';await workspace.save(initial.book,initial.etag);
  // A copy pins the native project directory, creating it once; do that before recording the source.
  await captureWorkspaceCopyDirectory(new ProjectRegistry(workspace,(await workspace.outline()).metadata.id));
  const before=await workspaceManifest(workspace.root);
  await withWorkspaceCopySession(application,client,async copy=>{
   const plan=await copy.plan(destination),created=await workspaceEncryptedCopyAccess(workspace,plan,{password:'synthetic copy password',deviceStore});vault=created.vault;
   assert.equal(await copy.encrypted(plan,created.access,vault),destination);
   targetApplication=new ProjectApplication(new Workspace(destination,vault),{deviceStore});
   await copy.install(targetApplication);
  });
  assert.deepEqual(await workspaceManifest(workspace.root),before);
  // Every file is an encrypted envelope except the credential record, the database
  // binding, and the portable catalogue archive, whose writer stores only encrypted
  // row payloads; the database itself lives in the successor's own cluster.
  for(const file of await workspaceManifest(destination))if(![`.observanda/access.json`,CATALOGUE_FILE,CATALOGUE_ARCHIVE].includes(file.path))assert.ok(encrypted(await readFile(path.join(destination,file.path))),file.path);
  reopened=await verifyAccess(await readAccess(destination),'','synthetic copy password',{deviceStore});
  assert.equal((await new Workspace(destination,reopened).read()).book.description,'Retained revision');
 }finally{await targetApplication?.close();await application?.close();await provider.close();detach();await clearVault(vault);await clearVault(reopened);if(f)await clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-copy-session-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
