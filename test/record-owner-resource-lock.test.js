import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lockRecordOwnerResource} from '../src/record-owner-resource-lock.js';

test('large resource publications use bounded transaction locks and retain contention refusal',async()=>{
 const locks=new Set(),store={db:{id:'catalogue-a',get:async(sql,key)=>{assert.match(sql,/pg_try_advisory_xact_lock/);locks.add(key);return {locked:true};}}};
 for(let i=0;i<10000;i++)await lockRecordOwnerResource(store,'resource-'+i);
 assert.ok(locks.size>1&&locks.size<=64,'resource count must not exhaust PostgreSQL shared lock memory');
 const first=new Set(locks);await lockRecordOwnerResource(store,'resource-1');assert.deepEqual(locks,first);
 store.db.id='catalogue-b';await lockRecordOwnerResource(store,'resource-1');assert.equal(locks.size,first.size+1,'separate catalogues retain independent lock identities');
 await assert.rejects(lockRecordOwnerResource({db:{id:'catalogue-a',get:async()=>({locked:false})}},'resource-1'),{code:'LOCKED'});
});
