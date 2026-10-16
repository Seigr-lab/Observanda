import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {moduleDashboardFixture} from './module-dashboard-fixture.js';
import {fixture} from './project-domain-fixture.js';
import {seedModuleCurrent} from './module-current-fixture.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {ModuleReader} from '../src/modules/reader.js';
import {moduleReferenceIncoming} from '../src/module-reference-incoming.js';
import {projectRecordCollection} from '../src/project-record-collection.js';
import {projectCollectionReader} from '../src/project-collection-reader.js';
import {RecordCollectionPages} from '../src/record-collection-pages.js';
import {ProjectDomains} from '../src/project-domains.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {referenceOriginKey} from '../src/research-reference-namespace.js';
import {workspaceFile} from '../src/storage.js';
import {backupCatalogue} from '../src/postgres.js';
import {verifyCatalogueArchive} from '../src/research-catalogue.js';
import {ProjectStorage} from '../src/project-storage.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ProjectSessionOwner} from '../src/project-session-owner.js';
const task=(id,links,title='Linked task')=>({id,type:'task',revision:1,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',data:{title,description:'Related work',status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links}});
const calculation=(id,links,name='Linked calculation')=>({id,type:'calculation',revision:1,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z',data:{name,links,engine:1,mode:'expression',angle:'rad',expression:'2+3',digits:'',fromBase:10,toBase:16}});

test('incoming links compose qualified summaries, preserve source independence and fail on revoked admitted grants',{timeout:240000},async t=>{
 const f=await moduleDashboardFixture(t),app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={},pages=new RecordCollectionPages();t.after(()=>app.close());t.after(()=>pages.clear());
 for(const p of f.projects)await app.unlock(client,p.projectId,{});
 const bookAction=(book,action)=>app.run(client,projectRequest('/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/access/'+action,'POST'),action==='unlock'?{password:'Protected observations 456!'}:{});
 for(const b of f.books)await bookAction(b,'unlock');
 const target={workspaceId:f.books[0].namespaceId,type:'record',id:f.books[0].before.book.entries[0].id},taskId=randomUUID(),entities=[];
 for(const owner of f.owners){const entity=task(taskId,[target]);entities.push(entity);await seedModuleCurrent(owner.storage,owner.workspaceId,[entity]);}
 const base={workspaceId:f.workspaceId,target,types:['task'],query:'',cursor:null,limit:2},visit=projectRecordCollection(app,client,async()=>{});
 const read=async(values={},who=client,visitor=projectRecordCollection(app,who,async()=>{}))=>{
  const reader=projectCollectionReader(app,who,async()=>{});
  try{const result=await moduleReferenceIncoming(pages,who,{...base,...values},{collectionWorkspaceId:f.workspaceId,visit:visitor,resolveTarget:(_target,consume)=>reader.use({workspaceId:target.workspaceId,projectId:f.books[0].projectId,labBookId:f.books[0].labBookId},null,async(store,snapshot,{storage})=>{assert.ok(await store.member(snapshot,target.id));return consume(storage,target,{store,snapshot});})});await reader.verify();return result;}finally{await reader.close();}
 };
 t.mock.method(ModuleCatalogue.prototype,'selected',()=>{throw Error('Incoming lookup opened an original');});t.mock.method(ModuleCatalogue.prototype,'read',()=>{throw Error('Incoming lookup loaded all originals');});t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Incoming lookup opened a research body');});
 const first=await read();assert.equal(first.total,5);assert.equal(first.items.length,2);assert.equal(first.partial,false);assert.equal(first.unavailableTotal,0);
 const rows=[...first.items];let next=first;
 while(next.nextCursor){const previous=next;next=await read({cursor:next.nextCursor});rows.push(...next.items);assert.deepEqual((await read({cursor:next.previousCursor})).items,previous.items);}
 assert.equal(new Set(rows.map(row=>row.key)).size,5);assert.deepEqual(new Set(rows.map(row=>row.reference.workspaceId)),new Set(f.owners.map(owner=>owner.workspaceId)));assert.ok(rows.every(row=>row.reference.id===taskId&&row.reference.type==='task'&&row.owner.workspaceId===row.reference.workspaceId&&row.openType==='task'&&row.openId===taskId));
 const other={};for(const p of f.projects)await app.unlock(other,p.projectId,{});await app.run(other,projectRequest('/api/projects/'+f.books[0].projectId+'/lab-books/'+f.books[0].labBookId+'/access/unlock','POST'),{password:'Protected observations 456!'});
 await assert.rejects(read({cursor:first.nextCursor},other),{code:'RECORD_QUERY_CURSOR'});
 assert.equal((await read({types:null,limit:25})).total,5);
 await assert.rejects(read({query:'different',cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 const local=new ModuleReader(f.owners[0].storage);assert.ok((await local.list({workspaceId:f.workspaceId,types:['movement'],reference:{workspaceId:f.workspaceId,type:'resource',id:f.resourceId}})).total>0);
 assert.equal((await local.list({workspaceId:f.workspaceId,types:['movement'],reference:{workspaceId:randomUUID(),type:'resource',id:f.resourceId}})).total,0);
 t.mock.restoreAll();
 let release,started;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>started=resolve),source=f.owners[1];
 const held=new ProjectDomains(source.storage,source.workspaceId).run(['calculator'],async()=>source.storage.withLock(async()=>{started();await gate;}),{write:['calculator']});await ready;
 try{assert.equal((await read({cursor:first.nextCursor})).total,5);}finally{release();await held;}
 await source.command('calculation.save',{id:randomUUID(),expectedRevision:null,data:calculation(randomUUID(),[]).data});assert.equal((await read({cursor:first.nextCursor})).total,5);
 await bookAction(f.books[1],'lock');const partial=await read();assert.equal(partial.total,4);assert.equal(partial.partial,true);assert.equal(partial.unavailableTotal,1);assert.deepEqual(partial.unavailable,[{workspaceId:f.books[1].namespaceId,projectId:f.books[1].projectId,labBookId:f.books[1].labBookId,code:'ACCESS_LOCKED'}]);
 await assert.rejects(visit(async()=>{},{workspaceId:f.workspaceId,scope:null}),error=>error.code==='ACCESS_LOCKED'&&error.labBookId===f.books[1].labBookId);
 await assert.rejects(read({cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 await bookAction(f.books[1],'unlock');await assert.rejects(read({cursor:partial.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 await app.lock(client,f.projects[1].projectId);const projectPartial=await read();assert.equal(projectPartial.total,3);assert.deepEqual(projectPartial.unavailable,[{workspaceId:f.projects[1].namespaceId,projectId:f.projects[1].projectId,labBookId:null,code:'ACCESS_LOCKED'}]);await app.unlock(client,f.projects[1].projectId,{});await bookAction(f.books[1],'unlock');
 // The first admitted project grant is revoked only after a later owner has
 // been consumed. Its retained verification must reject the whole response.
 let previous=null,revoked=false,locking;
 await assert.rejects(read({},client,async(consume,options)=>visit(async(storage,owner)=>{
  await consume(storage,owner);
  if(previous&&owner.projectId&&owner.projectId!==previous&&!revoked){revoked=true;locking=app.lock(client,previous);assert.equal(app.session(client).get(previous).locked,true);}
  if(owner.projectId&&!previous)previous=owner.projectId;
 },options)),{code:'ACCESS_LOCKED'});await locking;assert.equal(revoked,true);
 for(const p of f.projects)await app.unlock(client,p.projectId,{});for(const b of f.books)await bookAction(b,'unlock');
 const fresh=await read();await source.command('task.save',{id:taskId,expectedRevision:1,data:{...entities[1].data,title:'Changed source title'}});
 await assert.rejects(read({cursor:fresh.nextCursor}),{code:'RECORD_QUERY_CURSOR'});
 for(const code of ['CATALOGUE_DAMAGED','EIO']){t.mock.method(ProjectSessionOwner.prototype,'use',async()=>{throw Object.assign(Error('Synthetic source failure'),{code});});await assert.rejects(read(),{code});t.mock.restoreAll();}
});

test('incoming adopted research links require per-record witnesses and survive archive reopening',{timeout:180000},async t=>{
 const f=await fixture(t);await new ProjectModuleCommands(f.storage,f.book.id).initialize();const prior=randomUUID(),foreign=randomUUID(),recordId=f.book.entries[0].id,target={workspaceId:f.book.id,type:'record',id:recordId};
 const original={...target,workspaceId:prior},both=calculation(randomUUID(),[target,original]),retained=calculation(randomUUID(),[original],'Retained calculation'),unrelated=calculation(randomUUID(),[{...target,workspaceId:foreign}],'Unrelated calculation');
 await seedModuleCurrent(f.storage,f.book.id,[both,retained,unrelated]);
 await f.storage.withLock(()=>f.storage.catalogue(async store=>{await store.putObject('project:research-migration',{version:1,projectId:f.projectId,namespaceId:f.book.id,sourceNamespace:prior});await store.putObject(referenceOriginKey({kind:'record',id:recordId}),{version:1,projectId:f.projectId,namespaceId:f.book.id,sourceNamespace:prior,kind:'record',id:recordId});}));
 const pages=new RecordCollectionPages(),client={};t.after(()=>pages.clear());
 const read=(storage=f.storage,values={},options={})=>moduleReferenceIncoming(pages,client,{workspaceId:f.book.id,target,types:['calculation'],limit:1,cursor:null,...values},{collectionWorkspaceId:f.book.id,visit:(consume)=>consume(storage,{workspaceId:f.book.id,projectId:f.projectId,labBookId:null}),resolveTarget:(_target,consume)=>storage.catalogue(store=>consume(storage,target,{store})),...options});
 const first=await read();assert.equal(first.total,2);assert.equal((await read(f.storage,{cursor:first.nextCursor})).items.length,1);assert.equal((await read(f.storage,{target:original})).total,2);
 const descriptor=await f.storage.readFile(await workspaceFile(f.storage.root),'utf8'),root=path.join(f.root,'archive','project');await mkdir(path.join(root,'.observanda'),{recursive:true});
 for(const file of [path.basename(await workspaceFile(f.storage.root)),'.observanda/access.json'])await copyFile(path.join(f.storage.root,file),path.join(root,file));
 const db=await f.storage.openCatalogue();try{await backupCatalogue(f.storage.root,root,{connection:db});}finally{await db.close();}
 const copied=new ProjectStorage(root,f.projectId,f.vault);await verifyCatalogueArchive(copied,JSON.parse(descriptor));await copied.outline();
 t.mock.method(f.storage,'catalogue',()=>{throw Error('Portable query consulted original storage');});t.mock.method(ModuleCatalogue.prototype,'selected',()=>{throw Error('Incoming portable query read originals');});
 assert.equal((await read(copied)).total,2);t.mock.restoreAll();
 await f.storage.withLock(()=>f.storage.catalogue(store=>store.deleteObject(referenceOriginKey({kind:'record',id:recordId}))));
 await assert.rejects(read(f.storage,{cursor:first.nextCursor}),{code:'RECORD_QUERY_CURSOR'});assert.equal((await read()).total,1);
 const abort=new AbortController(),references=ModuleCatalogue.prototype.references,count=pages.sessions.size;let observed=false;
 t.mock.method(ModuleCatalogue.prototype,'references',async function(...args){const result=await references.apply(this,args);observed=true;abort.abort();return result;});
 t.mock.method(ModuleCatalogue.prototype,'selected',()=>{throw Error('Cancelled lookup opened an original');});t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Cancelled lookup opened a research body');});
 await assert.rejects(read(f.storage,{}, {signal:abort.signal}),{name:'AbortError'});assert.equal(observed,true);assert.equal(pages.sessions.size,count);
});

test('foreign resource identities cannot acquire implicit local movement or BOM backlinks',async()=>{
 const workspaceId=randomUUID(),foreign=randomUUID(),resourceId=randomUUID(),members=[{id:randomUUID(),type:'movement'},{id:randomUUID(),type:'bom'},{id:randomUUID(),type:'calculation'}],views=members.map(m=>({...m,title:m.type}));
 const context={book:{id:workspaceId,projects:[],notebooks:[]},head:{revision:1},members:()=>members,view:async m=>views.find(v=>v.id===m.id),references:async m=>({links:m.type==='calculation'?[{workspaceId:foreign,type:'resource',id:resourceId}]:[]}),constraint:async m=>({type:m.type,data:m.type==='bom'?{lines:[{resourceId}]}:m.type==='movement'?{resourceId}:{}}),encode:value=>JSON.stringify(value),decode:value=>JSON.parse(value)};
 const reader=new ModuleReader({root:'.'}, {context:async(_id,consume)=>consume(context)});
 assert.deepEqual(new Set((await reader.list({workspaceId,reference:{workspaceId,type:'resource',id:resourceId}})).items.map(row=>row.type)),new Set(['movement','bom']));
 assert.deepEqual((await reader.list({workspaceId,reference:{workspaceId:foreign,type:'resource',id:resourceId}})).items.map(row=>row.type),['calculation']);
 await assert.rejects(reader.list({workspaceId,reference:{workspaceId:'invalid',type:'resource',id:resourceId}}),{code:'INVALID'});
});
