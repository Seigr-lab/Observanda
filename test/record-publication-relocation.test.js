import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {RecordLocation} from '../src/record-location.js';
import {StructureCommands} from '../src/structure-commands.js';
import {withRecordDocument} from '../src/record-document.js';
import {projectTreeFixture} from './project-tree-fixture.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {PublicationConversion} from '../src/publication-conversion.js';
import {RecordValues} from '../src/record-values.js';
import {RecordOwnerTransfer} from '../src/record-owner-transfer.js';
import {WebsiteFilesCandidate} from '../src/website-files-candidate.js';
import {LabBookReparents} from '../src/lab-book-reparent.js';
import {copyLabBookLocation} from '../src/lab-book-transfer.js';
import {ProjectStorage} from '../src/project-storage.js';

test('a PDF-only entry becomes private on a direct book move or reparenting its book',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-move-')),book=sampleNotebook(),source=book.notebooks[0];
 const otherProject={...book.projects[0],id:randomUUID(),title:'Another project'},otherBook={...source,id:randomUUID(),projectId:otherProject.id,title:'Another book'};
 book.projects.push(otherProject);book.notebooks.push(otherBook);
 const first={...book.entries[0],notebookId:source.id,share:false,sharePdf:true,sections:[{id:randomUUID(),title:'Allowed section',body:'Retained wording',sharePdf:true}]};
 const second={...structuredClone(first),id:randomUUID(),sections:[{...first.sections[0],id:randomUUID()}]};
 book.entries=[first,second];
 const f=await encryptedFixture(root,book);t.after(async()=>{await clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const pin=await f.workspace.outline();
 const read=(id,pin)=>f.workspace.catalogue(async store=>{
  const current=await store.snapshot(pin),member=await store.member(current,id);
  return withRecordDocument(store,id,member.revision,async doc=>({revision:member.revision,notebook:(await doc.field(['notebookId'])).value,website:(await doc.field(['share'])).value,pdf:(await doc.field(['sharePdf'])).value,section:(await doc.field(['sections','0','sharePdf'])).value}));
 });
 const prior=await read(first.id,pin.etag),move={workspaceId:book.id,recordId:first.id,sourceNotebookId:source.id,notebookId:otherBook.id,expectedStorageRevision:prior.revision,commandId:randomUUID()};
 const service=new RecordLocation(f.workspace),receipt=await service.move(move);
 assert.deepEqual(await service.move(move),receipt);
 assert.deepEqual(await read(first.id,pin.etag),prior);assert.equal(prior.pdf,true);
 const moved=await read(first.id,receipt.etag);assert.deepEqual({...moved,revision:prior.revision},{...prior,notebook:otherBook.id,pdf:false});
 assert.equal((await read(second.id,receipt.etag)).pdf,true);
 const reparent=await new StructureCommands(f.workspace).execute('structure',{etag:receipt.etag,response:'outline',change:{kind:'notebook',value:{...source,projectId:otherProject.id}}});
 const remaining=await read(second.id,reparent.etag);assert.equal(remaining.website,false);assert.equal(remaining.pdf,false);assert.equal(remaining.section,true);
 assert.equal((await read(second.id,receipt.etag)).pdf,true);
});

test('copy keeps original consent and a physical book reparent withdraws placements before admitting the destination',{timeout:240000},async t=>{
 const f=await projectTreeFixture(t),[from]=f.books,[sourceParent,targetParent]=f.projects.map(p=>new ProjectStorage(p.root,p.projectId,p.key));
 const storage=new LabBookStorage(from.root,from.labBookId,from.key),publication=new PublicationConversion(f.workspace),files=publication.files;
 const record={workspaceId:from.namespaceId,recordId:from.before.book.entries[0].id},title=from.before.book.entries[0].title;
 await publication.mutateNotebook(storage,from.labBookId,()=>storage.update(book=>{
  book.notebooks[0].share=true;book.notebooks[0].sharePdf=true;book.entries[0].share=true;book.entries[0].sharePdf=true;return book;
 }));
 const grant=await files.sourceForRecord(record),pdf=await files.sourceForRecord({...record,target:'pdf'});assert.equal(pdf.visible,true);
 await files.scope(async()=>{
  const possible=await files.sourceDirectoryFilter(10000);assert.equal(possible(grant.id),true);assert.equal(possible(pdf.id),true);
  const missing=['000000','000001','000002'].find(prefix=>![grant.id.slice(0,6),pdf.id.slice(0,6)].includes(prefix))+'0'.repeat(58);
  assert.equal(possible(missing),false);
 },{write:true});
 const site=await files.create({name:'Relocation report'}),placed=await files.insertSource(site.site.id,{expectedRevision:site.site.revision,path:site.path,sourceId:grant.id,sourceRevision:grant.revision});
 const copies=path.join(f.directory,'Independent copies');await mkdir(copies);
 const copy=await copyLabBookLocation(storage,path.join(copies,from.directory),{id:randomUUID()});
 assert.equal((await copy.read()).book.entries[0].share,true);assert.equal((await files.open(site.site.id)).html,placed.html);
 const move=new LabBookReparents(f.registry,from.labBookId),id=randomUUID();
 await assert.rejects(move.run(sourceParent,targetParent,from.key,{id,checkpoint:point=>{if(point==='metadata')throw Error('Stop before attaching book');}}),/Stop before attaching book/);
 const withdrawn=await files.open(site.site.id);assert.ok(!withdrawn.html.includes(title));assert.ok(withdrawn.html.includes(grant.id));
 assert.equal((await files.sourceStatus(pdf.id)).source.visible,false);
 const result=await new LabBookReparents(f.registry,from.labBookId).run(sourceParent,targetParent,from.key,{id});assert.equal(result.complete,true);
 const moved=await new LabBookStorage(result.book.root,from.labBookId,from.key).read();
 for(const item of [moved.book.notebooks[0],moved.book.entries[0]]){assert.equal(item.share,false);assert.equal(item.sharePdf,false);}
 assert.equal((await files.open(site.site.id)).html,withdrawn.html);assert.equal((await copy.read()).book.entries[0].sharePdf,true);
});

test('interrupted owner transfer fences a placed source until retirement and keeps both destination grants private',{timeout:180000},async t=>{
 const f=await projectTreeFixture(t),[from,to]=f.books,source=new LabBookStorage(from.root,from.labBookId,from.key),target=new LabBookStorage(to.root,to.labBookId,to.key);
 const directory=new LabBookDirectory(f.registry);for(const book of [from,to])await directory.register(book.projectId,book);
 const owner=book=>({workspaceId:book.namespaceId,projectId:book.projectId,labBookId:book.labBookId});
 const publication=new PublicationConversion(f.workspace),files=publication.files,id=from.before.book.entries[0].id;
 const values=new RecordValues(source),record={workspaceId:from.namespaceId,recordId:id};
 await publication.mutateNotebook(source,from.labBookId,()=>source.update(book=>{book.notebooks[0].share=true;book.notebooks[0].sharePdf=true;return book;}));
 for(const field of ['share','sharePdf']){
  const selected={...record,field},prior=await values.read(selected),command={...selected,expectedRevision:prior.revision,value:{value:true}};
  await publication.mutate(source,{route:'/api/research/records/values/save',data:command},()=>values.save(command));
 }
 const grant=await files.sourceForRecord(record),site=await files.create({name:'Handoff report'}),placed=await files.insertSource(site.site.id,{expectedRevision:site.site.revision,path:site.path,sourceId:grant.id,sourceRevision:grant.revision});
 const pdf=await files.sourceForRecord({...record,target:'pdf'});assert.equal(pdf.visible,true);
 assert.ok(placed.html.includes(from.before.book.entries[0].title));
 const base=await source.catalogue(async store=>store.member(await store.snapshot(),id));
 const command={id:randomUUID(),...record,sourceNotebookId:from.labBookId,expectedStorageRevision:base.revision,targetWorkspaceId:to.namespaceId,targetNotebookId:to.labBookId};
 const engine=()=>new RecordOwnerTransfer(source,target,{registry:f.registry,sourceOwner:owner(from),targetOwner:owner(to),publication});
 // Cancellation before irreversible activation keeps the original placement.
 const cancelled={...command,id:randomUUID()};
 await assert.rejects(engine().start(cancelled,{checkpoint:async stage=>{if(stage==='verified')throw Error('Stop before activation');}}),/Stop before activation/);
 await engine().cancel({id:cancelled.id,...record});assert.equal((await files.open(site.site.id)).html,placed.html);
 await assert.rejects(engine().start(command,{checkpoint:async stage=>{if(stage==='destination-published')throw Error('Stop before retirement');}}),/Stop before retirement/);
 await assert.rejects(files.open(site.site.id),{code:'CONFLICT'});
 await assert.rejects(WebsiteFilesCandidate.open(files,site.site.id,placed.site.revision),{code:'CONFLICT'});
 const destination=new RecordValues(target);
 for(const field of ['share','sharePdf'])assert.equal((await destination.read({workspaceId:to.namespaceId,recordId:id,field})).value.value,false);
 await assert.rejects(engine().resume({id:command.id,...record},{checkpoint:async stage=>{if(stage==='source-retired')throw Error('Stop after retirement');}}),/Stop after retirement/);
 assert.equal((await engine().status({id:command.id,...record})).phase,'retiring');
 await assert.rejects(files.open(site.site.id),{code:'CONFLICT'});await assert.rejects(files.getSource(pdf.id,{target:'pdf'}),{code:'CONFLICT'});
 const resumed=await engine().resume({id:command.id,...record});assert.equal(resumed.phase,'complete');
 const final=await files.open(site.site.id);assert.ok(final.html.includes('data-observanda-source="'+grant.id+'"'));assert.ok(!final.html.includes(from.before.book.entries[0].title));
 assert.equal((await files.sourceStatus(grant.id)).source.visible,false);assert.equal(await files.scope(async()=>(await files.pendingSources()).size),0);
 assert.equal((await files.sourceStatus(pdf.id)).source.visible,false);
});

test('a retried inline book relocation settles its original project grants after an interrupted file update',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-book-permission-')),book=sampleNotebook(),source=book.notebooks[0];
 const other={...book.projects[0],id:randomUUID(),title:'Other project'};book.projects.push(other);book.entries=book.entries.slice(0,1);
 const f=await encryptedFixture(root,book);t.after(async()=>{await clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const publication=new PublicationConversion(f.workspace),files=publication.files,record={workspaceId:book.id,recordId:book.entries[0].id};
 await publication.mutateNotebook(f.workspace,source.id,()=>f.workspace.update(data=>{data.notebooks[0].sharePdf=true;data.entries[0].sharePdf=true;return data;}));
 const prior=await files.sourceForRecord(record),site=await files.create({name:'Field report'}),placed=await files.insertSource(site.site.id,{expectedRevision:site.site.revision,path:site.path,sourceId:prior.id,sourceRevision:prior.revision});
 const change={etag:(await f.workspace.outline()).etag,commandId:randomUUID(),response:'outline',change:{id:source.id,title:source.title,projectId:other.id}};
 const apply=()=>new StructureCommands(f.workspace).execute('notebook',change);
 const broken=new PublicationConversion(f.workspace);broken.capture=()=>{throw Error('Interrupted after research commit');};
 await assert.rejects(broken.mutate(f.workspace,{route:'/api/workspace/notebook',data:change},apply),/Interrupted after research commit/);
 await assert.rejects(files.open(site.site.id),{code:'CONFLICT'});
 await publication.mutate(f.workspace,{route:'/api/workspace/notebook',data:change},apply);
 const current=await files.open(site.site.id);assert.ok(current.html.includes(prior.id));assert.ok(!current.html.includes(book.entries[0].title));assert.notEqual(placed.site.revision,current.site.revision);
 assert.equal((await files.sourceStatus(prior.id)).source.visible,false);assert.equal(await files.scope(async()=>(await files.pendingSources()).size),0);
});

test('moving all entries out of a removed book withdraws its placed sources',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-book-grants-')),book=sampleNotebook(),source=book.notebooks[0],project={...book.projects[0],id:randomUUID(),title:'Further observations'};
 const destination={...source,id:randomUUID(),projectId:project.id};book.projects.push(project);book.notebooks.push(destination);book.entries=book.entries.slice(0,1);
 const f=await encryptedFixture(root,book);t.after(async()=>{await clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const publication=new PublicationConversion(f.workspace),files=publication.files,record={workspaceId:book.id,recordId:book.entries[0].id};
 await publication.mutateNotebook(f.workspace,source.id,()=>f.workspace.update(data=>{data.notebooks[0].sharePdf=true;data.entries[0].sharePdf=true;return data;}));
 const prior=await files.sourceForRecord(record),site=await files.create({name:'Observations'});
 await files.insertSource(site.site.id,{expectedRevision:site.site.revision,path:site.path,sourceId:prior.id,sourceRevision:prior.revision});
 const command={etag:(await f.workspace.outline()).etag,commandId:randomUUID(),response:'outline',change:{kind:'delete-notebook',value:{id:source.id,records:'move',destinationId:destination.id,confirmed:true}}};
 await publication.mutate(f.workspace,{route:'/api/workspace/structure',data:command},()=>new StructureCommands(f.workspace).execute('structure',command));
 assert.equal((await files.sourceStatus(prior.id)).source.visible,false);assert.ok(!(await files.open(site.site.id)).html.includes(book.entries[0].title));
 const moved=(await f.workspace.read()).book.entries[0];assert.equal(moved.notebookId,destination.id);assert.equal(moved.share,false);assert.equal(moved.sharePdf,false);
});
