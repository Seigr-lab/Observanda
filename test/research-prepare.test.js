import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ResearchRecords,recordRevision,historicalRecordValue,historicalBook} from '../src/research.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';

test('partial save preparation preserves the source and owns replacement content',async()=>{
 const source={...upgradeNotebook(sampleNotebook()),partialRecords:true},service=new ResearchRecords({}, {async get(id){return source.entries.flatMap(r=>r.attachments).find(a=>a.id===id);}});
 const previous=source.entries[0],incoming=structuredClone(previous),unchanged=source.entries[1];incoming.title='An amended interpretation';
 const before=structuredClone(source),command={workspaceId:source.id,changes:[{id:previous.id,expectedRevision:recordRevision(previous),record:incoming},...(unchanged?[{id:unchanged.id,expectedRevision:recordRevision(unchanged),record:structuredClone(unchanged)}]:[])]};
 const prepared=await service.prepare(source,command);assert.deepEqual(source,before);assert.equal(prepared.entries[0].title,incoming.title);
 incoming.tags.push('later caller edit');assert.ok(!prepared.entries[0].tags.includes('later caller edit'));
 prepared.entries[0].createdAt='2000-01-01T00:00:00.000Z';if(unchanged)prepared.entries[1].updatedAt='2000-01-01T00:00:00.000Z';assert.deepEqual(source,before);
 await assert.rejects(service.prepare(source,{...command,changes:[{...command.changes[0],expectedRevision:'0'.repeat(64)}]}),{code:'RECORD_CHANGED'});assert.deepEqual(source,before);
});

test('read-only index projections validate current records and retain legacy upgrade behavior',()=>{
 const legacy=sampleNotebook(),current=upgradeNotebook(legacy),record=current.entries[0];
 const before=structuredClone(current),display=historicalRecordValue(current,record);
 assert.deepEqual(display,historicalBook(current,record).entries[0]);assert.deepEqual(current,before);
 assert.throws(()=>historicalRecordValue(current,{...record,title:''}),{code:'INVALID'});
 assert.deepEqual(historicalRecordValue(legacy,legacy.entries[0]),historicalBook(legacy,legacy.entries[0]).entries[0]);
});
