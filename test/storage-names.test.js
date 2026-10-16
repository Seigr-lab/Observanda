import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {storageCreationPath,storageFolderName,requireStorageName,validateStorageName} from '../src/storage-names.js';

for(const [platform,parent] of [['win32','C:\\Research'],['win32','\\\\files.example.test\\research'],['linux','/home/example/Research'],['darwin','/Users/example/Research']]){
 test('literal names at every level of the hierarchy on '+platform+' at '+parent,()=>{
  const names=['Research Workspace 1','Field Project  2','Lab Book 3 - caf\u00e9'],paths=platform==='win32'?path.win32:path.posix;let root=parent;
  for(const name of names){const child=storageCreationPath(root,name,{platform});assert.equal(paths.dirname(child),paths.resolve(root));assert.equal(storageFolderName(child,{platform}),name);assert.equal(requireStorageName(child,name,{platform}),child);root=child;}
  assert.equal(root,paths.join(parent,...names));
  assert.throws(()=>requireStorageName(paths.join(paths.dirname(root),'Lab-Book-3-cafe'),names.at(-1),{platform}),{code:'STORAGE_NAME_MISMATCH'});
 });
}

test('owner names cannot introduce another path level or silently lose spelling',()=>{
 for(const platform of ['win32','linux','darwin'])for(const name of ['','.', '..','Project/Book',' Book','Book ','line\nbreak','\ud800'])assert.throws(()=>validateStorageName(name,{platform}),{code:'FOLDER_NAME'});
 for(const name of ['Project\\Book','CON','NUL.txt','ends.','Book:1'])assert.throws(()=>validateStorageName(name,{platform:'win32'}),{code:'FOLDER_NAME'});
 for(const name of ['One  Two','cafe\u0301','caf\u00e9'])assert.equal(validateStorageName(name,{platform:'linux'}),name);
});
