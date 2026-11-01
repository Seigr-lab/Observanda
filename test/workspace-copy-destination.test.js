import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {copyWorkspaceTo,prepareCopyDestination,workspaceManifest} from '../src/locations.js';
import {withNativeDestination} from '../src/native-destination.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {backupCatalogue,CATALOGUE_ARCHIVE} from '../src/postgres.js';
import {diskCapacity} from '../src/disk-capacity.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-destination-')),destination=path.join(root,'destination'),outside=path.join(root,'outside');await mkdir(outside);await writeFile(path.join(outside,'keep'),'unrelated');
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-copy-destination-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {root,destination,outside};
}
test('copy refuses publication after control-directory replacement and preserves the source',async t=>{
 const f=await fixture(t),source=new Workspace(path.join(f.root,'source'));await source.create(sampleNotebook());const before=await workspaceManifest(source.root),retained=path.join(f.root,'retained');
 await assert.rejects(copyWorkspaceTo(source.root,f.destination,{afterSnapshotVerified:async()=>{await rename(path.join(f.destination,'.observanda'),retained);await symlink(f.outside,path.join(f.destination,'.observanda'),'junction');}}),error=>['UNSAFE','STORAGE_COPY'].includes(error.code));
 assert.deepEqual(await workspaceManifest(source.root),before);assert.deepEqual(await readdir(f.outside),['keep']);assert.equal(await readFile(path.join(retained,'copy-in-progress'),'utf8'),'incomplete\n');
});
test('database backup writes its admitted archive after the destination control path is replaced',async t=>{
 const f=await fixture(t),source=await encryptedFixture(path.join(f.root,'source'),sampleNotebook());t.after(()=>clearVault(source.vault));const retained=path.join(f.root,'retained');
 await withNativeDestination(f.destination,async scope=>{
  await prepareCopyDestination(f.destination);let swapped=false;
  const capacity={async reserve(...args){const ticket=await diskCapacity.reserve(...args);if(!swapped){swapped=true;await rename(path.join(f.destination,'.observanda'),retained);await symlink(f.outside,path.join(f.destination,'.observanda'),'junction');}return ticket;}};
  const digest=await backupCatalogue(source.workspace.root,f.destination,{capacity});assert.equal(await scope.hash(path.join(f.destination,CATALOGUE_ARCHIVE)),digest);await assert.rejects(scope.assertNamed());
 });
 assert.deepEqual(await readdir(f.outside),['keep']);assert.ok((await readFile(path.join(retained,path.basename(CATALOGUE_ARCHIVE)))).length>0);await source.workspace.read();
});
