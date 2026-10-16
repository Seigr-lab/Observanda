import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {access} from 'node:fs/promises';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {recordProjectDeparture,acceptRelocatedProject} from '../src/project-relocation-directory.js';
import {encodeProjectRegistryLocations,decodeProjectRegistryLocations} from '../src/project-registry-locations.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {safeError} from '../src/errors.js';
import {projectTreeFixture,destinationProject} from './project-tree-fixture.js';
const moved=()=>({projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),operationId:randomUUID(),workspaceId:randomUUID()});

test('departed project identities cannot alias live owners, deletion, hierarchy parents or the source workspace',()=>{
 const workspaceId=randomUUID(),registry=new ProjectRegistry({root:path.resolve('fixture')},workspaceId),relocated=moved(),project={projectId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),root:path.resolve('fixture','Project 1'),parentId:null,summary:null};
 const value={version:7,workspaceId,projects:[project],deleted:[],relocated:[relocated],aliases:null};registry.validate(value);
 for(const key of ['projectId','namespaceId','vaultId']){const invalid=structuredClone(value);invalid.relocated[0][key]=project[key];assert.throws(()=>registry.validate(invalid),{code:'FORMAT'});}
 for(const edit of [v=>v.relocated.push({...relocated}),v=>v.relocated[0].workspaceId=workspaceId,v=>v.projects[0].parentId=relocated.projectId,v=>v.relocated[0].root=path.resolve('private'),v=>v.relocated=null]){
  const invalid=structuredClone(value);edit(invalid);assert.throws(()=>registry.validate(invalid),{code:'FORMAT'});
 }
 assert.throws(()=>registry.validate(value,{legacyProjects:[{id:randomUUID(),parentId:relocated.projectId}]}),{code:'FORMAT'});
 const returned=structuredClone(value);assert.throws(()=>acceptRelocatedProject(returned,{...relocated,vaultId:randomUUID()}),{code:'DATABASE_LOCATION'});assert.equal(returned.relocated.length,1);
 acceptRelocatedProject(returned,relocated);assert.deepEqual(returned.relocated,[]);
 for(const paths of [path.win32,path.posix]){
  const root=paths.resolve('fixture'),destination=paths.resolve('elsewhere'),source={...value,projects:[{...project,root:paths.join(root,'Project 1')}]},encoded=encodeProjectRegistryLocations(source,root,paths),decoded=decodeProjectRegistryLocations(encoded,destination,paths);
  assert.equal(encoded.version,7);assert.deepEqual(decoded.relocated,value.relocated);assert.equal(decoded.projects[0].root,paths.join(destination,'Project 1'));assert.equal(source.projects[0].root,paths.join(root,'Project 1'));
 }
});

test('a whole project departure is atomic, repeatable and reference-safe without deleting its data',async t=>{
 const f=await projectTreeFixture(t),sibling=await destinationProject(f,t),registry=f.registry,entries=(await registry.read()).value.projects.filter(entry=>entry.projectId!==sibling.projectId),command={workspaceId:randomUUID(),operationId:randomUUID()},addresses=new LabBookDirectory(registry);
 for(const book of f.books)await addresses.register(book.projectId,book);
 const before=await registry.read();await assert.rejects(recordProjectDeparture(registry,entries.slice(0,1),command),{code:'CONFLICT'});assert.equal((await registry.read()).revision,before.revision);
 await assert.rejects(recordProjectDeparture(registry,[{...entries[0],vaultId:randomUUID()},entries[1]],command),{code:'CONFLICT'});
 let enter,release;const ready=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve),writer=f.workspace.withLock(async()=>{enter();await gate;});await ready;
 try{await recordProjectDeparture(registry,entries,command);}finally{release();await writer;}
 const reused={id:randomUUID(),username:'',password:'',project:{id:entries[0].projectId,title:'Unwanted duplicate',description:'',parentId:null,share:false,logoId:null}};
 await assert.rejects(new ProjectCreation(registry,f.deviceStore).create(reused),{code:'EXISTS'});await assert.rejects(access(path.join(f.root,reused.project.title)),{code:'ENOENT'});
 const after=await registry.read();assert.deepEqual(after.value.projects.map(entry=>entry.projectId),[sibling.projectId]);assert.equal(after.value.deleted.length,0);assert.equal(after.value.relocated.length,2);
 for(const entry of entries){
  const check=error=>{assert.equal(error.code,'PROJECT_MOVED');assert.equal(error.workspaceId,command.workspaceId);assert.equal(error.projectId,entry.projectId);assert.equal(safeError(error).workspaceId,command.workspaceId);assert.ok(!JSON.stringify(safeError(error)).includes(f.directory));return true;};
  await assert.rejects(registry.locate(entry.projectId),check);await assert.rejects(registry.namespace(entry.namespaceId),check);
 }
 for(const book of f.books){await assert.rejects(addresses.locate(book.namespaceId),{code:'PROJECT_MOVED'});assert.deepEqual(await new LabBookStorage(book.root,book.labBookId,book.key).read(),book.before);}
 const outline=(await f.workspace.outline()).metadata,legacy={...outline,projects:entries.map(entry=>({id:entry.projectId,title:path.basename(entry.root),parentId:entry.parentId}))};
 assert.deepEqual((await registry.hierarchy(after.value,legacy)).map(entry=>entry.projectId),[sibling.projectId]);
 assert.equal((await recordProjectDeparture(new ProjectRegistry(f.workspace,registry.workspaceId),entries,command)).revision,after.revision);
 await assert.rejects(recordProjectDeparture(registry,entries,{...command,operationId:randomUUID()}),{code:'CONFLICT'});
 const raw=JSON.parse(await f.workspace.readFile(registry.file,'utf8'));assert.deepEqual(raw.relocated,after.value.relocated);assert.ok(!JSON.stringify(raw).includes(f.root));
 for(const entry of entries){const current=await registry.read();await registry.registerExisting(current.revision,entry);}
 assert.equal((await registry.read()).value.relocated.length,0);for(const book of f.books)assert.equal((await addresses.locate(book.namespaceId)).projectId,book.projectId);
});
