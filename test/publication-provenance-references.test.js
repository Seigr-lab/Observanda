import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recordRevision} from '../src/research.js';
import {publicProjection} from '../src/publication.js';
import {revisionPageId} from '../src/publication-revisions.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {EDITION_DETAILS,defaultEditionRecord} from '../src/web/publication-selection.js';
import {omittedEditionReferences} from '../src/web/publication-record-references.js';
import {attemptFixture} from './fixtures/attempts.js';
import {selectionBook} from './publication-selection-fixture.js';
import {historicalFixture} from './publication-revisions-fixture.js';
import {publicationText} from './publication-fixture.js';

test('removing preparation input details omits only their availability notes and keeps independently retained references',()=>{
 const {book,record,secret}=selectionBook(),target={workspaceId:book.id,kind:'record',id:secret.id,revision:recordRevision(secret)};
 record.relations=[];record.attempt=attemptFixture();record.attempt.preparations[0].inputs[0].reference={...target,label:'Input provenance'};
 const choice={...defaultEditionRecord(record,recordRevision(record)),details:EDITION_DETAILS.filter(key=>key!=='preparationInputs')},note={recordId:record.id,target,statement:'Availability of the omitted input'};
 assert.deepEqual(omittedEditionReferences(record,choice).map(({label,...reference})=>reference),[target]);
 const edition={version:1,records:[choice],availability:[note]},selected=publicProjection(book,{edition}).entries.find(row=>row.id===record.id);
 assert.deepEqual(selected.availability,[]);assert.deepEqual(selected.attempt.preparations[0].inputs,[]);
 record.relations=[{id:randomUUID(),type:'Related record',target,label:'Separate retained relation'}];choice.revision=recordRevision(record);
 assert.deepEqual(omittedEditionReferences(record,choice),[]);
 assert.deepEqual(publicProjection(book,{edition}).entries.find(row=>row.id===record.id).availability,[note.statement]);
 assert.equal(record.attempt.preparations[0].inputs.length,1);
});

test('detail exclusions reconcile exact historical selections and notes without publishing omitted chains or accepting forged references',async t=>{
 const f=await historicalFixture(t,{chain:true}),before=await f.workspace.read(),linkedTarget=f.old.relations[0].target;
 const choice={...defaultEditionRecord(f.run,recordRevision(f.run)),details:EDITION_DETAILS.filter(key=>key!=='relations')};
 const oldChoice=defaultEditionRecord(f.old,f.target.revision);oldChoice.sections=[];
 const linkedChoice=defaultEditionRecord(f.linked,linkedTarget.revision),oldPage=revisionPageId(f.book.id,f.old.id,f.target.revision),linkedPage=revisionPageId(f.book.id,f.linked.id,linkedTarget.revision);
 const edition={version:1,records:[choice,...f.book.entries.slice(1).map(record=>({...defaultEditionRecord(record,recordRevision(record)),include:false}))],history:[oldChoice,linkedChoice],availability:[
  {recordId:f.run.id,target:f.target,statement:'OMITTED_METHOD_AVAILABILITY'},
  {recordId:oldPage,target:linkedTarget,statement:'OMITTED_PRECURSOR_AVAILABILITY'}
 ]};
 const candidate=await f.releases.inline({...f.source,edition}),reader=await openPublicationInput(f.releases.workspace,await f.releases.source(candidate.jobId)),text=await publicationText(candidate);
 assert.equal(await reader.count('records'),1);assert.equal(await reader.count('availability'),0);
 for(const id of [oldPage,linkedPage]){assert.equal(await reader.get('records',id),null);assert.equal(await candidate.files.has('entries/'+id+'.html'),false);}
 for(const withheld of ['Exact older procedure','Retained precursor result','OMITTED_METHOD_AVAILABILITY','OMITTED_PRECURSOR_AVAILABILITY',f.target.revision,linkedTarget.revision])assert.ok(!text.includes(withheld),withheld);
 assert.deepEqual(await f.workspace.read(),before);
 assert.equal(await publicationText(await f.releases.read(candidate.reviewId)),text);
 await assert.rejects(f.releases.inline({...f.source,edition:{...edition,availability:[{...edition.availability[0],target:{...f.target,id:randomUUID()}}]}}),{code:'INVALID'});
 await assert.rejects(f.releases.inline({...f.source,edition:{...edition,availability:[{...edition.availability[1],target:{...linkedTarget,revision:'0'.repeat(64)}}]}}),{code:'INVALID'});
 await assert.rejects(f.releases.inline({...f.source,edition:{...edition,history:[...edition.history,{...oldChoice,id:randomUUID()}]}}),{code:'INVALID'});
 // The same exact history remains publishable when its referring detail is
 // selected again. Omission proof never grants consent or consumes live paths.
 const retained=await f.releases.inline({...f.source,edition:{...edition,records:[defaultEditionRecord(f.run,recordRevision(f.run)),...edition.records.slice(1)]}}),retainedText=await publicationText(retained);
 for(const id of [oldPage,linkedPage])assert.equal(await retained.files.has('entries/'+id+'.html'),true);
 assert.ok(retainedText.includes('Exact older procedure'));assert.ok(retainedText.includes('Retained precursor result'));
 assert.deepEqual(await f.workspace.read(),before);
});
