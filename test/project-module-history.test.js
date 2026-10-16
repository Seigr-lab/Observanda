import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fixture,calculation,calendar} from './project-domain-fixture.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ProjectModuleHistory} from '../src/project-module-history.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
const detached=AsyncLocalStorage.snapshot();
function gate(){let enter,release;return {started:new Promise(resolve=>enter=resolve),hold:new Promise(resolve=>release=resolve),enter:()=>enter(),release:()=>release()};}

test('project module history pages remain anchored during independent and same-item edits', {timeout:120000},async t=>{
 const f=await fixture(t),commands=new ProjectModuleCommands(f.storage,f.book.id);await commands.initialize();
 const first=calculation(f),other=calendar(f),history=new ProjectModuleHistory(f.storage,f.book.id),request={workspaceId:f.book.id,id:first.payload.id,limit:2};
 await commands.execute(first);for(let revision=1;revision<5;revision++)await commands.execute({...first,commandId:randomUUID(),payload:{...first.payload,expectedRevision:revision,data:{...first.payload.data,name:'Revision '+(revision+1)}}});await commands.execute(other);
 const original=ModuleCatalogue.prototype.head;t.mock.method(ModuleCatalogue.prototype,'head',async function(...args){assert.equal(this.store.domain,'calculator','history opened unrelated module history');return original.apply(this,args);});
 const page=await history.page(request);assert.equal(page.total,5);assert.deepEqual(page.items.map(i=>i.revision),[5,4]);t.mock.restoreAll();
 await commands.execute({...other,commandId:randomUUID(),payload:{...other.payload,expectedRevision:1,data:{...other.payload.data,name:'Unrelated calendar'}}});
 await commands.execute({...first,commandId:randomUUID(),payload:{...first.payload,expectedRevision:5,data:{...first.payload.data,name:'Newest'}}});
 const next=await history.page({...request,cursor:page.nextCursor});assert.equal(next.total,5);assert.equal(next.currentRevision,6);assert.equal(next.changed,true);assert.deepEqual(next.items.map(i=>i.revision),[3,2]);
 assert.deepEqual((await history.page({...request,cursor:next.nextCursor})).items.map(i=>i.revision),[1]);
 const old=await history.read({...request,revision:1});assert.deepEqual(old.entity.data,first.payload.data);assert.equal(old.currentRevision,6);
 await assert.rejects(history.page({...request,id:other.payload.id,cursor:page.nextCursor}),{code:'MODULE_HISTORY_CURSOR'});
 const token=page.nextCursor.slice(0,24)+(page.nextCursor[24]==='A'?'B':'A')+page.nextCursor.slice(25);await assert.rejects(history.page({...request,cursor:token}),{code:'MODULE_HISTORY_CURSOR'});
 await assert.rejects(history.read({...request,revision:7}),{code:'NOT_FOUND'});await assert.rejects(history.read({...request,id:randomUUID(),revision:1}),{code:'NOT_FOUND'});
 assert.throws(()=>history.page({...request,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const writer=gate(),held=detached(()=>f.domains.run(['calculator'],async()=>{writer.enter();await writer.hold;},{write:['calculator']}));await writer.started;
 try{assert.equal((await history.read({...request,revision:3})).entity.data.name,'Revision 3');}finally{writer.release();await held;}
 const research=gate(),busy=detached(()=>f.storage.withLock(async()=>{research.enter();await research.hold;}));await research.started;
 try{assert.equal((await history.page(request)).total,6);}finally{research.release();await busy;}
});
