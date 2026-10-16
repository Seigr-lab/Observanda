import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,unlink,rm,access,rename} from 'node:fs/promises';
import {removeRetiredProject} from '../src/project-move-retirement.js';
import {projectMoveDirectory} from '../src/project-move-boundaries.js';
import {MOVE_SOURCE} from '../src/workspace-move-state.js';

test('nested retirement preserves uncopied additions and resumes after removing its marker',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-retirement-'));t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-retirement-'));await rm(directory,{recursive:true,force:true});});
 const source=path.join(directory,'source'),destination=path.join(directory,'destination'),child=path.join(source,'.observanda','Child Project');await mkdir(child,{recursive:true});await mkdir(path.join(destination,'.observanda'),{recursive:true});
 const value={version:2,id:randomUUID(),source,destination,boundaries:['.observanda/Child Project'],sourceDirectory:await projectMoveDirectory(source)},sentinel=path.join(child,'keep');await writeFile(sentinel,'Independent project');
 await writeFile(path.join(source,MOVE_SOURCE),JSON.stringify({id:value.id,destination}));await writeFile(path.join(source,'.observanda','original'),'Copied evidence');await writeFile(path.join(destination,'.observanda','original'),'Changed destination');
 await assert.rejects(removeRetiredProject(value,{verify:false,checkpoint:async()=>{}}),{code:'STORAGE_COPY'});assert.equal(await readFile(path.join(source,'.observanda','original'),'utf8'),'Copied evidence');
 await writeFile(path.join(destination,'.observanda','original'),'Copied evidence');
 const added=path.join(source,'.observanda','New independent owner');await mkdir(added);await writeFile(path.join(added,'keep'),'Uncopied work');
 await assert.rejects(removeRetiredProject(value,{verify:false,checkpoint:async()=>{}}),{code:'STORAGE_MOVE_CONTENTS'});assert.equal(await readFile(path.join(added,'keep'),'utf8'),'Uncopied work');assert.equal(await readFile(sentinel,'utf8'),'Independent project');
 assert.equal(path.dirname(added),path.join(source,'.observanda'));await rm(added,{recursive:true});
 await assert.rejects(removeRetiredProject(value,{verify:false,checkpoint:async stage=>{if(stage==='marker-removed')throw Error('Lost completion');}}),/Lost completion/);
 await assert.rejects(access(path.join(source,MOVE_SOURCE)),{code:'ENOENT'});
 await writeFile(path.join(source,'new-work'),'Keep after marker removal');await assert.rejects(removeRetiredProject(value,{verify:false,checkpoint:async()=>{}}),{code:'STORAGE_MOVE_STATE'});assert.equal(await readFile(path.join(source,'new-work'),'utf8'),'Keep after marker removal');await unlink(path.join(source,'new-work'));
 await removeRetiredProject(value,{verify:false,checkpoint:async()=>{}});assert.equal(await readFile(sentinel,'utf8'),'Independent project');assert.equal(await readFile(path.join(destination,'.observanda','original'),'utf8'),'Copied evidence');
});


test('whole-tree retirement authenticates nested owner files and refuses a replacement retirement directory',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-tree-retirement-'));t.after(async()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-tree-retirement-'));await rm(directory,{recursive:true,force:true});});
 const id=randomUUID(),source=path.join(directory,'Original Project'),destination=path.join(directory,'Destination Project'),retired=path.join(directory,'.observanda-project-move-'+id),relative='Nested Project/Protected Notes';
 await mkdir(path.join(retired,relative,'.observanda/postgresql/data'),{recursive:true});await mkdir(path.join(destination,relative,'.observanda'),{recursive:true});await mkdir(path.join(retired,'.observanda'));
 const value={id,source,destination,sourceDirectory:await projectMoveDirectory(retired)},options={ownerDirectories:['Nested Project',relative],verify:true,checkpoint:async()=>{}};
 await writeFile(path.join(retired,MOVE_SOURCE),JSON.stringify({id,destination}));await writeFile(path.join(retired,relative,'.observanda/postgresql/data/PG_VERSION'),'17');await writeFile(path.join(retired,relative,'.observanda/original'),'Original evidence');await writeFile(path.join(destination,relative,'.observanda/original'),'Different evidence');
 await assert.rejects(removeRetiredProject(value,{...options,ownerDirectories:['../Outside']}),{code:'STORAGE_MOVE_STATE'});assert.equal(await readFile(path.join(retired,relative,'.observanda/original'),'utf8'),'Original evidence');
 await assert.rejects(removeRetiredProject(value,options),{code:'STORAGE_COPY'});assert.equal(await readFile(path.join(retired,relative,'.observanda/original'),'utf8'),'Original evidence');
 await rename(retired,retired+' saved');await mkdir(retired);await writeFile(path.join(retired,'new-file'),'Keep replacement');await assert.rejects(removeRetiredProject(value,options),{code:'STORAGE_MOVE_STATE'});assert.equal(await readFile(path.join(retired,'new-file'),'utf8'),'Keep replacement');await rename(retired,retired+' replacement');await rename(retired+' saved',retired);
 await writeFile(path.join(destination,relative,'.observanda/original'),'Original evidence');await removeRetiredProject(value,options);await assert.rejects(access(retired),{code:'ENOENT'});assert.equal(await readFile(path.join(retired+' replacement','new-file'),'utf8'),'Keep replacement');
});
