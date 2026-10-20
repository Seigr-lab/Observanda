import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {preparationCheckpoint} from './record-preparation-fixture.js';
import {RecordPreparationDrafts} from '../src/record-preparation-drafts.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {RecordDocument,withRecordDocument} from '../src/record-document.js';
import {RecordAttemptIndex} from '../src/record-attempt-index.js';
import {RecordContent} from '../src/record-content.js';
import {RunReadiness} from '../src/run-readiness.js';
import {assessment} from './fixtures/attempts.js';

test('nested preparations continue past 64 through exact checkpoints, late criteria, immutable corrections and counted readers',async t=>{
 const f=await figureValueFixture();t.after(f.close);const field=RecordDocument.prototype.field;
 t.mock.method(RecordDocument.prototype,'field',function(path,...options){if(path?.[0]==='attempt'&&path[1]==='preparations'&&path.length===3)throw Error('Loaded an entire preparation');return field.call(this,path,...options);});
 const edit=await preparationCheckpoint(f);assert.deepEqual((await edit.owner.change(edit.last)).draft,edit.command.draft);
 await assert.rejects(edit.owner.change({...edit.last,operations:[{type:'header',value:{...edit.header,applicability:'Changed replay'}}]}),{code:'DRAFT_CHANGED'});
 for(const group of Object.keys(edit.values)){const page=await edit.owner.window({...edit.command,collection:group,offset:68});assert.equal(page.total,70);assert.deepEqual(page.items.map(row=>row.value),edit.values[group].slice(68));assert.equal(page.next,null);}
 const recovered=await new RecordValueDrafts(f.workspace).read({workspaceId:f.book.id,id:edit.id,expectedRevision:edit.command.draft.revision});assert.equal(recovered.definition.paged,true);assert.equal(recovered.value.value.id,edit.header.id);
 const title=await f.values.read({workspaceId:f.book.id,recordId:f.record.id,field:'title'});await f.values.save({workspaceId:f.book.id,recordId:f.record.id,field:'title',expectedRevision:title.revision,value:{value:'Independent title'}});
 const saved=await edit.owner.save(edit.command);assert.equal(saved.saved,true);assert.deepEqual(await edit.owner.save(edit.command),saved);
 const head=await new RecordContent(f.workspace).read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true,windows:{['preparation:'+edit.header.id+':criteria']:68}});assert.equal(head.header.title,'Independent title');assert.deepEqual(head.header.attempt.preparations[0].criteria,edit.values.criteria.slice(68));assert.equal(head.collections['preparation:'+edit.header.id+':conditions'].total,70);
 const a=assessment({id:edit.header.id,criteria:edit.values.criteria},69),ab=await f.values.read({workspaceId:f.book.id,recordId:f.record.id,field:'attempt:assessment:'+a.id});await f.values.save({workspaceId:f.book.id,recordId:f.record.id,field:ab.field,expectedRevision:ab.revision,value:{value:a}});
 const context=await f.values.attemptContext({workspaceId:f.book.id,recordId:f.record.id,storageRevision:(await f.values.read({workspaceId:f.book.id,recordId:f.record.id,field:'attempt:assessment:'+randomUUID()})).storageRevision,field:'attempt:assessment:'+randomUUID(),prior:null,preparationId:edit.header.id,offset:0,criterionOffset:68,criterionId:a.criterionId});assert.equal(context.criteria.total,70);assert.equal(context.attempt.preparations.at(-1).criteria.at(-1).id,a.criterionId);
 const ready=await new RunReadiness(f.workspace).view({workspaceId:f.book.id,recordId:f.record.id,criteriaOffset:60});assert.equal(ready.unresolvedPage.total,70);assert.deepEqual(ready.unresolved.map(row=>row.id),edit.values.criteria.slice(60).map(row=>row.id));
 const nextField='attempt:preparation:'+randomUUID(),base=await f.values.read({workspaceId:f.book.id,recordId:f.record.id,field:nextField}),command={workspaceId:f.book.id,recordId:f.record.id,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},draft:null},owner=new RecordPreparationDrafts(f.workspace),opened=await owner.open(command),late=await owner.window({...command,collection:'criteria',offset:68}),row=late.items[1];
 const changed=await owner.change({...command,id:randomUUID(),commandId:randomUUID(),operations:[{type:'header',value:{...opened.header,reason:'Explicit amendment'}},{type:'replace',collection:'criteria',position:69,id:row.value.id,revision:row.revision,value:{...row.value,label:'Amended late criterion'}}]});await owner.save({...command,draft:changed.draft});
 await f.workspace.catalogue(async store=>{const member=await store.member(await store.snapshot(),f.record.id);await withRecordDocument(store,member.id,member.revision,async document=>{const index=await RecordAttemptIndex.open(document);assert.equal(index.value.version,3);const original=await index.nested(edit.header.id,'criteria',row.value.id),amendment=await index.nested(opened.header.id,'criteria',row.value.id);assert.equal((await document.tree.read(original.reference)).label,'criteria 69');assert.equal((await document.tree.read(amendment.reference)).label,'Amended late criterion');});await store.verifySnapshot(undefined,f.book.id);});
 await new ResearchDrafts(f.workspace).remove({id:edit.id,workspaceId:f.book.id,expectedRevision:edit.command.draft.revision});
});
