import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {Reviews} from '../src/reviews.js';
import {reviewHash} from '../src/security/review-exchange.js';
import {performance} from 'node:perf_hooks';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {ReviewScopeIndex} from '../src/review-scope-index.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';

async function fixture(t,count=320){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-review-outline-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0],first=book.notebooks[0].id,second=randomUUID();
 book.notebooks.push({...structuredClone(book.notebooks[0]),id:second,title:'Other takes'});
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),notebookId:i<2?first:second,title:'Saved take '+i,body:'Private original '+i,sections:[],figures:[],attachments:[],relations:[]}));
 const a=await encryptedFixture(path.join(directory,'author'),book),b=await encryptedFixture(path.join(directory,'reviewer'),sampleNotebook());
 t.after(async()=>{clearVault(a.vault);clearVault(b.vault);await rm(directory,{recursive:true,force:true});});
 const service=new Reviews(a.workspace,a.deviceStore),other=new Reviews(b.workspace,b.deviceStore),ac=await service.identity.contact(),bc=await other.identity.contact();
 const run=(operation,data={})=>service.run(operation,{workspaceId:book.id,...data});
 await run('contact',{name:'Reviewer',contact:bc,verified:true});
 return {book,a,b,service,other,ac,bc,run,first,second,payload:records=>({id:randomUUID(),recipient:reviewHash(bc),message:'Review these saved takes.',records})};
}
test('review planning and status use summaries; creation loads only selected records in a 320-record workspace',async t=>{
 const f=await fixture(t),read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,loaded=[];
 ResearchCatalogue.prototype.read=()=>{throw Error('Unexpected whole workspace read');};
 ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return record.call(this,id,...args);};
 t.after(()=>{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;});
 const plan=await f.run('plan',{scope:{kind:'notebook',id:f.first}});assert.deepEqual(plan.records.map(r=>r.id),f.book.entries.slice(0,2).map(r=>r.id));assert.deepEqual(loaded,[]);
 await assert.rejects(f.run('plan',{scope:{kind:'notebook',id:f.second}}));assert.deepEqual(loaded,[]);
 await assert.rejects(f.run('plan',{scope:{kind:'record',id:randomUUID()}}));await assert.rejects(f.run('plan',{scope:{kind:'record',id:f.book.entries[0].id,unexpected:true}}));
 const payload={...f.payload(plan.records.map(({id,revision})=>({id,revision}))),scope:plan.scope},created=await f.run('create',payload);
 assert.deepEqual(loaded,plan.records.map(r=>r.id));loaded.length=0;
 assert.ok((await f.run('create',payload)).file);assert.deepEqual(loaded,[]);
 assert.ok(!JSON.stringify(created).includes('Private original'));
 const page=await f.run('list',{recordId:f.book.entries[0].id});assert.equal(page.items.length,1);assert.equal(page.items[0].records.length,1);assert.equal(page.items[0].records[0].current,true);assert.deepEqual(loaded,[]);
 assert.ok(!JSON.stringify(page).includes('Private original'));
 const target=f.book.entries[0];await new ResearchRecords(f.a.workspace,{}).save({workspaceId:f.book.id,changes:[{id:target.id,expectedRevision:recordRevision(target),record:{...target,title:'New interpretation'}}]},{recordIds:[target.id]});loaded.length=0;
 assert.equal((await f.run('list')).items[0].records[0].current,false);assert.deepEqual(loaded,[]);
 await assert.rejects(f.run('create',{...payload,id:randomUUID()}));assert.deepEqual(loaded,[]);
 const replan=await f.run('plan',{scope:plan.scope});assert.equal(replan.records[0].title,'New interpretation');
 assert.equal((await f.run('read',{id:payload.id})).packet.request.value.records[0].record.title,target.title);
 await assert.rejects(f.service.run('list',{workspaceId:randomUUID()}));assert.deepEqual(loaded,[]);
});
test('review pages retain bounded results, reject changed or forged cursors, and read legacy summaries without writing during browsing',async t=>{
 const f=await fixture(t,32),ref={id:f.book.entries[0].id,revision:recordRevision(f.book.entries[0])},ids=[];
 for(let i=0;i<12;i++){const p=f.payload([ref]);await f.run('create',p);ids.push(p.id);}
 const packet=f.service.packet.bind(f.service);f.service.packet=()=>{throw Error('Old review packet decoded during browsing');};
 const first=await f.run('list');assert.equal(first.items.length,5);assert.equal(first.total,12);assert.equal(first.previousCursor,null);
 const second=await f.run('list',{cursor:first.nextCursor}),third=await f.run('list',{cursor:second.nextCursor});assert.equal(third.items.length,2);assert.equal(third.nextCursor,null);
 assert.deepEqual([...first.items,...second.items,...third.items].map(r=>r.id),ids.toReversed());
 assert.deepEqual((await f.run('list',{cursor:third.previousCursor})).items,second.items);
 await assert.rejects(f.run('list',{cursor:first.nextCursor,recordId:ref.id}));
 const bytes=Buffer.from(first.nextCursor,'base64url');bytes[bytes.length-5]^=1;await assert.rejects(f.run('list',{cursor:bytes.toString('base64url')}));
 await f.run('create',f.payload([ref]));await assert.rejects(f.run('list',{cursor:first.nextCursor}),{code:'CONFLICT'});
 const fresh=await f.run('list'),middle=await f.run('list',{cursor:fresh.nextCursor}),tailCursor=middle.nextCursor;
 const legacy=ids[0];await f.a.workspace.withLock(()=>f.a.workspace.removeMetadata('.observanda/reviews/summaries/'+legacy+'.json'));
 const read=[];f.service.packet=id=>{read.push(id);return packet(id);};await f.run('list');assert.deepEqual(read,[]);await f.run('list',{cursor:tailCursor});assert.deepEqual(read,[legacy]);read.length=0;await f.run('list',{cursor:tailCursor});assert.deepEqual(read,[legacy]);assert.equal(await f.a.workspace.readMetadata('.observanda/reviews/summaries/'+legacy+'.json'),null);
 await f.a.workspace.withLock(()=>f.a.workspace.writeMetadata('.observanda/reviews/summaries/'+legacy+'.json','{}'));
 await assert.rejects(f.run('list',{cursor:tailCursor}),{code:'CATALOGUE_DAMAGED'});
});
test('incoming reviews from another workspace do not witness local records with matching UUIDs',async t=>{
 const f=await fixture(t,32),otherBook=(await f.b.workspace.read()).book;
 // Independent authors may exchange/copy records. A UUID alone is not authority.
 const foreign=await f.other.identity.sign({kind:'request',id:randomUUID(),workspaceId:otherBook.id,createdAt:new Date().toISOString(),sender:f.bc,recipient:reviewHash(f.ac),message:'Foreign workspace',records:[{id:f.book.entries[0].id,revision:recordRevision(f.book.entries[0]),record:f.book.entries[0]}]});
 await f.run('import',{file:await f.other.identity.seal(foreign,f.ac)});
 const list=await f.run('list');assert.equal(list.items[0].records[0].current,null);
 assert.equal((await f.run('list',{recordId:f.book.entries[0].id})).total,0);
});
test('review writes roll back together and a changed notebook membership requires a fresh selection',async t=>{
 const f=await fixture(t,32),scope={kind:'notebook',id:f.first},plan=await f.run('plan',{scope}),payload={...f.payload(plan.records.map(({id,revision})=>({id,revision}))),scope};
 const write=f.a.workspace.writeMetadata;
 f.a.workspace.writeMetadata=async function(name,...args){if(name.includes('/summaries/'))throw Error('Interrupted summary write');return write.call(this,name,...args);};
 try{await assert.rejects(f.run('create',payload),/Interrupted summary write/);}finally{f.a.workspace.writeMetadata=write;}
 assert.equal((await f.run('list')).total,0);assert.equal(await f.a.workspace.readMetadata('.observanda/reviews/'+payload.id+'.json'),null);
 const extra={...structuredClone(f.book.entries[0]),id:randomUUID(),title:'Additional saved take'};
 await new ResearchRecords(f.a.workspace,{}).save({workspaceId:f.book.id,changes:[{id:extra.id,expectedRevision:null,record:extra}]},{recordIds:[extra.id]});
 await assert.rejects(f.run('create',payload));assert.equal((await f.run('list')).total,0);
 const next=await f.run('plan',{scope});assert.equal(next.records.length,3);await f.run('create',{...payload,records:next.records.map(({id,revision})=>({id,revision}))});assert.equal((await f.run('list')).total,1);
});

test('record review pages read at most five summaries as requests grow tenfold, including late pages',async t=>{
 t.diagnostic(os.platform()+'/'+os.arch()+'; '+os.cpus()[0].model+'; Node '+process.version);
 for(const count of [42,420]){
  const f=await fixture(t,65),records=f.book.entries.slice(0,3).map(r=>({id:r.id,revision:recordRevision(r)})),expected=[];
  for(let i=0;i<count;i++){
   const selected=i%3===0?records.slice(0,2):records.slice(2),payload=f.payload(selected);
   await f.run('create',payload);if(i%3===0)expected.unshift(payload.id);
  }
  const read=f.a.workspace.readMetadata.bind(f.a.workspace),packet=f.service.packet;let summaries=0;
  f.a.workspace.readMetadata=(name,...args)=>{if(name.includes('/summaries/'))summaries++;return read(name,...args);};
  f.service.packet=()=>{throw Error('Browsing loaded an original review packet');};
  try{
   let cursor=null,seen=[],pages=0,peak=0;const start=performance.now();
   do{
    summaries=0;const page=await f.run('list',{recordId:records[0].id,cursor});
    assert.equal(page.total,expected.length);assert.equal(summaries,page.items.length);assert.ok(summaries<=5);
    peak=Math.max(peak,summaries);seen.push(...page.items.map(p=>p.id));cursor=page.nextCursor;pages++;
    assert.ok(page.items.every(p=>p.records.length===1&&p.records[0].id===records[0].id));
    if(page.previousCursor){
     summaries=0;const back=await f.run('list',{recordId:records[0].id,cursor:page.previousCursor});assert.ok(summaries<=5);
     assert.deepEqual(back.items.map(p=>p.id),expected.slice(page.offset-5,page.offset));
    }
   }while(cursor);
   assert.deepEqual(seen,expected);
   summaries=0;assert.equal((await f.run('list',{recordId:f.book.entries[3].id})).total,0);assert.equal(summaries,0);
   t.diagnostic(count+' requests: '+pages+' scoped pages; peak '+peak+' summary reads; '+Math.round(performance.now()-start)+' ms including backward traversal.');
  }finally{f.a.workspace.readMetadata=read;f.service.packet=packet;}
  await f.a.workspace.catalogue(s=>new ReviewScopeIndex(s).verify());
 }
});

test('review membership commits atomically, reads missing indexes without writing and rejects damaged authenticated branches',async t=>{
 const f=await fixture(t,8),ref={id:f.book.entries[0].id,revision:recordRevision(f.book.entries[0])},payload=f.payload([ref]),save=ReviewScopeIndex.prototype.save;
 ReviewScopeIndex.prototype.save=()=>{throw Error('Interrupted review scope index');};
 try{await assert.rejects(f.run('create',payload),/Interrupted review scope index/);}finally{ReviewScopeIndex.prototype.save=save;}
 assert.equal((await f.run('list')).total,0);assert.equal(await f.a.workspace.readMetadata('.observanda/reviews/'+payload.id+'.json',1800000),null);
 await f.run('create',payload);
 for(let i=0;i<7;i++)await f.run('create',f.payload([ref]));
 await f.a.workspace.withLock(()=>f.a.workspace.catalogue(s=>s.db.run("DELETE FROM state WHERE slot='review-scopes' OR starts_with(slot,'review-scope-index:')")));
 const read=f.a.workspace.readMetadata.bind(f.a.workspace);let summaries=0;
 f.a.workspace.readMetadata=(name,...args)=>{if(name.includes('/summaries/'))summaries++;return read(name,...args);};
 assert.equal((await f.run('list',{recordId:ref.id})).total,8);assert.equal(summaries,13);
 summaries=0;assert.equal((await f.run('list',{recordId:ref.id})).total,8);assert.equal(summaries,13);
 assert.equal(await f.a.workspace.catalogue(s=>new ReviewScopeIndex(s).state()),null);
 await f.run('create',f.payload([ref]));summaries=0;const page=await f.run('list',{recordId:ref.id});assert.equal(summaries,5);
 f.a.workspace.readMetadata=read;
 const db=await f.a.workspace.openCatalogue();
 try{
  const head=await f.a.workspace.catalogue(s=>new ReviewScopeIndex(s).state()),slot='review-scope-index:'+head.root.hash,row=await db.get('SELECT payload FROM state WHERE slot=$1',slot);
  await db.run('DELETE FROM state WHERE slot=$1',slot);
  await assert.rejects(f.run('list',{recordId:ref.id,cursor:page.nextCursor}),{code:'CATALOGUE_DAMAGED'});
  await assert.rejects(f.a.workspace.catalogue(s=>new ReviewScopeIndex(s).verify()),{code:'CATALOGUE_DAMAGED'});
  await db.run('INSERT INTO state VALUES ($1,$2)',slot,row.payload);
 }finally{await db.close();}
 assert.equal((await f.run('list',{recordId:ref.id})).total,9);
});

test('empty review browsing leaves no index and indexed reviews survive ordinary and fresh-key restore',async t=>{
 const f=await fixture(t,8),recordId=f.book.entries[0].id,contacts=await f.a.workspace.readMetadata('.observanda/reviews/index.json');
 await f.a.workspace.withLock(()=>f.a.workspace.removeMetadata('.observanda/reviews/index.json'));
 assert.equal((await f.run('list',{recordId})).total,0);
 assert.equal(await f.a.workspace.catalogue(s=>new ReviewScopeIndex(s).state()),null);
 await f.a.workspace.catalogue(s=>new ReviewScopeIndex(s).verify());
 const empty=await copyWorkspace(await copyPlan(f.a.workspace.root,path.join(path.dirname(f.a.workspace.root),'empty-backup')),{vault:f.a.vault});
 assert.equal((await new Reviews(new Workspace(empty,f.a.vault),f.a.deviceStore).run('list',{workspaceId:f.book.id,recordId})).total,0);
 await f.a.workspace.withLock(()=>f.a.workspace.writeMetadata('.observanda/reviews/index.json',contacts));
 const payload=f.payload([{id:recordId,revision:recordRevision(f.book.entries[0])}]);
 await f.run('create',payload);
 const expected=await f.run('list',{recordId}),parent=path.dirname(f.a.workspace.root);
 const access=await createAccess('','synthetic restored review password'),vault=takeCreatedVault(access);
 t.after(()=>clearVault(vault));
 const ordinary=await copyWorkspace(await copyPlan(f.a.workspace.root,path.join(parent,'ordinary')),{vault:f.a.vault});
 const fresh=await encryptedCopy(await copyPlan(f.a.workspace.root,path.join(parent,'fresh')),access,vault,f.a.vault);
 for(const [root,key] of [[ordinary,f.a.vault],[fresh,vault]]){
  const workspace=new Workspace(root,key),service=new Reviews(workspace,f.a.deviceStore);
  assert.deepEqual((await service.run('list',{workspaceId:f.book.id,recordId})).items,expected.items);
  await workspace.catalogue(s=>new ReviewScopeIndex(s).verify());
  assert.equal((await service.run('read',{workspaceId:f.book.id,id:payload.id})).packet.request.value.id,payload.id);
 }
 await f.a.workspace.withLock(()=>f.a.workspace.removeMetadata('.observanda/reviews/index.json'));
 await assert.rejects(f.a.workspace.catalogue(s=>new ReviewScopeIndex(s).verify()),{code:'CATALOGUE_DAMAGED'});
});
