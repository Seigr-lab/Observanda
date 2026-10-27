import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {publicationDraftCommand} from './publication-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {AnalysisPublicationReview} from '../src/analysis-publication-review.js';
import {startServer} from '../src/server.js';

async function bounded(promise,message,timeout=15000){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeout);})]);}
 finally{clearTimeout(timer);}
}

test('retained ZIP exports survive slow review, preserve review and privacy admission, and cancel disconnected checks',{timeout:180000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-export-lifecycle-'));
 const book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.relations=[];record.figures=[];record.body='Original observed value.';
 record.sections=[{id:randomUUID(),title:'Public procedure',body:'PUBLIC_EXPORT_PROCEDURE',share:true},{id:randomUUID(),title:'Private notes',body:'WITHHELD_EXPORT_NOTE',share:false}];
 book.entries=[record];book.pages=[];
 const f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace);
 let app,cookie,context,mode='normal',entered,cancelled,assertions=0,completedAssertions=0;
 const originalAssert=AnalysisPublicationReview.prototype.assert;
 const assertion=t.mock.method(AnalysisPublicationReview.prototype,'assert',async function(candidate,options){
  assertions++;assert.ok(options?.signal instanceof AbortSignal,'Export preflight must receive the client cancellation signal');
  if(mode==='slow')await delay(750,undefined,{signal:options.signal});
  if(mode==='abort'){
   entered.resolve();
   try{await delay(30000,undefined,{signal:options.signal});}
   finally{cancelled.resolve(options.signal.aborted);}
  }
  const result=await originalAssert.call(this,candidate,options);completedAssertions++;return result;
 });
 t.after(async()=>{
  assertion.mock.restore();await app?.close();clearVault(f.vault);
  assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-export-lifecycle-'));
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 });
 const pin=await materials.pinRecord(record.id,recordRevision(record));
 const analysis=await materials.analysis({recordId:record.id,title:'Retained interpretation',tool:'Synthetic interpretation',version:'1',parameters:'Original observation',inputs:[pin],outputs:[]});
 const current=await f.workspace.read(),original=current.book.entries[0];
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(original),record:{...original,body:'A later observed value.',results:{version:1,statements:[{id:randomUUID(),kind:'conclusion',basis:'retained',title:'Historical interpretation',text:'A retained interpretation requiring review.',limitations:'Synthetic qualification.',source:analysis}]}}}]});
 app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 assert.equal(session.status,200);cookie=session.headers.get('set-cookie').split(';')[0];
 context=(await(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}})).json()).contextId;
 function request(route,{method='GET',body,authenticated=true}={}){
  let req;
  const response=new Promise((resolve,reject)=>{
   const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
   req=http.request(app.origin+route,{method,agent:false,headers:{Origin:app.origin,'Content-Type':'application/json',...(authenticated?{Cookie:cookie,'X-Observanda-Workspace':context,'X-Observanda-Wait':'1'}:{}),...(bytes?{'Content-Length':bytes.length}:{})}},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
   });req.on('error',reject);req.end(bytes??undefined);
  });
  return {response,abort:()=>req.destroy(new Error('Intentional client disconnect'))};
 }
 const saved=await f.workspace.read(),command=await publicationDraftCommand(f.workspace,saved.book);
 const prepared=await request('/api/preview',{method:'POST',body:{workspaceId:book.id,...command}}).response;
 assert.equal(prepared.status,200,prepared.body.toString());const reviewId=JSON.parse(prepared.body).id;
 const releases=new PublicationJobs(f.workspace),candidate=await releases.read(reviewId),review=new AnalysisPublicationReview(releases.workspace),window=await review.window(candidate);
 assert.equal(window.total,1);assert.equal(window.decided,0);

 const anonymous=await request('/api/export/'+reviewId,{authenticated:false}).response;
 assert.equal(anonymous.status,401);assert.equal(assertions,0,'Anonymous downloads must not enter analysis preflight');
 const pending=await request('/api/export/'+reviewId).response;
 assert.equal(pending.status,422,pending.body.toString());assert.equal(JSON.parse(pending.body).code,'ANALYSIS_REVIEW');
 assert.notEqual(pending.headers['content-type'],'application/zip');assert.notEqual(pending.body.subarray(0,2).toString(),'PK');
 assert.equal(assertions,1);assert.equal(completedAssertions,0,'The real pending-review check must reject the download');
 await review.save(candidate,[{id:window.items[0].id,reason:'Retain the historical interpretation and disclose its changed input.'}]);

 // Each request uses a fresh connection, so it inherits the shortened idle
 // timeout. Only this export request may suspend it while preflight is active.
 app.server.setTimeout(200);mode='slow';
 for(const method of ['GET','POST']){
  const response=await request(method==='GET'?'/api/export/'+reviewId:'/api/export',{method,...(method==='POST'?{body:{id:reviewId}}:{})}).response;
  assert.equal(response.status,200,response.body.toString());assert.equal(response.headers['content-type'],'application/zip');
  assert.equal(response.body.readUInt32LE(0),0x04034b50);assert.ok(response.body.includes(Buffer.from('PUBLIC_EXPORT_PROCEDURE')));
  assert.ok(!response.body.includes(Buffer.from('WITHHELD_EXPORT_NOTE')));assert.ok(!response.body.includes(Buffer.from(f.workspace.root)));
  assert.equal(app.server.timeout,200,'Export must not disable the server-wide timeout');
 }
 assert.equal(completedAssertions,2,'GET and POST must both delegate to the original review and freshness checks');

 app.server.setTimeout(60000);mode='abort';entered=Promise.withResolvers();cancelled=Promise.withResolvers();
 const download=request('/api/export/'+reviewId),outcome=download.response.then(value=>({value}),error=>({error}));
 await bounded(Promise.race([entered.promise,outcome.then(result=>{throw new Error('Export ended before cancellable analysis preflight: '+(result.error?.message??result.value.status+' '+result.value.body.toString()));})]),'Export did not enter its cancellable analysis preflight');download.abort();
 assert.match((await outcome).error?.message??'',/Intentional client disconnect/);
 assert.equal(await bounded(cancelled.promise,'Disconnected export did not cancel its analysis preflight'),true);
 assert.equal(completedAssertions,2,'An aborted preflight must not approve or stream an edition');

 // Changing source consent advances the record revision, so exercise this
 // refusal after cancellation without pretending that a restored flag would
 // also restore the edition's original source revision.
 mode='normal';
 const withheld=await f.workspace.read();withheld.book.entries[0].sections[0].share=false;await f.workspace.save(withheld.book,withheld.etag);
 const privateSource=await request('/api/export/'+reviewId).response;
 assert.equal(privateSource.status,422,privateSource.body.toString());assert.equal(JSON.parse(privateSource.body).code,'PUBLICATION_PERMISSIONS_CHANGED');
 assert.notEqual(privateSource.headers['content-type'],'application/zip');assert.ok(!privateSource.body.includes(Buffer.from('PUBLIC_EXPORT_PROCEDURE')));
 await bounded(app.close(),'Server shutdown waited for an abandoned export');app=null;
});
