import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {RecordConfigurationSeed} from '../src/record-configuration-seed.js';
import {RecordDraftReview} from '../src/record-draft-review.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {proseText} from '../src/web/prose-model.js';

const media={get:async()=>{throw Error('Unexpected media');}};
const target=plan=>({id:plan.id,workspaceId:plan.workspaceId,expectedRevision:plan.revision});

// A new record of a built-in type is a server draft until its first Save. It is read the
// way the record page reads a saved record, edited field by field, and saved once.
test('a new built-in record is kept as a draft, read like a saved record, edited and saved once',async t=>{
 const f=await figureValueFixture();t.after(f.close);
 const notebookId=f.book.notebooks[0].id,recordId=randomUUID(),now=new Date().toISOString();
 const record={id:recordId,notebookId,type:'observation',title:'Untitled observation',body:'',contributors:[],relations:[],tags:[],occurredOn:'2026-11-27',createdAt:now,updatedAt:now,share:false,figures:[],status:'draft',
  sections:[{id:randomUUID(),title:'Observation',body:''},{id:randomUUID(),title:'Context',body:''}],attachments:[]};
 const command={id:randomUUID(),workspaceId:f.book.id,notebookId,recordId,configurationPin:null,sectionId:null,record};
 const seed=new RecordConfigurationSeed(f.workspace),receipt=await seed.seed(command);
 assert.equal(receipt.draft.id,command.id);assert.equal(receipt.record.id,recordId);
 // The same request answers again with the same draft; nothing exists in the lab book yet.
 assert.deepEqual(await seed.seed(command),receipt);
 assert.equal((await f.workspace.read()).book.entries.some(entry=>entry.id===recordId),false);
 // A seed for a lab book that does not exist is refused.
 const missingBook=randomUUID(),missingRecord=randomUUID();
 await assert.rejects(seed.seed({...command,id:randomUUID(),recordId:missingRecord,notebookId:missingBook,record:{...record,id:missingRecord,notebookId:missingBook}}),{code:'NOT_FOUND'});

 const review=new RecordDraftReview(f.workspace,media);
 const plan=await review.prepare({id:receipt.draft.id,workspaceId:f.book.id,expectedRevision:receipt.revision});
 assert.equal(plan.newRecord,true);assert.equal(plan.recordId,recordId);

 const reading=await review.reading({...target(plan)});
 assert.equal(reading.recordId,recordId);assert.equal(reading.newRecord,true);
 assert.equal(reading.header.title,'Untitled observation');assert.equal(reading.header.type,'observation');
 assert.deepEqual(reading.sections.values.map(section=>section.title),['Observation','Context']);assert.equal(reading.sections.total,2);
 await assert.rejects(review.reading({...target(plan),unexpected:true}),{code:'INVALID'});

 const selected=await review.editRead({...target(plan),field:'title'});
 await review.editWrite({...target(plan),field:'title',value:{value:'River bank survey'},valueRevision:selected.revision,editRevision:selected.editRevision,operationId:randomUUID()});
 const draft=(await new ResearchDrafts(f.workspace).list({workspaceId:f.book.id})).drafts.find(item=>item.id===receipt.draft.id);assert.ok(draft);
 const ready=await review.prepare({id:receipt.draft.id,workspaceId:f.book.id,expectedRevision:draft.revision});
 assert.equal((await review.reading({...target(ready)})).header.title,'River bank survey');

 const saved=await review.apply({...target(ready)});
 assert.equal(saved.recordId,recordId);
 const entry=(await f.workspace.read()).book.entries.find(item=>item.id===recordId);
 assert.equal(entry.title,'River bank survey');assert.equal(entry.type,'observation');assert.equal(entry.template,undefined);
 assert.deepEqual(entry.sections.map(section=>[section.title,proseText(section.body)]),[['Observation',''],['Context','']]);
});
