import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './project-domain-fixture.js';
import {PdfDocuments} from '../src/pdf-documents.js';
import {ProjectDomainCatalogue} from '../src/project-domain-catalogue.js';
import {pdfLayoutPreset} from '../src/web/pdf-layout-model.js';

test('acknowledged PDF settings survive interrupted saves, conflicting editions and lost replies',async t=>{
 const f=await fixture(t),docs=new PdfDocuments(f.storage,f.book.id);
 assert.deepEqual(await docs.settingsDraft('list',{}),{items:[],next:null});
 assert.equal(await docs.available(),false);
 const id=randomUUID(),header={version:1,id,name:'Survey report',language:'en',direction:'ltr',layout:pdfLayoutPreset()};
 const initial=await docs.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,
  section:{id:randomUUID(),title:'Sampling',content:'Unrelated section body',layout:null,start:null}}});
 const proposal=(name,base=initial.revision)=>({id,commandId:randomUUID(),expectedRevision:base,operation:{type:'header',header:{...header,name}}});
 const interrupted=proposal('Interrupted title'),put=ProjectDomainCatalogue.prototype.putObject;
 const capacity=t.mock.method(ProjectDomainCatalogue.prototype,'putObject',function(key,...args){
  if(key==='pdf-settings:pending:'+interrupted.commandId)throw Object.assign(Error('Test volume is full'),{code:'ENOSPC'});
  return put.call(this,key,...args);
 });
 await assert.rejects(docs.settingsDraft('prepare',interrupted),{code:'ENOSPC'});
 capacity.mock.restore();
 assert.deepEqual(await docs.settingsDraft('list',{}),{items:[],next:null});
 await assert.rejects(docs.settingsDraft('submit',interrupted),{code:'DRAFT_CHANGED'});
 const pending=proposal('Pending title'),ack=await docs.settingsDraft('prepare',pending);
 assert.equal(ack.saved,false);assert.equal((await docs.settingsDraft('prepare',pending)).summary.revision,ack.summary.revision);
 await assert.rejects(docs.settingsDraft('prepare',{...pending,operation:proposal('Unrelated title').operation}),{code:'MODULE_REPLAY'});
 const address={id:pending.commandId,documentId:id,revision:ack.summary.revision};
 const listed=await docs.settingsDraft('list',{limit:1});assert.equal(listed.next,null);
 assert.equal(listed.items[0].title,header.name);assert.ok(!JSON.stringify(listed).includes('Pending title'));
 assert.equal((await docs.read('open',{id})).revision,initial.revision);
 const recovered=await docs.settingsDraft('read',address);
 assert.equal(recovered.proposed.name,'Pending title');assert.deepEqual(recovered.current,header);
 assert.ok(!JSON.stringify(recovered).includes('Unrelated section body'));
 const other=proposal('Another editor'),second=await docs.settingsDraft('prepare',other);
 assert.ok((await docs.settingsDraft('list',{limit:1})).next);
 // A client may have lost the acknowledgement and retried the same command
 // through the normal document route. Only the other draft remains pending.
 const saved=await docs.change(pending);
 assert.deepEqual((await docs.settingsDraft('list',{})).items.map(item=>item.id),[other.commandId]);
 assert.equal((await docs.settingsDraft('submit',pending)).revision,saved.revision);
 assert.deepEqual(await docs.settingsDraft('prepare',pending),{saved:true,revision:saved.revision});
 const stale={id:other.commandId,documentId:id,revision:second.summary.revision};
 const comparison=await docs.settingsDraft('read',stale);
 assert.equal(comparison.summary.state,'conflict');assert.equal(comparison.proposed.name,'Another editor');
 assert.equal(comparison.current.name,'Pending title');
 await assert.rejects(docs.settingsDraft('submit',other),{code:'CONFLICT'});
 await assert.rejects(docs.settingsDraft('discard',{...stale,revision:saved.revision}),{code:'DRAFT_CHANGED'});
 await docs.change({id,commandId:randomUUID(),expectedRevision:saved.revision,operation:{type:'remove'}});
 const hidden=await docs.settingsDraft('read',stale);assert.equal(hidden.summary.state,'missing');
 assert.equal(hidden.proposed,undefined);assert.equal(hidden.summary.title,undefined);
 assert.deepEqual(await docs.settingsDraft('discard',stale),{discarded:true});
 assert.deepEqual(await docs.settingsDraft('discard',stale),{discarded:true});
 await assert.rejects(docs.settingsDraft('prepare',other),{code:'DRAFT_CHANGED'});
 await assert.rejects(docs.settingsDraft('submit',other),{code:'DRAFT_CHANGED'});
 await assert.rejects(docs.change(other),{code:'DRAFT_CHANGED'});
 assert.deepEqual(await docs.settingsDraft('list',{}),{items:[],next:null});
});
