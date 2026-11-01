import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,unlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {workspaceFiles} from '../src/workspace-inventory.js';
import {workspaceOwnerLeaseFile} from '../src/owned-storage-control.js';

test('runtime admission lease is excluded at its exact owner location without hiding similarly named data',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-runtime-inventory-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'.observanda/materials'),{recursive:true});
 await writeFile(path.join(root,'workspace.observanda'),'synthetic descriptor');
 const lease='.observanda/.postgresql.runtime-upgrade.lock',original='.observanda/materials/.postgresql.runtime-upgrade.lock',other='.observanda/other.runtime-upgrade.lock';
 for(const name of [lease,original,other])await writeFile(path.join(root,name),'retained bytes');
 const inventory=()=>Array.fromAsync(workspaceFiles(root,{hashFiles:false,includeDatabase:false}));
 assert.deepEqual((await inventory()).map(row=>row.path).sort(),['workspace.observanda',original,other].sort());
 assert.equal(workspaceOwnerLeaseFile(lease),true);assert.equal(workspaceOwnerLeaseFile(original),false);assert.equal(workspaceOwnerLeaseFile(other),false);
 await unlink(path.join(root,lease));await mkdir(path.join(root,lease));
 await assert.rejects(inventory(),{code:'UNSAFE'});
});
