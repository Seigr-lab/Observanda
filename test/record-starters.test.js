import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {RecordStarters} from '../src/record-starters.js';
import {validStarter,starterRecord} from '../src/web/record-starter-model.js';
import {plainRichText} from '../src/web/rich-text-model.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {createAccess,takeCreatedVault,readAccess,verifyAccess} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {buildPublication} from '../src/publication.js';
import {testServer} from './device-fixture.js';
import {sealStarter} from '../src/record-starter-package.js';
const blueprint=()=>({name:'Private controlled protocol',type:'experiment',title:'Next precision trial',body:plainRichText('Follow these private instructions.'),sections:[{title:'Method',body:'Measure the declared interval.'},{title:'Results',body:''}],tags:['trial']});
async function fixture(t){const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-starters-')),root=path.join(dir,'workspace'),book=upgradeNotebook(sampleNotebook()),access=await createAccess('','synthetic starter password'),vault=takeCreatedVault(access);await initializeLocation(root,book,access,vault);const ws=new Workspace(root,vault),store=new RecordStarters(ws,{});t.after(async()=>{clearVault(vault);await rm(dir,{recursive:true,force:true});});return {dir,root,book,ws,store,vault,workspaceId:book.id};}
async function released(f,draft=blueprint()){const c={workspaceId:f.workspaceId,id:randomUUID(),expectedRevision:null,draft},saved=await f.store.save(c),published=await f.store.publish({workspaceId:f.workspaceId,id:c.id,expectedRevision:saved.header.revision,note:'Reviewed instructions for the first trial.'});return {...published,id:c.id,saved,c};}

test('portable templates retain rich instructions, reject dependencies, and create fresh empty execution identities',()=>{
 const b=blueprint(),block={type:'book_equation',attrs:{version:1,id:randomUUID(),source:'x=1',label:'Declared equation'}};b.body.content.push(block);assert.ok(validStarter(b));
 const a=starterRecord(b,{id:randomUUID(),notebookId:randomUUID(),uuid:randomUUID,now:new Date().toISOString()}),c=starterRecord(b,{id:randomUUID(),notebookId:randomUUID(),uuid:randomUUID,now:new Date().toISOString()});
 assert.notEqual(a.body.content[1].attrs.id,c.body.content[1].attrs.id);assert.notEqual(a.body.content[1].attrs.id,block.attrs.id);assert.notEqual(a.sections[0].id,c.sections[0].id);
 for(const r of [a,c]){assert.equal(r.share,false);assert.equal(r.status,'draft');assert.equal(r.outcome,'');assert.deepEqual(r.occurredOn,{kind:'unknown'});for(const key of ['figures','attachments','contributors','relations'])assert.deepEqual(r[key],[]);assert.equal(r.attempt,undefined);assert.equal(r.results,undefined);}
 const dependencies=[{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:randomUUID(),alternative:'Private figure'}}, {type:'paragraph',content:[{type:'text',text:'private',marks:[{type:'font_family',attrs:{font:'custom-'+'a'.repeat(64)}}]}]}, {type:'paragraph',content:[{type:'text',text:'private',marks:[{type:'link',attrs:{href:'observanda://'+randomUUID()+'/record/'+randomUUID(),title:'',target:'_self',nofollow:false}}]}]}];
 for(const n of dependencies)assert.equal(validStarter({...b,body:{type:'doc',content:[n]}}),false);
 assert.equal(validStarter({...b,results:[]}),false);assert.equal(validStarter({...b,tags:Array.from({length:33},(_,i)=>'tag'+i)}),true);assert.equal(validStarter({...b,sections:Array.from({length:31},()=>b.sections[0])}),true);assert.equal(validStarter({...b,sections:Array.from({length:31},()=>b.sections[0])},{legacy:true}),false);
});

test('drafts, immutable releases, concurrent edits, archive and idempotent record creation retain exact provenance',async t=>{
 const f=await fixture(t),r=await released(f),workspaceId=f.workspaceId,read={workspaceId,id:r.id};
 assert.deepEqual((await f.store.save(r.c)).draft,r.saved.draft); // Lost acknowledgement cannot revert a later release.
 const again=await f.store.publish({...read,expectedRevision:r.saved.header.revision,note:r.release.note});assert.equal(again.release.revision,r.release.revision);
 const first={...read,release:r.release.revision,recordId:randomUUID(),notebookId:f.book.notebooks[0].id};await f.store.create(first);
 const original=(await f.ws.read()).book.entries.find(e=>e.id===first.recordId);assert.equal(original.sections[1].body,'');
 const modified={...blueprint(),title:'Later planned trial',body:'New method instructions'};
 const updated=await f.store.save({...read,expectedRevision:r.header.revision,draft:modified});
 await assert.rejects(f.store.save({...read,expectedRevision:r.header.revision,draft:{...modified,title:'Concurrent edit'}}),{code:'STARTER_CHANGED'});
 const second=await f.store.publish({...read,expectedRevision:updated.header.revision,note:'Changed method instructions.'});assert.equal(second.release.number,2);
 assert.deepEqual((await f.store.release({...read,release:r.release.revision})).blueprint,blueprint());assert.equal((await f.store.history({...read,cursor:null})).items.length,2);
 const snapshot=await f.ws.read(),edited=snapshot.book.entries.find(e=>e.id===first.recordId);edited.body='Actual independently authored result';await f.ws.save(snapshot.book,snapshot.etag);
 await f.store.create(first);assert.equal((await f.ws.read()).book.entries.find(e=>e.id===first.recordId).body,edited.body);
 assert.equal((await f.store.origin({workspaceId,recordId:first.recordId})).origin.release,r.release.revision);
 await assert.rejects(f.store.create({...first,release:second.release.revision}),{code:'STARTER_CHANGED'});
 const archived=await f.store.archive({...read,expectedRevision:second.header.revision,archived:true});
 await assert.rejects(f.store.create({...first,recordId:randomUUID()}),{code:'STARTER_ARCHIVED'});
 await assert.rejects(f.store.save({...read,expectedRevision:archived.header.revision,draft:modified}),{code:'STARTER_ARCHIVED'});
 assert.equal((await f.store.release({...read,release:r.release.revision})).number,1);
 await f.store.archive({...read,expectedRevision:archived.header.revision,archived:false});
 await f.store.create({...first,recordId:randomUUID()});assert.equal((await f.store.list({workspaceId,cursor:null})).items.length,1);
 await assert.rejects(f.store.list({workspaceId:randomUUID(),cursor:null}),{code:'WORKSPACE_CHANGED'});
 const occupied=f.book.entries[0].id;await assert.rejects(f.store.create({...first,recordId:occupied}),{code:'RECORD_CHANGED'});assert.equal((await f.store.origin({workspaceId,recordId:occupied})).origin,null);
});

test('encrypted package review, independent import, metadata backup and public projection preserve the boundary',async t=>{
 const f=await fixture(t),r=await released(f),workspaceId=f.workspaceId,password='a separate package password',query={workspaceId,id:r.id,release:r.release.revision};
 const {encoded}=await f.store.export({...query,password});assert.ok(!Buffer.from(encoded,'base64').includes(Buffer.from('private instructions')));
 const preview=await f.store.preview({workspaceId,encoded,password});assert.deepEqual(preview.value.blueprint,blueprint());
 await assert.rejects(sealStarter({...preview.value,blueprint:{...preview.value.blueprint,body:'Unreviewed replacement'}},password),{code:'STARTER_PACKAGE'});
 await assert.rejects(f.store.preview({workspaceId,encoded,password:'wrong password here'}),{code:'STARTER_PACKAGE'});
 const damaged=Buffer.from(encoded,'base64');damaged[damaged.length-1]^=1;await assert.rejects(f.store.preview({workspaceId,encoded:damaged.toString('base64'),password}),{code:'STARTER_PACKAGE'});
 const dest=await fixture(t),id=randomUUID(),command={workspaceId:dest.workspaceId,id,encoded,password,digest:preview.digest};
 await assert.rejects(dest.store.import({...command,digest:'a'.repeat(64)}),{code:'STARTER_CHANGED'});assert.equal((await dest.store.list({workspaceId:dest.workspaceId,cursor:null})).items.length,0);
 const imported=await dest.store.import(command);assert.equal(imported.header.latest,null);assert.equal(imported.header.origin.release,r.release.revision);assert.deepEqual((await dest.store.import(command)).header,imported.header);
 await f.store.create({...query,recordId:randomUUID(),notebookId:f.book.notebooks[0].id});
 const destination=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.dir,'backup')),{vault:f.vault});
 const vault=await verifyAccess(await readAccess(destination),'','synthetic starter password');
 try{const restored=new RecordStarters(new Workspace(destination,vault),{});assert.deepEqual(await restored.release(query),await f.store.release(query));assert.deepEqual(await restored.read({workspaceId,id:r.id}),await f.store.read({workspaceId,id:r.id}));}finally{clearVault(vault);}
 const publication=buildPublication((await f.ws.read()).book);const text=[...publication.files.values()].filter(v=>typeof v==='string').join('\n');assert.ok(!text.includes('private instructions'));assert.ok(!text.includes('Private controlled protocol'));assert.ok(![...publication.files.keys()].some(k=>k.includes('record-starters')));
});

test('template library and history use bounded pages without loading record bodies',async t=>{
 const f=await fixture(t),workspaceId=f.workspaceId,ids=[];
 // Any accidental whole-workspace load fails this test immediately.
 f.ws.read=()=>{throw Error('Unrelated records loaded for a template operation');};
 for(let i=0;i<23;i++){const id=randomUUID();ids.push(id);await f.store.save({workspaceId,id,expectedRevision:null,draft:{...blueprint(),name:'Template '+i}});}
 const first=await f.store.list({workspaceId,cursor:null}),last=await f.store.list({workspaceId,cursor:first.next});assert.equal(first.items.length,20);assert.equal(last.items.length,3);assert.equal(last.next,null);assert.equal(new Set([...first.items,...last.items].map(v=>v.id)).size,23);
 let current=await f.store.read({workspaceId,id:ids[0]});
 for(let i=0;i<23;i++){const result=await f.store.publish({workspaceId,id:ids[0],expectedRevision:current.header.revision,note:'Reviewed release '+i});current={header:result.header};}
 const page=await f.store.history({workspaceId,id:ids[0],cursor:null}),tail=await f.store.history({workspaceId,id:ids[0],cursor:page.next});assert.equal(page.items.length,20);assert.deepEqual(tail.items.map(v=>v.number),[3,2,1]);assert.equal(tail.next,null);
 await assert.rejects(f.store.history({workspaceId,id:ids[0],cursor:'../../invalid'}),{code:'INVALID'});
});

test('template endpoints require authentication, workspace binding and unlocked access',async t=>{
 const f=await fixture(t),app=await testServer({root:f.root,port:0,headless:true});t.after(()=>app.close());
 const command={workspaceId:f.workspaceId,cursor:null},route='/api/research/starters/list';
 const target={workspaceId:f.workspaceId,recordId:f.book.entries[0].id,snapshotId:(await f.ws.outline()).etag},sourceCommands=[['source',{...target,offset:0}],['capture',{...target,body:false,sections:[]}]];
 const selectedOperations=['view','field','change','capture-begin','capture-append','capture-finish','publish-selected','upload','uploadPart','review','packageView','packageField','accept','discard','download'];
 const unauth=await fetch(app.origin+route,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify(command)});assert.equal(unauth.status,401);
 for(const [operation,value] of sourceCommands)assert.equal((await fetch(app.origin+'/api/research/starters/'+operation,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify(value)})).status,401);
 for(const operation of selectedOperations)assert.equal((await fetch(app.origin+'/api/research/starters/'+operation,{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:'{}'})).status,401);
 const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});
 const headers={Origin:app.origin,Cookie:auth.headers.get('set-cookie').split(';')[0],'Content-Type':'application/json'};
 const post=(route,value,extra={})=>fetch(app.origin+route,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(value)});
 assert.equal((await post('/api/access/unlock',{password:'synthetic starter password'})).status,200);
 assert.equal((await post('/api/storage/open',{path:f.root,password:'synthetic starter password'})).status,200);
 const current=await (await fetch(app.origin+'/api/storage',{headers})).json();headers['X-Observanda-Workspace']=current.contextId;
 assert.equal((await post(route,command,{'X-Observanda-Workspace':randomUUID()})).status,409);
 assert.equal((await post(route,command)).status,200);
 for(const operation of selectedOperations)assert.equal((await post('/api/research/starters/'+operation,{}, {'X-Observanda-Workspace':randomUUID()})).status,409);
 for(const [operation,value] of sourceCommands){const endpoint='/api/research/starters/'+operation;assert.equal((await post(endpoint,value,{'X-Observanda-Workspace':randomUUID()})).status,409);assert.equal((await post(endpoint,value)).status,200);}
 assert.equal((await post('/api/research/starters/constructor',{})).status,404);
 const id=randomUUID(),saved=await (await post('/api/research/starters/save',{workspaceId:f.workspaceId,id,expectedRevision:null,draft:blueprint()})).json();assert.equal(saved.header.id,id);
 assert.equal((await post('/api/research/starters/save',{workspaceId:f.workspaceId,id,expectedRevision:null,draft:{...blueprint(),name:'Concurrent change'}})).status,409);
 assert.equal((await post('/api/access/lock',{})).status,200);assert.equal((await post(route,command)).status,401);
 for(const [operation,value] of sourceCommands)assert.equal((await post('/api/research/starters/'+operation,value)).status,401);
 for(const operation of selectedOperations)assert.equal((await post('/api/research/starters/'+operation,{})).status,401);
});
