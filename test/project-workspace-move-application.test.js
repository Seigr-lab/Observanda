import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {ProjectWorkspaceMoves} from '../src/project-workspace-move.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectCreation} from '../src/project-creation.js';
import {Workspace} from '../src/storage.js';
import {createNotebook} from '../src/model.js';
import {initializeLocation} from '../src/locations.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {LabBookStorage} from '../src/lab-book-storage.js';

const password='Destination workspace 456!',parentPassword='Destination parent 789!';
test('workspace move application authenticates both workspaces and protected owners, then recovers after source departure',{timeout:360000},async t=>{
 const f=await projectTreeFixture(t),metadata=createNotebook('Receiving Workspace'),root=path.join(f.directory,metadata.title),access=await createWorkspaceAccess('',password,f.deviceStore),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));await initializeLocation(root,metadata,access,vault);
 const targetRegistry=new ProjectRegistry(new Workspace(root,vault),metadata.id),parentId=randomUUID(),{project:parent}=await new ProjectCreation(targetRegistry,f.deviceStore).create({id:randomUUID(),username:'',password:parentPassword,project:{id:parentId,title:'Protected Parent',description:'',parentId:null,share:false,logoId:null}});
 const settings={deviceStore:f.deviceStore,workspaceLocations:async()=>[{path:root,title:metadata.title}]};let app=new ProjectApplication(f.workspace,settings);t.after(()=>app.close());const client={},other={},projectId=f.projects[0].projectId;
 const run=(route,data,who=client)=>app.run(who,projectRequest('/api/projects/'+route,'POST'),data);
 const targetOpen=()=>run('move/target/open',{path:root,username:'',password,recovery:''});
 await assert.rejects(run('move/target/open',{path:f.directory,username:'',password,recovery:''}),{code:'NOT_FOUND'});
 await assert.rejects(run('move/target/open',{path:root,username:'',password:'incorrect password',recovery:''}),error=>['ACCESS_DENIED','AUTH'].includes(error.code));
 let target=await targetOpen();const choices={target:target.id,kind:'parents',exclude:null,query:'',offset:0,limit:25,revision:null};
 await assert.rejects(run('move/target/choices',choices,other),{code:'PROJECT_MOVE_DESTINATION_ACCESS'});assert.equal((await run('move/target/choices',choices)).projects[0].projectId,parentId);
 const command={id:randomUUID(),parentId,expectedParentId:null,target:target.id};
 await assert.rejects(run(projectId+'/storage/move',command),error=>error.projectId===parentId&&error.destinationWorkspaceId===metadata.id&&error.operationNotStarted===true);
 await run('move/target/unlock',{target:target.id,projectId:parentId,username:'',password:parentPassword,recovery:''});
 const missing=new Set();
 for(let attempt=0;attempt<3;attempt++){
  try{await run(projectId+'/storage/move',command);assert.fail('Protected books were not authorized');}catch(error){
   assert.equal(error.operationNotStarted,true);assert.ok(error.labBookId);assert.ok(!missing.has(error.labBookId));missing.add(error.labBookId);
   await run(error.projectId+'/lab-books/'+error.labBookId+'/access/unlock',{username:'',password:'Protected observations 456!',recovery:''});
   if(missing.size===f.books.length)break;
  }
 }
 assert.equal(missing.size,2);
 const originalFinish=ProjectWorkspaceMoves.prototype.finish;let expireOnce=true;
 const expire=t.mock.method(ProjectWorkspaceMoves.prototype,'finish',function(value,key,options){return originalFinish.call(this,value,key,{...options,checkpoint:async stage=>{if(stage==='stopped'&&expireOnce){expireOnce=false;app.moveTargets.entries.get(target.id).expires=0;}}});});
 await assert.rejects(run(projectId+'/storage/move',command),{code:'PROJECT_MOVE_DESTINATION_ACCESS'});expire.mock.restore();
 assert.equal((await run('move/pending',{after:null,limit:20})).items.length,1);app.moveTargets.expire();target=await targetOpen();command.target=target.id;
 await run('move/target/unlock',{target:target.id,projectId:parentId,username:'',password:parentPassword,recovery:''});
 const originalSave=ProjectWorkspaceMoves.prototype.save;
 const mock=t.mock.method(ProjectWorkspaceMoves.prototype,'save',async function(value){await originalSave.call(this,value);if(value.phase==='departed')throw Error('Interrupted after source departure');});
 await assert.rejects(run(projectId+'/storage/move',command),/Interrupted after source departure/);mock.mock.restore();
 const pending=await run('move/pending',{after:null,limit:20});assert.equal(pending.items.length,1);assert.equal(pending.items[0].phase,'departed');await assert.rejects(f.registry.locate(projectId),{code:'PROJECT_MOVED'});
 await app.close();await f.stopProvider();f.restartProvider();app=new ProjectApplication(f.workspace,settings);target=await targetOpen();
 await run('move/target/unlock',{target:target.id,projectId:parentId,username:'',password:parentPassword,recovery:''});
 const completed=await run(projectId+'/storage/move',{...command,target:target.id});assert.equal(completed.complete,true);assert.equal(completed.workspaceId,metadata.id);assert.equal(completed.project.root,path.join(parent.root,path.basename(f.projects[0].root)));assert.deepEqual((await run('move/pending',{after:null,limit:20})).items,[]);
 for(const book of f.books){const location=path.join(completed.project.root,path.relative(f.projects[0].root,book.root));assert.deepEqual(await new LabBookStorage(location,book.labBookId,book.key).read(),book.before);}
 await run('move/target/release',{target:target.id});await assert.rejects(run('move/target/choices',{...choices,target:target.id}),{code:'PROJECT_MOVE_DESTINATION_ACCESS'});
});
