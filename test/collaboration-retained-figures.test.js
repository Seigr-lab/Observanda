import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {collaborationFixture} from './fixtures/collaboration.js';
import {retainedCollaborationFigure} from './fixtures/retained-collaboration-figure.js';
import {startLiveHost} from '../src/collaboration/live-host.js';
import {LiveClient} from '../src/collaboration/live-client.js';
import {LiveResearch} from '../src/collaboration/live-research.js';
import {startServer} from '../src/server.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ChangeReview} from '../src/collaboration/change-review.js';
import {ResearchExchange} from '../src/collaboration/research-exchange.js';
import {sharedReviewFigure} from '../src/collaboration/review-figures.js';
import {readAccess,verifyAccess} from '../src/access.js';
import {Workspace} from '../src/storage.js';
import {ExchangeParts} from '../src/collaboration/exchange-parts.js';
import {contentBuffer} from '../src/file-content.js';
import {digest} from '../src/storage-format.js';
import {ResearchTransfer} from '../src/collaboration/research-transfer.js';
import {RetainedFigureAuthoring} from '../src/retained-figure-authoring.js';
import {RetainedFigureDocuments} from '../src/retained-figure-document.js';
import {RecordValues} from '../src/record-values.js';
const gate=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
async function bounded(operation){let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('A stalled figure download blocked an authoring or access change')),8000);})]);}finally{clearTimeout(timer);}}
const text=async chunks=>{let value='';for await(const chunk of chunks)value+=typeof chunk==='string'?chunk:chunk.toString('utf8');return value;};
async function session(app){
 const headers={Origin:app.origin,'Content-Type':'application/json'},response=await fetch(app.origin+'/api/session',{method:'POST',headers,body:JSON.stringify({token:app.launchToken})});assert.equal(response.status,200);headers.Cookie=response.headers.get('set-cookie').split(';')[0];
 const storage=await (await fetch(app.origin+'/api/storage',{headers})).json();return {headers,contextId:storage.contextId,post:(url,data)=>fetch(app.origin+url,{method:'POST',headers,body:JSON.stringify(data)})};
}
async function edit(workspace,workspaceId,id,title){
 const record=(await workspace.read()).book.entries.find(row=>row.id===id);await new ResearchRecords(workspace,{}).save({workspaceId,changes:[{id,expectedRevision:recordRevision(record),record:{...record,title}}]});
}
async function revoke(f){const {generation,...grant}=f.grant;void generation;await f.sa.access.saveLocal(await f.a.identity.public(),{...grant,workspaceId:f.book.id,expectedRevision:1,active:false});}

test('live retained figures authorize exact records and reference chains for complete streamed exports',{timeout:180000},async t=>{
 const f=await collaborationFixture(t),recordId=f.book.entries[0].id,hiddenId=f.book.entries[2].id,{figure,source,materials,composition}=await retainedCollaborationFigure(f.author.workspace,f.book.id,recordId,{nested:true}),hidden=await retainedCollaborationFigure(f.author.workspace,f.book.id,hiddenId,{title:'Unshared figure'});
 const original=(await f.author.workspace.read()).book.entries.find(row=>row.id===recordId),pinned=await materials.pinRecord(recordId,recordRevision(original)),linkId=randomUUID(),linkedId=f.book.entries[1].id,linked=(await f.author.workspace.read()).book.entries.find(row=>row.id===linkedId);
 await new ResearchRecords(f.author.workspace,{}).save({workspaceId:f.book.id,changes:[{id:linkedId,expectedRevision:recordRevision(linked),record:{...linked,relations:[...linked.relations,{id:linkId,type:'Method',label:original.title,target:{workspaceId:f.book.id,kind:'record',id:recordId,revision:pinned.revision}}]}}]});
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',port:0,advertise:'https://127.0.0.1'});t.after(()=>host.close());const card=await host.card(f.grant.id),peer=new LiveClient(f.member.deviceStore,card);t.after(()=>peer.close());
 const read=await peer.call('read',{recordId}),selector={recordId,figureId:figure.id,revision:read.revision};
 const selectedHeader=await peer.call('figure',{...selector,operation:'header'});assert.equal(selectedHeader.header.title,figure.title);assert.equal(selectedHeader.header.x.label,'Edited shared coordinate');
 {const language='nb',localized=await peer.call('figure',{...selector,operation:'svg',window:{plotId:figure.id,seriesOffset:0,seriesLimit:1,pointOffset:128,pointLimit:9},language});assert.equal(localized.language,language);assert.equal(localized.revision,selector.revision);assert.deepEqual(localized.document,selectedHeader.document);assert.equal((localized.svg.match(/class="figure-observation"/g)??[]).length,9);}
 const tail=await peer.call('figure',{...selector,operation:'window',selection:{collection:'points',plotId:figure.id,seriesId:figure.series[0].id,offset:128,limit:9}});assert.deepEqual(tail.items.map(row=>row.value),figure.series[0].points.slice(128));
 for(const format of ['svg','csv','json']){
  const response=await peer.call('figure-export',{...selector,format},{stream:true}),value=await text(response);assert.equal(response.headers['x-content-type-options'],'nosniff');
  if(format==='svg')assert.equal((value.match(/class="figure-observation"/g)??[]).length,137);
  if(format==='csv')assert.equal((value.match(/^"measurement",/gm)??[]).length,137);
  if(format==='json')assert.deepEqual(JSON.parse(value).series,figure.series);
 }
 const evidence={recordId,figureId:figure.id,revision:source.revision,via:{kind:'evidence',ref:source,trail:[]}};
 const sourceHeader=await peer.call('figure',{...evidence,operation:'header'});assert.equal(sourceHeader.revision,source.revision);assert.equal(sourceHeader.header.x.label,'','Presentation edits do not rewrite the pinned analysis');
 await assert.rejects(peer.call('figure',{...evidence,via:{kind:'evidence',ref:hidden.source,trail:[]}}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(peer.call('figure',{...selector,recordId:hiddenId,figureId:hidden.figure.id}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(peer.call('figure',{...selector,figureId:randomUUID()}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(peer.call('figure',{...selector,figureId:composition.id}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(peer.call('figure',{...selector,revision:'0'.repeat(64)}),{code:'RECORD_CHANGED'});
 await assert.rejects(peer.call('figure',{...selector,document:{root:'0'.repeat(64)}}),{code:'COLLABORATION_INVALID'});
 await edit(f.author.workspace,f.book.id,recordId,'Updated live title');
 await assert.rejects(peer.call('figure',selector),{code:'RECORD_CHANGED'});
 const historical={recordId:linkedId,figureId:figure.id,revision:pinned.revision,via:{kind:'link',id:linkId}};
 assert.equal((await peer.call('figure',{...historical,operation:'header'})).header.title,figure.title);
 const app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'live-figure-prefs')});t.after(()=>app.close());
 const http=await session(app),workspaceId=(await f.member.workspace.outline()).metadata.id,connected=await http.post('/api/live/connect',{workspaceId,card,verifiedFingerprint:card.identity.id});assert.equal(connected.status,200);const {id}=await connected.json();
 const selected={...historical,format:'csv'},url=app.origin+'/api/live/figures/'+id+'/'+linkedId+'/'+figure.id+'?context='+http.contextId+'&selection='+encodeURIComponent(JSON.stringify(selected));
 assert.equal((await fetch(url)).status,401);const download=await fetch(url,{headers:http.headers});assert.equal(download.status,200);assert.equal((await download.text()).match(/^"measurement",/gm).length,137);
 assert.equal((await fetch(url.replace(http.contextId,randomUUID()),{headers:http.headers})).status,409);
 assert.equal((await http.post('/api/live/request',{workspaceId,connectionId:id,operation:'figure-export',data:historical})).status,422);
 const entered=gate(),resume=gate();t.after(()=>resume.release());const streaming=new LiveResearch(f.author.workspace).figure(await f.b.identity.public(),card.value,{...historical,format:'json'},{exporting:true,download:async({chunks})=>{const iterator=chunks[Symbol.asyncIterator](),first=await iterator.next();entered.release();await resume.promise;let value=first.value;for await(const chunk of iterator)value+=chunk;return JSON.parse(value);}});
 await entered.promise;try{await bounded(edit(f.author.workspace,f.book.id,recordId,'Authoring during a retained download'));await bounded(revoke(f));}finally{resume.release();}assert.deepEqual((await streaming).series,figure.series);
 for(const command of [historical,evidence])await assert.rejects(peer.call('figure',{...command,operation:'header'}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(peer.call('figure-export',{...historical,format:'json'},{stream:true}),{code:'COLLABORATION_DENIED'});
 const revoked=await fetch(url,{headers:http.headers});assert.notEqual(revoked.status,200);assert.equal((await revoked.json()).code,'COLLABORATION_DENIED');
});

test('shared change reviews read exact base incoming and current figure closures and reject withdrawn access',{timeout:180000},async t=>{
 const f=await collaborationFixture(t),recordId=f.book.entries[0].id,{figure,composition}=await retainedCollaborationFigure(f.author.workspace,f.book.id,recordId,{points:137,nested:true});const started=performance.now(),opened={source:0,recipient:0};for(const [key,workspace]of [['source',f.author.workspace],['recipient',f.member.workspace]]){const original=workspace.openCatalogue;t.mock.method(workspace,'openCatalogue',function(...args){opened[key]++;return original.apply(this,args);});}const phase=name=>console.log('Shared figure',name,{elapsedMs:Math.round(performance.now()-started),...opened});phase('retained');
 const first=await f.sa.prepareOffer({grantId:f.grant.id,contact:f.contact});phase('offer prepared');const parts=new ExchangeParts(f.author.workspace,first.id);await parts.open();let figureBlocks=0;
 for await(const part of parts.items())if(part.name.startsWith('.observanda/materials/figures/')){assert.equal(digest(await contentBuffer(parts.content(part))),path.posix.basename(part.name,'.json'));figureBlocks++;}assert.ok(figureBlocks>1);phase('packet hashes checked ('+figureBlocks+' blocks)');
 const incoming=await f.sb.receive(await f.sa.outgoing(first.id)),destination=path.join(f.directory,'review-copy');phase('offer received');const copyOpens=opened.recipient;await f.sb.acceptCopy(incoming.id,destination);phase('copy admitted');assert.ok(opened.recipient-copyOpens<=16,'Copy admission must not reopen the source catalogue per retained block');
 const vault=await verifyAccess(await readAccess(destination),'','',{deviceStore:f.member.deviceStore});f.vaults.push(vault);const copy=new Workspace(destination,vault),member=new ResearchExchange(copy,f.member.deviceStore);
 await edit(copy,f.book.id,recordId,'Reviewed observations');
 const changes=await member.prepareChanges();phase('changes prepared');const returned=await f.sa.receive(await member.outgoing(changes.id)),reviewer=new ChangeReview(f.sa),reviewOpens=opened.source,review=await reviewer.review(returned.id);assert.equal(review.rows.length,1);phase('review admitted');assert.ok(opened.source-reviewOpens<=16,'Review validation must not reopen the source catalogue per retained block');
 const selectors={};
 for(const version of ['base','incoming','current']){
  const record=await reviewer.record(review.id,recordId,version),selector={workspaceId:f.book.id,reviewId:review.id,recordId,version,revision:recordRevision(record),figureId:figure.id};selectors[version]=selector;
  const header=await sharedReviewFigure(reviewer,{...selector,operation:'header'});assert.equal(header.header.title,figure.title);assert.equal(header.header.x.label,'Edited shared coordinate');
  if(version==='incoming'){const language='nb',localized=await sharedReviewFigure(reviewer,{...selector,operation:'svg',window:{plotId:figure.id,seriesOffset:0,seriesLimit:1,pointOffset:128,pointLimit:9},language});assert.equal(localized.language,language);assert.equal(localized.revision,selector.revision);assert.deepEqual(localized.document,header.document);assert.equal((localized.svg.match(/class="figure-observation"/g)??[]).length,9);}
  const tail=await sharedReviewFigure(reviewer,{...selector,operation:'window',selection:{collection:'points',plotId:figure.id,seriesId:figure.series[0].id,offset:128,limit:9}});assert.deepEqual(tail.items.map(row=>row.value),figure.series[0].points.slice(128));
  const json=await sharedReviewFigure(reviewer,{...selector,format:'json'},{exporting:true,download:async({chunks})=>JSON.parse(await text(chunks))});assert.deepEqual(json.series,figure.series);
 }
 await assert.rejects(sharedReviewFigure(reviewer,{...selectors.incoming,recordId:f.book.entries[2].id}),{code:'COLLABORATION_PACKAGE'});
 await assert.rejects(sharedReviewFigure(reviewer,{...selectors.incoming,figureId:randomUUID()}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(sharedReviewFigure(reviewer,{...selectors.incoming,figureId:composition.id}),{code:'COLLABORATION_DENIED'});
 await assert.rejects(sharedReviewFigure(reviewer,{...selectors.incoming,revision:'0'.repeat(64)}),{code:'RECORD_CHANGED'});
 assert.throws(()=>sharedReviewFigure(reviewer,{...selectors.incoming,document:{root:'0'.repeat(64)}}),{code:'INVALID'});
 const app=await startServer({root:f.author.workspace.root,port:0,headless:true,deviceStore:f.author.deviceStore,preferencesFile:path.join(f.directory,'review-figure-prefs')});t.after(()=>app.close());const http=await session(app);
 const selected=await http.post('/api/sharing/record',{workspaceId:f.book.id,reviewId:review.id,recordId,version:'incoming'});assert.equal(selected.status,200);assert.equal((await selected.json()).revision,selectors.incoming.revision);
 const read=await http.post('/api/sharing/figure',{...selectors.incoming,operation:'header'});assert.equal(read.status,200);const httpHeader=(await read.json()).header;assert.equal(httpHeader.title,figure.title);assert.equal(httpHeader.x.label,'Edited shared coordinate');
 const url=app.origin+'/api/sharing/figures/'+review.id+'/incoming/'+recordId+'/'+figure.id+'?context='+http.contextId+'&revision='+selectors.incoming.revision+'&expectedRevision='+selectors.incoming.revision+'&format=csv';
 assert.equal((await fetch(url)).status,401);const response=await fetch(url,{headers:http.headers});assert.equal(response.status,200);assert.equal((await response.text()).match(/^"measurement",/gm).length,137);
 const entered=gate(),resume=gate();t.after(()=>resume.release());const streaming=sharedReviewFigure(reviewer,{...selectors.incoming,format:'json'},{exporting:true,download:async({chunks})=>{const iterator=chunks[Symbol.asyncIterator](),first=await iterator.next();entered.release();await resume.promise;let value=first.value;for await(const chunk of iterator)value+=chunk;return JSON.parse(value);}});
 await entered.promise;try{await bounded(revoke(f));}finally{resume.release();}assert.deepEqual((await streaming).series,figure.series);
 for(const selector of Object.values(selectors))await assert.rejects(sharedReviewFigure(reviewer,{...selector,operation:'header'}),{code:'COLLABORATION_DENIED'});
 const revoked=await fetch(url,{headers:http.headers});assert.notEqual(revoked.status,200);assert.equal((await revoked.json()).code,'COLLABORATION_DENIED');
 assert.equal((await f.author.workspace.read()).book.entries.find(row=>row.id===recordId).title,f.book.entries[0].title,'Reading a returned proposal does not apply it');
});


test('shared research closure follows authored point origins without widening selected ownership',{timeout:120000},async t=>{
 const f=await collaborationFixture(t),workspace=f.author.workspace,recordId=f.book.entries[0].id,stored=await retainedCollaborationFigure(workspace,f.book.id,recordId,{points:2}),authoring=new RetainedFigureAuthoring(workspace,{write:operation=>workspace.withLock(operation)}),authored=await authoring.finish(await authoring.start(stored.retained)),values=new RecordValues(workspace),selection={workspaceId:f.book.id,recordId,field:'figure:'+authored.id},base=await values.read(selection);
 await values.save({...selection,expectedRevision:base.revision,value:{value:authored}});assert.equal(authored.source,undefined);
 const record=(await workspace.read()).book.entries.find(value=>value.id===recordId),collect=async(records,heads)=>{const parts=new Map(),transfer=new ResearchTransfer(workspace,new Set([recordId]),[record.notebookId],async part=>{assert.equal(part.kind,'metadata');const previous=parts.get(part.name);if(previous!==undefined)assert.equal(previous,part.content);parts.set(part.name,part.content);});await transfer.copy(records,heads);return parts;},sourcePath='.observanda/materials/objects/'+stored.source.id+'/'+stored.source.revision+'.json';
 const recordParts=await collect([record],[]);assert.deepEqual(JSON.parse(recordParts.get(sourcePath)),await stored.materials.read(stored.source));const reopened=await new RetainedFigureDocuments({readMetadata:async name=>recordParts.get(name)??null},{readOnly:true}).open(authored);await reopened.verify();const first=(await reopened.window({collection:'points',limit:1})).items[0];assert.deepEqual(first.value.source.origin.ref,stored.source);
 // A material can carry the same immutable authored figure without an inputs
 // array mentioning its original point evidence. That branch needs closure too.
 const derived=await workspace.withLock(()=>stored.materials.commit({kind:'analysis',recordId,title:'Authored material',content:{inputs:[],outputs:[],tool:'Synthetic authored observations',version:'1',parameters:'Retained exact points',figure:authored}}));let head;for await(const value of stored.materials.headEntries())if(value.id===derived.id)head=value;assert.ok(head);const materialParts=await collect([],[head]);assert.deepEqual(JSON.parse(materialParts.get(sourcePath)),await stored.materials.read(stored.source));
 const hidden=await retainedCollaborationFigure(workspace,f.book.id,f.book.entries[2].id,{points:1,title:'Unselected origin'}),imported=await authoring.finish(await authoring.start(hidden.retained,{id:authored.id})),current=await values.read(selection);await values.save({...selection,expectedRevision:current.revision,value:{value:imported}});const denied=(await workspace.read()).book.entries.find(value=>value.id===recordId);await assert.rejects(collect([denied],[]),{code:'COLLABORATION_DEPENDENCY'});
 const forbidden={...first.value.source.origin,ref:{...stored.source,workspaceId:randomUUID()}},reader={async *blocks(){},async *items(){yield {value:{source:{origin:forbidden}}};}},transfer=new ResearchTransfer(workspace,new Set([recordId]),[record.notebookId],async()=>{});await assert.rejects(transfer.figure(reader,async()=>assert.fail('Foreign origin must not be enqueued'),f.book.id),{code:'COLLABORATION_DEPENDENCY'});
});
