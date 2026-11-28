import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {RecordConfigurationSeed} from '../src/record-configuration-seed.js';
import {RecordDraftReview} from '../src/record-draft-review.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {verifyRecordDraftEdits} from '../src/record-draft-edits.js';
import {proseText} from '../src/web/prose-model.js';
import {MediaStore} from '../src/media.js';
import {createFigure} from '../src/web/figure-model.js';

const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jk1sAAAAASUVORK5CYII=','base64');
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

 const media=new MediaStore(f.workspace.root,f.workspace.vault),review=new RecordDraftReview(f.workspace,media);
 const plan=await review.prepare({id:receipt.draft.id,workspaceId:f.book.id,expectedRevision:receipt.revision});
 assert.equal(plan.newRecord,true);assert.equal(plan.recordId,recordId);

 const reading=await review.reading({...target(plan)});
 assert.equal(reading.recordId,recordId);assert.equal(reading.newRecord,true);
 assert.equal(reading.header.title,'Untitled observation');assert.equal(reading.header.type,'observation');
 assert.deepEqual(reading.sections.values.map(section=>section.title),['Observation','Context']);assert.equal(reading.sections.total,2);
 await assert.rejects(review.reading({...target(plan),unexpected:true}),{code:'INVALID'});

// Each draft edit is read first, then written against what was read.
 const write=async(field,value)=>{const selected=await review.editRead({...target(plan),field});return review.editWrite({...target(plan),field,value,valueRevision:selected.revision,editRevision:selected.editRevision,operationId:randomUUID()});};
 await write('title',{value:'River bank survey'});
 // The page reads the draft with its edits, as soon as each one is written.
 const edited=await review.reading({...target(plan)});assert.equal(edited.header.title,'River bank survey');assert.match(edited.editRevision,/^[a-f0-9]{64}$/);
 assert.equal(reading.editRevision,null);
 // A recovery preview shows the draft with its edits too.
 assert.equal((await review.content({...target(plan),offset:0})).title,'River bank survey');
 // A draft takes new parts as a saved record does: sections are inserted, moved and removed, tags and contributors added.
 const [observation,context]=record.sections.map(section=>section.id),methods=randomUUID(),notes=randomUUID();
 await write('sections',{action:'insert',sectionId:methods,beforeId:context,value:{title:'Methods',body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Transect walk.'}]}]}}});
 await write('sections',{action:'insert',sectionId:notes,beforeId:null,value:{title:'Notes',body:{type:'doc',content:[{type:'paragraph',content:[]}]}}});
 await write('sections',{action:'move',sectionId:notes,position:0});
 await write('sections',{action:'remove',sectionId:context});
 await assert.rejects(write('sections',{action:'insert',sectionId:methods,beforeId:null,value:{title:'Again',body:{type:'doc',content:[{type:'paragraph',content:[]}]}}}),{code:'INVALID'});
 await write('tag:0',{value:'river'});await write('tag:1',{value:'survey'});
 await assert.rejects(write('tag:5',{value:'far'}),{code:'MISSING'});
 const contributor=randomUUID();await write('contributor:'+contributor,{value:{name:'Field assistant',role:'Observer'}});
 // Files the workspace holds are attached, ordered and removed; a file it lacks, or of another kind, is refused.
 const first=await media.import(pixel,'image'),second=await media.import(pixel,'image');
 await write('attachments',{action:'attach',mediaId:first.id,kind:'image'});await write('attachments',{action:'attach',mediaId:second.id,kind:'image'});
 await assert.rejects(write('attachments',{action:'attach',mediaId:first.id,kind:'image'}),{code:'INVALID'});
 await assert.rejects(write('attachments',{action:'attach',mediaId:randomUUID(),kind:'image'}),{code:'MISSING'});
 await assert.rejects(write('attachments',{action:'attach',mediaId:randomUUID(),kind:'audio'}),{code:'MISSING'});
 await assert.rejects(write('attachments',{action:'attach',mediaId:second.id,kind:'audio'}),{code:'MEDIA_INVALID'});
 await write('attachments',{action:'move',mediaId:second.id,position:0});
 const spare=await media.import(pixel,'image');await write('attachments',{action:'attach',mediaId:spare.id,kind:'image'});await write('attachments',{action:'remove',mediaId:spare.id});
 await write('media:'+first.id,{value:{caption:'Bank edge',alt:'Eroded bank',transcript:'',share:false}});
 // A figure is added under a new identity.
 const figure=createFigure();figure.title='Water level';figure.kind='scatter';figure.series[0].points=[{x:1,y:2,error:null},{x:2,y:3,error:null}];await write('figure:'+figure.id,{value:figure});
 // A figure is duplicated (a retry is the same edit) and the original removed, as on a saved record.
 const copyId=randomUUID(),order=await review.editRead({...target(plan),field:'figures'});
 const duplicate={...target(plan),field:'figures',value:{action:'duplicate',figureId:figure.id,copyId},valueRevision:order.revision,editRevision:order.editRevision,operationId:randomUUID()};
 const copied=await review.editWrite(duplicate);assert.deepEqual(await review.editWrite(duplicate),copied);
 await write('figures',{action:'remove',figureId:figure.id});
 await assert.rejects(write('figures',{action:'remove',figureId:figure.id}),{code:'MISSING'});
 // Every recorded edit, the new kinds included, replays to the same draft.
 await f.workspace.catalogue(store=>verifyRecordDraftEdits(store));
 const draft=(await new ResearchDrafts(f.workspace).list({workspaceId:f.book.id})).drafts.find(item=>item.id===receipt.draft.id);assert.ok(draft);
 const ready=await review.prepare({id:receipt.draft.id,workspaceId:f.book.id,expectedRevision:draft.revision});
 assert.equal((await review.reading({...target(ready)})).header.title,'River bank survey');

 const saved=await review.apply({...target(ready)});
 assert.equal(saved.recordId,recordId);
 const entry=(await f.workspace.read()).book.entries.find(item=>item.id===recordId);
 assert.equal(entry.title,'River bank survey');assert.equal(entry.type,'observation');assert.equal(entry.template,undefined);
 assert.deepEqual(entry.sections.map(section=>[section.title,proseText(section.body)]),[['Notes',''],['Observation',''],['Methods','Transect walk.']]);
 assert.deepEqual(entry.tags,['river','survey']);
 assert.deepEqual(entry.attachments.map(item=>[item.id,item.kind,item.caption]),[[second.id,'image',''],[first.id,'image','Bank edge']]);
 assert.deepEqual(entry.figures.map(item=>[item.id,item.title]),[[copyId,'Water level']]);assert.deepEqual(entry.contributors.map(person=>[person.id,person.name,person.role]),[[contributor,'Field assistant','Observer']]);
});
