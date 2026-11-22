import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {holdImportSource,releaseImportSource,assertNoImportHold,IMPORT_SOURCE_HOLD} from '../src/import-source-hold.js';

async function tree(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-import-hold-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const workspace=path.join(directory,'Workspace'),project=path.join(workspace,'Project'),book=path.join(project,'Book'),record=path.join(directory,'Receiving','.observanda','project-imports','pending.obsv');
 for(const folder of [path.join(workspace,'.observanda'),path.join(project,'.observanda'),path.join(book,'.observanda'),path.dirname(record)])await mkdir(folder,{recursive:true});
 await writeFile(record,'{}');return {workspace,project,book,record};
}

test('an import holds its source tree until it releases it, and a second import cannot take the same source',async t=>{
 const f=await tree(t),id=randomUUID();
 await assertNoImportHold(f.book,f.workspace);
 await holdImportSource(f.project,id,f.record);await holdImportSource(f.project,id,f.record);
 for(const root of [f.project,f.book])await assert.rejects(assertNoImportHold(root,f.workspace),{code:'STORAGE_PROJECT_BUSY'});
 await assert.rejects(holdImportSource(f.project,randomUUID(),f.record),{code:'STORAGE_PROJECT_BUSY'});
 await releaseImportSource(f.project,randomUUID());await assert.rejects(assertNoImportHold(f.book,f.workspace),{code:'STORAGE_PROJECT_BUSY'});
 await releaseImportSource(f.project,id);await assertNoImportHold(f.book,f.workspace);
 await assert.rejects(access(path.join(f.project,IMPORT_SOURCE_HOLD)),{code:'ENOENT'});
});

test('a hold whose import record no longer exists does not block the tree and can be replaced',async t=>{
 const f=await tree(t),id=randomUUID();
 await holdImportSource(f.project,id,f.record);await rm(f.record);
 await assertNoImportHold(f.book,f.workspace);
 const next=randomUUID(),record=f.record.replace('pending','next');await writeFile(record,'{}');
 await holdImportSource(f.project,next,record);await assert.rejects(assertNoImportHold(f.project,f.workspace),{code:'STORAGE_PROJECT_BUSY'});
});

test('a damaged hold is treated as busy, and releasing it leaves it for inspection',async t=>{
 const f=await tree(t);
 await writeFile(path.join(f.project,IMPORT_SOURCE_HOLD),'not a hold');
 await assert.rejects(assertNoImportHold(f.book,f.workspace),{code:'STORAGE_PROJECT_BUSY'});
 await releaseImportSource(f.project,randomUUID());await access(path.join(f.project,IMPORT_SOURCE_HOLD));
});
