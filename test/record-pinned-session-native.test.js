import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {ProjectRegistry} from '../src/project-registry.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {LabBookCreation} from '../src/lab-book-creation.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {viewQuery} from '../src/web/record-view-model.js';
import {timelineDefaults,timelineQuery} from '../src/web/tools/timeline-model.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';

test('real project and book grants reuse pinned results across request clones and retire on revocation',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-query-grants-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[];let app;
 try{
  const root=sampleNotebook(),f=await encryptedFixture(directory,root);keys.push(f.vault);const registry=new ProjectRegistry(f.workspace,root.id),book=sampleNotebook();book.title=book.projects[0].title='Query Project';
  const seed=book.entries[0];book.entries=Array.from({length:60},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Sample '+(120-i),status:'completed',tags:['batch']}));
  const access=await createWorkspaceAccess('','Project query password',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,book.title),book.projects[0].id,book,access,vault);await registry.attach(project,{expected:(await registry.read()).revision});
  const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(project.projectId,entry)}).create({id:randomUUID(),username:'',password:'Book query password',book:{id:randomUUID(),projectId:project.projectId,title:'Query Book'}}),key=await verifyAccess(await readAccess(created.book.root),'','Book query password',{deviceStore:f.deviceStore});keys.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key);await storage.update(value=>{value.entries=Array.from({length:60},(_,i)=>({...structuredClone(seed),id:randomUUID(),notebookId:storage.labBookId,title:'Sample '+(60-i),status:'completed',tags:['batch']}));return value;});
  app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore});const client={},prefix='/api/projects/'+project.projectId,request=(suffix,data)=>app.run(client,projectRequest(prefix+'/'+suffix,'POST'),data);
  await app.unlock(client,project.projectId,{password:'Project query password'});await request('lab-books/'+storage.labBookId+'/access/unlock',{password:'Book query password'});
  const original=ResearchCatalogue.prototype.queryDocuments;let decoded=0;t.mock.method(ResearchCatalogue.prototype,'queryDocuments',async function*(...args){for await(const value of original.apply(this,args)){decoded++;yield value;}});
  const command={workspaceId:book.id,query:viewQuery({project:project.projectId,recordBrowse:{sort:'title',tags:'batch'}}),mode:'browse',cursor:null,limit:25},first=await request('record-collection/query',command);assert.equal(first.total,120);assert.equal(decoded,120);decoded=0;
  const next=await request('record-collection/query',{...command,cursor:first.nextCursor});assert.equal(next.offset,25);assert.equal(decoded,0);assert.equal(pinnedQueryResults.stats().entries,2);
  const direct={workspaceId:created.book.namespaceId,query:viewQuery({recordBrowse:{sort:'title',tags:'batch'}}),cursor:null,limit:25};
  const own=await request('lab-books/'+storage.labBookId+'/research/records/query',direct);decoded=0;await request('lab-books/'+storage.labBookId+'/research/records/query',{...direct,cursor:own.nextCursor});assert.equal(decoded,0);
  const timeline={workspaceId:book.id,query:timelineQuery({...timelineDefaults(),status:'completed'}),cursor:null,limit:25},page=await request('timeline-collection/query',timeline);decoded=0;await request('timeline-collection/query',{...timeline,cursor:page.nextCursor});assert.equal(decoded,0);
  await request('lab-books/'+storage.labBookId+'/access/lock',{});assert.equal(pinnedQueryResults.stats().entries,0);await assert.rejects(request('record-collection/query',{...command,cursor:first.nextCursor}),{code:'ACCESS_LOCKED'});
  await request('lab-books/'+storage.labBookId+'/access/unlock',{password:'Book query password'});await request('record-collection/query',command);assert.ok(pinnedQueryResults.stats().entries>0);
  await app.lock(client,project.projectId);assert.equal(pinnedQueryResults.stats().entries,0);await assert.rejects(request('record-collection/query',command),{code:'ACCESS_LOCKED'});
  await app.unlock(client,project.projectId,{password:'Project query password'});await request('lab-books/'+storage.labBookId+'/access/unlock',{password:'Book query password'});await request('record-collection/query',command);await app.close();app=null;assert.equal(pinnedQueryResults.stats().entries,0);
  t.diagnostic(JSON.stringify({owners:2,records:120,page:25,repeatedSourceSummaryReads:0,bookRevocation:true,projectRevocation:true,applicationDrain:true}));
 }finally{await app?.close();await pinnedQueryResults.clear();await runtime.close();detach();for(const key of keys)await clearVault(key);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-query-grants-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
