import {dashboardCollectionStructure} from '../src/dashboard-collection-structure.js';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {projectCollectionScope} from '../src/project-collection-scope.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';

test('project cards and discovery resolve a retained workspace entry to its dedicated owner on every refresh',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-dashboard-membership-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];let application;
 try{
  const root=sampleNotebook(),f=await encryptedFixture(directory,root);keys.push(f.vault);
  const book=structuredClone(root);book.id=randomUUID();book.title=book.projects[0].title='Dedicated project';
  const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,book.title),book.projects[0].id,book,access,vault),registry=new ProjectRegistry(f.workspace,root.id);
  await registry.attach(project,{expected:'new'});application=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore});
  const client={},request=projectRequest('/api/projects/dashboard-collection/structure','POST'),command={workspaceId:root.id,etag:await f.workspace.catalogue(store=>store.head()),provider:'projects',config:defaultPanelConfig(),options:{},limit:100,key:null,cursor:null};
  for(let refresh=0;refresh<2;refresh++){
   const result=await application.run(client,request,command);assert.equal(result.total,1);assert.equal(result.items[0].title,'Dedicated project');assert.equal(result.items[0].action.data.workspaceId,book.id);assert.equal(result.items[0].data.id,root.projects[0].id);
  }
  const discover=await application.run(client,projectRequest('/api/projects/dashboard-collection/discovery','POST'),{workspaceId:root.id,etag:command.etag,provider:'projects',search:'',offset:0,limit:12,cursor:null});assert.equal(discover.total,1);assert.equal(discover.items[0].key,book.id+'/'+project.projectId);
  await assert.rejects(application.run(client,request,{...command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 }finally{await application?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-dashboard-membership-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('project cards use current membership and book owners, including deletions and cross-workspace relocation',async t=>{
 const workspaceId=randomUUID(),projectId=randomUUID(),namespaceId=randomUUID(),legacyId=randomUUID(),deletedId=randomUUID(),movedId=randomUUID(),foreignId=randomUUID();
 const entry={projectId,namespaceId,vaultId:randomUUID(),parentId:null,root:path.join(os.tmpdir(),'registered-project'),summary:null};
 const metadata={id:workspaceId,projects:[projectId,legacyId,deletedId,movedId].map(id=>({id,title:'Same project name'})),notebooks:[]};
 const directory={version:7,workspaceId,projects:[entry],aliases:null,deleted:[{projectId:deletedId,namespaceId:randomUUID(),vaultId:randomUUID(),operationId:randomUUID()}],relocated:[{projectId:movedId,namespaceId:randomUUID(),vaultId:randomUUID(),operationId:randomUUID(),workspaceId:randomUUID()}]};
 const hierarchy=await new ProjectRegistry({root:os.tmpdir()},workspaceId).hierarchy(directory,metadata);
 const dedicated={labBookId:randomUUID(),namespaceId:randomUUID(),vaultId:randomUUID(),directory:'Dedicated observations'},removed={labBookId:randomUUID()},moved={labBookId:randomUUID()},local={id:randomUUID(),title:'Local observations',projectId};
 const bookDirectory={books:[dedicated],deleted:[removed],relocated:[moved]};
 t.mock.method(LabBookRegistry.prototype,'read',async()=>({value:bookDirectory}));
 const projectMetadata={id:namespaceId,projects:[{id:projectId,title:'Same project name'},{id:foreignId,title:'Unrelated workspace project'},{id:legacyId,title:'Incorrect owner copy'}],notebooks:[...bookDirectory.books,...bookDirectory.deleted,...bookDirectory.relocated].map(book=>({id:book.labBookId,title:'Retained book entry',projectId})).concat(local)};
 const storage=(value,owner={})=>({root:os.tmpdir(),...owner,catalogue:read=>read({head:async()=> 'a'.repeat(64),snapshot:async()=>({metadata:value})})});
 const visit=async(consume,{selection})=>{const selected=projectCollectionScope(hierarchy,{selection});await consume(storage(metadata),{workspaceId,projectId:null},selected);await consume(storage(projectMetadata,{projectId}),{workspaceId:namespaceId,projectId},selected);};
 const pages=new RecordCollectionPages(),client={},command={workspaceId,etag:'a'.repeat(64),provider:'projects',config:defaultPanelConfig(),options:{},key:null,limit:1,cursor:null};
 try{
  const first=await dashboardCollectionStructure(pages,client,command,{visit}),second=await dashboardCollectionStructure(pages,client,{...command,cursor:first.nextCursor},{visit}),rows=[...first.items,...second.items];
  assert.equal(first.total,2);assert.equal(second.nextCursor,null);assert.deepEqual(new Set(rows.map(item=>item.data.id)),new Set([projectId,legacyId]));
  assert.equal(rows.find(item=>item.data.id===legacyId).action.data.workspaceId,workspaceId);
  const row=rows.find(item=>item.data.id===projectId);assert.equal(row.action.data.workspaceId,namespaceId);assert.equal(row.data.notebookTotal,2);
  assert.deepEqual(new Set(row.data.notebooks.map(book=>book.id)),new Set([local.id,dedicated.labBookId]));assert.equal(row.data.notebooks.find(book=>book.id===dedicated.labBookId).route.workspaceId,dedicated.namespaceId);
  const discovery=await dashboardCollectionStructure(pages,client,{...command,limit:10},{visit,discovery:{offset:0}});assert.equal(discovery.total,2);
 }finally{pages.clear();}
});
