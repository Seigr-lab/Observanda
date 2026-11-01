import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,symlink,unlink,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {removeNativeDeletion,removeNativeMove} from '../src/native-storage-cleanup.js';
import {retireNativeDirectory,nativeControl} from '../src/native-storage-tree.js';
import {DELETE_MARKER} from '../src/workspace-delete-state.js';
import {MOVE_SOURCE} from '../src/workspace-move-state.js';
const windows={skip:process.platform!=='win32'};
async function fixture(t){
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-native-cleanup-')),root=path.join(parent,'retired'),outside=path.join(parent,'outside');await mkdir(path.join(root,'.observanda','media'),{recursive:true});await mkdir(outside);await writeFile(path.join(outside,'sentinel'),'keep');
 const value={id:randomUUID(),source:path.join(parent,'source'),phase:'retired'};await writeFile(path.join(root,DELETE_MARKER),JSON.stringify({version:1,id:value.id,source:value.source}));
 await writeFile(path.join(root,'.observanda','media','one'),'one');await writeFile(path.join(root,'.observanda','media','two'),'two');
 t.after(async()=>{assert.equal(path.dirname(parent),path.resolve(os.tmpdir()));assert.ok(path.basename(parent).startsWith('observanda-native-cleanup-'));await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});return {parent,root,outside,value};
}
test('native owned cleanup retains its marker across interruption and finishes an empty-marker tail',windows,async t=>{
 const f=await fixture(t);await assert.rejects(removeNativeDeletion(f.root,f.value,{checkpoint:async stage=>{if(stage==='file')throw Error('Synthetic interruption');}}),/Synthetic interruption/);await access(path.join(f.root,DELETE_MARKER));
 await removeNativeDeletion(f.root,f.value);await assert.rejects(access(f.root),{code:'ENOENT'});assert.equal(await readFile(path.join(f.outside,'sentinel'),'utf8'),'keep');
 await mkdir(path.join(f.root,'.observanda'),{recursive:true});await removeNativeDeletion(f.root,f.value);await assert.rejects(access(f.root),{code:'ENOENT'});
 await mkdir(path.join(f.root,'.observanda'),{recursive:true});await writeFile(path.join(f.root,'new-content'),'keep');await assert.rejects(removeNativeDeletion(f.root,f.value),{code:'ENOTEMPTY'});assert.equal(await readFile(path.join(f.root,'new-content'),'utf8'),'keep');
});
test('native owned cleanup refuses a static junction before deleting any file',windows,async t=>{
 const f=await fixture(t);await symlink(f.outside,path.join(f.root,'.observanda','linked'),'junction');await assert.rejects(removeNativeDeletion(f.root,f.value),{code:'UNSAFE'});
 assert.equal(await readFile(path.join(f.root,'.observanda','media','one'),'utf8'),'one');assert.equal(await readFile(path.join(f.outside,'sentinel'),'utf8'),'keep');
});
test('native owned cleanup cannot follow a retired root replaced during removal',windows,async t=>{
 const f=await fixture(t),original=path.join(f.parent,'original');let changed=false;
 await assert.rejects(removeNativeDeletion(f.root,f.value,{checkpoint:async stage=>{if(stage==='files'&&!changed){changed=true;await rename(f.root,original);await symlink(f.outside,f.root,'junction');}}}),{code:'UNSAFE'});
 assert.equal(changed,true);assert.deepEqual(await readdir(f.outside),['sentinel']);assert.equal(await readFile(path.join(f.outside,'sentinel'),'utf8'),'keep');
 await unlink(f.root);await rename(original,f.root);await removeNativeDeletion(f.root,f.value);await assert.rejects(access(f.root),{code:'ENOENT'});
});
test('native move cleanup retains changed destination originals and resumes verified deletion',windows,async t=>{
 const f=await fixture(t),destination=path.join(f.parent,'destination');await mkdir(path.join(destination,'.observanda','media'),{recursive:true});await unlink(path.join(f.root,DELETE_MARKER));
 const receipt={id:f.value.id,destination};await writeFile(path.join(f.root,MOVE_SOURCE),JSON.stringify(receipt));await writeFile(path.join(destination,'.observanda','media','one'),'changed');await writeFile(path.join(destination,'.observanda','media','two'),'two');
 await assert.rejects(removeNativeMove(f.root,receipt,{verifyDestination:true}),{code:'STORAGE_COPY'});assert.equal(await readFile(path.join(f.root,'.observanda','media','one'),'utf8'),'one');await access(path.join(f.root,MOVE_SOURCE));
 await writeFile(path.join(destination,'.observanda','media','one'),'one');await removeNativeMove(f.root,receipt,{verifyDestination:true});await assert.rejects(access(f.root),{code:'ENOENT'});
});
test('native retirement preserves identity and refuses a replacement of the admitted source',windows,async t=>{
 const f=await fixture(t),target=path.join(f.parent,'renamed');
 await retireNativeDirectory(f.root,target,async root=>{assert.equal((await nativeControl(root,DELETE_MARKER)).value.id,f.value.id);});await access(path.join(target,DELETE_MARKER));
 await assert.rejects(retireNativeDirectory(target,f.root,async()=>{await rename(target,path.join(f.parent,'original'));await symlink(f.outside,target,'junction');}),{code:'UNSAFE'});assert.deepEqual(await readdir(f.outside),['sentinel']);
});
