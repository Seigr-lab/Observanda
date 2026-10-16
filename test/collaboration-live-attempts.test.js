import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {preparation,event,assessment,fact} from './fixtures/attempts.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {recordRevision} from '../src/research.js';

test('shared attempt facts merge independent additions, retain exact methods and reject conflicting corrections atomically',async t=>{
 const f=await collaborationFixture(t),ws=f.author.workspace,{book}=await ws.read(),[source,method,hidden]=book.entries;
 const host=await startLiveHost(ws,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());const card=await host.card(f.grant.id),a=new LiveClient(f.member.deviceStore,card),b=new LiveClient(f.member.deviceStore,card);t.after(()=>{a.close();b.close();});
 const command=(kind,item)=>({recordId:source.id,id:item.id,kind,item});
 const {reference}=await a.call('attempt-pin',{recordId:source.id,ref:{kind:'record',id:method.id,revision:recordRevision(method)}}),p=preparation({protocols:[reference]});p.conditions[0].value='9007199254740993.000000001';
 await a.call('attempt-append',command('preparation',p));
 let saved=(await a.call('read',{recordId:source.id})).record;assert.equal(saved.attempt.preparations[0].recordedAt===p.recordedAt,false);assert.equal(saved.attempt.preparations[0].conditions[0].value,p.conditions[0].value);assert(saved.relations.some(r=>r.role==='uses-method'&&r.target.revision===reference.revision));
 const e=event(p),assess=assessment(p,1);await Promise.all([a.call('attempt-append',command('event',e)),b.call('attempt-append',command('assessment',assess))]);
 await a.call('attempt-append',command('event',e));saved=(await a.call('read',{recordId:source.id})).record;assert.equal(saved.attempt.events.length,1);assert.equal(saved.attempt.assessments.length,1);assert.equal(saved.status,source.status);assert.equal(saved.attempt.events[0].time.value,e.time.value);
 const amended={...structuredClone(p),...fact(),supersedes:p.id,applicability:'Only later acquisitions',reason:'Change controlled window'};amended.conditions[0].value='240';await b.call('attempt-append',command('preparation',amended));
 await assert.rejects(a.call('attempt-append',command('preparation',{...p,...fact(),supersedes:p.id,reason:'Stale amendment'})),{code:'RECORD_CHANGED'});
 const correction={...assess,...fact(),supersedes:assess.id,reason:'Independent reference remains unavailable',outcome:'unavailable'};await a.call('attempt-append',command('assessment',correction));
 await assert.rejects(b.call('attempt-append',command('assessment',{...assess,...fact(),supersedes:assess.id,reason:'Conflicting interpretation'})),{code:'RECORD_CHANGED'});
 const before=(await a.call('read',{recordId:source.id})).record,write=ws.writeMetadata;ws.writeMetadata=async function(file,data){if(file.includes('/live/activity/'))throw Error('Synthetic failed audit');return write.call(this,file,data);};
 try{await assert.rejects(a.call('attempt-append',command('event',event(amended))));}finally{ws.writeMetadata=write;}assert.deepEqual((await a.call('read',{recordId:source.id})).record,before);
 await assert.rejects(a.call('attempt-append',command('assessment',{...assessment(p),criterionId:randomUUID()})),{code:'COLLABORATION_INVALID'});
 await assert.rejects(a.call('attempt-append',{...command('event',e),item:{...e,circumstances:'Reused operation identity'}}),{code:'CONFLICT'});
 await ws.update(book=>{book.entries.find(r=>r.id===method.id).body='Changed method after acquisition';return book;});assert.deepEqual((await a.call('attempt-read',{recordId:source.id,ref:reference})).record,method);
 const privateRef={kind:'record',id:hidden.id,revision:recordRevision(hidden)};await assert.rejects(a.call('attempt-pin',{recordId:source.id,ref:privateRef}),{code:'COLLABORATION_DENIED'});
 await ws.withLock(()=>new ResearchMaterials(ws).retainRecord(hidden));await assert.rejects(a.call('attempt-append',command('event',event(p,{references:[{...privateRef,workspaceId:book.id,label:'Hidden method'}]}))),{code:'COLLABORATION_DENIED'});
 await ws.update(book=>{book.entries.find(r=>r.id===method.id).notebookId=hidden.notebookId;return book;});await assert.rejects(a.call('attempt-read',{recordId:source.id,ref:reference}),{code:'COLLABORATION_DENIED'});
 const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:book.id,expectedRevision:1,role:'reader'});
 assert.equal((await a.call('attempt',{recordId:source.id})).attempt.preparations.length,2);await assert.rejects(a.call('attempt-append',command('event',e)),{code:'COLLABORATION_DENIED'});
});

test('shared structured evidence keeps original bytes and checks current ownership for every retained reference and download',async t=>{
 const f=await collaborationFixture(t),ws=f.author.workspace,{book}=await ws.read(),source=book.entries[0],hidden=book.entries[2],materials=new ResearchMaterials(ws),bytes=Buffer.from('Synthetic original: exact retained acquisition');
 const upload=await materials.startImport({recordId:source.id,name:'capture.bin',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 const host=await startLiveHost(ws,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());const a=new LiveClient(f.member.deviceStore,await host.card(f.grant.id));t.after(()=>a.close());
 const {reference}=await a.call('attempt-pin',{recordId:source.id,ref:artifact}),item=event(null,{references:[reference]});await a.call('attempt-append',{recordId:source.id,id:item.id,kind:'event',item});
 const retained=await a.call('attempt-read',{recordId:source.id,ref:reference});assert.equal(retained.document.content.name,'capture.bin');
 const response=await a.call('file',{recordId:source.id,kind:'artifact',id:artifact.id,attemptRef:artifact},{stream:true});assert.deepEqual(Buffer.concat(await Array.fromAsync(response)),bytes);
 await assert.rejects(a.call('attempt-read',{recordId:source.id,ref:{...artifact,revision:'0'.repeat(64)}}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(a.call('file',{recordId:source.id,kind:'artifact',id:randomUUID(),attemptRef:artifact}),{code:'COLLABORATION_DENIED'});
 const secret=await materials.startImport({recordId:hidden.id,name:'private.bin',size:bytes.length});await materials.appendImport(secret.id,0,[bytes]);const secretRef=await materials.finishImport(secret.id);
 await assert.rejects(a.call('attempt-pin',{recordId:source.id,ref:secretRef}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(a.call('attempt-append',{recordId:source.id,id:randomUUID(),kind:'event',item:event(null,{references:[{...secretRef,workspaceId:book.id,label:'Private evidence'}]})}),{code:'COLLABORATION_DENIED'});
 assert.equal((await a.call('attempt',{recordId:source.id})).attempt.events.length,1);
});

test('shared retained analysis inspection pages precise datasets, follows verified reference positions and withholds private inputs',async t=>{
 const f=await collaborationFixture(t),ws=f.author.workspace,{book}=await ws.read(),source=book.entries[0],hidden=book.entries[2],materials=new ResearchMaterials(ws);
 const upload=async(recordId,name,bytes)=>{const task=await materials.startImport({recordId,name,size:bytes.length});await materials.appendImport(task.id,0,[bytes]);return materials.finishImport(task.id);};
 const exact='9007199254740993.000000001',bytes=Buffer.from(Array.from({length:18},(_,i)=>'Channel '+i).join(',')+'\n'+Array.from({length:310},(_,i)=>[i,...Array(17).fill(exact)].join(',')).join('\n'));
 const original=await upload(source.id,'exact.csv',bytes),dataset=await materials.dataset({recordId:source.id,title:'Precise retained values',artifact:original});
 const secret=await upload(hidden.id,'Do not disclose this filename.bin',Buffer.from('private'));
 const analysis=await materials.analysis({recordId:source.id,title:'Retained decoder',tool:'Native test decoder',version:'fixture-1',parameters:'Keep exact decimal spelling',inputs:[dataset,secret],outputs:[original]});
 const host=await startLiveHost(ws,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0});t.after(()=>host.close());const a=new LiveClient(f.member.deviceStore,await host.card(f.grant.id));t.after(()=>a.close());
 const {reference}=await a.call('attempt-pin',{recordId:source.id,ref:analysis}),e=event(null,{references:[reference]});await a.call('attempt-append',{recordId:source.id,id:e.id,kind:'event',item:e});
 const base={recordId:source.id,ref:analysis},trail=[{slot:'inputs',index:0}],inputs=await a.call('attempt-page',{...base,slot:'inputs'});assert.equal(inputs.items[0].title,'Precise retained values');assert.deepEqual(inputs.items[1],{withheld:true});assert(!JSON.stringify(inputs).includes(secret.id));
 assert.equal((await a.call('attempt-read',base)).document.content.parameters,'Keep exact decimal spelling');assert.equal((await a.call('attempt-read',{...base,trail})).document.id,dataset.id);
 await assert.rejects(a.call('attempt-read',{...base,trail:[{slot:'inputs',index:1}]}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(a.call('attempt-read',{...base,trail:[{slot:'inputs',index:2}]}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(a.call('attempt-page',{recordId:source.id,ref:dataset,slot:'rows'}),{code:'COLLABORATION_DENIED'});
 let cursor={page:0,rowOffset:0};const actual=[];while(cursor){const page=await a.call('attempt-page',{...base,trail,slot:'rows',...cursor,columnOffset:0});assert(page.rows.length<=50);assert.equal(page.columns.length,16);assert.equal(page.columnCount,18);actual.push(...page.rows);cursor=page.next;}
 assert.equal(actual.length,310);assert.equal(new Set(actual.map(r=>r.id)).size,310);assert(actual.every(r=>r.cells[1]===exact));assert.deepEqual(actual.map(r=>r.id),(await materials.datasetRows(dataset)).map(r=>r.id));
 const tail=await a.call('attempt-page',{...base,trail,slot:'rows',columnOffset:16});assert.equal(tail.columns.length,2);assert.equal(tail.rows[0].cells[1],exact);
 const file=await a.call('file',{recordId:source.id,kind:'artifact',id:original.id,attemptRef:analysis,attemptTrail:[{slot:'outputs',index:0}]},{stream:true});assert.deepEqual(Buffer.concat(await Array.fromAsync(file)),bytes);
 await assert.rejects(a.call('file',{recordId:source.id,kind:'artifact',id:secret.id,attemptRef:analysis,attemptTrail:[{slot:'outputs',index:0}]}),{code:'COLLABORATION_DENIED'});
 await ws.update(book=>{book.entries.find(r=>r.id===source.id).notebookId=hidden.notebookId;return book;});await assert.rejects(a.call('attempt-page',{...base,trail,slot:'rows'}),{code:'COLLABORATION_DENIED'});
});
