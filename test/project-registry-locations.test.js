import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,rename,rm} from 'node:fs/promises';
import {encodeProjectRegistryLocations,decodeProjectRegistryLocations} from '../src/project-registry-locations.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {WorkspaceRenames} from '../src/workspace-rename.js';
const entry=root=>({projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),parentId:null,summary:null,root});
const registry=projects=>({version:5,workspaceId:randomUUID(),projects,deleted:[],aliases:null});

for(const [label,paths,source,destination,external] of [
  ['Windows',path.win32,'C:\\Research\\Research Workspace 1','D:\\Archive\\Research Workspace 1','E:\\Other Project'],
  ['Windows NAS',path.win32,'\\\\files.example.test\\Research\\Research Workspace 1','\\\\files.example.test\\Archive\\Research Workspace 1','C:\\Other Project'],
  ['Ubuntu',path.posix,'/home/research/Research Workspace 1','/media/research/Research Workspace 1','/srv/Other Project'],
  ['macOS',path.posix,'/Users/research/Research Workspace 1','/Volumes/Archive/Research Workspace 1','/Volumes/Other Project']
])test(label+' keeps literal names and independent external owners during registry relocation',()=>{
  const relative=['projects','Microscope ? experiments'],value=registry([entry(paths.join(source,...relative)),entry(external)]);
  const encoded=encodeProjectRegistryLocations(value,source,paths);
  assert.equal(encoded.version,6);assert.deepEqual(encoded.projects[0].root,{relative:relative.join('/')});
  assert.equal(encoded.projects[1].root,external);
  const decoded=decodeProjectRegistryLocations(encoded,destination,paths);
  assert.equal(decoded.projects[0].root,paths.join(destination,...relative));assert.equal(decoded.projects[1].root,external);
  assert.deepEqual({...decoded.projects[0],root:value.projects[0].root},value.projects[0]);
  assert.equal(value.version,5);assert.equal(value.projects[0].root,paths.join(source,...relative));
  assert.deepEqual(encodeProjectRegistryLocations(decoded,destination,paths),encoded);
});

test('portable location decoding rejects escape paths and ambiguous path syntax',()=>{
  for(const paths of [path.win32,path.posix])for(const relative of ['../outside','projects/../../outside','/absolute','projects//item','projects/./item','C:/outside','projects/escape:stream','projects\\outside','projects/\u0000item','']) {
    const value=registry([entry({relative})]);value.version=6;
    assert.throws(()=>decodeProjectRegistryLocations(value,paths.resolve('fixture'),paths),{code:'FORMAT'},relative);
  }
});

test('encrypted directory resolves owned projects after its folder moves without rewriting the receipt',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-registry-locations-')),source=path.join(directory,'Research Workspace 1'),destination=path.join(directory,'Research Workspace 2'),vault={id:randomUUID(),key:randomBytes(32)};
  t.after(async()=>{clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-registry-locations-'));await rm(directory,{recursive:true,force:true});});
  await mkdir(path.join(source,'.observanda'),{recursive:true});const workspace=new Workspace(source,vault);
  const value=registry([entry(path.join(source,'projects','Example experiments')),entry(path.join(directory,'External project'))]),owner=new ProjectRegistry(workspace,value.workspaceId);
  await workspace.writeFile(owner.file,JSON.stringify(value));
  const before=await owner.read(),changed=await owner.change(before.revision,next=>next),raw=JSON.parse(await workspace.readFile(owner.file,'utf8'));
  assert.deepEqual(raw.projects[0].root,{relative:'projects/Example experiments'});
  assert.equal(changed.value.projects[0].root,value.projects[0].root);
  await assert.rejects(new WorkspaceRenames(path.join(directory,'rename-journal')).begin(workspace,path.basename(destination)),{code:'STORAGE_RENAME_PROJECTS'});
  await rename(source,destination);
  const moved=new ProjectRegistry(new Workspace(destination,vault),value.workspaceId),after=await moved.read();
  assert.equal(after.revision,changed.revision);assert.equal(after.value.projects[0].root,path.join(destination,'projects','Example experiments'));
  assert.equal(after.value.projects[1].root,value.projects[1].root);
  const untouched=await moved.change(after.revision,next=>next);assert.equal(untouched.revision,after.revision);
});
