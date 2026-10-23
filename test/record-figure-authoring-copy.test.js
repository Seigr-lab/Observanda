import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {RecordFigureDrafts} from '../src/record-figure-drafts.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {RetainedFigureAuthoring} from '../src/retained-figure-authoring.js';
import {figureCopyChoices,figureCopySource} from '../src/record-figure-copy-values.js';
import {withRecordDocument} from '../src/record-document.js';
import {findResultFigure} from '../src/record-result-values.js';

test('retained composition copies preserve exact child result targets and reject edited or invented proofs',{timeout:120000},async t=>{
 const f=await figureValueFixture();t.after(f.close);
 const owner={workspaceId:f.book.id,recordId:f.record.id},top=await figureCopyChoices(f.workspace,{...owner,source:null,offset:8}),page=await figureCopyChoices(f.workspace,{...owner,source:top.source,figureId:top.items[0].figureId,offset:0});
 const selected=page.items[0],source={ref:top.source,figureId:selected.figureId,plotId:selected.plotId},figureId=randomUUID(),base=await f.values.read(f.target(figureId)),selection={field:base.field,revision:base.revision,storageRevision:base.storageRevision},id=randomUUID(),drafts=new RecordFigureDrafts(f.workspace);
 let saved=await drafts.start({...owner,id,selection,expectedRevision:null,operationId:randomUUID(),create:'panels'});
 const command=()=>({...owner,id,selection,expectedRevision:saved.revision,operationId:randomUUID()});
 for(let i=0;i<2;i++){const request={...command(),source,mode:'panel',plotId:figureId};saved=await drafts.import(request);assert.deepEqual(await drafts.import(request),saved);}
 assert.equal(saved.value.copies.length,2);assert.notEqual(saved.value.copies[0].targetId,saved.value.copies[1].targetId);
 assert.deepEqual((await new RecordValueDrafts(f.workspace).read({id,workspaceId:f.book.id,expectedRevision:saved.revision})).value,saved.value);
 saved=await drafts.finish(command());const proof=saved.value;
 const write={...f.target(figureId),expectedRevision:base.revision,value:proof},result=await f.values.save(write);assert.deepEqual(await f.values.save(write),result);
 await f.workspace.catalogue(async store=>{
  const row=await store.member(await store.snapshot(),f.record.id);
  await withRecordDocument(store,row.id,row.revision,async document=>{
   const statements=(await document.field(['results','statements'])).value;assert.equal(statements.length,3);
   for(const copy of proof.copies){const statement=statements.find(s=>s.figureId===copy.targetId);assert.equal(statement.text,f.record.results.statements[0].text);assert.equal(statement.limitations,f.record.results.statements[0].limitations);assert.equal((await findResultFigure(document,copy.targetId)).id,copy.targetId);}
  });
  await store.verifySnapshot(undefined,f.book.id);
 });
 const resultChoices=await f.values.figureChoices({...owner,figureId,offset:1});assert.equal(resultChoices.total,2);assert.equal(resultChoices.items[0].id,proof.copies[1].targetId);
 const current=await f.values.read(f.target(figureId)),nextSelection={field:current.field,revision:current.revision,storageRevision:current.storageRevision},nextId=randomUUID();
 let editing=await drafts.start({...owner,id:nextId,selection:nextSelection,expectedRevision:null,operationId:randomUUID(),create:null});
 const reader=await new RetainedFigureAuthoring(f.workspace,{readOnly:true}).open(editing.value.value),panel=(await reader.window({collection:'panels',limit:1})).items[0];
 editing=await drafts.change({...owner,id:nextId,selection:nextSelection,expectedRevision:editing.revision,operationId:randomUUID(),operation:{type:'remove',collection:'panels',plotId:panel.plotId,id:panel.id}});
 // Even a fabricated complete descriptor cannot silently orphan a linked result.
 const removed={...proof.value,document:editing.value.value.document};
 await assert.rejects(f.values.save({...f.target(figureId),expectedRevision:current.revision,value:{value:removed}}));
 const copies=await figureCopyChoices(f.workspace,{...owner,source:null,offset:9});assert.equal(copies.items[0].figureId,figureId);assert.equal(copies.items[0].type,'panels');
 const child=await figureCopyChoices(f.workspace,{...owner,source:copies.source,figureId,offset:1});assert.equal(child.items.length,1);assert.equal(child.items[0].plotId,proof.copies[1].targetId);
 const selectedRetained=await figureCopySource(f.workspace,{...owner,source:copies.source,figureId,plotId:child.items[0].plotId});assert.equal(selectedRetained.statementCount,1);
 // Compare complete observations, not only the retained document identity.
 const forgedId=randomUUID(),forgedBase=await f.values.read(f.target(forgedId)),authoring=new RetainedFigureAuthoring(f.workspace);let forged=await f.workspace.withLock(()=>authoring.start(proof.value,{id:forgedId}));
 const r=await authoring.open(forged),point=(await r.window({collection:'points',plotId:proof.copies[0].targetId,limit:1})).items[0];
 forged=await f.workspace.withLock(()=>authoring.change(forged,{type:'patch',collection:'points',plotId:point.plotId,id:point.id,patch:{y:2.25}}));forged=await f.workspace.withLock(()=>authoring.finish(forged));
 await assert.rejects(f.values.save({...f.target(forgedId),expectedRevision:forgedBase.revision,value:{value:forged,copies:proof.copies}}),{code:'FIGURE_COPY_CHANGED'});
 await assert.rejects(new RecordValueDrafts(f.workspace).write({...owner,id:randomUUID(),selection:{field:forgedBase.field,revision:forgedBase.revision,storageRevision:forgedBase.storageRevision},expectedRevision:null,value:{value:forged,copies:[{...proof.copies[0],targetId:randomUUID()}]}}),{code:'INVALID'});
});
