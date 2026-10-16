import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {namedWorkspaceLocation} from '../src/locations.js';
import {validateWorkspaceName,workspaceFolderName,workspaceCreationPath,requireWorkspaceName} from '../src/workspace-names.js';

for(const [platform,parent] of [['win32','C:\\Users\\example\\Observanda'],['win32','\\\\files.example.test\\share'],['linux','/home/example/Observanda'],['darwin','/Users/example/Observanda']])test('exact folder spelling on '+platform+' at '+parent,()=>{
 const paths=platform==='win32'?path.win32:path.posix;
 for(const name of ['Research Workspace 1','Research  Workspace 1','Ångström & café','cafe\u0301','研究 1',"Apostrophe's study"]){
  const root=workspaceCreationPath(parent,name,{platform});assert.equal(root,paths.join(parent,name));assert.equal(workspaceFolderName(root,{platform}),name);assert.equal(requireWorkspaceName(root,name,{platform}),root);
 }
});

test('path validation distinguishes Windows drive and UNC roots from relative paths',()=>{
 for(const parent of ['C:\\','\\\\files.example.test\\share\\','C:/','//files.example.test/share/'])assert.equal(workspaceFolderName(workspaceCreationPath(parent,'Research Workspace 1',{platform:'win32'}),{platform:'win32'}),'Research Workspace 1');
 for(const parent of ['C:','C:relative','\\relative','relative','\\\\?\\C:\\','\\\\.\\device'])assert.throws(()=>workspaceCreationPath(parent,'Name',{platform:'win32'}),{code:'STORAGE_PATH'});
 for(const platform of ['linux','darwin']){assert.equal(workspaceCreationPath('/','Name',{platform}),'/Name');assert.throws(()=>workspaceCreationPath('relative','Name',{platform}),{code:'STORAGE_PATH'});}
});

test('unsupported names are rejected rather than trimmed, escaped or replaced',()=>{
 for(const platform of ['win32','linux','darwin'])for(const name of ['', '.', '..', 'One/Two',' leading','trailing ','line\nbreak','null\0byte','x'.repeat(161),'\ud800'])assert.throws(()=>validateWorkspaceName(name,{platform}),{code:'WORKSPACE_NAME'});
 for(const name of ['NUL','nul.txt','COM1','LPT².txt','ends.','with:colon','with\\slash','with?question'])assert.throws(()=>validateWorkspaceName(name,{platform:'win32'}),{code:'WORKSPACE_NAME'});
 for(const name of ['with:colon','with\\slash','ends.'])assert.equal(validateWorkspaceName(name,{platform:'linux'}),name);
 assert.throws(()=>validateWorkspaceName('界'.repeat(100),{platform:'linux'}),{code:'WORKSPACE_NAME'});
 assert.throws(()=>requireWorkspaceName('/tmp/Research-Workspace-1','Research Workspace 1',{platform:'linux'}),{code:'WORKSPACE_NAME_MISMATCH'});
});

test('real folders retain spaces and Unicode, and an existing destination is never overwritten',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-name-contract-'));
 try{
  const name='Research Workspace 1 – café',root=workspaceCreationPath(parent,name);await mkdir(root);await writeFile(path.join(root,'retained.txt'),'unchanged');
  assert.deepEqual(await readdir(parent),[name]);assert.equal(workspaceFolderName(root),name);await assert.rejects(mkdir(root),{code:'EEXIST'});assert.equal(await readFile(path.join(root,'retained.txt'),'utf8'),'unchanged');
 }finally{if(path.dirname(parent)!==path.resolve(os.tmpdir())||!path.basename(parent).startsWith('observanda-name-contract-'))throw Error('Unexpected test root');await rm(parent,{recursive:true,force:true});}
});


test('creation resolves the parent while retaining the literal final name',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-name-contract-'));
 try{
  const name='Research Workspace 1',root=await namedWorkspaceLocation({parent,name});assert.equal(root,path.join(parent,name));assert.deepEqual(await readdir(parent),[]);
  await assert.rejects(namedWorkspaceLocation({root:path.join(parent,'Research-Workspace-1'),name}),{code:'WORKSPACE_NAME_MISMATCH'});
  assert.deepEqual(await readdir(parent),[]);
  const same=await namedWorkspaceLocation({root,name});assert.equal(same,root);
  await assert.rejects(namedWorkspaceLocation({parent:path.join(parent,'Missing mount'),name}),{code:'ENOENT'});assert.deepEqual(await readdir(parent),[]);
 }finally{if(path.dirname(parent)!==path.resolve(os.tmpdir())||!path.basename(parent).startsWith('observanda-name-contract-'))throw Error('Unexpected test root');await rm(parent,{recursive:true,force:true});}
});
