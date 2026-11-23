import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectApplication} from '../src/project-application.js';
import {withWorkspaceCopySession} from '../src/workspace-copy-session.js';
import {workspaceEncryptedCopyAccess} from '../src/workspace-encrypted-copy.js';
import {workspaceManifest} from '../src/locations.js';
import {clearVault} from '../src/encryption.js';
import {writeContent,FileContent,contentBuffer} from '../src/file-content.js';
import {verifiedStagingReservationNamespace} from '../src/staging-reservations.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {ownedStorageLeaseFile} from '../src/owned-storage-control.js';

// Staging namespaces and writer leases are bound to the folder that holds them.
// A copy carries the research content, then starts its own controls when used.
const folderControl=file=>file.path==='.observanda/.staging-reservations.lock'||file.path.startsWith('.observanda/staging-reservations/')||ownedStorageLeaseFile(file.path);

test('a copied encrypted workspace keeps staged content and starts its own staging and website leases',{timeout:180000},async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-leases-')),encryptedRoot=path.join(directory,'encrypted'),copyRoot=path.join(directory,'copy'),bytes=Buffer.from('Staged evidence retained by the copy');
 const provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider);
 let f,application,encryptedApplication,vault;
 try{
  f=await encryptedFixture(directory,{...sampleNotebook(),title:'source'});const source=f.workspace,deviceStore=f.deviceStore;application=new ProjectApplication(source,{deviceStore});
  await withWorkspaceCopySession(application,{},async copy=>{
   const plan=await copy.plan(encryptedRoot),created=await workspaceEncryptedCopyAccess(source,plan,{password:'synthetic copy password',deviceStore});vault=created.vault;
   await copy.encrypted(plan,created.access,vault);encryptedApplication=new ProjectApplication(new Workspace(encryptedRoot,vault),{deviceStore});await copy.install(encryptedApplication);
  });
  // Use the encrypted workspace: a staged write and the website writer create
  // its own namespace, admission and writer leases.
  const encrypted=new Workspace(encryptedRoot,vault),evidence=path.join(encryptedRoot,'.observanda','staged-evidence.bin'),saved=await writeContent(encrypted,evidence,[bytes]);
  await new WebsiteFileStore(encrypted).scope(()=>{},{write:true});
  assert.equal(await verifiedStagingReservationNamespace(encryptedRoot,vault),true);
  assert.ok((await workspaceManifest(encryptedRoot)).every(file=>!ownedStorageLeaseFile(file.path)));

  await withWorkspaceCopySession(encryptedApplication,{},async copy=>{const plan=await copy.plan(copyRoot);assert.equal(await copy.copy(plan),copyRoot);});
  const copied=await workspaceManifest(copyRoot);
  assert.deepEqual(copied.filter(folderControl).map(file=>file.path),[]);
  assert.ok(copied.some(file=>file.path==='.observanda/staged-evidence.bin'));
  const copiedWorkspace=new Workspace(copyRoot,vault);
  assert.deepEqual(await contentBuffer(new FileContent(copiedWorkspace,path.join(copyRoot,'.observanda','staged-evidence.bin'),saved.size,saved.sha256)),bytes);

  // The copy opens and creates its own staging namespace and website writer.
  assert.ok((await copiedWorkspace.read()).book);
  const later=Buffer.from('Written after the copy'),written=await writeContent(copiedWorkspace,path.join(copyRoot,'.observanda','later-evidence.bin'),[later]);
  assert.deepEqual(await contentBuffer(new FileContent(copiedWorkspace,path.join(copyRoot,'.observanda','later-evidence.bin'),written.size,written.sha256)),later);
  assert.equal(await verifiedStagingReservationNamespace(copyRoot,vault),true);
  await new WebsiteFileStore(copiedWorkspace).scope(()=>{},{write:true});
 }finally{await encryptedApplication?.close();await application?.close();await provider.close();detach();await clearVault(vault);if(f)await clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-copy-leases-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
