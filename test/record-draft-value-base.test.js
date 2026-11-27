import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {RecordConfigurationSeed} from '../src/record-configuration-seed.js';
import {RecordDraftReview} from '../src/record-draft-review.js';
import {RecordValueDrafts} from '../src/record-value-drafts.js';
import {RecordWritingDrafts} from '../src/record-writing-drafts.js';
import {RecordFigureDrafts} from '../src/record-figure-drafts.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {MediaStore} from '../src/media.js';
import {validRetainedFigure} from '../src/web/retained-figure-model.js';
import {proseText} from '../src/web/prose-model.js';

const body=text=>({type:'doc',content:[{type:'paragraph',content:[{type:'text',text}]}]});

// A new record's value dialogs keep recovery copies and build figures exactly as a saved
// record's do; their base is the record's draft at one edit instead of a stored version.
test('value, writing and figure recovery copies are based on a new record draft and saved into it',{timeout:180000},async t=>{
 const f=await figureValueFixture();t.after(f.close);
 const workspaceId=f.book.id,notebookId=f.book.notebooks[0].id,recordId=randomUUID(),now=new Date().toISOString(),sectionId=randomUUID();
 const record={id:recordId,notebookId,type:'observation',title:'Untitled observation',body:'',contributors:[],relations:[],tags:[],occurredOn:'2026-11-27',createdAt:now,updatedAt:now,share:false,figures:[],status:'draft',sections:[{id:sectionId,title:'Observation',body:''}],attachments:[]};
 const receipt=await new RecordConfigurationSeed(f.workspace).seed({id:randomUUID(),workspaceId,notebookId,recordId,configurationPin:null,sectionId:null,record});
 const review=new RecordDraftReview(f.workspace,new MediaStore(f.workspace.root,f.workspace.vault));
 const plan=await review.prepare({id:receipt.draft.id,workspaceId,expectedRevision:receipt.revision}),target={id:plan.id,workspaceId,expectedRevision:plan.revision};
 const read=field=>review.editRead({...target,field});
 const base=selected=>({id:plan.id,edit:selected.editRevision});

 // Before any edit the base is the seeded draft (edit null).
 const title=await read('title');assert.equal(title.editRevision,null);
 const values=new RecordValueDrafts(f.workspace),titleDraft=randomUUID();
 const titleSelection={field:'title',revision:title.revision,recordDraft:base(title)};
 const firstCopy=await values.write({id:titleDraft,workspaceId,recordId,expectedRevision:null,selection:titleSelection,value:{value:'River bank survey'}});
 assert.deepEqual((await values.read({id:titleDraft,workspaceId,expectedRevision:firstCopy.revision})).value,{value:'River bank survey'});
 // A copy whose value no longer matches the draft is refused, as on a saved record.
 await assert.rejects(values.write({id:randomUUID(),workspaceId,recordId,expectedRevision:null,selection:{...titleSelection,revision:'0'.repeat(64)},value:{value:'Stale'}}),{code:'RECORD_CHANGED'});
 await assert.rejects(values.write({id:randomUUID(),workspaceId,recordId:randomUUID(),expectedRevision:null,selection:titleSelection,value:{value:'Other'}}),{code:'INVALID'});
 // The dialog's Save writes the value into the draft.
 const saveValue=async(field,selected,value)=>review.editWrite({...target,field,value,valueRevision:selected.revision,editRevision:selected.editRevision,operationId:randomUUID()});
 await saveValue('title',title,{value:'River bank survey'});

 // Writing is based on the draft at its latest edit.
 const section=await read('section:'+sectionId);assert.notEqual(section.editRevision,null);
 const writing=new RecordWritingDrafts(f.workspace),writingDraft=randomUUID(),writingSelection={sectionId,revision:section.revision,recordDraft:base(section)};
 const writingCopy=await writing.write({id:writingDraft,workspaceId,recordId,expectedRevision:null,writing:writingSelection,value:{title:'Observation',body:body('Eroded bank.')}});
 assert.equal(proseText((await writing.read({id:writingDraft,workspaceId,expectedRevision:writingCopy.revision})).value.body),'Eroded bank.');
 await saveValue('section:'+sectionId,section,{title:'Observation',body:body('Eroded bank.')});

 // A figure is built in its own copy, then saved into the draft once finished.
 const figureId=randomUUID(),figureField='figure:'+figureId,figureBase=await read(figureField),figures=new RecordFigureDrafts(f.workspace),figureDraft=randomUUID();
 const selection={field:figureField,revision:figureBase.revision,recordDraft:base(figureBase)};
 let built=await figures.start({id:figureDraft,workspaceId,recordId,selection,expectedRevision:null,operationId:randomUUID(),create:'plot'});
 assert.equal(built.value.value.document.format,'figure-authoring');
 const window=(scope)=>figures.read({id:figureDraft,workspaceId,expectedRevision:built.revision,operation:'window',selection:scope});
 const plotId=(await window({collection:'panels',limit:1})).items[0].plotId,seriesId=(await window({collection:'series',plotId,limit:1})).items[0].id;
 const change=async operation=>{built=await figures.change({id:figureDraft,workspaceId,recordId,selection,expectedRevision:built.revision,operationId:randomUUID(),operation});};
 await change({type:'append',collection:'points',plotId,seriesId,value:{x:1,y:4,error:null}});
 await change({type:'append',collection:'points',plotId,seriesId,value:{x:2,y:7,error:null}});
 built=await figures.finish({id:figureDraft,workspaceId,recordId,selection,expectedRevision:built.revision,operationId:randomUUID()});
 assert.equal(validRetainedFigure(built.value.value),true);
 await saveValue(figureField,figureBase,built.value);

 // Each finished dialog removes its copy, as a saved record's dialog does.
 const drafts=new ResearchDrafts(f.workspace);
 for(const [id,revision] of [[titleDraft,firstCopy.revision],[writingDraft,writingCopy.revision],[figureDraft,built.revision]])await drafts.remove({id,workspaceId,expectedRevision:revision});

 const seed=(await drafts.list({workspaceId})).drafts.find(item=>item.id===receipt.draft.id);
 const ready=await review.prepare({id:receipt.draft.id,workspaceId,expectedRevision:seed.revision});
 const saved=await review.apply({id:ready.id,workspaceId,expectedRevision:ready.revision});assert.equal(saved.recordId,recordId);
 const entry=(await f.workspace.read()).book.entries.find(item=>item.id===recordId);
 assert.equal(entry.title,'River bank survey');
 assert.deepEqual(entry.sections.map(item=>[item.title,proseText(item.body)]),[['Observation','Eroded bank.']]);
 assert.deepEqual(entry.figures.map(item=>item.id),[figureId]);
 // A saved draft is no longer a base for new copies.
 await assert.rejects(values.write({id:randomUUID(),workspaceId,recordId,expectedRevision:null,selection:{field:'title',revision:title.revision,recordDraft:{id:ready.id,edit:null}},value:{value:'Late'}}),{code:'DRAFT_CHANGED'});
});
