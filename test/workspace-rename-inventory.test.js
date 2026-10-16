import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assertRenameDatabaseOwners} from '../src/workspace-rename-inventory.js';
test('rename inventory refuses an unregistered nested database and preserves file contents',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-rename-inventory-')),project=path.join(root,'projects','Nested project'),unknown=path.join(root,'Later branch','Other owner');
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-rename-inventory-'));await rm(root,{recursive:true,force:true});});
 for(const owner of [root,project])await mkdir(path.join(owner,'.observanda','postgresql'),{recursive:true});
 await writeFile(path.join(project,'Research original.txt'),'Original file retained');
 for(let i=0;i<80;i++)await mkdir(path.join(project,'originals','group '+i),{recursive:true});
 await assertRenameDatabaseOwners(root,[project]);assert.equal(await readFile(path.join(project,'Research original.txt'),'utf8'),'Original file retained');await mkdir(path.join(unknown,'.observanda','postgresql'),{recursive:true});
 await assert.rejects(assertRenameDatabaseOwners(root,[project]),{code:'STORAGE_RENAME_PROJECTS'});
 await assertRenameDatabaseOwners(root,[project,unknown]);
});


test('case variants cannot hide a live database from parent lifecycle ownership checks',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-owner-case-')),child=path.join(root,'Unexpected owner');
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-owner-case-'));await rm(root,{recursive:true,force:true});});
 await mkdir(path.join(child,'.OBSERVANDA','PostgreSQL'),{recursive:true});
 await assert.rejects(assertRenameDatabaseOwners(root,[],{stage:'delete-check-owners',errorCode:'STORAGE_DELETE_CONTENTS'}),{code:'STORAGE_DELETE_CONTENTS'});
 await assert.rejects(assertRenameDatabaseOwners(root,[child]),{code:'STORAGE_RENAME_PROJECTS'});
 await writeFile(path.join(child,'.OBSERVANDA','PostgreSQL','retained'),'Original');assert.equal(await readFile(path.join(child,'.OBSERVANDA','PostgreSQL','retained'),'utf8'),'Original');
});
