import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rename,rm} from 'node:fs/promises';
import {encodeProjectRegistryLocations,decodeProjectRegistryLocations} from '../src/project-registry-locations.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {Workspace} from '../src/storage.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
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
  const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-registry-locations-')),source=path.join(directory,'workspace'),destination=path.join(directory,'Research Workspace 2'),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime);let vault;
  t.after(async()=>{await runtime.close();detach();if(vault)clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-registry-locations-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
  const book=sampleNotebook();book.title=path.basename(source);book.projects=[];book.notebooks=[];book.entries=[];const fixture=await encryptedFixture(directory,book),workspace=fixture.workspace;vault=fixture.vault;
  const value={...registry([entry(path.join(source,'projects','Example experiments')),entry(path.join(directory,'External project'))]),workspaceId:book.id},owner=new ProjectRegistry(workspace,value.workspaceId);
  await workspace.writeFile(owner.file,JSON.stringify(value));
  const before=await owner.read(),changed=await owner.change(before.revision,next=>next),raw=JSON.parse(await workspace.readFile(owner.file,'utf8'));
  assert.equal(raw.version,8);assert.equal(JSON.stringify(raw).includes(source),false);const stored=await owner.directoryOwner.access.read(({directory,value:head})=>directory.find(head,value.projects[0].projectId,{decode:false}));assert.deepEqual(stored.entry.root,{relative:'projects/Example experiments'});
  assert.equal(changed.value.projects[0].root,value.projects[0].root);
  await assert.rejects(new WorkspaceRenames(path.join(directory,'rename-journal')).begin(workspace,path.basename(destination)),{code:'STORAGE_RENAME_PROJECTS'});
  await runtime.closeWorkspace(source);await rename(source,destination);
  const moved=new ProjectRegistry(new Workspace(destination,vault),value.workspaceId),after=await moved.read();
  assert.equal(after.revision,changed.revision);assert.equal(after.value.projects[0].root,path.join(destination,'projects','Example experiments'));
  assert.equal(after.value.projects[1].root,value.projects[1].root);
  const untouched=await moved.change(after.revision,next=>next);assert.equal(untouched.revision,after.revision);
});
