import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,link,unlink,rm,rmdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {workspaceManifest} from '../src/locations.js';
import {sampleNotebook} from '../src/sample.js';
import {temporaryWriteName,temporaryStreamName} from '../src/storage-temporary.js';

test('backup inventories exclude only ordinary reserved staging files and still reject unsafe storage',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-staging-inventory-'));
 t.after(()=>rm(root,{recursive:true,force:true}));await new Workspace(root).create(sampleNotebook());
 const internal=path.join(root,'.observanda'),source=path.join(internal,'original');await writeFile(source,'retained evidence');
 const expected=await workspaceManifest(root);
 for(const name of [temporaryWriteName(),temporaryStreamName()]){
  const file=path.join(internal,name);await writeFile(file,'unfinished bytes');assert.deepEqual(await workspaceManifest(root),expected);await unlink(file);
  await link(source,file);await assert.rejects(workspaceManifest(root),{code:'UNSAFE'});await unlink(file);
  await mkdir(file);await assert.rejects(workspaceManifest(root),{code:'UNSAFE'});await rmdir(file);
 }
 for(const name of ['.stream-unknown','.write-unrecognized.tmp','copy-in-progress']){
  const file=path.join(internal,name);await writeFile(file,'unfinished');await assert.rejects(workspaceManifest(root),{code:'LOCKED'});await unlink(file);
 }
 assert.deepEqual(await workspaceManifest(root),expected);
});
