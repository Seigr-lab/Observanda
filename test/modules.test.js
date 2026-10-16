import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {createNotebook} from '../src/model.js';
import {workspaceModules} from '../src/modules/index.js';
import {balance} from '../src/web/modules/quantities.js';
const resource=(kind='material')=>({name:'Test resource',code:'',kind,description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:kind==='material'?'mL':'',capacity:1,status:'available',links:[]});
const task=()=>({title:'Prepare experiment',description:'',status:'todo',priority:'normal',dueOn:null,assignees:['A','B'],checklist:[],dependencies:[],links:[]});
const booking=id=>({title:'Instrument run',resourceId:id,startsAt:'2026-10-25T00:30:00.000Z',endsAt:'2026-10-25T01:30:00.000Z',timeZone:'Europe/Oslo',places:1,kind:'work',status:'confirmed',notes:'',links:[]});
async function setup(vault=null){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-modules-')),workspace=new Workspace(root,vault),book=createNotebook('Modules');
 await workspace.create(book);const store=workspaceModules(workspace);
 const execute=(action,payload,commandId=randomUUID())=>store.execute({workspaceId:book.id,commandId,action,payload});
 const save=(type,id,data,expectedRevision=null)=>execute(type+'.save',{id,expectedRevision,data});
 return {root,book,store,execute,save};
}
test('exact stock accounting, idempotent retry, competing reservations and atomic consume',async()=>{
 const s=await setup(),id=randomUUID();await s.save('resource',id,resource());
 const payload={resourceId:id,expectedRevision:1,delta:'0.3',reason:'Receipt',links:[]},commandId=randomUUID();
 await s.execute('stock.move',payload,commandId);
 assert.equal((await s.execute('stock.move',payload,commandId)).replayed,true);
 await assert.rejects(s.execute('stock.move',{...payload,delta:'3'},commandId),{code:'MODULE_REPLAY'});
 await s.execute('stock.reserve',{resourceId:id,expectedRevision:2,quantity:'0.2',reason:'Run one',links:[]});
 const before=await s.store.read();
 await assert.rejects(s.execute('stock.reserve',{resourceId:id,expectedRevision:3,quantity:'0.2',reason:'Run two',links:[]}),{code:'STOCK_UNAVAILABLE'});
 assert.deepEqual(await s.store.read(),before);
 const reservation=before.entities.find(e=>e.type==='reservation');
 await s.execute('stock.resolve',{id:reservation.id,expectedRevision:1,decision:'consume'});
 assert.deepEqual(balance((await s.store.read()).entities,id),{physical:'0.1',reserved:'0',available:'0.1'});
 await assert.rejects(s.execute('stock.resolve',{id:reservation.id,expectedRevision:1,decision:'consume'}));
});
test('independent edits coexist; stale edits and invalid references leave the stored state intact',async()=>{
 const s=await setup(),a=randomUUID(),b=randomUUID();await s.save('task',a,task());await s.save('task',b,{...task(),title:'Other'});
 await s.save('task',a,{...task(),title:'Changed'},1);
 await s.save('task',b,{...task(),title:'Other changed'},1);
 const before=await s.store.read();
 await assert.rejects(s.save('task',a,task(),1),{code:'MODULE_CHANGED'});
 await assert.rejects(s.save('task',a,{...task(),links:[{workspaceId:s.book.id,type:'record',id:randomUUID()}]},2),{code:'MODULE_REFERENCE'});
 assert.deepEqual(await s.store.read(),before);
});
test('equipment capacity is checked across time offsets and maintenance',async()=>{
 const s=await setup(),id=randomUUID();await s.save('resource',id,resource('equipment'));
 const first=randomUUID();await s.save('booking',first,booking(id));
 const before=await s.store.read();
 await assert.rejects(s.save('booking',randomUUID(),{...booking(id),title:'Collision'}),{code:'BOOKING_CONFLICT'});
 assert.deepEqual(await s.store.read(),before);
 await s.save('booking',randomUUID(),{...booking(id),startsAt:'2026-10-25T01:30:00.000Z',endsAt:'2026-10-25T02:00:00.000Z'});
 await s.save('booking',first,{...booking(id),status:'cancelled'},1);
 await s.save('booking',randomUUID(),{...booking(id),kind:'maintenance'});
 await assert.rejects(s.save('booking',randomUUID(),booking(id)),{code:'BOOKING_CONFLICT'});
});
test('task completion, prerequisites, cycles and reopening preserve valid work',async()=>{
 const s=await setup(),a=randomUUID(),b=randomUUID();
 await s.save('task',a,task());await s.save('task',b,{...task(),dependencies:[a]});
 await assert.rejects(s.save('task',b,{...task(),dependencies:[a],status:'done'},1),{code:'TASK_BLOCKED'});
 await assert.rejects(s.save('task',a,{...task(),dependencies:[b]},1),{code:'MODULE_INVALID'});
 await s.save('task',a,{...task(),status:'done'},1);await s.save('task',b,{...task(),dependencies:[a],status:'done'},1);
 await assert.rejects(s.save('task',a,task(),2),{code:'TASK_BLOCKED'});
});
test('category changes retain resource schema versions and encrypted module data survives reopening',async()=>{
 const s=await setup({id:randomUUID(),key:Buffer.alloc(32,7)}),categoryId=randomUUID(),id=randomUUID();
 const fields=[{key:'concentration',label:'Concentration',type:'number',unit:'mol/L',required:true,choices:[]}],category={name:'Reagents',description:'',fields,archived:false};
 await s.save('category',categoryId,category);
 await s.save('resource',id,{...resource(),name:'PRIVATE_MODULE_MARKER',categoryId,schemaRevision:1,fieldSchema:fields,values:{concentration:'0.01'}});
 await s.save('category',categoryId,{...category,fields:[...fields,{key:'supplier',label:'Supplier',type:'text',unit:'',required:true,choices:[]}]},1);
 const data=await s.store.read(),saved=data.entities.find(e=>e.id===id);
 assert.equal(saved.data.schemaRevision,1);assert.equal(saved.data.fieldSchema.length,1);
 await assert.rejects(readFile(path.join(s.root,'.observanda','modules.json')),{code:'ENOENT'});
 await s.store.workspace.catalogue(async store=>{for(const row of await store.db.all('SELECT payload FROM module_entities UNION ALL SELECT payload FROM module_events'))assert.equal(row.payload.includes('PRIVATE_MODULE_MARKER'),false);});
 assert.deepEqual(await workspaceModules(s.store.workspace).read(),data);
});
