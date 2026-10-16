import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runFixture} from './run-fixture.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordRuns} from '../src/record-runs.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {validRunPage} from '../src/web/record-runs.js';

async function fixture(t,count=23,unrelated=5){
 const data=runFixture(count,unrelated),directory=await mkdtemp(path.join(os.tmpdir(),'observanda-run-pages-')),f=await encryptedFixture(directory,data.book);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,...data,service:new RecordRuns(f.workspace),command:{workspaceId:data.book.id,recordId:data.parent.id}};
}
test('run summaries and selected comparison fields never assemble record bodies across corpus growth',async t=>{
 for(const count of [40,400]){
  const f=await fixture(t,23,count),original=ResearchCatalogue.prototype.record,read=ResearchCatalogue.prototype.read,loaded=[];
  ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return original.call(this,id,...args);};
  ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace read');};
  try{
   const first=await f.service.list(f.command);assert.equal(first.total,23);assert.equal(first.runs.length,10);assert.deepEqual(loaded,[]);assert.ok(validRunPage(first,{...f.command,compare:false}));
   const second=await f.service.list({...f.command,cursor:first.nextCursor});assert.equal(second.offset,10);assert.deepEqual(loaded,[]);
   const compared=await f.service.list({...f.command,cursor:second.cursor,compare:true});assert.ok(validRunPage(compared,{...f.command,compare:true}));
   assert.deepEqual(loaded,[]);assert.ok(!JSON.stringify(compared).includes('Private full raw results'));assert.equal(compared.runs[0].conditions.parameters,'Light level 10');
   const last=await f.service.list({...f.command,cursor:second.nextCursor});assert.equal(last.runs.length,3);assert.equal(last.nextCursor,null);
   assert.deepEqual((await f.service.list({...f.command,cursor:last.previousCursor})).runs,second.runs);
   t.diagnostic(count+' unrelated records: summaries and comparisons read 0 complete bodies');
  }finally{ResearchCatalogue.prototype.record=original;ResearchCatalogue.prototype.read=read;}
 }
});
test('a page pins conditions and method revisions across edits and deletion without omitting incomplete runs',async t=>{
 const f=await fixture(t),first=await f.service.list(f.command),records=new ResearchRecords(f.workspace,{}),run=f.runs[1];
 assert.equal(first.runs[1].status,'incomplete');assert.equal(first.runs[1].outcome,'Acquisition interrupted');
 const revised=structuredClone(run);revised.sections.find(s=>s.title==='Parameters and conditions').body='Later condition';
 await records.save({workspaceId:f.book.id,changes:[{id:run.id,expectedRevision:recordRevision(run),record:revised}]},{recordIds:[run.id]});
 await records.remove({workspaceId:f.book.id,recordId:f.runs[0].id,expectedRevision:recordRevision(f.runs[0])});
 const pinned=await f.service.list({...f.command,cursor:first.cursor,compare:true});assert.equal(pinned.changed,true);assert.equal(pinned.total,23);
 assert.equal(pinned.runs[1].conditions.parameters,'Light level 1');assert.equal(pinned.runs[1].revision,recordRevision(run));
 assert.equal(pinned.runs[1].conditions.methods[0].revision,recordRevision(f.method));assert.equal(pinned.runs[1].conditions.deviations,'');
 const fresh=await f.service.list({...f.command,compare:true});assert.equal(fresh.total,22);assert.equal(fresh.runs[0].conditions.parameters,'Later condition');
});
test('run cursors reject other series and workspaces, damaged pages and cancellation',async t=>{
 const f=await fixture(t),page=await f.service.list(f.command);
 await assert.rejects(f.service.list({...f.command,recordId:f.method.id,cursor:page.cursor}),{code:'RECORD_QUERY_CURSOR'});
 await assert.rejects(f.service.list({...f.command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(f.service.list({...f.command,cursor:'invalid'}),{code:'RECORD_QUERY_CURSOR'});
 for(const value of [{...f.command,compare:'yes'},{...f.command,extra:true},{...f.command,recordId:'bad'}])await assert.rejects(f.service.list(value),{code:'INVALID'});
 const controller=new AbortController();controller.abort();await assert.rejects(f.service.list(f.command,{signal:controller.signal}),{name:'AbortError'});
 for(const change of [v=>v.runs.push(v.runs[0]),v=>v.total=-1,v=>v.runs[0].revision='bad',v=>v.nextCursor=null,v=>v.compare=true,v=>v.recordId=randomUUID()]){
  const copy=structuredClone(page);change(copy);assert.equal(validRunPage(copy,{...f.command,compare:false}),false);
 }
});
