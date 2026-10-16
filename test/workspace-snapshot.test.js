import {test} from 'node:test';
import assert from 'node:assert/strict';
import {snapshotWorkspace,draftWorkspace,editableRecord} from '../src/web/workspace-snapshot.js';
import {recordDraftTracker,retainPendingEdits} from '../src/web/research-client.js';
import {workspaceSaveRequest} from '../src/web/workspace-edits.js';
import {applyRecordPatch} from '../src/web/record-patch.js';
import {reconcileRecords} from '../src/web/record-merge.js';

function fixture(count=4){
 const input={id:'workspace',formatVersion:21,title:'Studio',projects:[],website:{title:'Public studio'},entries:Array.from({length:count},(_,i)=>({
  id:'record-'+i,title:'Take '+i,body:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Original '+i}]}]},
  sections:[],attachments:[{id:'attachment-'+i,share:false}],contributors:[],relations:[],figures:[],
  share:false,notebookId:'book',createdAt:'before',updatedAt:'before'
 }))};
 const saved=snapshotWorkspace(input),draft=draftWorkspace(saved),revisions=Object.fromEntries(saved.entries.map(r=>[r.id,'revision-'+r.id]));
 return {input,saved,draft,revisions};
}
function scoped(allowed,run){
 const clone=globalThis.structuredClone,json=JSON.stringify;
 const check=value=>{
  if(value?.entries?.length>1)throw Error('Whole workspace processed');
  if(value?.id?.startsWith('record-')&&!allowed.has(value.id))throw Error('Unrelated record processed: '+value.id);
 };
 globalThis.structuredClone=(value,...rest)=>{check(value);return clone(value,...rest);};
 JSON.stringify=(value,...rest)=>{check(value);return json(value,...rest);};
 try{return run();}finally{globalThis.structuredClone=clone;JSON.stringify=json;}
}

test('saved records cannot be mutated through nested values and editing detaches only the selected record',()=>{
 const {input,saved,draft}=fixture(),second=draftWorkspace(saved);
 assert.equal(draft.entries[0],saved.entries[0]);assert.notEqual(draft.website,saved.website);
 assert.throws(()=>{draft.entries[0].attachments[0].share=true;},TypeError);
 const record=editableRecord(draft,'record-0');record.title='Draft title';record.body.content[0].content[0].text='Changed prose';record.attachments[0].share=true;
 assert.equal(editableRecord(draft,'record-0'),record);assert.equal(editableRecord(draft,'missing'),undefined);
 assert.deepEqual(saved,input);assert.equal(second.entries[0].title,'Take 0');assert.equal(saved.entries[0].attachments[0].share,false);
 draft.website.title='Draft site';assert.equal(saved.website.title,'Public studio');
 const next=snapshotWorkspace(draft);record.title='Later draft';
 assert.equal(next.entries[0].title,'Draft title');assert.equal(next.entries[1],saved.entries[1]);
 input.entries[1].title='Caller mutation';assert.equal(saved.entries[1].title,'Take 1');
});

for(const count of [32,320]){
 test('mixed save, patch adoption, rollback and deletion share unrelated records at '+count,()=>{
  const {saved,draft,revisions}=fixture(count),tracker=recordDraftTracker();tracker.reset(saved,revisions);
  scoped(new Set(['record-0']),()=>{
   editableRecord(draft,'record-0').title='Changed';draft.title='Changed studio';
   assert.equal(tracker.inspect(draft),true);assert.equal(tracker.command(),null);
   const submitted=tracker.submission(draft);assert.equal(submitted.book.entries[1],saved.entries[1]);
   const command=workspaceSaveRequest(saved,submitted.book,revisions);assert.deepEqual(command.metadata,{title:'Changed studio'});assert.equal(command.changes.length,1);
   const {entries,...metadata}=saved;
   const response={etag:'new',recordRevisions:{'record-0':'new-record'},recordPatch:{baseEtag:'old',metadata:{...metadata,title:'Changed studio'},records:[{...submitted.book.entries[0],updatedAt:'committed'}],removed:[],appended:[],count,order:null}};
   const patched=applyRecordPatch(saved,'old',revisions,response),next=snapshotWorkspace(patched.book);
   const working=draftWorkspace(next);assert.equal(working.entries[1],saved.entries[1]);
   const checkpoint=draftWorkspace(working);editableRecord(working,'record-0').title='Later unsaved change';
   assert.equal(checkpoint.entries[0].title,'Changed');assert.equal(next.entries[0].title,'Changed');
   tracker.reset(next,patched.recordRevisions);assert.equal(tracker.inspect(checkpoint),false);
   checkpoint.entries=checkpoint.entries.filter(r=>r.id!=='record-0');tracker.inspect(checkpoint);
   const removal=workspaceSaveRequest(next,tracker.submission(checkpoint).book,patched.recordRevisions);
   assert.equal(removal.changes.length,0);assert.deepEqual(removal.removed,[{id:'record-0',expectedRevision:'new-record'}]);
  });
 });

 test('in-flight changes and independent remote edits preserve exact saved bases at '+count,()=>{
  const {saved,draft,revisions}=fixture(count),tracker=recordDraftTracker();tracker.reset(saved,revisions);
  scoped(new Set(['record-0','record-1','record-2']),()=>{
   editableRecord(draft,'record-0').title='Sent title';tracker.updateRecord(draft,'record-0');
   const submitted=tracker.submission(draft).book;
   const server=draftWorkspace(saved);editableRecord(server,'record-0').title='Sent title';server.entries[0].updatedAt='committed';
   editableRecord(server,'record-2').title='Independent remote change';const accepted=snapshotWorkspace(server);
   draft.entries[0].body.content[0].content[0].text='Typed while saving';
   editableRecord(draft,'record-1').title='Another pending record';draft.website.title='Another pending site title';
   const merged=retainPendingEdits(submitted,draft,accepted);
   assert.equal(merged.entries[0].updatedAt,'committed');assert.equal(merged.entries[0].body.content[0].content[0].text,'Typed while saving');
   assert.equal(merged.entries[1].title,'Another pending record');assert.equal(merged.entries[2].title,'Independent remote change');
   assert.equal(merged.entries[3],saved.entries[3]);assert.equal(merged.website.title,'Another pending site title');
   merged.entries[0].title='Keep editing';assert.equal(accepted.entries[0].title,'Sent title');
   assert.equal(submitted.entries[0].body.content[0].content[0].text,'Original 0');
  });
 });

 test('conflict choices retain unrelated immutable bodies and preserve public-selection safeguards at '+count,()=>{
  const {saved,draft}=fixture(count),base=saved.entries[0],local=editableRecord(draft,'record-0');
  local.title='Local title';local.notebookId='different-book';local.share=true;
  const remote=draftWorkspace(saved);editableRecord(remote,'record-0').title='Remote title';const latest=snapshotWorkspace(remote);
  scoped(new Set(['record-0']),()=>{
   const plan=reconcileRecords([{base,record:local}],latest.entries);
   assert.equal(plan.conflicts.length,1);
   const resolved=plan.resolve(new Map(plan.conflicts.map(c=>[c.key,c.mine])));
   assert.equal(resolved[0].title,'Local title');assert.equal(resolved[0].share,false);
   assert.equal(resolved[1],saved.entries[1]);assert.equal(latest.entries[0].title,'Remote title');
   const again=plan.resolve(new Map(plan.conflicts.map(c=>[c.key,c.stored])));
   assert.equal(again[0].title,'Remote title');assert.equal(again[1],saved.entries[1]);
  });
 });
}

test('a pending removal and new record do not erase independently added saved records',()=>{
 const {saved,draft}=fixture(),submitted=draftWorkspace(saved),server=draftWorkspace(saved);
 server.entries.push({...structuredClone(saved.entries[0]),id:'remote-addition'});
 draft.entries=draft.entries.filter(r=>r.id!=='record-1');
 draft.entries.push({...structuredClone(saved.entries[0]),id:'local-addition'});
 const merged=retainPendingEdits(submitted,draft,snapshotWorkspace(server));
 assert.deepEqual(merged.entries.map(r=>r.id),['record-0','record-2','record-3','remote-addition','local-addition']);
 assert.equal(saved.entries.length,4);assert.equal(merged.entries[0],saved.entries[0]);
});

test('a record removed during another save retains its old revision until explicit conflict review',()=>{
 const {saved,draft,revisions}=fixture(),old=saved.entries[1];
 editableRecord(draft,old.id).title='Typed while another record saved';editableRecord(draft,old.id).share=true;
 const remote=draftWorkspace(saved);remote.entries=remote.entries.filter(r=>r.id!==old.id);
 const latest=snapshotWorkspace(remote),tracker=recordDraftTracker();
 // The application retains the original revision/base of an unsent edit.
 tracker.reset(latest,revisions);tracker.inspect(draft);
 assert.equal(tracker.command().changes.find(c=>c.id===old.id).expectedRevision,revisions[old.id]);
 const checkpoints=tracker.checkpoint(Object.fromEntries(saved.entries.map(r=>[r.id,r])));
 assert.equal(checkpoints.find(c=>c.record.id===old.id).base,old);
 const review=reconcileRecords(checkpoints,latest.entries);assert.equal(review.conflicts.length,1);
 const restored=review.resolve(new Map(review.conflicts.map(c=>[c.key,c.mine])));
 assert.equal(restored.find(r=>r.id===old.id).share,false);
 const currentRevisions={...revisions};delete currentRevisions[old.id];
 tracker.reset(latest,currentRevisions);tracker.inspect({...draftWorkspace(latest),entries:restored});
 assert.equal(tracker.command().changes.find(c=>c.id===old.id).expectedRevision,null);
});
