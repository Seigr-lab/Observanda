import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ObjectIndex} from '../src/object-index.js';
import {RecordSearchIndex} from '../src/record-search-index.js';
import {retiredSearchOwnerSlot} from '../src/project-retired-search.js';
import {withRetiredProjectRecords} from '../src/project-retired-records.js';
import {digest,serialize} from '../src/storage-format.js';
const bytes=value=>Buffer.from(serialize(value)),damaged=()=>Object.assign(Error('Corrupt synthetic row'),{code:'CATALOGUE_DAMAGED'});
function fixture(){
 const sourceId=randomUUID(),projectId=randomUUID(),namespaceId=randomUUID(),vaultId=randomUUID(),receipt={version:1,operationId:randomUUID(),projectId,sourceNamespace:sourceId,namespaceId,vaultId,sourceHead:digest('Synthetic source')};
 const workspace={root:'synthetic-workspace',vault:{key:Buffer.alloc(32,1)}},target={projectId,vault:{id:vaultId,key:Buffer.alloc(32,2)}},sourceRows=new Map(),targetRows=new Map(),calls={opened:0,maxBatch:0};
 const store=(workspace,rows,id)=>({workspace,decode:(_kind,_slot,payload)=>{if(!payload)throw damaged();return JSON.parse(payload.toString());},snapshot:async()=>({metadata:{id}}),object:async key=>key==='project:adoption'?{version:1,ready:true,receipt}:null,db:{get:async(_sql,slot)=>rows.has(slot)?{payload:rows.get(slot)}:undefined,all:async(_sql,slots)=>{calls.maxBatch=Math.max(calls.maxBatch,slots.length);return slots.filter(slot=>rows.has(slot)).map(slot=>({slot,payload:rows.get(slot)}));}}});
 const from=store(workspace,sourceRows,sourceId),to=store(target,targetRows,namespaceId),router={registry:{workspace},withProject:async(id,consume)=>{assert.equal(id,projectId);calls.opened++;return consume({...target,catalogue:operation=>operation(to)});}},tree=new ObjectIndex(null,{immutable:true});
 const build=(first,last)=>{if(first>last)return null;const mid=Math.floor((first+last)/2),left=build(first,mid-1),right=build(mid+1,last);return tree.make('item:'+String(mid).padStart(4,'0'),digest(String(mid)),left,right);};
 const root=build(1,127);for(const [hash,node] of tree.pending)targetRows.set('record-search-index:'+hash,bytes(node));
 sourceRows.set(retiredSearchOwnerSlot,bytes({version:1,owner:receipt}));sourceRows.set('project-source-authority:project:'+projectId,bytes(receipt));
 const authorized=operation=>withRetiredProjectRecords(workspace,router,operation),entries=()=>authorized(async()=>{const rows=[];for await(const row of new RecordSearchIndex(from).entries({root}))rows.push(row);return rows;});
 return {from,to,sourceRows,targetRows,root,receipt,calls,authorized,entries};
}
test('historical search resolves bounded owned nodes with explicit access and preserves local corruption errors',async()=>{
 const f=fixture();await assert.rejects(new RecordSearchIndex(f.from).node(f.root),{code:'ACCESS_LOCKED'});assert.equal(f.calls.opened,0);
 const rows=await f.entries();assert.equal(rows.length,127);assert.equal(rows[0].id,'item:0001');assert.equal(rows.at(-1).id,'item:0127');assert.ok(f.calls.opened<=3);assert.ok(f.calls.maxBatch<=32);
 const slot='record-search-index:'+f.root.hash;f.sourceRows.set(slot,bytes({damaged:true}));const opened=f.calls.opened;await assert.rejects(f.entries(),{code:'CATALOGUE_DAMAGED'});assert.equal(f.calls.opened,opened);
 f.sourceRows.delete(slot);const child='record-search-index:'+JSON.parse(f.targetRows.get(slot).toString()).left.hash;f.targetRows.delete(child);await assert.rejects(f.entries(),{code:'CATALOGUE_DAMAGED'});
});
test('partially retired searches read remaining local descendants without requiring their transfer to have finished',async()=>{
 const f=fixture(),slot='record-search-index:'+f.root.hash;for(const [key,value] of f.targetRows)if(key!==slot){f.sourceRows.set(key,value);f.targetRows.delete(key);}
 assert.equal((await f.entries()).length,127);assert.equal(f.calls.opened,1);
 f.sourceRows.set(retiredSearchOwnerSlot,bytes({version:1,owner:{...f.receipt,namespaceId:randomUUID()}}));await assert.rejects(f.entries(),{code:'CATALOGUE_DAMAGED'});
});
test('ordinary missing search nodes remain damaged when no owner was recorded',async()=>{
 const f=fixture();f.sourceRows.delete(retiredSearchOwnerSlot);await assert.rejects(f.entries(),{code:'CATALOGUE_DAMAGED'});assert.equal(f.calls.opened,0);
});
