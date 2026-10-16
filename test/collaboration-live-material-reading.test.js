import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collaborationFixture} from './fixtures/collaboration.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {createFigure} from '../src/web/figure-model.js';

test('shared material inspection follows exact retained sources without requiring a preparation or exposing private inputs',async t=>{
 const f=await collaborationFixture(t),m=new ResearchMaterials(f.author.workspace),[source,other,hidden]=f.book.entries;
 const upload=async(recordId,name,bytes)=>{const session=await m.startImport({recordId,name,size:bytes.length});await m.appendImport(session.id,0,[bytes]);return m.finishImport(session.id);};
 const precise='9007199254740993.000000001',bytes=Buffer.from('Take,Reading\nA,'+precise+'\nB,0.000000001\n'),original=await upload(other.id,'readings.csv',bytes),secret=await upload(hidden.id,'PRIVATE-name.bin',Buffer.from('PRIVATE bytes'));
 const dataset=await m.dataset({recordId:other.id,title:'Exact observations',artifact:original}),plot=await m.plot({recordId:other.id,title:'Observation counts',dataset,mapping:{x:0,xKind:'category',values:[],group:null,operation:'count',kind:'bar',order:'source',mode:'replace',decimal:'.'},base:createFigure()});
 const analysis=await m.analysis({recordId:source.id,title:'Inspection root',tool:'Synthetic decoder',version:'fixture-1',parameters:'Read exact retained values',inputs:[dataset,secret,plot.ref],outputs:[original]});
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',port:0,advertise:'https://127.0.0.1'}),client=new LiveClient(f.member.deviceStore,await host.card(f.grant.id));t.after(async()=>{client.close();await host.close();});
 const command={recordId:source.id,ref:analysis},read=await client.call('evidence-read',command);assert.equal(read.document.content.version,'fixture-1');assert.equal(read.document.title,'Inspection root');
 const inputs=await client.call('evidence-page',{...command,slot:'inputs'});assert.equal(inputs.items[0].title,'Exact observations');assert.deepEqual(inputs.items[1],{withheld:true});assert.ok(!JSON.stringify(inputs).includes('PRIVATE'));
 const data=await client.call('evidence-page',{...command,trail:[{slot:'inputs',index:0}],slot:'rows'});assert.equal(data.rows[0].cells[1],precise);assert.ok(data.rows[0].locator);assert.equal(data.columnCount,2);
 const figure=await client.call('evidence-read',{...command,trail:[{slot:'inputs',index:2}]});assert.equal(figure.document.title,'Observation counts');assert.deepEqual(figure.document.content.figure,(await m.read(plot.ref)).content.figure);
 await assert.rejects(client.call('evidence-read',{...command,trail:[{slot:'inputs',index:1}]}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(client.call('evidence-read',{recordId:source.id,ref:dataset}),{code:'COLLABORATION_DENIED'});
 const file={recordId:source.id,kind:'artifact',id:original.id,evidenceRef:analysis,evidenceTrail:[{slot:'outputs',index:0}]},response=await client.call('file',file,{stream:true}),chunks=[];for await(const chunk of response)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);
 await assert.rejects(client.call('file',{...file,id:secret.id},{stream:true}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(client.call('file',{...file,attemptRef:analysis},{stream:true}),{code:'COLLABORATION_INVALID'});
 // A metadata edit must not change the retained revision already selected.
 const doc=await m.read(analysis);await f.author.workspace.withLock(()=>m.commit({kind:'analysis',id:analysis.id,recordId:source.id,title:'Changed inspection root',expectedRevision:analysis.revision,content:{...doc.content,version:'fixture-2'}}));
 assert.equal((await client.call('evidence-read',command)).document.content.version,'fixture-1');
 await f.author.workspace.update(book=>{book.entries.find(r=>r.id===other.id).notebookId=hidden.notebookId;return book;});
 await assert.rejects(client.call('evidence-page',{...command,trail:[{slot:'inputs',index:0}],slot:'rows'}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(client.call('file',file,{stream:true}),{code:'COLLABORATION_DENIED'});
 const after=await client.call('evidence-page',{...command,slot:'inputs'});assert.ok(after.items.every(i=>i.withheld));
});
