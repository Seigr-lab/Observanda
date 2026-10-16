import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceEdits} from '../src/workspace-edits.js';
import {Workspace} from '../src/storage.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {ResearchCatalogue,catalogueDescriptor} from '../src/research-catalogue.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {RecordSearchIndex} from '../src/record-search-index.js';
import {ResearchRecords,recordRevision,recordRevisions} from '../src/research.js';
import {workspaceSaveRequest} from '../src/web/workspace-edits.js';
import {applyRecordPatch} from '../src/web/record-patch.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {publicProjection} from '../src/publication.js';
import {validateWorkspaceOutline} from '../src/web/workspace-reader.js';
import {MediaStore} from '../src/media.js';

async function fixture(t,count=8){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-workspace-edits-'));
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Private take '+i,body:'Unrelated original body '+i,share:false,sections:[{id:randomUUID(),title:'Notes',body:''}],figures:[],attachments:[],relations:[]}));
 book.branding=[{target:'entry:'+book.entries.at(-1).id,logos:[]}];
 book.website.layouts=[defaultPageLayout('entry:'+book.entries.at(-1).id)];
 const {workspace:ws,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 const media=new MediaStore(ws.root,vault),logo=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>'),'image'),saved=await ws.read();
 saved.book.branding[0].logos=[{id:logo.id,alt:'Private mark'}];await ws.save(saved.book,saved.etag);
 return {directory,ws,vault,base:await ws.read(),service:new WorkspaceEdits(ws,{get:async()=>{throw Object.assign(Error('Missing original'),{code:'MEDIA_MISSING'});}})};
}
const request=(base,draft)=>({...workspaceSaveRequest(base.book,draft,recordRevisions(base.book)),baseEtag:base.etag});
const patch=(base,result)=>({etag:result.etag,...applyRecordPatch(base.book,base.etag,recordRevisions(base.book),result)});
async function bounded(ids,fn){
 const old={read:ResearchCatalogue.prototype.read,manifest:ResearchCatalogue.prototype.manifest,put:ResearchCatalogue.prototype.put,record:ResearchCatalogue.prototype.record},members=SnapshotIndex.prototype.members,loaded=[];
 for(const key of ['read','manifest','put'])ResearchCatalogue.prototype[key]=()=>{throw Error('Whole corpus '+key);};
 ResearchCatalogue.prototype.record=function(id,revision){assert.ok(ids.has(id),'Unrelated body loaded: '+id);loaded.push(id);return old.record.call(this,id,revision);};
 SnapshotIndex.prototype.members=()=>{throw Error('Whole membership scan');};
 try{return {result:await fn(),loaded};}finally{Object.assign(ResearchCatalogue.prototype,old);SnapshotIndex.prototype.members=members;}
}
test('general, appearance, website and branding saves reuse record roots at growing corpus sizes',async t=>{
 for(const count of [32,320]){
  const f=await fixture(t,count),before=await f.ws.catalogue(s=>s.snapshot());let base=f.base;
  const edits=[
   b=>{b.title='Research studio';b.description='Shared creative work';},
   b=>{b.appearance.accent='#735123';},
   b=>{b.website.footer='An approved public footer';b.pages.push({id:randomUUID(),title:'Introduction',body:'Selected explanation',share:false});},
   b=>{b.branding.push({target:'home',logos:[{id:b.branding[0].logos[0].id,alt:'Studio emblem'}]});b.projects[0].logoId=b.branding.at(-1).logos[0].id;}
  ];
  await bounded(new Set(),async()=>{
   for(const edit of edits){
    const draft=structuredClone(base.book);edit(draft);const command=request(base,draft);
    assert.deepEqual(command.changes,[]);assert.ok(!JSON.stringify(command).includes('Unrelated original body'));
    const result=await f.service.save(command),next=patch(base,result);
    assert.equal(result.book,undefined);assert.equal(result.recordPatch.order,null);assert.deepEqual(result.recordPatch.records,[]);
    assert.deepEqual({...next.book,revision:draft.revision,updatedAt:draft.updatedAt},draft);base=next;
   }
  });
  assert.deepEqual(await f.ws.read(),{book:base.book,etag:base.etag});
  const after=await f.ws.catalogue(s=>s.snapshot());assert.deepEqual(after.membership,before.membership);assert.deepEqual(after.searchIndex,before.searchIndex);assert.equal(after.bytes,before.bytes);
  t.diagnostic(count+' records: four authoring saves loaded zero record bodies and reused membership/search roots.');
 }
});

test('workspace details save from an explicit outline without loading or replacing original records',async t=>{
 const f=await fixture(t,320),base=await f.ws.catalogue(store=>store.recordOutline()),draft=structuredClone(base.book);draft.title='Research collective';
 const command={...request(base,draft),response:'outline'};
 const {result,loaded}=await bounded(new Set(),()=>f.service.save(command));
 assert.equal(loaded.length,0);validateWorkspaceOutline(result,{workspaceId:f.base.book.id});
 assert.equal(result.total,320);assert.deepEqual(result.notebookCounts,base.notebookCounts);assert.equal(result.book.title,draft.title);assert.deepEqual(result.book.entries,[]);
 assert.deepEqual((await f.ws.read()).book.entries,f.base.book.entries);
 await assert.rejects(f.service.save(command),{code:'CONFLICT'});
 await assert.rejects(f.service.save({...command,response:'partial'}),{code:'INVALID'});
 for(const change of [{total:0},{recordRevisions:[]},{book:{...result.book,entries:f.base.book.entries}},{notebookCounts:{}},{recordPatch:{}}])assert.throws(()=>validateWorkspaceOutline({...result,...change}),{code:'WORKSPACE_READ_INVALID'});
});
test('mixed publication selections and deletion commit together and restore with original revisions',async t=>{
 const f=await fixture(t),draft=structuredClone(f.base.book),removed=draft.entries.pop();
 draft.website.footer='Reviewed context';draft.projects[0].share=true;draft.entries[0].share=true;draft.entries[1].title='A revised interpretation';
 draft.branding=[];draft.website.layouts=[];
 const command=request(f.base,draft),{result}=await bounded(new Set([draft.entries[0].id,draft.entries[1].id,removed.id]),()=>f.service.save(command));
 assert.deepEqual(result.recordPatch.removed,[removed.id]);assert.equal(result.recordPatch.records.length,2);
 const saved=await f.ws.read();assert.deepEqual(patch(f.base,result).book,saved.book);assert.deepEqual(saved.book.entries.slice(2),f.base.book.entries.slice(2,-1));
 assert.deepEqual(await f.ws.catalogue(s=>s.read(f.base.etag)),f.base);
 const publication=JSON.stringify(publicProjection(saved.book));assert.ok(publication.includes(saved.book.entries[0].title));assert.ok(!publication.includes('A revised interpretation'));assert.ok(!publication.includes(removed.id));
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(saved.book)));
 const backup=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'backup')),{vault:f.vault});
 const access=await createAccess('','synthetic authoring restore secret'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.ws.root,path.join(f.directory,'fresh-key')),access,vault,f.vault);
 for(const [root,key] of [[backup,f.vault],[fresh,vault]]){
  const ws=new Workspace(root,key);assert.deepEqual(await ws.read(),saved);
  assert.deepEqual(await ws.catalogue(s=>s.read(f.base.etag)),f.base);
  const next=structuredClone(saved.book);next.description='Edited after restore';
  const reply=await new WorkspaceEdits(ws,{}).save(request(saved,next));assert.deepEqual(patch(saved,reply).book,(await ws.read()).book);
  await ws.catalogue(s=>s.verify(catalogueDescriptor(saved.book)));
 }
});
test('invalid identities, selections, structure mutations and stale bases never partially save',async t=>{
 const f=await fixture(t),base=request(f.base,f.base.book),first=f.base.book.entries[0];
 const invalid=[
  ...[null,[],42].map(website=>({...base,metadata:{website}})),
  ...['pages','branding','themes'].map(key=>({...base,metadata:{[key]:null}})),
  {...base,metadata:{id:randomUUID()}},
  {...base,metadata:{pages:[{id:first.id,title:'Collision',body:'',share:false}]}},
  {...base,metadata:{pages:[{id:first.sections[0].id,title:'Collision',body:'',share:false}]}},
  {...base,metadata:{branding:[{target:'entry:'+randomUUID(),logos:[]}]}},
  {...base,metadata:{website:{...f.base.book.website,layouts:[defaultPageLayout('entry:'+randomUUID())]}}},
  {...base,projects:[{id:randomUUID(),share:true,logoId:null}]},
  {...base,projects:[{id:f.base.book.projects[0].id,share:true,logoId:null,title:'Bypass'}]},
  {...base,metadata:{title:''}},
  {...base,removed:[{id:first.id,expectedRevision:recordRevision(first)},{id:first.id,expectedRevision:recordRevision(first)}]},
  {...base,changes:[{id:first.id,expectedRevision:recordRevision(first),record:{...first,notebookId:randomUUID()}}]},
  {...base,changes:[{id:first.id,expectedRevision:recordRevision(first),record:{...first,sections:[{...first.sections[0],id:f.base.book.entries[1].sections[0].id}]}}]}
 ];
 for(const command of invalid)await assert.rejects(f.service.save(command),{code:'INVALID'});
 await assert.rejects(f.service.save({...base,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(f.service.save({...base,removed:[{id:first.id,expectedRevision:'a'.repeat(64)}]}),{code:'RECORD_CHANGED'});
 assert.deepEqual(await f.ws.read(),f.base);
 const committed=await f.service.save({...base,metadata:{description:'Concurrent changes'}});
 await assert.rejects(f.service.save({...base,metadata:{title:'Stale title'}}),{code:'CONFLICT'});
 assert.equal((await f.ws.outline()).etag,committed.etag);
});
test('failed reference checks and interrupted mixed commits roll back metadata, originals and indexes',async t=>{
 const f=await fixture(t),draft=structuredClone(f.base.book),record=draft.entries[0];
 draft.description='Must not partially commit';record.title='Uncommitted title';
 record.attachments=[{id:randomUUID(),kind:'image',caption:'',alt:'',transcript:'',share:true}];
 await assert.rejects(f.service.save(request(f.base,draft)),{code:'MEDIA_MISSING'});
 assert.deepEqual(await f.ws.read(),f.base);record.attachments=[];
 const before=await f.ws.catalogue(s=>s.db.all('SELECT slot,payload FROM state ORDER BY slot')),snapshots=await f.ws.catalogue(s=>s.snapshots()),replace=RecordSearchIndex.prototype.replace;
 RecordSearchIndex.prototype.replace=()=>{throw Object.assign(Error('Interrupted storage'),{code:'ENOSPC'});};
 try{await assert.rejects(f.service.save(request(f.base,draft)),{code:'ENOSPC'});}
 finally{RecordSearchIndex.prototype.replace=replace;}
 assert.deepEqual(await f.ws.read(),f.base);assert.deepEqual(await f.ws.catalogue(s=>s.snapshots()),snapshots);
 assert.deepEqual(await f.ws.catalogue(s=>s.db.all('SELECT slot,payload FROM state ORDER BY slot')),before);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(f.base.book)));
});
test('mixed insertion has a bounded append response and preserves per-record revision validation',async t=>{
 const f=await fixture(t),draft=structuredClone(f.base.book),record={...structuredClone(draft.entries[0]),id:randomUUID(),sections:[],title:'A new take'};
 draft.entries.push(record);draft.website.footer='New edition';draft.website.layouts.push(defaultPageLayout('entry:'+record.id));
 const {result}=await bounded(new Set(),()=>f.service.save(request(f.base,draft)));
 assert.deepEqual(result.recordPatch.appended,[record.id]);assert.equal(result.recordPatch.records.length,1);const saved=await f.ws.read();
 assert.deepEqual(patch(f.base,result).book,saved.book);
 const existing=saved.book.entries[0],next={...existing,title:'After mixed save'};
 const edit=await new ResearchRecords(f.ws,{}).save({workspaceId:saved.book.id,baseEtag:f.base.etag,changes:[{id:existing.id,expectedRevision:recordRevision(existing),record:next}]},{compact:true});
 assert.deepEqual(patch(f.base,edit).book,(await f.ws.read()).book);
 const broken=structuredClone(result);broken.recordPatch.appended=[];assert.throws(()=>patch(f.base,broken),/Incomplete record update/);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(saved.book)));
});
test('an unchanged save is idempotent and cannot erase a writer that commits after preflight',async t=>{
 const f=await fixture(t),command=request(f.base,f.base.book),unchanged=await f.service.save(command);
 assert.equal(unchanged.etag,f.base.etag);
 const outline=f.ws.outline.bind(f.ws);let once=true;
 f.ws.outline=async()=>{
  const current=await outline();
  if(once){once=false;await new WorkspaceEdits(new Workspace(f.ws.root,f.vault),{}).save({...command,metadata:{description:'Saved by another writer'}});}
  return current;
 };
 await assert.rejects(f.service.save({...command,metadata:{title:'Stale editor'}}),{code:'CONFLICT'});
 const saved=await f.ws.read();assert.equal(saved.book.description,'Saved by another writer');assert.equal(saved.book.title,f.base.book.title);
});
test('client authoring commands exclude unchanged private records and reject structural edits',()=>{
 const book=upgradeNotebook(sampleNotebook()),next=structuredClone(book),revisions=recordRevisions(book);
 next.website.footer='Only metadata';const command=workspaceSaveRequest(book,next,revisions);
 assert.deepEqual(command.metadata,{website:next.website});assert.deepEqual(command.changes,[]);
 next.notebooks[0].title='Structural change';assert.equal(workspaceSaveRequest(book,next,revisions),null);
 next.notebooks=book.notebooks;next.projects[0].title='Other structure';assert.equal(workspaceSaveRequest(book,next,revisions),null);
 next.projects=book.projects;next.entries.reverse();assert.equal(workspaceSaveRequest(book,next,revisions),null);
});

test('template snapshots, private moves and selected media use the shared record save contract',async t=>{
 const f=await fixture(t),{starterTemplate}=await import('../src/web/project-templates.js'),{templateFrom}=await import('../src/web/notebook-schema.js');
 const base=await f.ws.update(book=>{
  book.notebooks[0].configuration=starterTemplate('research-development').configuration;
  book.entries[0].template=templateFrom(book.notebooks[0].configuration.sections[0]);
  book.notebooks.push({id:randomUUID(),projectId:book.projects[0].id,title:'Another lab book'});
  return book;
 });
 const draft=structuredClone(base.book);draft.website.footer='Mixed changes';draft.entries[0].template.label='Silently revised method';
 await assert.rejects(f.service.save(request(base,draft)),{code:'INVALID'});
 draft.entries[0].template=structuredClone(base.book.entries[0].template);
 draft.entries[0].notebookId=draft.notebooks.at(-1).id;draft.entries[0].share=true;
 draft.entries[0].attachments=[{id:randomUUID(),kind:'image',caption:'Selected result',alt:'',transcript:'',share:false}];
 const lookups=[],service=new WorkspaceEdits(f.ws,{get:async(id,options)=>{lookups.push({id,options});return {kind:'image'};}});
 const result=await service.save(request(base,draft)),stored=(await f.ws.read()).book;
 assert.deepEqual(lookups,[{id:draft.entries[0].attachments[0].id,options:{streamed:true}}]);
 assert.equal(stored.entries[0].share,false);assert.equal(stored.entries[0].attachments[0].share,false);
 assert.deepEqual(stored.entries[0].template,base.book.entries[0].template);assert.deepEqual(patch(base,result).book,stored);
});
test('pre-index metadata edits and unchanged retries preserve history and reconcile counts',async t=>{
 const f=await fixture(t);
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const manifest=await store.manifest(f.base.etag);
  await store.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',f.base.etag,store.encode('snapshot',f.base.etag,manifest));
 }));
 const unchanged=await f.service.save(request(f.base,f.base.book));assert.deepEqual(patch(f.base,unchanged).book,f.base.book);
 const draft=structuredClone(f.base.book);draft.website.footer='Older workspace edited';
 const result=await f.service.save(request(f.base,draft));assert.deepEqual(patch(f.base,result).book,(await f.ws.read()).book);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(f.base.book)));
});

test('ordinary record creation returns only appended bodies without scanning the growing catalogue',async t=>{
 for(const count of [32,320]){
  const f=await fixture(t,count),record={...structuredClone(f.base.book.entries[0]),id:randomUUID(),sections:[],title:'New field observation'};
  const command={workspaceId:f.base.book.id,baseEtag:f.base.etag,changes:[{id:record.id,expectedRevision:null,record}]};
  const {result,loaded}=await bounded(new Set(),()=>new ResearchRecords(f.ws,{}).save(command,{compact:true}));
  assert.deepEqual(loaded,[]);assert.equal(result.recordPatch.order,null);assert.deepEqual(result.recordPatch.appended,[record.id]);assert.equal(result.recordPatch.count,count+1);
  assert.deepEqual(patch(f.base,result).book,(await f.ws.read()).book);
  assert.deepEqual((await f.ws.read()).book.entries.slice(0,count),f.base.book.entries);
 }
});
