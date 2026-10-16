import {moduleDraftOwners} from './module-domain-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {clearVault} from '../src/encryption.js';
import {workspaceModules} from '../src/modules/index.js';
import {blankBOM,bomLine} from '../src/web/modules/bom-model.js';

async function fixture(t,count,{sections=0}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-research-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Specimen '+i,body:'Private original '+i,relations:[]}));
 if(sections)book.entries[0].sections=Array.from({length:sections},(_,i)=>({id:randomUUID(),title:'Retained run '+i,body:'Exact original observation '.repeat(1000)}));
 const f=await encryptedFixture(directory,book),store=workspaceModules(f.workspace),original=ResearchCatalogue.prototype.record,read=ResearchCatalogue.prototype.read,members=ResearchCatalogue.prototype.members,loaded=[];
 ResearchCatalogue.prototype.read=()=>{throw Error('Complete research read');};
 ResearchCatalogue.prototype.members=()=>{throw Error('Research membership scan');};
 ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return original.call(this,id,...args);};
 t.after(async()=>{ResearchCatalogue.prototype.record=original;ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.members=members;clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const command=(action,payload,commandId=randomUUID())=>store.execute({workspaceId:book.id,action,payload,commandId});
 return {...f,book,store,command,loaded};
}
for(const count of [40,400])test('module commands and draft recovery never read '+count+' research bodies or scan membership',async t=>{
 const f=await fixture(t,count),id=randomUUID(),data={name:'Exact bases',links:[{workspaceId:f.book.id,type:'record',id:f.book.entries[0].id}],engine:1,mode:'bases',angle:'rad',expression:'',digits:'9007199254740993',fromBase:10,toBase:6};
 const first={id,expectedRevision:null,data},commandId=randomUUID();
 const saved=await f.command('calculation.save',first,commandId);assert.equal((await f.command('calculation.save',first,commandId)).replayed,true);
 assert.equal((await f.store.current()).entities.length,1);
 const before=await f.store.current();
 for(const link of [{workspaceId:randomUUID(),type:'record',id:f.book.entries[0].id},{workspaceId:f.book.id,type:'record',id:randomUUID()}])await assert.rejects(f.command('calculation.save',{id,expectedRevision:1,data:{...data,links:[link]}}),{code:'MODULE_REFERENCE'});
 await assert.rejects(f.command('calculation.save',first),{code:'MODULE_CHANGED'});assert.deepEqual(await f.store.current(),before);
 const {drafts}=moduleDraftOwners(f.workspace,f.book.id,'scientific-calculator'),draftId=randomUUID(),checkpoint=await drafts.write({workspaceId:f.book.id,id:draftId,moduleId:'scientific-calculator',etag:null,drafts:[{id,type:'calculation',expectedRevision:1,base:data,data:{...data,name:'Unfinished'}}]});
 assert.equal((await drafts.list('scientific-calculator')).drafts[0].id,draftId);assert.deepEqual((await drafts.read(draftId)).draft,checkpoint.draft);
 await assert.rejects(drafts.write({workspaceId:randomUUID(),id:draftId,moduleId:'scientific-calculator',etag:checkpoint.etag,drafts:[]}),{code:'WORKSPACE_CHANGED'});
 assert.equal(saved.entities[0].data.digits,'9007199254740993');assert.deepEqual(f.loaded,[]);
 // A broken old reference remains visible and editable; adding it anew fails.
 await new ResearchRecords(f.workspace,{}).remove({workspaceId:f.book.id,recordId:f.book.entries[0].id,expectedRevision:recordRevision(f.book.entries[0])});
 f.loaded.length=0;
 await f.command('calculation.save',{id,expectedRevision:1,data:{...data,name:'After removal'}});
 await assert.rejects(f.command('calculation.save',{id:randomUUID(),expectedRevision:null,data}),{code:'MODULE_REFERENCE'});
 assert.deepEqual(f.loaded,[]);
});
test('BOM saves and reservations use authenticated summaries without record bodies and reject a changed run',async t=>{
 const f=await fixture(t,80,{sections:67}),id=randomUUID(),resource=randomUUID(),record=f.book.entries[0];
 await f.command('resource.create',{id:resource,data:{projectId:null,placementId:null,name:'Resistor',code:'',kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]},openingStock:{quantity:'10',projectId:null}});
 const data={...blankBOM(),title:'Board A',recordId:record.id,lines:[{...bomLine(),value:'4k7',resourceId:resource}]};
 const result=await f.command('bom.save',{id,expectedRevision:null,data}),saved=result.entities.find(e=>e.id===id);
 assert.equal(saved.data.recordRevision,recordRevision(record));assert.deepEqual(f.loaded,[]);
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Changed board'}}]},{compact:true,recordIds:[record.id]});
 const before=await f.store.current();f.loaded.length=0;
 await assert.rejects(f.command('bom.reserve',{id,expectedRevision:1,resources:[{id:resource,revision:1}]}),{code:'MODULE_INVALID'});
 assert.deepEqual(await f.store.current(),before);assert.deepEqual(f.loaded,[]);
});
