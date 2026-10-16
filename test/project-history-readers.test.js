import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProjectHistoryReaders} from '../src/project-history-access.js';
import {ProjectSessionOwner} from '../src/project-session-owner.js';
const gate=()=>{let release;return {wait:new Promise(resolve=>release=resolve),release:()=>release()};};
test('history access bounds live owners, reuses snapshots and closes every reader after failure',async t=>{
 const read=ProjectSessionOwner.prototype.read,close=ProjectSessionOwner.prototype.close,opened=new Set(),live=new Set(),active=new Set();let peak=0;
 ProjectSessionOwner.prototype.read=async function(operation){opened.add(this);live.add(this);peak=Math.max(peak,live.size);active.add(this);try{return await operation(this.projectId);}finally{active.delete(this);}};
 ProjectSessionOwner.prototype.close=async function(){assert.equal(active.has(this),false,'Closed an active owner');live.delete(this);};
 t.after(()=>{ProjectSessionOwner.prototype.read=read;ProjectSessionOwner.prototype.close=close;});
 const session=new Map(),application={workspace:{},session:()=>session,tracked:operation=>operation()},reader=new ProjectHistoryReaders(application,{}),options={action:'read'};
 for(let n=0;n<12;n++){await reader.withProject('owner-'+n,async id=>assert.equal(id,'owner-'+n),options);const count=opened.size;await reader.withProject('owner-'+n,async()=>{},options);assert.equal(opened.size,count);}
 assert.equal(opened.size,12);assert.equal(peak,4);await assert.rejects(reader.withProject('bad',async()=>{throw Error('Read failed');},options),/Read failed/);await reader.close();assert.equal(live.size,0);
 await assert.rejects(reader.withProject('after-close',async()=>assert.fail('Closed reader admitted'),options),{code:'ACCESS_LOCKED'});
 const waiting=new ProjectHistoryReaders(application,{}),hold=gate(),entered=gate();let starts=0;
 const requests=Array.from({length:4},(_,n)=>waiting.withProject('held-'+n,async()=>{if(++starts===4)entered.release();await hold.wait;},options));await entered.wait;
 let extra=false;const fifth=waiting.withProject('fifth',async()=>{extra=true;},options);await new Promise(resolve=>setImmediate(resolve));assert.equal(extra,false);assert.equal(live.size,4);
 const rejected=assert.rejects(fifth,{code:'ACCESS_LOCKED'}),closed=waiting.close();hold.release();await Promise.all(requests);await rejected;await closed;assert.equal(live.size,0);
});
