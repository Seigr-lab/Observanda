import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,symlink,rm} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {stageFiles,checkOriginals,applyFiles,cleanFiles,fingerprint} from '../src/local-export-files.js';
import {withMutationFilesSession} from '../src/mutation-files.js';
import {discardNativeFiles} from '../src/local-export-native-files.js';
const windows={skip:!['win32','linux','darwin'].includes(process.platform)},digest=data=>({bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
test('native discard removes an incomplete stage, preserves originals and refuses a retained backup',windows,async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-native-discard-')),plan={id:randomUUID(),directory:parent,changes:[{path:'index.html'}]},stage='.observanda-'+plan.id+'-new-index.html',backup='.observanda-'+plan.id+'-old-index.html';
 try{await writeFile(path.join(parent,'index.html'),'original');await writeFile(path.join(parent,stage),'partial');
  await discardNativeFiles(plan,()=>plan.changes);assert.deepEqual(await readdir(parent),['index.html']);
  await writeFile(path.join(parent,stage),'partial');await writeFile(path.join(parent,backup),'retained');
  await assert.rejects(discardNativeFiles(plan,()=>plan.changes),{code:'LOCAL_EXPORT_RECOVER'});
  assert.equal(await readFile(path.join(parent,stage),'utf8'),'partial');assert.equal(await readFile(path.join(parent,'index.html'),'utf8'),'original');
 }finally{assert.equal(path.dirname(parent),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-native-discard-'));await rm(parent,{recursive:true,force:true});}
});
test('native export stages, resumes no-clobber replacement, verifies and cleans only its retained files',windows,async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-native-export-')),directory=path.join(parent,'output');await mkdir(path.join(directory,'pages'),{recursive:true});await writeFile(path.join(directory,'pages','index.html'),'previous');await writeFile(path.join(directory,'unrelated'),'keep');
 const data=Buffer.from('reviewed edition'),empty=Buffer.alloc(0),plan={id:randomUUID(),directory,applied:0,changes:[{path:'pages/index.html',kind:'update',before:await fingerprint(path.join(directory,'pages','index.html')),after:digest(data)},{path:'.nojekyll',kind:'new',before:null,after:digest(empty)}]},files=new Map([['pages/index.html',data],['.nojekyll',empty]]);
 try{await withMutationFilesSession(async()=>{
  await checkOriginals(plan);await stageFiles(plan,{files},async()=>{});await checkOriginals(plan);
  await assert.rejects(applyFiles(plan,async phase=>{if(phase==='moved')throw Error('Synthetic interruption');},async count=>{plan.applied=count;}),/Synthetic interruption/);
  await applyFiles(plan,async()=>{},async count=>{plan.applied=count;});await cleanFiles(plan);await cleanFiles(plan);
 });assert.deepEqual(await readFile(path.join(directory,'pages','index.html')),data);assert.equal(await readFile(path.join(directory,'unrelated'),'utf8'),'keep');assert.deepEqual(await readdir(path.join(directory,'pages')),['index.html']);assert.equal((await readFile(path.join(directory,'.nojekyll'))).length,0);
 }finally{assert.equal(path.dirname(parent),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-native-export-'));await rm(parent,{recursive:true,force:true});}
});
test('native export mutation remains in the admitted directory when its pathname becomes a junction',windows,async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-native-export-race-')),directory=path.join(parent,'output'),outside=path.join(parent,'outside'),original=path.join(parent,'original');await mkdir(directory);await mkdir(outside);await writeFile(path.join(outside,'sentinel'),'keep');
 const data=Buffer.from('reviewed edition'),plan={id:randomUUID(),directory,applied:0,changes:[{path:'index.html',kind:'new',before:null,after:digest(data)}]};
 try{await stageFiles(plan,{files:{async get(){await rename(directory,original);await symlink(outside,directory,'junction');return data;}}},async()=>{});
  assert.deepEqual(await readdir(outside),['sentinel']);assert.equal(await readFile(path.join(outside,'sentinel'),'utf8'),'keep');assert.equal((await readdir(original)).length,1);
  await assert.rejects(applyFiles(plan,async()=>{},async()=>{}),{code:'UNSAFE'});
 }finally{assert.equal(path.dirname(parent),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-native-export-race-'));await rm(parent,{recursive:true,force:true});}
});
