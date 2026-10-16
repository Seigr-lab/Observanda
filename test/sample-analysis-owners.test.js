import path from 'node:path';
import {mkdir,rename} from 'node:fs/promises';
import {LabBookCopies} from '../src/lab-book-copy.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {Laboratory} from '../src/laboratory.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {sampleAnalysisOwnerFixture} from './sample-analysis-owner-fixture.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {ProjectDomains} from '../src/project-domains.js';
import {SampleAnalysisCatalogue} from '../src/sample-analysis-catalogue.js';
import {SampleAnalysisReader} from '../src/sample-analysis-reader.js';
import {defaultPanelConfig} from '../src/web/dashboard-model.js';
import {projectApiRoute} from '../src/web/project-context.js';

test('nested sample owners have independent writers, reports and bounded combined cards',{timeout:240000},async t=>{
 const f=await sampleAnalysisOwnerFixture(t),app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={};t.after(()=>app.close());
 for(const p of f.projects)await app.unlock(client,p.projectId,{});
 const request=(book,path,method='POST')=>projectRequest(projectApiRoute('/api/laboratory'+path,{projectId:book.projectId,labBookId:book.labBookId}),method);
 for(const b of f.books)await app.run(client,projectRequest('/api/projects/'+b.projectId+'/lab-books/'+b.labBookId+'/access/unlock','POST'),{password:'Protected observations 456!'});
 const b=f.books[0],o=f.owners[3],call=(path,data,options={})=>app.run(client,request(b,path),data,options),id=f.analyses[0].id;
 const selected=await call('/read/selected',{workspaceId:b.namespaceId,kind:'analysis',id});assert.equal(selected.record.result.value,3);
 let release,started;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve);
 const holding=o.storage.withLock(async()=>{started();await gate;});await ready;
 try{
  const saved=await Promise.race([call('/change',{action:'save-result',etag:selected.etag,id,expectedRecordRevision:selected.revision,result:{...selected.record.result,value:9},commandId:randomUUID()},{query:{compact:'1'}}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Sample command waited for research writer')),5000);timer.unref();})]);
  assert.ok(saved.recordRevision);assert.equal(saved.lab,undefined);
 }finally{release();await holding;}
 await new ProjectDomains(o.storage,o.workspaceId).run(['samples'],()=>o.storage.update(book=>({...book,description:'Research remains independent'})),{write:['samples']});
 const current=await call('/read/selected',{workspaceId:b.namespaceId,kind:'analysis',id});assert.equal(current.record.result.value,9);assert.equal((await new SampleAnalysisReader(f.owners[0].service).selected({workspaceId:f.workspaceId,kind:'analysis',id})).record.result.value,0);
 let approved=await call('/change',{action:'save-and-submit',etag:current.etag,id,expectedRecordRevision:current.revision,result:current.record.result},{query:{compact:'1'}});
 approved=await call('/change',{action:'review',etag:approved.etag,id,reviewer:'Fixture reviewer',comment:'Checked',decision:'approve',checked:true},{query:{compact:'1'}});
 let report;await app.run(client,request(b,'/issued/'+id,'GET'),{},{query:{revision:approved.etag},binary:async response=>{report=response;}});assert.equal(report.mime,'text/html; charset=utf-8');assert.match(report.content.toString(),/<td>9<\/td>/);
 const base={workspaceId:f.workspaceId,view:'all',config:defaultPanelConfig(),options:{},mode:'page',key:null,cursor:null,offset:0,limit:3},route=projectRequest('/api/projects/dashboard-collection/samples','POST'),read=(values={})=>app.run(client,route,{...base,...values});
 const original=SampleAnalysisCatalogue.prototype.value;let originals=0;t.mock.method(SampleAnalysisCatalogue.prototype,'value',async function(...args){const value=await original.apply(this,args);if(value.result?.notes!==undefined)originals++;return value;});
 const first=await read();assert.equal(first.total,10);let page=first;const rows=[...page.items];
 while(page.nextCursor){const before=page;page=await read({cursor:page.nextCursor});rows.push(...page.items);assert.deepEqual((await read({cursor:page.previousCursor})).items,before.items);}
 assert.equal(originals,0);assert.equal(new Set(rows.map(row=>row.collectionKey)).size,10);assert.equal(rows.filter(row=>row.id===id).length,5);
 const chosen=rows.find(row=>row.owner.labBookId===b.labBookId&&row.id===id);assert.deepEqual((await read({key:chosen.collectionKey})).items,[chosen]);
 assert.equal((await read({key:id})).items[0].owner.projectId,null);
 const options={scopeMode:'selected',projectIds:[b.projectId],includeWorkspace:false,includeDescendants:false,notebookMode:'selected',notebookIds:[b.labBookId]};
 assert.equal((await read({options})).total,2);assert.equal((await read({view:'samples',options})).items[0].analyses,1);assert.equal((await read({mode:'counts',options})).counts.approved,1);assert.ok((await read({view:'events',options})).items.every(event=>event.recordKind==='analysis'&&event.recordId===id));
 assert.equal((await read({mode:'discovery',offset:4,limit:2})).items.length,2);assert.equal((await read({options:{search:'not found'}})).total,0);
 await assert.rejects(read({options:{...options,notebookIds:[randomUUID()]}}),{code:'RECORD_VIEW_SCOPE'});await assert.rejects(app.run({},route,{...base,cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 await new ProjectDomains(o.storage,o.workspaceId).run(['calculator'],()=>read({cursor:first.nextCursor}),{write:['calculator']});
 await call('/change',{action:'create-sample',etag:approved.etag,sample:{code:'Extra sample',material:'Synthetic',source:'',collectedOn:'2026-10-01',receivedOn:'2026-10-01'}},{query:{compact:'1'}});await assert.rejects(read({cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 await app.run(client,projectRequest('/api/projects/'+b.projectId+'/lab-books/'+b.labBookId+'/access/lock','POST'),{});await assert.rejects(call('/read/selected',{workspaceId:b.namespaceId,kind:'analysis',id}),{code:'ACCESS_LOCKED'});await assert.rejects(read({key:chosen.collectionKey}),{code:'ACCESS_LOCKED'});
 assert.equal(await o.storage.catalogue(store=>store.object('laboratory')),null);
 t.mock.restoreAll();const parent=path.join(f.directory,'Copies');await mkdir(parent);
 const project=f.owners.find(owner=>owner.projectId===b.projectId&&!owner.labBookId),copies=new LabBookCopies(project.storage,b.labBookId),copyId=randomUUID();
 await assert.rejects(copies.run(o.storage,{id:copyId,parent,checkpoint:stage=>{if(stage==='files')throw Error('Interrupted sample copy');}}),/Interrupted sample copy/);
 assert.equal((await copies.run(o.storage,{id:copyId,resume:true})).phase,'complete');
 await app.close();await f.provider.closeLabBook(o.storage.root);await rename(o.storage.root,o.storage.root+'.unavailable');
 const copied=new Laboratory(new LabBookStorage(path.join(parent,b.directory),b.labBookId,o.storage.vault)),reader=new SampleAnalysisReader(copied),opened=await reader.selected({workspaceId:b.namespaceId,kind:'analysis',id});
 assert.equal(opened.record.result.value,9);assert.equal(opened.record.status,'approved');assert.match(await copied.report(id,approved.etag,[],{retained:true}),/<td>9<\/td>/);
 await copied.change({action:'amend',id,etag:opened.etag,reason:'Independent copied result'},{compact:true});assert.equal((await reader.selected({workspaceId:b.namespaceId,kind:'analysis',id})).record.status,'draft');

});
