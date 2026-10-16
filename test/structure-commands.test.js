import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {StructureCommands} from '../src/structure-commands.js';
import {saveStructure} from '../src/structure.js';
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
import {RecordQuery} from '../src/record-query.js';
import {recordBrowse} from '../src/web/record-query.js';
import {applyRecordPatch} from '../src/web/record-patch.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';
import {starterTemplate} from '../src/web/project-templates.js';
import {validateWorkspaceOutline} from '../src/web/workspace-reader.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {MediaStore} from '../src/media.js';

async function fixture(t,count=12){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-structure-index-'));
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0],project={...book.projects[0],id:randomUUID(),title:'Studio'};
 const notebook={id:randomUUID(),projectId:project.id,title:'Listening'},empty={id:randomUUID(),projectId:book.projects[0].id,title:'Empty book'};
 book.projects.push(project);book.notebooks.push(notebook,empty);
 book.entries=Array.from({length:count},(_,n)=>({...structuredClone(seed),id:randomUUID(),notebookId:n<3?book.notebooks[0].id:notebook.id,title:'Private take '+n,body:'Original working material',share:true,sections:[{id:randomUUID(),title:'Notes',body:''}],figures:[],attachments:[],relations:[]}));
 book.branding=[];
 book.website.layouts=[defaultPageLayout('entry:'+book.entries.at(-1).id),defaultPageLayout('entry:'+book.entries[0].id)];
 const {workspace:ws,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(vault);await rm(directory,{recursive:true,force:true});});
 const asset=await new MediaStore(ws.root,vault).import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="black"/></svg>'),'image');
 book.branding=[{target:'entry:'+book.entries.at(-1).id,logos:[{id:asset.id,alt:'Private mark'}]}];
 await ws.save(book,(await ws.outline()).etag);
 return {directory,ws,vault,base:await ws.read(),service:new StructureCommands(ws)};
}
const command=(f,base,kind,value)=>f.service.execute('structure',{etag:base.etag,change:{kind,value}});
const patch=(base,result)=>({etag:result.etag,...applyRecordPatch(base.book,base.etag,recordRevisions(base.book),result)});
const query=(workspaceId,notebookId,search='private take')=>({workspaceId,query:{projectId:null,notebookId,filter:'all',search,browse:recordBrowse()}});
test('structure receipts retry the exact committed result and cancellation rolls back a streamed move',async t=>{
 const f=await fixture(t,24),source=f.base.book.notebooks[1],destination=f.base.book.notebooks[0];
 const data={commandId:randomUUID(),response:'outline',etag:f.base.etag,change:{kind:'delete-notebook',value:{id:source.id,records:'move',destinationId:destination.id,confirmed:true}}};
 const controller=new AbortController(),stages=[];
 await assert.rejects(f.service.execute('structure',data,{signal:controller.signal,onProgress:value=>{stages.push(value);if(value.stage==='records'&&value.loaded>=10)controller.abort();}}),{name:'AbortError'});
 assert.ok(stages.some(p=>p.loaded===10));assert.equal((await f.ws.outline()).etag,f.base.etag);
 const moved=await f.service.execute('structure',data);assert.equal(moved.total,24);assert.equal(moved.notebookCounts[destination.id],24);
 const newer=await f.service.execute('structure',{response:'outline',etag:moved.etag,change:{kind:'project',value:{...moved.book.projects[0],title:'A later edit'}}});
 assert.deepEqual(await f.service.execute('structure',data),moved);assert.equal((await f.ws.outline()).etag,newer.etag);
 await assert.rejects(f.service.execute('structure',{...data,change:{kind:'delete-notebook',value:{...data.change.value,records:'delete',destinationId:null}}}),{code:'CONFLICT'});
 const copy=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'receipt-backup')),{vault:f.vault});
 assert.deepEqual(await new StructureCommands(new Workspace(copy,f.vault)).execute('structure',data),moved);
});

test('current structure metadata uses a byte budget instead of the old 100-project and 500-book counts',async t=>{
 const f=await fixture(t),book=structuredClone(f.base.book);book.entries=[];
 book.branding=[];book.website.layouts=[];
 book.projects=Array.from({length:110},(_,i)=>({...book.projects[0],id:randomUUID(),title:'Project '+i}));
 book.notebooks=Array.from({length:510},(_,i)=>({...book.notebooks[0],id:randomUUID(),projectId:book.projects[i%110].id,title:'Book '+i}));
 // Start through the document validator, then use the normal metadata command.
 const saved=await f.ws.save(book,f.base.etag),value={...book.notebooks.at(-1),title:'Edited larger directory'};
 const result=await f.service.execute('structure',{etag:saved.etag,response:'outline',change:{kind:'notebook',value}});
 assert.equal(result.book.projects.length,110);assert.equal(result.book.notebooks.length,510);assert.equal(result.total,0);assert.equal(result.book.notebooks.at(-1).title,value.title);
});
async function bounded(allowedBooks,allowedRecords,fn){
 const old={read:ResearchCatalogue.prototype.read,manifest:ResearchCatalogue.prototype.manifest,put:ResearchCatalogue.prototype.put,record:ResearchCatalogue.prototype.record},members=SnapshotIndex.prototype.members;
 const loaded=[];
 for(const key of ['read','manifest','put'])ResearchCatalogue.prototype[key]=()=>{throw Error('Whole corpus '+key);};
 ResearchCatalogue.prototype.record=function(id,revision){assert.ok(allowedRecords.has(id),'Unrelated body loaded: '+id);loaded.push(id);return old.record.call(this,id,revision);};
 SnapshotIndex.prototype.members=function(root,options){assert.ok(allowedBooks.has(options?.notebookId),'Unscoped membership iteration');return members.call(this,root,options);};
 try{return {result:await fn(),loaded};}finally{Object.assign(ResearchCatalogue.prototype,old);SnapshotIndex.prototype.members=members;}
}

test('project, template, tool and lab-book metadata commands retain roots and load no bodies at growing corpus sizes',async t=>{
 for(const count of [32,320]){
  const f=await fixture(t,count),before=await f.ws.catalogue(s=>s.snapshot());let base=f.base;
  const changes=[
   ['project',{...base.book.projects[0],title:'Renamed research',labBookTemplate:starterTemplate('research-development')}],
   ['project-tools',{moduleId:'planning',projectIds:[base.book.projects[0].id]}],
   ['notebook',{...base.book.notebooks[0],title:'Measured notes'}],
   ['notebook',{id:randomUUID(),title:'New lab book',projectId:base.book.projects[0].id}],
   ['project',{id:randomUUID(),title:'New project',description:'',share:false,logoId:null}]
  ];
  await bounded(new Set(),new Set(),async()=>{
   for(const [kind,value] of changes){
    const result=await command(f,base,kind,value);
    assert.equal(result.book,undefined);assert.equal(result.recordPatch.order,null);assert.deepEqual(result.recordPatch.records,[]);
    const expected=saveStructure(base.book,{kind,value}).book,next=patch(base,result);
    assert.deepEqual({...next.book,revision:expected.revision,updatedAt:expected.updatedAt},expected);base=next;
   }
  });
  assert.deepEqual(await f.ws.read(),{book:base.book,etag:base.etag});
  const after=await f.ws.catalogue(s=>s.snapshot());
  assert.deepEqual(after.membership,before.membership);assert.deepEqual(after.searchIndex,before.searchIndex);
  assert.equal(after.bytes,before.bytes);assert.deepEqual(base.book.entries,f.base.book.entries);
  t.diagnostic(count+' records: five structure commands loaded zero record bodies; membership and search roots unchanged.');
 }
});

test('metadata settings responses preserve accurate counts without reading records or returning a corpus patch',async t=>{
 for(const count of [32,320]){
  const f=await fixture(t,count),value={moduleId:'planning',projectIds:[f.base.book.projects[0].id]},command={etag:f.base.etag,change:{kind:'project-tools',value},response:'outline'};
  const {result,loaded}=await bounded(new Set(),new Set(),()=>f.service.execute('structure',command));
  assert.equal(loaded.length,0);validateWorkspaceOutline(result,{workspaceId:f.base.book.id});
  assert.equal(result.total,count);assert.deepEqual(result.book.entries,[]);assert.equal(result.recordPatch,undefined);
  for(const notebook of f.base.book.notebooks)assert.equal(result.notebookCounts[notebook.id],f.base.book.entries.filter(r=>r.notebookId===notebook.id).length);
  const saved=await f.ws.read();assert.deepEqual(saved.book.entries,f.base.book.entries);assert.ok(saved.book.projects[0].tools.includes('planning'));
  await assert.rejects(f.service.execute('structure',command),{code:'CONFLICT'});
  await assert.rejects(f.service.execute('structure',{...command,etag:result.etag,response:'partial'}),{code:'INVALID'});
 }
});

test('moving a lab book reads only its branch, clears publication selections and preserves retained queries and history',async t=>{
 const f=await fixture(t,40),source=f.base.book.notebooks[0],destination=f.base.book.projects[1],entries=f.base.book.entries.slice(0,3);
 const queries=new RecordQuery(f.ws),first=await queries.list({...query(f.base.book.id,source.id),limit:2});
 const {result,loaded}=await bounded(new Set([source.id]),new Set(entries.map(r=>r.id)),()=>f.service.execute('notebook',{etag:f.base.etag,change:{id:source.id,title:'Relocated takes',projectId:destination.id}}));
 // Only the legacy patch response reconstructs these three records. The move
 // itself retains their blocks without the former three additional body reads.
 assert.equal(result.moved,true);assert.equal(result.recordPatch.records.length,3);assert.equal(loaded.length,3);
 const current=await f.ws.read();assert.deepEqual(patch(f.base,result).book,current.book);
 for(const record of current.book.entries.slice(0,3)){assert.equal(record.share,false);assert.equal(record.createdAt,entries.find(r=>r.id===record.id).createdAt);}
 assert.deepEqual(current.book.entries.slice(3),f.base.book.entries.slice(3));
 assert.equal((await queries.list({...query(f.base.book.id,source.id),limit:2,cursor:first.nextCursor})).records.length,1);
 assert.deepEqual(await f.ws.catalogue(s=>s.read(f.base.etag)),f.base);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(current.book)));
});

test('lab-book removal can move contents within or across projects without loading unrelated bodies',async t=>{
 for(const crossProject of [false,true]){
  const f=await fixture(t),source=f.base.book.notebooks[0],destination=f.base.book.notebooks[crossProject?1:2],entries=f.base.book.entries.slice(0,3);
  const {result}=await bounded(new Set([source.id]),new Set(entries.map(r=>r.id)),()=>command(f,f.base,'delete-notebook',{id:source.id,records:'move',destinationId:destination.id,confirmed:true}));
  const current=await f.ws.read();assert.deepEqual(patch(f.base,result).book,current.book);assert.equal(current.book.notebooks.some(n=>n.id===source.id),false);
  for(const record of current.book.entries.slice(0,3)){assert.equal(record.notebookId,destination.id);assert.equal(record.share,!crossProject);}
  assert.deepEqual(current.book.entries.slice(3),f.base.book.entries.slice(3));
  assert.equal((await new RecordQuery(f.ws).list(query(current.book.id,destination.id))).total,crossProject?12:3);
  await f.ws.catalogue(s=>s.verify(catalogueDescriptor(current.book)));
 }
});

test('deletion responses reconcile concurrent changes with no discarded bodies and retain exact original revisions',async t=>{
 const f=await fixture(t),source=f.base.book.notebooks[0],removed=f.base.book.entries.slice(0,3).map(r=>r.id);
 const {result}=await bounded(new Set([source.id]),new Set(),()=>command(f,f.base,'delete-notebook',{id:source.id,records:'delete',destinationId:null,confirmed:true}));
 assert.deepEqual(new Set(result.recordPatch.removed),new Set(removed));assert.equal(result.recordPatch.count,9);
 const deleted=await f.ws.read();assert.deepEqual(patch(f.base,result).book,deleted.book);
 assert.equal(deleted.book.website.layouts.some(l=>l.target==='entry:'+removed[0]),false);
 assert.deepEqual(deleted.book.branding,f.base.book.branding);
 const other=f.base.book.entries[3];
 const {result:concurrent}=await bounded(new Set(),new Set([other.id]),()=>new ResearchRecords(f.ws,{}).save({workspaceId:f.base.book.id,baseEtag:f.base.etag,changes:[{id:other.id,expectedRevision:recordRevision(other),record:{...other,title:'A concurrent edit'}}]},{compact:true}));
 assert.deepEqual(patch(f.base,concurrent).book,(await f.ws.read()).book);
 assert.deepEqual(new Set(concurrent.recordPatch.removed),new Set(removed));
 const historic=await f.ws.catalogue(s=>s.read(f.base.etag));assert.deepEqual(historic,f.base);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(historic.book)));
 // Dropping a deletion from the delta would silently leave stale records in a client.
 const snapshot=await f.ws.catalogue(s=>s.snapshot(result.etag));
 await f.ws.withLock(()=>f.ws.catalogue(s=>s.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',result.etag,s.encode('snapshot',result.etag,{...snapshot,delta:{...snapshot.delta,removed:[]}}))));
 await assert.rejects(f.ws.catalogue(s=>s.verify(catalogueDescriptor(historic.book))),{code:'CATALOGUE_DAMAGED'});
});

test('identity collisions, invalid metadata, stale forms and interrupted commits fail atomically',async t=>{
 const f=await fixture(t),source=f.base.book.notebooks[0],p=f.base.book.projects[0],first=f.base.book.entries[0];
 for(const [kind,value] of [
  ['project',true],['project','invalid'],['notebook',[]],
  ['project',{...p,id:first.id}],['project',{...p,id:first.sections[0].id}],
  ['notebook',{...source,id:first.id}],['notebook',{...source,projectId:randomUUID()}],
  ['notebook',{...source,configuration:{bad:true}}],['project',{...p,parentId:p.id}],
  ['delete-notebook',{id:source.id,records:'empty',destinationId:null,confirmed:true}],
  ['delete-notebook',{id:source.id,records:'delete',destinationId:null,confirmed:false}]
 ])await assert.rejects(command(f,f.base,kind,value),{code:'INVALID'});
 assert.deepEqual(await f.ws.read(),f.base);
 const before=await f.ws.catalogue(s=>s.db.all('SELECT slot,payload FROM state ORDER BY slot')),original=RecordSearchIndex.prototype.replace;
 RecordSearchIndex.prototype.replace=()=>{throw Object.assign(Error('Interrupted write'),{code:'ENOSPC'});};
 try{await assert.rejects(command(f,f.base,'delete-notebook',{id:source.id,records:'delete',destinationId:null,confirmed:true}),{code:'ENOSPC'});}
 finally{RecordSearchIndex.prototype.replace=original;}
 assert.deepEqual(await f.ws.read(),f.base);
 assert.deepEqual(await f.ws.catalogue(s=>s.db.all('SELECT slot,payload FROM state ORDER BY slot')),before);
 const saved=await command(f,f.base,'project',{...p,title:'Committed'});
 await assert.rejects(command(f,f.base,'notebook',{...source,title:'Stale choice'}),{code:'CONFLICT'});
 assert.equal((await f.ws.outline()).etag,saved.etag);
});

test('reorganization preview is read-only and counts only selected metadata branches',async t=>{
 const f=await fixture(t),p=f.base.book.projects[0],source=f.base.book.notebooks[0],empty=f.base.book.notebooks[2];
 const change={workspaceTitle:'Creative research',workspaceDescription:'One workspace',projectId:p.id,copyLogos:true};
 const {result:plan}=await bounded(new Set([source.id,empty.id]),new Set(),()=>f.service.execute('reorganize',{etag:f.base.etag,change},{preview:true}));
 assert.equal(plan.summary.records,3);assert.equal(plan.summary.notebooks,2);assert.equal((await f.ws.outline()).etag,f.base.etag);
 await assert.rejects(f.service.execute('reorganize',{etag:plan.etag,change}),{code:'INVALID'});
 const {result}=await bounded(new Set([source.id,empty.id]),new Set(),()=>f.service.execute('reorganize',{etag:plan.etag,change,reviewed:true}));
 assert.deepEqual(patch(f.base,result).book,(await f.ws.read()).book);assert.equal(result.projectId,p.id);
});

test('ordinary and fresh-key restore preserve structure changes, deleted history and future edits',async t=>{
 const f=await fixture(t,8),source=f.base.book.notebooks[0];
 await command(f,f.base,'delete-notebook',{id:source.id,records:'delete',destinationId:null,confirmed:true});
 const saved=await f.ws.read(),copy=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'backup')),{vault:f.vault});
 const access=await createAccess('','synthetic structure restore secret'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const rekeyed=await encryptedCopy(await copyPlan(f.ws.root,path.join(f.directory,'fresh-key')),access,vault,f.vault);
 for(const [root,key] of [[copy,f.vault],[rekeyed,vault]]){
  const ws=new Workspace(root,key);assert.deepEqual(await ws.read(),saved);assert.deepEqual(await ws.catalogue(s=>s.read(f.base.etag)),f.base);
  const p=saved.book.projects[0],result=await new StructureCommands(ws).execute('structure',{etag:saved.etag,change:{kind:'project',value:{...p,title:'After restore'}}});
  assert.deepEqual(patch(saved,result).book,(await ws.read()).book);
  await ws.catalogue(s=>s.verify(catalogueDescriptor(saved.book)));
 }
});

test('client rejects incomplete deletion deltas and never silently keeps stale records',async t=>{
 const f=await fixture(t,6),source=f.base.book.notebooks[0];
 const result=await command(f,f.base,'delete-notebook',{id:source.id,records:'delete',destinationId:null,confirmed:true});
 for(const corrupt of [{removed:[]},{removed:[...result.recordPatch.removed,result.recordPatch.removed[0]]},{count:6},{removed:[randomUUID(),...result.recordPatch.removed.slice(1)]},{records:[f.base.book.entries[0]]}]){
  assert.throws(()=>patch(f.base,{...result,recordPatch:{...result.recordPatch,...corrupt}}),/Incomplete record update/);
 }
});

test('pre-index catalogues validate structure and upgrade membership without changing original records',async t=>{
 const f=await fixture(t,6);
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const manifest=await store.manifest(f.base.etag);
  await store.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',f.base.etag,store.encode('snapshot',f.base.etag,manifest));
 }));
 const change={workspaceTitle:'Restored workspace',workspaceDescription:'',projectId:f.base.book.projects[0].id,copyLogos:false};
 const preview=await f.service.execute('reorganize',{etag:f.base.etag,change},{preview:true});
 assert.equal(preview.summary.records,3);
 const result=await command(f,f.base,'notebook',{...f.base.book.notebooks[0],title:'Renamed legacy book'});
 const latest=patch(f.base,result).book;
 assert.equal(latest.notebooks[0].title,'Renamed legacy book');assert.deepEqual(latest.entries,f.base.book.entries);
 assert.equal((await f.ws.catalogue(s=>s.snapshot())).indexVersion,1);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(f.base.book)));
});

test('creating and removing empty lab books needs no body reads even when the corpus is empty',async t=>{
 const f=await fixture(t,3),source=f.base.book.notebooks[0];
 const removed=await command(f,f.base,'delete-notebook',{id:source.id,records:'delete',destinationId:null,confirmed:true}),base=patch(f.base,removed);
 assert.equal(base.book.entries.length,0);
 const id=randomUUID(),value={id,title:'Fresh start',projectId:base.book.projects[0].id};
 const {result}=await bounded(new Set([id]),new Set(),async()=>{
  const created=await command(f,base,'notebook',value),latest=patch(base,created);
  return command(f,latest,'delete-notebook',{id,records:'empty',destinationId:null,confirmed:true});
 });
 assert.equal(result.recordPatch.count,0);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(base.book)));
});

test('partially indexed old ownership is completed instead of omitting records from a deletion',async t=>{
 const f=await fixture(t,6),source=f.base.book.notebooks[0];
 await f.ws.withLock(()=>f.ws.catalogue(async store=>{
  const manifest=await store.manifest(f.base.etag);
  manifest.records=manifest.records.map(({notebookId,queryRevision,summaryRevision,...row})=>row);
  await store.db.run('UPDATE snapshots SET payload=$2 WHERE id=$1',f.base.etag,store.encode('snapshot',f.base.etag,manifest));
 }));
 // An ordinary edit can leave older siblings without scoped membership.
 const other=f.base.book.entries.at(-1);
 await new ResearchRecords(f.ws,{}).save({workspaceId:f.base.book.id,changes:[{id:other.id,expectedRevision:recordRevision(other),record:{...other,title:'One indexed sibling'}}]});
 const current=await f.ws.read(),snapshot=await f.ws.catalogue(s=>s.snapshot());
 assert.equal(await f.ws.catalogue(s=>new SnapshotIndex(s).scopedCount(snapshot.membership)),1);
 const result=await command(f,current,'delete-notebook',{id:source.id,records:'delete',destinationId:null,confirmed:true});
 const saved=patch(current,result).book;assert.equal(saved.entries.length,3);
 assert.ok(saved.entries.every(r=>r.notebookId!==source.id));
 const latest=await f.ws.catalogue(s=>s.snapshot());
 assert.equal(await f.ws.catalogue(s=>new SnapshotIndex(s).scopedCount(latest.membership)),latest.count);
 await f.ws.catalogue(s=>s.verify(catalogueDescriptor(saved)));
 const copy=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'legacy-backup')),{vault:f.vault});
 assert.deepEqual(await new Workspace(copy,f.vault).read(),await f.ws.read());
});
