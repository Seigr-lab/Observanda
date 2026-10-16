import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {fixture,calculation,calendar} from './project-domain-fixture.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ProjectModuleReader} from '../src/project-module-reader.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
const detached=AsyncLocalStorage.snapshot();
function gate(){let enter,release;return {started:new Promise(resolve=>enter=resolve),hold:new Promise(resolve=>release=resolve),enter:()=>enter(),release:()=>release()};}
async function setup(t){const f=await fixture(t);f.commands=new ProjectModuleCommands(f.storage,f.book.id);await f.commands.initialize();f.reader=new ProjectModuleReader(f.storage,f.book.id);return f;}

test('typed domain pagination reads only requested summaries and ignores unrelated writes', {timeout:120000},async t=>{
 const f=await setup(t),items=[];for(let i=0;i<5;i++){const command=calculation(f);command.payload.data.name='Calculation '+i;await f.commands.execute(command);items.push(command);}
 const scheduled=calendar(f);await f.commands.execute(scheduled);const query={workspaceId:f.book.id,type:'calculation',limit:2},head=ModuleCatalogue.prototype.head,selected=ModuleCatalogue.prototype.selected;
 ModuleCatalogue.prototype.head=async function(...args){assert.equal(this.store.domain,'calculator','typed list opened an unrelated module head');return head.apply(this,args);};
 ModuleCatalogue.prototype.selected=async()=>{throw Error('list assembled an original body');};
 let first;try{first=await f.reader.list(query);}finally{ModuleCatalogue.prototype.head=head;ModuleCatalogue.prototype.selected=selected;}
 assert.equal(first.total,5);assert.deepEqual(first.items.map(i=>i.title),['Calculation 0','Calculation 1']);assert.deepEqual(first.revisions,{calculator:5});assert.ok(first.nextCursor);
 await f.commands.execute({...scheduled,commandId:randomUUID(),payload:{...scheduled.payload,expectedRevision:1,data:{...scheduled.payload.data,name:'Independent edit'}}});
 const second=await f.reader.list({...query,cursor:first.nextCursor});assert.deepEqual(second.items.map(i=>i.title),['Calculation 2','Calculation 3']);assert.equal(second.revision,first.revision);
 assert.deepEqual((await f.reader.list({...query,cursor:second.previousCursor})).items,first.items);
 await f.commands.execute({...items[0],commandId:randomUUID(),payload:{...items[0].payload,expectedRevision:1,data:{...items[0].payload.data,name:'Changed'}}});
 await assert.rejects(f.reader.list({...query,cursor:first.nextCursor}),{code:'MODULE_QUERY_CURSOR'});
 await assert.rejects(f.reader.list({...query,type:'calendar',cursor:first.nextCursor}),{code:'MODULE_QUERY_CURSOR'});
 const forged=first.nextCursor.slice(0,30)+(first.nextCursor[30]==='A'?'B':'A')+first.nextCursor.slice(31);await assert.rejects(f.reader.list({...query,cursor:forged}),{code:'MODULE_QUERY_CURSOR'});
});

test('selected originals and cross-domain labels remain readable during active domain and research writes', {timeout:120000},async t=>{
 const f=await setup(t),a=calculation(f),b=calendar(f);await f.commands.execute(a);await f.commands.execute(b);
 const read=await f.reader.selected({workspaceId:f.book.id,id:a.payload.id});assert.equal(read.entity.data.expression,'2+3');assert.deepEqual(read.revisions,{calculator:1});
 const missing=randomUUID(),labels=await f.reader.labels({workspaceId:f.book.id,ids:[a.payload.id,b.payload.id,missing]});assert.deepEqual(labels.missing,[missing]);assert.deepEqual(labels.revisions,{calculator:1,calendars:1});assert.equal(labels.items.length,2);
 const research=gate(),held=detached(()=>f.storage.withLock(async()=>{research.enter();await research.hold;}));await research.started;
 try{assert.equal((await f.reader.list({workspaceId:f.book.id,type:'calendar'})).total,1);}finally{research.release();await held;}
 const writer=gate(),writing=detached(()=>f.domains.run(['calculator'],async()=>{writer.enter();await writer.hold;},{write:['calculator']}));await writer.started;
 try{assert.equal((await f.reader.selected({workspaceId:f.book.id,id:a.payload.id})).entity.revision,1);}finally{writer.release();await writing;}
 await assert.rejects(f.reader.selected({workspaceId:f.book.id,id:missing}),{code:'NOT_FOUND'});await assert.rejects(f.reader.list({workspaceId:randomUUID(),type:'calendar'}),{code:'WORKSPACE_CHANGED'});
 assert.deepEqual((await f.reader.labels({workspaceId:f.book.id,ids:[]})).revisions,{});
});
