import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordValues} from '../src/record-values.js';
import {RecordContent} from '../src/record-content.js';
import {RecordValueDrafts,verifyRecordValueDraft} from '../src/record-value-drafts.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {withRecordDocument,RecordDocument} from '../src/record-document.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
const forbidRecord=t=>t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Figure editing reconstructed a full record');});
test('selected figure saves preserve late figures, results, source revisions and concurrent edits',async t=>{
 const f=await figureValueFixture();t.after(f.close);forbidRecord(t);const prior=(await f.workspace.outline()).etag;
 const items=RecordDocument.prototype.items;t.mock.method(RecordDocument.prototype,'items',function(path,...args){if(path[0]==='figures')throw Error('Selected figure lookup scanned the figure collection');return items.call(this,path,...args);});
 const first=await f.values.read(f.target(f.record.figures[0].id)),last=await f.values.read(f.target(f.record.figures.at(-1).id));RecordDocument.prototype.items.mock.restore();
 assert.deepEqual(last.definition.linkedFigureIds,[f.record.figures[8].panels[0].figure.id]);assert.equal(Object.hasOwn(first.definition,'original'),false);
 const a=structuredClone(first.value.value),b=structuredClone(last.value.value);a.title='Reviewed capture';a.series[0].points[0].y=2.25;b.panels.reverse();b.title='Reviewed panels';
 await f.save(first,a);const receipt=await f.save(last,b);assert.deepEqual(await f.save(last,b),receipt);await assert.rejects(f.save(first,{...a,title:'Stale'}),{code:'RECORD_CHANGED'});
 assert.deepEqual((await f.values.read(f.target(a.id))).value.value.source,f.analysis);assert.equal((await f.materials.read(f.analysis)).content.figure.series[0].points[0].y,2);
 const reader=new RecordContent(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true};assert.deepEqual((await reader.read({...target,snapshotId:prior})).header.figures,f.record.figures.slice(0,4));assert.deepEqual((await reader.read({...target,windows:{figures:8}})).header.figures,[b]);
 await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,row.id,row.revision,async doc=>{assert.deepEqual((await doc.field(['results'])).value,f.record.results);assert.deepEqual((await doc.field(['body'])).value,f.record.body);for(let i=1;i<8;i++)assert.deepEqual((await doc.field(['figures',String(i)])).value,f.record.figures[i]);});await store.verifySnapshot(undefined,f.book.id);});
 const base=await f.values.read(f.target(b.id)),missing=structuredClone(b);missing.panels=missing.panels.filter(p=>p.figure.id!==last.definition.linkedFigureIds[0]);await assert.rejects(f.save(base,missing),{code:'INVALID'});
 for(const value of [null,{...b,id:randomUUID()},{...b,extra:true}])await assert.rejects(f.save(base,value),{code:'INVALID'});
 await assert.rejects(f.save(await f.values.read(f.target(a.id)),{...a,source:{...f.analysis,id:randomUUID()}}));const absent=await f.values.read(f.target(randomUUID()));assert.equal(absent.value.value,null);assert.equal(absent.definition.existing,false);
 await assert.rejects(f.values.read({...f.target(a.id),workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
});

test('figure checkpoints on heavy records recover with a new key and reject edits outside their selected figure',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);assert.ok(Buffer.byteLength(JSON.stringify(f.record))>2*1024*1024);forbidRecord(t);
 const base=await f.values.read(f.target(f.record.figures[8].id)),value=structuredClone(base.value.value);value.title='';value.panels[1].figure.series[0].points[1].y=null;
 const drafts=new RecordValueDrafts(f.workspace),command={id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},value:{value}},receipt=await drafts.write(command),lookup={id:command.id,workspaceId:f.book.id,expectedRevision:receipt.revision};
 assert.deepEqual(await drafts.write(command),receipt);assert.deepEqual((await drafts.read(lookup)).value,command.value);
 const retained=await new ResearchDrafts(f.workspace).read(command.id,{header:true});await f.workspace.withLock(()=>f.workspace.catalogue(store=>withDraftDocument(store,retained.draft,async doc=>{
  for(const [path,value] of [[['figures','0','title'],'Unselected title'],[['results','statements','0','text'],'Rewritten interpretation'],[['sections','72','body'],'Unselected section']]){
   const changed=await new RecordDocument(doc.blocks,doc.root,{mutable:true}).replace(path,value);await changed.blocks.flush();await assert.rejects(verifyRecordValueDraft(store,{...retained.draft,document:{...retained.draft.document,root:changed.root}}),{code:'CATALOGUE_DAMAGED'});
  }
 })));
 const access=await createAccess('','synthetic figure recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(root,vault),recovered=await new RecordValueDrafts(workspace).read(lookup);
 assert.deepEqual(recovered.value,command.value);assert.deepEqual(recovered.definition.linkedFigureIds,base.definition.linkedFigureIds);recovered.value.value.title='Recovered comparison';recovered.value.value.panels[1].figure.series[0].points[1].y=42;
 await new RecordValues(workspace).save({...f.target(value.id),expectedRevision:base.revision,value:recovered.value});await workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,row.id,row.revision,async doc=>{assert.equal(doc.blocks.scopeId,f.record.notebookId);assert.deepEqual((await doc.field(['figures','8'])).value,recovered.value.value);for(let i=0;i<73;i++)assert.deepEqual((await doc.field(['sections',String(i)])).value,f.record.sections[i]);});await store.verifySnapshot(undefined,f.book.id);});
});

test('interrupted figure commits roll back history and projections and permit a retry',async t=>{
 const f=await figureValueFixture();t.after(f.close);forbidRecord(t);const base=await f.values.read(f.target(f.record.figures[0].id)),etag=(await f.workspace.outline()).etag,value={...base.value.value,title:'Retry figure'};
 const finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted figure commit');});
 await assert.rejects(f.save(base,value),/Interrupted figure commit/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await f.workspace.outline()).etag,etag);assert.deepEqual((await f.values.read(f.target(value.id))).value,base.value);await f.save(base,value);await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});
