import {archiveDatabaseFixture} from './archive-database-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {seal} from '../src/encryption.js';
import {withOperationProgress} from '../src/operation-progress.js';
import {transferCatalogue} from '../src/postgres.js';

for(const failure of ['source','destination'])test(`direct catalogue transfer releases both stream ends after ${failure} failure`,{timeout:5000},async()=>{
 const payload=seal(Buffer.alloc(3*1024*1024,65),randomBytes(32),'synthetic'),calls=[];
 const source={run:async sql=>calls.push(sql),get:async()=>({total:1}),all:async sql=>sql==='SELECT version FROM catalogue_format'?[{version:3}]:[{slot:'head',payload}],async *rows(sql){if(/FROM state\b/.test(sql)){if(failure==='source')throw Error('source interrupted');yield {slot:'head',payload_bytes:payload.length};}}};
 const target={get:async()=>({found:1}),run:async()=>{throw Error('destination interrupted');}};
 archiveDatabaseFixture(source);archiveDatabaseFixture(target);
 await assert.rejects(transferCatalogue(source,target),new RegExp(failure+' interrupted'));
 assert.deepEqual(calls,['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','ROLLBACK']);
});


test('direct transfer verifies measured row counts without counting the source first',async()=>{
 const payload=seal(Buffer.from('Synthetic retained data'),randomBytes(32),'synthetic'),calls=[],received=[],events=[];
 const rows=Array.from({length:70},(_,i)=>({slot:i?'item-'+i:'head',payload}));
 let visited=0;
 const source={
  run:async sql=>calls.push(sql),get:async()=>{throw Object.assign(Error('count scan timed out'),{code:'57014'});},
  all:async(sql,...ids)=>sql==='SELECT version FROM catalogue_format'?[{version:3}]:rows.filter(row=>ids.includes(row.slot)),
  async *rows(sql){if(/FROM state\b/.test(sql))for(const row of rows){visited++;yield {slot:row.slot,payload_bytes:payload.length};}}
 };
 const target={get:async()=>({found:1}),run:async(sql,...values)=>{assert.match(sql,/^INSERT INTO state /);for(let i=0;i<values.length;i+=2)received.push({slot:values[i],payload:values[i+1]});}};
 archiveDatabaseFixture(source);archiveDatabaseFixture(target);
 await withOperationProgress(event=>events.push(event),()=>transferCatalogue(source,target));
 assert.equal(visited,70);assert.deepEqual(received,rows);
 assert.deepEqual(calls,['BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY','COMMIT']);
 const progress=events.filter(event=>event.stage==='transfer-database');
 assert.equal(progress[0].total,undefined);assert.equal(progress.at(-1).total,70);assert.equal(progress.at(-1).completed,70);
});
