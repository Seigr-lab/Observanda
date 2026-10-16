import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {validRecordDate,recordDateLabel,dateBounds,dateInRange} from '../src/web/record-date.js';
import {queryRecords} from '../src/web/record-query.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {recordRevision,ResearchRecords} from '../src/research.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {RecordHistory} from '../src/record-history.js';
import {Workspace} from '../src/storage.js';
import {reconcileRecords} from '../src/web/record-merge.js';
import {recordRevisionComparison} from '../src/web/record-revision-view.js';
import {publicProjection,buildPublication,escapeHTML} from '../src/publication.js';
import {createAccess,takeCreatedVault,verifyAccess,readAccess} from '../src/access.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {clearVault} from '../src/encryption.js';
import {createRun} from '../src/web/record-workflow.js';

const unknown={kind:'unknown'},approx={kind:'month',value:'2024-02',estimated:true};
const range={kind:'range',from:'2024-02-10',to:'2024-03-03',estimated:false};
const media={get:()=>{throw Error('No media expected');}};
test('declared dates retain precision and reject malformed dates or extra metadata',()=>{
 for(const value of ['2024-02-29',unknown,approx,range,{kind:'year',value:'1998',estimated:false},{kind:'day',value:'2024-02-10',estimated:true}]){
  assert.equal(validRecordDate(value),true,JSON.stringify(value));
  const book=sampleNotebook();book.entries[0].occurredOn=value;validateNotebook(book);
 }
 for(const value of [null,'','2023-02-29','2024-2-01',{},[],{kind:'unknown',value:'2024-01-01'},{...approx,value:'2024-13'},{kind:'year',value:'202',estimated:true},{...range,to:'2024-01-31'},{...range,to:''},{...range,estimated:'false'}]){
  assert.equal(Boolean(validRecordDate(value)),false,JSON.stringify(value));
  const book=sampleNotebook();book.entries[0].occurredOn=value;assert.throws(()=>validateNotebook(book),{code:'INVALID'});
 }
 assert.deepEqual(dateBounds(approx),{from:'2024-02-01',to:'2024-02-29'});
 assert.deepEqual(dateBounds({...approx,value:'1900-02'}),{from:'1900-02-01',to:'1900-02-28'});
 assert.equal(recordDateLabel(approx),'Estimated: February 2024');
 assert.equal(recordDateLabel(unknown),'Date unknown');assert.equal(dateBounds(unknown),null);
 assert.equal(dateInRange({...approx,kind:'day',value:'2024-02-10'},'2024-02-11'),false); // No invented error margin.
 assert.equal(validRecordDate({...range,to:''},{draft:true}),true);
});
test('upgrading format 19 preserves exact record revisions and new planned runs start undated',()=>{
 const old=sampleNotebook();old.formatVersion=19;const bytes=JSON.stringify(old),hashes=old.entries.map(recordRevision);
 const next=upgradeNotebook(old);assert.equal(next.formatVersion,21);assert.equal(JSON.stringify(old),bytes);
 assert.deepEqual(next.entries.map(recordRevision),hashes);assert.deepEqual(next.entries,old.entries);
 const run=createRun(next,next.entries[0]);assert.deepEqual(run.occurredOn,unknown);
 old.entries[0].occurredOn=unknown;assert.throws(()=>validateNotebook(old),{code:'INVALID'});
});
test('chronology overlaps declared spans, keeps unknown last, and never orders by import timestamp',()=>{
 const source=sampleNotebook().entries[0];
 const rows=[
  {...source,id:'unknown',occurredOn:unknown,createdAt:'1800-01-01T00:00:00.000Z'},
  {...source,id:'estimated-month',occurredOn:approx},
  {...source,id:'range',occurredOn:range},
  {...source,id:'day',occurredOn:'2024-02-29'},
  {...source,id:'year',occurredOn:{kind:'year',value:'1998',estimated:false}}
 ];
 assert.deepEqual(queryRecords(rows,{browse:{from:'2024-02-29',to:'2024-02-29'}}).map(e=>e.id),['day','range','estimated-month']);
 for(const sort of ['date-asc','date-desc'])assert.equal(queryRecords(rows,{browse:{sort}}).at(-1).id,'unknown');
 assert.deepEqual(queryRecords(rows,{browse:{dateKnowledge:'estimated'}}).map(e=>e.id),['estimated-month']);
 assert.deepEqual(queryRecords(rows,{browse:{dateKnowledge:'unknown'}}).map(e=>e.id),['unknown']);
 assert.equal(queryRecords(rows,{browse:{dateKnowledge:'known'}}).length,3);
 const before=JSON.stringify(rows);queryRecords(rows,{browse:{from:'1998-12-31',to:'1998-12-31'}});assert.equal(JSON.stringify(rows),before);
 const imported=rows.map(e=>({...e,createdAt:'2099-01-01T00:00:00.000Z'}));assert.deepEqual(queryRecords(rows),queryRecords(imported).map(e=>({...e,createdAt:rows.find(r=>r.id===e.id).createdAt})));
});
test('date conflict decisions keep an entire declaration together and history presents it in plain language',()=>{
 const base=sampleNotebook().entries[0],mine={...base,occurredOn:approx},stored={...base,occurredOn:range};
 const merge=reconcileRecords([{base,record:mine}],[stored]);assert.equal(merge.conflicts.length,1);assert.equal(merge.conflicts[0].label,'Record date');
 assert.deepEqual(merge.resolve(new Map([[merge.conflicts[0].key,merge.conflicts[0].mine]]))[0].occurredOn,approx);
 const comparison=recordRevisionComparison(mine,stored,escapeHTML);assert.match(comparison,/Estimated: February 2024/);assert.match(comparison,/2024-02-10 to 2024-03-03/);assert.ok(!comparison.includes('[object Object]'));
});
test('encrypted save, incomplete draft, exact pins, history and verified workspace copies retain date declarations',async()=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-dates-')),root=path.join(parent,'source'),access=await createAccess('','synthetic date password'),vault=takeCreatedVault(access);
 let restoredVault;
 try{
  await initializeLocation(root,sampleNotebook(),access,vault);
  const ws=new Workspace(root,vault);let saved=await ws.read();const original=structuredClone(saved.book.entries[0]),materials=new ResearchMaterials(ws);
  const pin=await materials.pinRecord(original.id,recordRevision(original)),records=new ResearchRecords(ws,media),drafts=new ResearchDrafts(ws);
  const draft={...original,occurredOn:{...range,to:''}},id=randomUUID();
  await drafts.write({id,workspaceId:saved.book.id,expectedRevision:null,changes:[{base:original,record:draft,expectedRevision:recordRevision(original)}]});
  assert.deepEqual((await drafts.read(id)).draft.changes[0].record.occurredOn,draft.occurredOn);
  await assert.rejects(records.save({workspaceId:saved.book.id,changes:[{id:original.id,record:draft,expectedRevision:recordRevision(original)}]}),{code:'INVALID'});
  assert.equal((await ws.read()).etag,saved.etag);
  await records.save({workspaceId:saved.book.id,changes:[{id:original.id,record:{...original,occurredOn:approx},expectedRevision:recordRevision(original)}]});
  saved=await ws.read();const updated=saved.book.entries[0];assert.deepEqual(updated.occurredOn,approx);assert.equal(updated.createdAt,original.createdAt);
  assert.equal((await materials.read(pin)).occurredOn,original.occurredOn);
  const history=new RecordHistory(ws,media),command={workspaceId:saved.book.id,recordId:original.id},listing=await history.list(command),old=listing.versions.find(v=>v.revision===recordRevision(original));
  assert.equal((await history.read({...command,...old})).record.occurredOn,original.occurredOn);
  const destination=path.join(parent,'restored');await copyWorkspace(await copyPlan(root,destination));
  restoredVault=await verifyAccess(await readAccess(destination),'','synthetic date password');
  const restored=new Workspace(destination,restoredVault);assert.deepEqual((await restored.read()).book.entries[0].occurredOn,approx);
  assert.deepEqual((await new ResearchDrafts(restored).read(id)).draft.changes[0].record.occurredOn,draft.occurredOn);
  assert.equal((await new ResearchMaterials(restored).read(pin)).occurredOn,original.occurredOn);
  await new RecordHistory(restored,media).restore({...command,...old,expectedRevision:recordRevision(updated)});
  assert.equal((await restored.read()).book.entries[0].occurredOn,original.occurredOn);
  assert.deepEqual((await ws.read()).book.entries[0].occurredOn,approx);
 }finally{clearVault(vault);if(restoredVault)clearVault(restoredVault);await rm(parent,{recursive:true,force:true});}
});
test('static output keeps authored uncertainty and excludes private undated records before rendering',()=>{
 const book=sampleNotebook();const [art,field,hidden]=book.entries;
 art.title='Undated material study';art.occurredOn=unknown;field.occurredOn=approx;hidden.occurredOn=range;hidden.title='PRIVATE DATE SENTINEL';hidden.body='E:\\private\\capture.bin';hidden.share=false;
 const before=JSON.stringify(book),projection=publicProjection(book);projection.entries[0].occurredOn.kind='changed';assert.equal(JSON.stringify(book),before);
 const output=buildPublication(book),artHTML=output.files.get('entries/'+art.id+'.html'),fieldHTML=output.files.get('entries/'+field.id+'.html');
 assert.match(artHTML,/Date unknown/);assert.ok(!artHTML.includes('<time datetime='));
 assert.match(fieldHTML,/Estimated: February 2024/);assert.ok(!fieldHTML.includes('datetime="2024-02-01"'));
 const text=[...output.files.values()].filter(v=>typeof v==='string').join('\n');
 for(const privateValue of [hidden.id,hidden.title,'capture.bin','[object Object]'])assert.ok(!text.includes(privateValue),privateValue);
 assert.equal(output.files.has('entries/'+hidden.id+'.html'),false);assert.equal(JSON.stringify(book),before);
});
