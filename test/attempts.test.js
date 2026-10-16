import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {attemptFixture,preparation,event,assessment,fact} from './fixtures/attempts.js';
import {validAttempt,appendOnlyAttempt,mergeAttemptAdditions,attemptComparison} from '../src/web/attempt-model.js';
import {attemptView} from '../src/web/attempt-view.js';
import {attemptComparisonView} from '../src/web/attempt-comparison.js';
import {createRun} from '../src/web/record-workflow.js';
import {reconcileRecords} from '../src/web/record-merge.js';
import {recordRevision,ResearchRecords} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordHistory} from '../src/record-history.js';
import {RecordRuns} from '../src/record-runs.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {queryRecords,recordQueryDocument} from '../src/web/record-query.js';
import {validateNotebook} from '../src/model.js';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-attempts-')),book=sampleNotebook();
 for(const e of book.entries){e.figures=[];e.attachments=[];e.relations=[];e.sections=[];e.share=false;}
 const [investigation,method]=book.entries;investigation.type='experiment';investigation.share=true;method.type='protocol';method.title='PRIVATE source method';
 const encrypted=await encryptedFixture(root,book),ws=encrypted.workspace;
 const materials=new ResearchMaterials(ws),ref={...await materials.pinRecord(method.id,recordRevision(method)),label:method.title};
 const run=createRun(book,investigation);run.attempt=attemptFixture({protocols:[ref]});run.share=true;
 const service=new ResearchRecords(ws,{});await service.save({workspaceId:book.id,changes:[{id:run.id,expectedRevision:null,record:run}]});
 t.after(async()=>{clearVault(encrypted.vault);await rm(root,{recursive:true,force:true});});
 return {root,vault:encrypted.vault,book,investigation,method,ref,run,ws,materials,service,save:async next=>{
  const current=(await ws.read()).book.entries.find(e=>e.id===next.id);
  return service.save({workspaceId:book.id,changes:[{id:next.id,expectedRevision:current?recordRevision(current):null,record:next}]});
 }};
}
test('attempt facts retain declared time, numeric spellings and independent outcomes; malformed corrections fail',()=>{
 const a=attemptFixture();assert.ok(validAttempt(a));const bytes=JSON.stringify(a),html=attemptView(a,esc);
 const uppercase=structuredClone(a);uppercase.preparations[0].inputs[0].hash=uppercase.preparations[0].inputs[0].hash.toUpperCase();assert.ok(validAttempt(uppercase));
 assert.match(html,/Recognition — Unresolved/);assert.match(html,/Native logging — Met/);assert.match(html,/Return copied — Complete/);assert.match(html,/10000000000000001/);
 for(const alter of [v=>v.events[0].time.value='',v=>v.events[0].time.meaning='inferred-boot',v=>v.events[0].extent='success',v=>v.assessments[0].criterionId=randomUUID(),v=>v.preparations[0].inputs[0].hash='wrong',v=>v.preparations[0].conditions[0].basis='inherited',v=>v.assessments[0].outcome='passed',v=>v.events[0].supersedes=v.events[0].id,v=>v.preparations[0].criteria[0].scope='exploratory']){
  const changed=structuredClone(a);alter(changed);assert.equal(validAttempt(changed),false);
 }
 const corrected=structuredClone(a);corrected.assessments.push({...a.assessments[1],...fact(),supersedes:a.assessments[1].id,outcome:'unavailable',reason:'The independent reference was not acquired'});
 assert.ok(validAttempt(corrected));assert.ok(appendOnlyAttempt(a,corrected));assert.match(attemptView(corrected,esc),/Recognition — Unresolved/);assert.match(attemptView(corrected,esc),/Recognition — Unavailable/);
 assert.equal(JSON.stringify(a),bytes);assert.equal(appendOnlyAttempt(a,undefined),false);
});
test('record transactions preserve frozen facts, pinned methods, history restore and independent concurrent additions',async t=>{
 const f=await fixture(t),saved=(await f.ws.read()).book.entries.find(e=>e.id===f.run.id),priorRevision=recordRevision(saved);
 for(const alter of [r=>delete r.attempt,r=>r.attempt.events.pop(),r=>r.attempt.assessments[1].outcome='met',r=>r.attempt.preparations[0].criteria[1].expected='Changed threshold']){
  const changed=structuredClone(saved);alter(changed);await assert.rejects(f.save(changed),{code:'ATTEMPT_IMMUTABLE'});
 }
 const amended=structuredClone(saved),p=structuredClone(saved.attempt.preparations[0]);
 Object.assign(p,{...fact(),supersedes:p.id,reason:'New exploratory threshold',applicability:'Later reanalysis only'});p.criteria[1].expected='Exploratory criterion';p.criteria[1].scope='exploratory';p.criteria[1].reason='Hypothesis after acquisition';
 amended.attempt.preparations.push(p);amended.attempt.assessments.push(assessment(p,1,{outcome:'met',reason:'Only the revised exploratory criterion is met'}));
 await f.save(amended);
 const changed=await f.ws.read();changed.book.entries.find(r=>r.id===f.method.id).body='New method content';await f.ws.save(changed.book,changed.etag);
 assert.equal((await f.materials.read(f.ref)).body,f.method.body);
 const history=new RecordHistory(f.ws,{}),command={workspaceId:f.book.id,recordId:saved.id},listing=await history.list(command),old=listing.versions.find(v=>v.revision===priorRevision);
 assert.equal((await history.read({...command,...old})).record.attempt.preparations[0].criteria[1].expected,'Requested pattern recognized');
 const current=(await f.ws.read()).book.entries.find(r=>r.id===saved.id);
 await history.restore({...command,...old,expectedRevision:recordRevision(current)});
 const restored=(await f.ws.read()).book.entries.find(r=>r.id===saved.id);assert.deepEqual(restored.attempt,amended.attempt);assert.equal(restored.share,false);
 const mine=structuredClone(restored),remote=structuredClone(restored);mine.attempt.events.push(event(p,{kind:'returned'}));remote.attempt.events.push(event(p,{kind:'reviewed'}));
 const merge=reconcileRecords([{base:restored,record:mine}],[remote]);assert.equal(merge.conflicts.length,0);
 const combined=merge.resolve(new Map())[0];assert.equal(combined.attempt.events.length,4);assert.ok(appendOnlyAttempt(remote.attempt,combined.attempt));
 await f.save(remote);await f.save(combined);
 assert.ok(mergeAttemptAdditions(restored.attempt,mine.attempt,remote.attempt));
 const invalid=structuredClone(combined);invalid.attempt.events.push(event(p,{references:[{...f.ref,id:randomUUID()}]}));await assert.rejects(f.save(invalid),{code:'MATERIAL_MISSING'});
});
test('repeats retain preparation as inherited conditions, compare one changed parameter and keep public outcomes separate',async t=>{
 const f=await fixture(t),first=(await f.ws.read()).book.entries.find(e=>e.id===f.run.id),pinned=await f.materials.pinRecord(first.id,recordRevision(first));
 const second=createRun(f.book,first,{previous:first,revision:pinned.revision});second.title='Second physical attempt';second.share=true;
 assert.equal(second.attempt.assessments.length,0);assert.equal(second.attempt.events.length,0);assert.equal(second.attempt.preparations[0].conditions[0].basis,'inherited');
 const p=second.attempt.preparations[0];p.conditions[0].value='240';p.conditions[0].basis='stated';p.conditions[0].reason='Deliberately changed one parameter';p.applicability='Second attempt';
 second.attempt.events.push(event(p));second.attempt.assessments.push(assessment(p,0),assessment(p,1));await f.save(second);
 const read=ResearchCatalogue.prototype.read;ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace loaded');};let page;
 try{page=await new RecordRuns(f.ws).list({workspaceId:f.book.id,recordId:f.investigation.id,compare:true});}finally{ResearchCatalogue.prototype.read=read;}
 assert.equal(page.runs.length,2);assert.ok(page.runs.every(r=>r.conditions.attempt.assessments.some(a=>a.outcome==='unresolved')));
 const view=attemptComparisonView(attemptComparison(second.attempt),attemptComparison(first.attempt),esc);assert.match(view,/Differs from the first run/);assert.match(view,/240/);
 assert.match(view,/Requested pattern recognized/);assert.match(view,/Preparation revision 1/);
 const removed=structuredClone(second.attempt);removed.preparations[0].conditions=[];assert.match(attemptComparisonView(attemptComparison(removed),attemptComparison(first.attempt),esc),/Not present in this preparation/);
 const book=(await f.ws.read()).book;validateNotebook(book);const projection=publicProjection(book),published=projection.entries.find(e=>e.id===first.id);
 assert.deepEqual(published.attempt.preparations[0].protocols,[{withheld:true}]);const output=buildPublication(book),html=output.files.get('entries/'+first.id+'.html');
 assert.match(html,/Recognition — Unresolved/);assert.match(html,/Native logging — Met/);assert.match(html,/Return copied — Complete/);
 const all=[...output.files.values()].filter(v=>typeof v==='string').join('\n');assert.ok(!all.includes(f.method.id));assert.ok(!all.includes(f.method.title));
 const backup=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.root,'backup')),{vault:f.vault}),restored=new Workspace(backup,f.vault);
 assert.deepEqual((await restored.read()).book.entries.find(e=>e.id===first.id).attempt,first.attempt);
});

test('attempt draft recovery retains exact immutable bases and searchable facts without publishing a checkpoint',async t=>{
 const f=await fixture(t),base=(await f.ws.read()).book.entries.find(r=>r.id===f.run.id),record=structuredClone(base),drafts=new ResearchDrafts(f.ws);
 record.attempt.events.push(event(record.attempt.preparations[0],{label:'Second independent acquisition',extent:'partial',circumstances:'Recovered reused medium without asserting another boot'}));
 const command={id:randomUUID(),workspaceId:f.book.id,expectedRevision:null,changes:[{baseRevision:recordRevision(base),expectedRevision:recordRevision(base),record}]};
 const checkpoint=await drafts.write(command),recovered=await new ResearchDrafts(new Workspace(f.ws.root,f.vault)).read(command.id);
 assert.deepEqual(recovered.draft.changes[0].base,base);assert.deepEqual(recovered.draft.changes[0].record,record);
 assert.equal((await f.ws.read()).book.entries.find(r=>r.id===base.id).attempt.events.length,base.attempt.events.length);
 assert.equal(queryRecords([recordQueryDocument(record)],{search:'reused medium without asserting another boot'}).length,1);
 await f.save(recovered.draft.changes[0].record);
 await drafts.remove({id:command.id,workspaceId:f.book.id,expectedRevision:checkpoint.revision});assert.equal(await drafts.read(command.id),null);
 const revised=structuredClone(record);revised.attempt.assessments[0].observed='Overwritten';
 const copy=await f.ws.read();copy.book.entries[copy.book.entries.findIndex(r=>r.id===revised.id)]=revised;await assert.rejects(f.ws.save(copy.book,copy.etag),{code:'ATTEMPT_IMMUTABLE'});
});
