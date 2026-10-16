import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {createRun,runsOf,recordCounts,sectionAnchor,workflowIssues} from '../src/web/record-workflow.js';
import {recordRevision,ResearchRecords} from '../src/research.js';
import {Workspace} from '../src/storage.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {RecordHistory} from '../src/record-history.js';
import {reconcileRecords} from '../src/web/record-merge.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {routeFor,resolveRoute} from '../src/web/navigation.js';
function fixture(){
 const book=sampleNotebook();book.entries.forEach(e=>{e.figures=[];e.sections=[];e.relations=[];e.share=false;});
 const [experiment,method,series]=book.entries;
 experiment.type='experiment';experiment.title='Pigment stability';experiment.share=true;
 method.type='protocol';method.title='PRIVATE method';method.body='Private operational notes';
 series.type='note';series.title='Acoustic sessions';
 return {book,experiment,method,series};
}
test('format 19 preserves legacy hashes and statuses; roles validate independently of labels',()=>{
 const {book,experiment,method}=fixture();book.formatVersion=18;experiment.status='failed';
 const bytes=JSON.stringify(book),revision=recordRevision(experiment),next=upgradeNotebook(book);
 assert.equal(JSON.stringify(book),bytes);assert.equal(recordRevision(next.entries[0]),revision);assert.equal(next.entries[0].status,'failed');
 const run=createRun(next,next.entries[0]);next.entries.push(run);
 for(const change of [
  r=>r.relations[0].target.revision='a'.repeat(64),
  r=>r.relations[0].target.id=r.id,
  r=>r.relations[0].role='invented-role',
  r=>r.relations.push({...r.relations[0],id:randomUUID()}),
  r=>r.relations.push({id:randomUUID(),role:'uses-method',type:'My method',label:method.title,target:{workspaceId:next.id,kind:'record',id:method.id}}),
  r=>r.type='note',
  r=>r.outcome='x'.repeat(501)
 ]){const candidate=structuredClone(next);change(candidate.entries.at(-1));assert.throws(()=>validateNotebook(candidate));}
 run.relations[0].type='Session in';run.status='completed';run.outcome='Negative result';validateNotebook(next);
});
test('experiments and creative series share runs; repeats carry methods and conditions, never results',()=>{
 const {book,experiment,method,series}=fixture();
 experiment.relations.push({id:randomUUID(),role:'uses-method',type:'Uses method',label:method.title,target:{workspaceId:book.id,kind:'record',id:method.id,revision:recordRevision(method)}});
 const first=createRun(book,experiment);book.entries.push(first);
 first.status='completed';first.outcome='Negative result';first.body='First result only';
 first.sections.find(s=>s.title==='Parameters and conditions').body='Same paper, lamp and pigment.';
 first.sections.find(s=>s.title==='Results').body='Faded after 24 hours.';
 const second=createRun(book,first,{previous:first,revision:recordRevision(first)});second.status='incomplete';book.entries.push(second);
 const planned=createRun(book,experiment),take=createRun(book,series);book.entries.push(planned,take);
 assert.equal(runsOf(book,experiment.id).length,3);assert.equal(runsOf(book,series.id).length,1);
 assert.equal(second.relations.find(l=>l.role==='uses-method').target.revision,recordRevision(method));
 assert.equal(second.relations.find(l=>l.role==='follows-run').target.id,first.id);
 assert.equal(second.body,'');assert.equal(second.outcome,'');assert.deepEqual(second.figures,[]);assert.deepEqual(second.attachments,[]);
 assert.equal(second.sections.find(s=>s.title==='Parameters and conditions').body,'Same paper, lamp and pigment.');
 assert.equal(second.sections.find(s=>s.title==='Results').body,'');
 assert.equal(take.sections.some(s=>s.title==='Hypothesis'),false);
 assert.deepEqual(recordCounts(book.entries),{experiments:1,runs:4,other:2});validateNotebook(book);
});
test('saved workflow survives drafts, conflicts, exact method edits and record history',async()=>{
 const {book,experiment,method}=fixture(),root=await mkdtemp(path.join(os.tmpdir(),'observanda-workflow-')),ws=new Workspace(root);
 await ws.create(book);const materials=new ResearchMaterials(ws),pinned=await materials.pinRecord(method.id,recordRevision(method));
 const run=createRun(book,experiment);run.relations.push({id:randomUUID(),type:'Uses method',role:'uses-method',label:method.title,target:{workspaceId:book.id,kind:'record',id:method.id,revision:pinned.revision}});
 const drafts=new ResearchDrafts(ws),id=randomUUID();
 await drafts.write({id,workspaceId:book.id,expectedRevision:null,changes:[{base:null,record:run,expectedRevision:null}]});
 assert.deepEqual((await drafts.read(id)).draft.changes[0].record,run);
 const records=new ResearchRecords(ws,{get:()=>{throw Error('No media expected');}});
 await records.save({workspaceId:book.id,changes:[{id:run.id,expectedRevision:null,record:run}]});
 const savedRun=(await ws.read()).book.entries.find(e=>e.id===run.id),originalRevision=recordRevision(savedRun),next=structuredClone(savedRun);next.status='completed';next.outcome='Negative result';
 await records.save({workspaceId:book.id,changes:[{id:run.id,expectedRevision:originalRevision,record:next}]});
 await assert.rejects(records.save({workspaceId:book.id,changes:[{id:run.id,expectedRevision:originalRevision,record:run}]}),{code:'RECORD_CHANGED'});
 const changed=await ws.read();changed.book.entries.find(e=>e.id===method.id).body='Revised procedure';await ws.save(changed.book,changed.etag);
 assert.equal((await materials.read(pinned)).body,method.body);
 const savedNext=(await ws.read()).book.entries.find(e=>e.id===run.id);assert.equal(savedNext.outcome,next.outcome);assert.deepEqual(savedNext.relations,next.relations);
 const local=structuredClone(next);local.outcome='Inconclusive';const remote=structuredClone(next);remote.outcome='Mixed results';
 const merge=reconcileRecords([{base:next,record:local}],[remote]);assert.equal(merge.conflicts[0].label,'Outcome');
 const history=new RecordHistory(ws,{get:()=>{throw Error('No media');}}),versions=await history.list({workspaceId:book.id,recordId:run.id});
 const old=versions.versions.find(v=>v.revision===originalRevision);
 assert.deepEqual((await history.read({workspaceId:book.id,recordId:run.id,...old})).record,savedRun);
});
test('public journeys omit private runs and methods; stable section anchors survive edits',()=>{
 const {book,experiment,method}=fixture(),first=createRun(book,experiment),second=createRun(book,experiment);
 first.title='First attempt';first.status='completed';first.outcome='Negative result';first.share=true;
 second.title='PRIVATE incomplete attempt';second.status='incomplete';second.outcome='PRIVATE path E:\\private\\capture.bin';second.share=false;
 first.relations.push({id:randomUUID(),type:'Uses method',role:'uses-method',label:method.title,target:{workspaceId:book.id,kind:'record',id:method.id,revision:recordRevision(method)}});
 experiment.sections=[{id:randomUUID(),title:'Question',body:'Does the colour fade?'},{id:randomUUID(),title:'Limitations',body:'Two attempts cannot establish reliability.'}];
 book.entries.push(first,second);
 const projection=publicProjection(book);assert.equal(projection.entries.find(e=>e.id===first.id).relations.length,1);
 const build=buildPublication(book),html=build.files.get('entries/'+experiment.id+'.html');
 assert.match(html,/Runs and takes/);assert.ok(html.includes('../entries/'+first.id+'.html'));assert.ok(html.includes('Negative result'));
 const publicFiles=[...build.files.values()].filter(v=>typeof v==='string').join('\n');
 for(const secret of [method.id,method.title,second.id,second.title,'capture.bin'])assert.ok(!publicFiles.includes(secret),secret);
 const anchor=sectionAnchor(experiment.sections[0]);assert.ok(html.includes('id="'+anchor+'"'));
 experiment.sections.reverse();experiment.sections[1].title='Renamed question';
 assert.ok(buildPublication(book).files.get('entries/'+experiment.id+'.html').includes('id="'+anchor+'"'));
 const conclusion={...structuredClone(book.entries[2]),id:randomUUID(),type:'conclusion',title:'Two attempts compared',share:true,relations:[{id:randomUUID(),role:'compares',type:'Compares',label:first.title,target:{workspaceId:book.id,kind:'record',id:first.id,revision:recordRevision(first)}}]};
 book.entries.push(conclusion);
 assert.ok(buildPublication(book).files.get('entries/'+first.id+'.html').includes('Compared in'));
 first.outcome='Revised interpretation';
 assert.ok(!buildPublication(book).files.get('entries/'+conclusion.id+'.html').includes('../entries/'+first.id+'.html'));
 first.outcome='E:\\private\\new-capture.bin';assert.throws(()=>buildPublication(book));
});
test('reader and section URLs keep identity across rename and reordering',()=>{
 const {book,experiment}=fixture();experiment.sections=[{id:randomUUID(),title:'Rationale',body:'Context'}];
 const hash='#/records/'+experiment.id+'/read/'+experiment.sections[0].id;
 assert.equal(routeFor(resolveRoute(hash,book)),hash);
 experiment.title='New title';experiment.sections.unshift({id:randomUUID(),title:'Earlier section',body:''});
 assert.equal(routeFor(resolveRoute(hash,book)),hash);
 assert.equal(resolveRoute('#/records/'+experiment.id,book).recordReading,false);
});


test('retained workflow addresses remain valid across independent namespaces without resolving foreign identities locally',()=>{
 const {book,experiment,method}=fixture(),run=createRun(book,experiment),foreign=randomUUID();
 run.relations[0].target.workspaceId=foreign;
 // An equal record ID in another namespace is not the local run's parent.
 const collision={...experiment,type:'run',relations:[]};
 assert.deepEqual(workflowIssues({...book,entries:[collision,run]}),[]);
 assert.ok(workflowIssues({...book,entries:[collision,run]},{localReference:target=>target.workspaceId===foreign}).length);
 for(const change of [
  value=>value.relations[0].target.workspaceId='invalid',
  value=>value.relations[0].target.id=value.id,
  value=>value.relations[0].target.revision='a'.repeat(64),
  value=>value.relations.push({...value.relations[0],id:randomUUID()}),
  value=>value.relations.push({id:randomUUID(),role:'uses-method',type:'Uses method',label:method.title,target:{workspaceId:foreign,kind:'record',id:method.id}})
 ]){const candidate=structuredClone(run);change(candidate);assert.ok(workflowIssues({...book,entries:[experiment,candidate]}).length);}
});
