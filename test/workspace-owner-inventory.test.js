import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {workspaceFiles} from '../src/workspace-inventory.js';

test('workspace inventory excludes declared project owners and refuses an undeclared nested database',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'observanda-owner-inventory-'));
  t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-owner-inventory-'));await rm(root,{recursive:true,force:true});});
  const project=path.join(root,'.observanda','projects','Measurements with spaces');
  await mkdir(path.join(project,'.observanda','postgresql'),{recursive:true});
  await writeFile(path.join(root,'observanda.json'),'{}');
  await writeFile(path.join(root,'.observanda','evidence.original'),'workspace evidence');
  await writeFile(path.join(project,'.observanda','postgresql','fixture'),'These database bytes must never travel through the file copier.');
  const walk=options=>Array.fromAsync(workspaceFiles(root,{includeDatabase:false,...options}));
  await assert.rejects(walk(),{code:'DATABASE_LOCATION'});
  const files=await walk({projectRoots:[project]});
  assert.deepEqual(files.map(file=>file.path).sort(),['.observanda/evidence.original','observanda.json']);
  await assert.rejects(walk({projectRoots:[root]}),{code:'STORAGE_PATH'});
  await assert.rejects(walk({projectRoots:[path.dirname(root)]}),{code:'STORAGE_PATH'});
  await assert.rejects(walk({projectRoots:[path.join(root,'.observanda')]}),{code:'STORAGE_PATH'});
  await assert.rejects(walk({projectRoots:[path.join(root,'observanda.json')]}),{code:'UNSAFE'});
});
