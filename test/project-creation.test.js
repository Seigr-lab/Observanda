import {ProjectOpening} from '../src/project-opening.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,access,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {ProjectStorage} from '../src/project-storage.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-creation-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];
 t.after(async()=>{await owner.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-creation-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const f=await encryptedFixture(path.join(directory,'workspace'),sampleNotebook());vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id),creation=new ProjectCreation(registry,f.deviceStore);
 const command=name=>({id:randomUUID(),path:path.join(f.workspace.root,name),project:{id:randomUUID(),title:name,description:'Private project description',parentId:null,share:false,logoId:null,kind:'Custom project',tools:[]},username:'',password:''});
 const open=async entry=>{const vault=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:f.deviceStore});vaults.push(vault);return new ProjectStorage(entry.root,entry.projectId,vault);};
 return {...f,directory,registry,creation,command,open,owner};
}
test('creation interrupted before registry attachment reopens one project without overwriting its edits',async t=>{
 const f=await fixture(t),command=f.command('portable'),attach=f.registry.attach.bind(f.registry);let failed=false;
 f.registry.attach=async(...args)=>{if(!failed){failed=true;throw Error('Interrupted before registry attachment');}return attach(...args);};
 await assert.rejects(f.creation.create(command),/Interrupted before registry attachment/);assert.equal((await f.registry.read()).value.projects.length,0);
 const project=await f.open({root:command.path,projectId:command.project.id});await project.update(book=>{book.projects[0].description='Edited after creation';return book;});const edited=(await project.outline()).etag;
 await f.owner.closeProject(command.path);
 const resumed=await new ProjectCreation(f.registry,f.deviceStore).create(command);assert.equal(resumed.project.projectId,command.project.id);assert.equal((await project.outline()).etag,edited);
 assert.equal((await f.registry.read()).value.projects.length,1);
 const reordered=Object.fromEntries(Object.entries(command).reverse());assert.deepEqual(await f.creation.create(reordered),resumed);assert.equal((await project.outline()).etag,edited);
 await assert.rejects(f.creation.create({...command,project:{...command.project,title:'Different request'}}),{code:'CONFLICT'});
 const journal=await readFile(path.join(f.workspace.root,'.observanda/project-created',command.id+'.obsv'));assert.ok(!journal.includes(Buffer.from('Private project description')));assert.ok(!journal.includes(Buffer.from(command.path)));
});
test('project creation has independent keys and serializes only registry attachment',async t=>{
 const f=await fixture(t),a=f.command('parent'),b=f.command('sibling');let release,entered;
 const held=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),busy=f.workspace.withLock(async()=>{entered();await held;});await ready;
 try{
  let admitted,continueFirst;const ready=new Promise(resolve=>admitted=resolve),gate=new Promise(resolve=>continueFirst=resolve),describe=f.registry.describe.bind(f.registry);let heldOnce=false;
  f.registry.describe=async(storage,...args)=>{if(storage.projectId===a.project.id&&!heldOnce){heldOnce=true;admitted();await gate;}return describe(storage,...args);};
  const firstRequest=f.creation.create(a);await ready;let second;
  try{second=await f.creation.create(b);}finally{continueFirst();}
  const first=await firstRequest,one=await f.open(first.project),two=await f.open(second.project);
  assert.notEqual(one.vault.id,two.vault.id);assert.notEqual(one.vault.id,f.vault.id);assert.ok(!one.vault.key.equals(two.vault.key));
  const child=f.command('child');child.project.parentId=first.project.projectId;child.path=path.join(first.project.root,child.project.title);const created=await f.creation.create(child);assert.equal(created.project.parentId,first.project.projectId);assert.equal((await(await f.open(created.project)).outline()).metadata.projects[0].parentId,null);
  const wrong=f.command('nested');wrong.path=path.join(one.root,'other');await assert.rejects(f.creation.create(wrong),{code:'STORAGE_PATH'});assert.equal((await f.registry.read()).value.projects.length,3);
 }finally{release();await busy;}
});

test('competing creation requests for one project identity create only one root',async t=>{
 const f=await fixture(t),a=f.command('first'),b=f.command('duplicate');b.project.id=a.project.id;
 const values=await Promise.allSettled([f.creation.create(a),f.creation.create(b)]);assert.equal(values.filter(value=>value.status==='fulfilled').length,1);assert.equal(values.find(value=>value.status==='rejected').reason.code,'EXISTS');
 const winner=values[0].status==='fulfilled'?a:b,loser=winner===a?b:a;
 await access(winner.path);await assert.rejects(access(loser.path),{code:'ENOENT'});assert.equal((await f.registry.read()).value.projects.length,1);
});


test('version one directories upgrade summaries without opening unrelated project databases',async t=>{
 const f=await fixture(t),command=f.command('cached'),created=await f.creation.create(command),entry=created.project;
 assert.equal(entry.summary.title,'cached');
 const old=structuredClone((await f.registry.read()).value);old.version=1;delete old.deleted;delete old.aliases;for(const project of old.projects)delete project.summary;
 await f.workspace.writeFile(f.registry.file,JSON.stringify(old));assert.equal((await f.registry.read()).value.version,1);
 const storage=await f.open(entry),metadata=(await storage.outline()).metadata;
 await f.registry.refreshSummary(entry.projectId,metadata);
 const upgraded=await f.registry.read();assert.equal(upgraded.value.version,6);assert.equal(upgraded.value.aliases,null);assert.deepEqual(upgraded.value.deleted,[]);assert.equal(upgraded.value.projects[0].summary.title,'cached');
 await f.registry.refreshSummary(entry.projectId,metadata);assert.equal((await f.registry.read()).revision,upgraded.revision);
 assert.throws(()=>f.registry.validate({...upgraded.value,projects:[{...upgraded.value.projects[0],summary:{title:'x'.repeat(161),description:'',kind:'Project'}}]}),{code:'FORMAT'});
});


test('unfinished creation is discoverable and resumes after restart with the original project access',async t=>{
 const f=await fixture(t),command=f.command('resume-from-directory');command.password='Original project password';
 const attach=f.registry.attach.bind(f.registry);f.registry.attach=async()=>{throw Error('Stopped before attachment');};
 await assert.rejects(f.creation.create(command),/Stopped before attachment/);f.registry.attach=attach;
 const restarted=new ProjectCreation(f.registry,f.deviceStore),pending=await restarted.pending();assert.equal(pending.items.length,1);assert.equal(pending.items[0].id,command.id);assert.equal(pending.items[0].running,false);assert.equal(pending.items[0].password,true);assert.ok(!JSON.stringify(pending).includes(command.password));
 await assert.rejects(restarted.resume({id:command.id,username:'',password:'Incorrect password'}),{code:'ACCESS_DENIED'});assert.equal((await f.registry.read()).value.projects.length,0);
 const result=await restarted.resume({id:command.id,username:'',password:command.password});assert.equal(result.project.projectId,command.project.id);assert.deepEqual(await restarted.pending(),{items:[],next:null});
 const receipt=await restarted.read(command.id);assert.equal(receipt.completed,true);assert.equal(receipt.intent.version,2);assert.ok(!Object.hasOwn(receipt.intent,'book'));assert.ok(!Object.hasOwn(receipt.intent,'access'));
 assert.deepEqual(await restarted.resume({id:command.id,username:'',password:''}),result);await assert.rejects(access(f.creation.file(command.id)),{code:'ENOENT'});
});

test('creation discovery finalizes interrupted acknowledgement after the adopted project was edited and moved',async t=>{
 const f=await fixture(t),command=f.command('adopted'),finish=f.creation.finish.bind(f.creation);f.creation.finish=async()=>{throw Error('Lost creation acknowledgement');};await assert.rejects(f.creation.create(command),/Lost creation acknowledgement/);f.creation.finish=finish;
 const entry=await f.registry.locate(command.project.id),storage=await f.open(entry);await storage.update(book=>{book.projects[0].description='Changed after adoption';return book;});const retained=(await storage.outline()).etag;
 await f.owner.closeProject(entry.root);const destination=path.join(f.directory,'relocated');await rename(entry.root,destination);const moved=new ProjectStorage(destination,entry.projectId,storage.vault);await f.registry.relocate(moved,{from:entry.root,expected:(await f.registry.read()).revision});
 const restarted=new ProjectCreation(f.registry,f.deviceStore);assert.deepEqual(await restarted.pending(),{items:[],next:null});const result=await restarted.resume({id:command.id,username:'',password:''});assert.equal(result.project.root,destination);assert.equal((await moved.outline()).etag,retained);await assert.rejects(access(entry.root),{code:'ENOENT'});assert.equal((await restarted.read(command.id)).intent.version,2);
});


test('a project inside its workspace has independent storage and can be reopened',async t=>{
 const f=await fixture(t),command=f.command('Local Project 1');command.path=path.join(f.workspace.root,command.project.title);
 const {project}=await f.creation.create(command),owned=await f.open(project);
 assert.equal(project.root,command.path);assert.notEqual(owned.vault.id,f.workspace.vault.id);
 assert.equal((await owned.outline()).metadata.projects[0].title,'Local Project 1');
 const serialized=JSON.parse(await f.workspace.readFile(f.registry.file,'utf8'));
 assert.deepEqual(serialized.projects[0].root,{relative:'Local Project 1'});
 await f.owner.closeProject(project.root);
 const reopened=await new ProjectOpening(f.registry,f.deviceStore).open({id:randomUUID(),path:project.root,username:'',password:'',recovery:''});
 assert.equal(reopened.project.namespaceId,project.namespaceId);
 await mkdir(path.join(f.workspace.root,'Files','.observanda'),{recursive:true});
 for(const input of [f.workspace.root,f.directory,path.join(f.workspace.root,'.observanda','Other'),path.join(f.workspace.root,'Files','.observanda','Other'),path.join(project.root,'Other')]){
  const rejected={...f.command('Other'),path:input};await assert.rejects(f.creation.create(rejected),{code:'STORAGE_PATH'});
 }
 assert.equal((await f.registry.read()).value.projects.length,1);
});


test('project creation rejects folder/title disagreement and invalid literal names',async t=>{
 const f=await fixture(t),request=f.command('Field Project 1');request.path=path.join(f.workspace.root,'Field-Project-1');
 await assert.rejects(f.creation.create(request),{code:'STORAGE_NAME_MISMATCH'});
 await assert.rejects(access(request.path),{code:'ENOENT'});
 assert.deepEqual((await f.creation.pending()).items,[]);
 assert.equal((await f.registry.read()).value.projects.length,0);
 for(const title of ['A/B',' Leading','Trailing ','..']){
  const invalid={...f.command('Invalid'),project:{...request.project,id:randomUUID(),title}};
  await assert.rejects(f.creation.create(invalid),{code:'FOLDER_NAME'});
  await assert.rejects(access(invalid.path),{code:'ENOENT'});
 }
 const valid=f.command('Field Project 1');valid.path=path.join(f.workspace.root,valid.project.title);
 const result=await f.creation.create(valid);
 assert.equal(path.basename(result.project.root),'Field Project 1');
 assert.equal(result.project.summary.title,'Field Project 1');
 assert.equal((await (await f.open(result.project)).outline()).metadata.projects[0].title,'Field Project 1');
});


test('project creation derives literal child folders when no path is supplied',async t=>{
 const f=await fixture(t),parent=f.command('Field Project 1');delete parent.path;
 const first=await f.creation.create(parent);assert.equal(first.project.root,path.join(f.workspace.root,parent.project.title));
 const child=f.command('Measurement notes 2');delete child.path;child.project.parentId=first.project.projectId;
 const second=await f.creation.create(child);assert.equal(second.project.root,path.join(first.project.root,child.project.title));
 await f.owner.closeProject(second.project.root);
 const opened=await new ProjectOpening(f.registry,f.deviceStore).open({id:randomUUID(),path:second.project.root,username:'',password:'',recovery:''});assert.equal(opened.project.parentId,first.project.projectId);
 const rejected=f.command('Elsewhere');rejected.path=path.join(f.directory,'Elsewhere');await assert.rejects(f.creation.create(rejected),{code:'STORAGE_PATH'});
});
