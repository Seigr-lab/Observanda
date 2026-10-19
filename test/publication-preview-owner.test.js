import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {recordRevision,ResearchRecords} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {privateDirectory,digest,serialize} from '../src/storage.js';
import {MediaStore} from '../src/media.js';
import {clearVault} from '../src/encryption.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {PublicationOwnerIdentities} from '../src/publication-owner-identities.js';
import {PublicationPreviewOwner} from '../src/publication-preview-owner.js';
import {WebsiteSites} from '../src/website-sites.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';
import {revisionPageId} from '../src/publication-revisions.js';
import {contentBuffer} from '../src/file-content.js';
import {websitePreviewSource} from '../src/website-preview-source.js';
import {workspaceSaveRequest} from '../src/web/workspace-edits.js';
import {recordRevisions} from '../src/research.js';
import {newElement} from '../src/web/composition-tree.js';
import {readingKey} from '../src/record-reading-index.js';
import {SnapshotIndex} from '../src/snapshot-index.js';
import {AppError} from '../src/errors.js';

async function fixture(t,configure=()=>{},count=37){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-owner-preview-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.id=randomUUID();
 book.entries=Array.from({length:count},(_,index)=>({...structuredClone(seed),id:randomUUID(),title:'Selected '+index,body:'Body '+index,share:false,attachments:[],figures:[],relations:[]}));
 const selected=book.entries[0],visible=randomUUID(),hidden=randomUUID();
 selected.sections=[{id:visible,title:'Selected section',body:'Visible details'},{id:hidden,title:'Private section',body:'Private details'}];
 selected.attachments=[{id:randomUUID(),kind:'image',share:true,caption:'Original cover',alt:'Original',transcript:''},{id:randomUUID(),kind:'image',share:false,caption:'Chosen cover',alt:'Chosen',transcript:''}];
 configure(book);
 let f;t.after(async()=>{if(f)clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});});
 f=await encryptedFixture(directory,{...book,entries:[]});
 const bytes=await readFile(new URL('../src/preview-assets/image.png',import.meta.url));
 for(const attachment of selected.attachments){
  const folder=await privateDirectory(f.workspace.root,'.observanda/media/'+attachment.id),metadata={id:attachment.id,kind:'image',extension:'png',mime:'image/png',bytes:bytes.length,sha256:digest(bytes),originalBytes:bytes.length,originalSha256:digest(bytes)};
  await f.workspace.writeFile(path.join(folder,'asset.json'),serialize(metadata));await f.workspace.writeFile(path.join(folder,'public.png'),bytes);await f.workspace.writeFile(path.join(folder,'original'),bytes);
 }
 await new ResearchRecords(f.workspace,new MediaStore(f.workspace)).save({workspaceId:book.id,changes:book.entries.map(record=>({id:record.id,expectedRevision:null,record}))});
 const research=await f.workspace.read(),site=await new WebsiteSites(f.workspace).read(null);
 Object.assign(book,site.book,{entries:research.book.entries});
 const snapshotId=(await f.workspace.outline()).etag,identities=new PublicationOwnerIdentities(randomUUID());
 let active=false,opens=0;
 const reader={async use(workspaceId,revision,consume){assert.equal(active,false);assert.equal(workspaceId,book.id);active=true;opens++;const selectedSnapshot=revision??(await f.workspace.outline()).etag;
  try{return {value:await f.workspace.catalogue(async store=>consume(store,await store.snapshot(selectedSnapshot),{snapshotId:selectedSnapshot,storage:f.workspace,owner:{workspaceId:book.id,projectId:book.projects[0].id,labBookId:null},projectNamespaceId:book.id}))};}finally{active=false;}
 }};
 const source={workspaceId:book.id,projectIds:[book.projects[0].id],selection:{defaultShare:false,includeProjects:[book.projects[0].id],records:[]}};
 return {book,f,websitePin:site.websitePin,identities,source,reader,get active(){return active;},get opens(){return opens;}};
}

test('owner preview pages rank projected identities without originals or retained corpus identities',async t=>{
 const f=await fixture(t);f.source.selection.records=[{id:f.book.entries[2].id,share:false,attachments:[]}];
 const owner=await new PublicationPreviewOwner(f.source,f.reader,f.identities).initialize(),notebooks=new Set(owner.projected.notebooks.map(book=>book.id)),identityCount=f.identities.origins.size;
 const read=ResearchCatalogue.prototype.record,loaded=[];ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return read.call(this,id,...args);};
 t.after(()=>{ResearchCatalogue.prototype.record=read;});
 const first=await owner.window(notebooks,{limit:17}),second=await owner.window(notebooks,{limit:17,after:first.at(-1)}),third=await owner.window(notebooks,{limit:17,after:second.at(-1)});
 const all=[...first,...second,...third];assert.equal(all.length,36);assert.equal(new Set(all.map(row=>row.id)).size,36);assert.deepEqual(all.map(row=>readingKey(row,'date')),[...all.map(row=>readingKey(row,'date'))].sort());
 assert.deepEqual(await owner.window(notebooks,{limit:17,after:second[0],backward:true}),[...first].reverse());
 assert.equal(f.identities.origins.size,identityCount);assert.equal(owner.descriptors.size,0);assert.deepEqual(loaded,[]);
 const counts=await owner.counts();assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),36);
 const row=first.find(row=>row.recordId!==f.book.entries[0].id),beforeResolve=f.opens,resolved=await owner.resolve(row.id,{recordId:row.recordId}),descriptor=resolved.descriptor;
 assert.deepEqual(resolved.row,row);assert.equal(f.opens-beforeResolve,1);assert.equal(descriptor.id,row.id);assert.equal(descriptor.sourceWorkspaceId,f.book.id);assert.deepEqual(loaded,[]);
 assert.equal(await owner.describe(row),descriptor);assert.equal(f.opens-beforeResolve,1,'The existing descriptor cache remains effective');
 const neighbours=await owner.neighbours(row),expected=[];for(const neighbour of neighbours)expected.push({row:neighbour,descriptor:await owner.describe(neighbour)});
 const compound=await new PublicationPreviewOwner(f.source,f.reader,f.identities).initialize(),beforeNeighbours=f.opens;
 assert.deepEqual(await compound.neighbourDescriptors(row),expected);assert.equal(f.opens-beforeNeighbours,1);assert.deepEqual(loaded,[]);
 const original=await owner.original(row);assert.equal(original.body,f.book.entries.find(record=>record.id===row.recordId).body);assert.deepEqual(loaded,[row.recordId]);assert.equal(f.active,false);
 assert.equal(await owner.find(owner.id('record',f.book.entries[2].id),{recordId:f.book.entries[2].id}),null);
 assert.equal((await f.f.workspace.outline()).etag,owner.snapshotId);
 // A compound callback still cannot return its derivative after the reader's
 // final grant check refuses it, including revocation during hydration.
 let permitted=true;
 const guarded={use:(id,revision,consume)=>f.reader.use(id,revision,async(...args)=>{
  if(!permitted)throw new AppError('ACCESS_LOCKED');const value=await consume(...args);
  if(!permitted)throw new AppError('ACCESS_LOCKED');return value;
 })},revoked=await new PublicationPreviewOwner(f.source,guarded,f.identities).initialize(),describe=revoked.describeCurrent.bind(revoked);
 revoked.describeCurrent=async(...args)=>{const value=await describe(...args);permitted=false;return value;};
 await assert.rejects(revoked.resolve(row.id,{recordId:row.recordId}),{code:'ACCESS_LOCKED'});assert.equal(f.active,false);
 permitted=true;await assert.rejects(revoked.neighbourDescriptors(row),{code:'ACCESS_LOCKED'});assert.equal(f.active,false);
 permitted=true;const initial=new PublicationPreviewOwner(f.source,guarded,f.identities),initialDescribe=initial.describeCurrent.bind(initial);
 initial.describeCurrent=async(...args)=>{const value=await initialDescribe(...args);permitted=false;return value;};
 await assert.rejects(initial.initialize({counts:true,entryId:row.id}),{code:'ACCESS_LOCKED'});assert.equal(f.active,false);
});

test('source preview applies section and attachment choices to derivatives and retains canonical revisions',async t=>{
 const f=await fixture(t),raw=f.book.entries[0],choice=defaultEditionRecord(raw,recordRevision(raw));choice.sections=[raw.sections[0].id];choice.attachments=[raw.attachments[1].id];
 f.source.edition={version:1,records:[choice]};f.source.selection.records=[{id:raw.id,share:true,attachments:[{id:raw.attachments[0].id,share:false},{id:raw.attachments[1].id,share:true}]}];
 const owner=await new PublicationPreviewOwner(f.source,f.reader,f.identities).initialize(),before=f.opens,{row,descriptor}=await owner.resolve(owner.id('record',raw.id),{recordId:raw.id});
 assert.equal(f.opens-before,1);const record=await owner.original(row);
 assert.equal(descriptor.revision,recordRevision(raw));assert.equal(record.id,descriptor.id);assert.equal(record.recordId,raw.id);
 assert.deepEqual(record.sections,raw.sections.slice(0,1));assert.deepEqual(record.attachments.map(attachment=>attachment.id),[owner.id('media',raw.attachments[1].id)]);
 assert.deepEqual(descriptor.media.map(media=>media.id),record.attachments.map(media=>media.id));assert.ok(!JSON.stringify(record).includes('Private details'));
 assert.deepEqual((await f.f.workspace.read()).book.entries[0],raw);
 const bad=structuredClone(f.source);bad.edition.records[0].revision='f'.repeat(64);const changed=await new PublicationPreviewOwner(bad,f.reader,f.identities).initialize();await assert.rejects(changed.resolve(row.id,{recordId:raw.id}),{code:'RECORD_CHANGED'});
});


test('a combined canvas admits selected sources, follows cross-owner references and binds paging to consent',async t=>{
 const host=await fixture(t),source=await fixture(t,book=>{
  book.entries[0].id=host.book.entries[0].id;book.entries[0].title='Foreign selected record';book.entries[0].body='Foreign original body';
  book.entries[0].relations=[{id:randomUUID(),type:'Related to',label:'Host observation',target:{workspaceId:host.book.id,kind:'record',id:host.book.entries[0].id}}];
 });
 source.source.selection={defaultShare:false,includeProjects:[],records:[{id:source.book.entries[0].id,share:true,attachments:[]}]};
 const draft=structuredClone(host.book);draft.website.researchSources=[source.source];draft.website.home.sections=[newElement('records',randomUUID)];
 const request=await host.f.workspace.outline();const makeCommand=()=>({...workspaceSaveRequest(host.book,draft,recordRevisions(host.book)),baseEtag:request.etag});
 let readers=0,closed=0,verified=0;
 const sourceReader=async()=>{readers++;return {...source.reader,verify:async()=>{verified++;},close:async()=>{closed++;}};};
 const identities=new PublicationOwnerIdentities(host.book.id),foreignId=identities.identity(source.book.id,'record',source.book.entries[0].id);
 const read=ResearchCatalogue.prototype.record,loaded=[];ResearchCatalogue.prototype.record=function(id,...args){loaded.push({workspaceId:this.workspace?.id,id});return read.call(this,id,...args);};t.after(()=>{ResearchCatalogue.prototype.record=read;});
 const home=await websitePreviewSource(host.f.workspace,makeCommand(),{websitePin:host.websitePin,designTarget:'home',sourceReader});
 assert.equal(home.context.entries.length,0);assert.deepEqual(loaded,[]);assert.ok(home.context.recordCards.length<=24);assert.equal(readers,closed);assert.equal(readers,verified);
 const beforeEntry=source.opens,page=await websitePreviewSource(host.f.workspace,makeCommand(),{websitePin:host.websitePin,designTarget:'entry:'+foreignId,sourceReader});
 assert.equal(source.opens-beforeEntry,2,'The selected entry and its reference window share initial admission; only its outbound lookup reopens the source');
 assert.equal(page.context.entries.length,1);assert.equal(page.context.entries[0].body,'Foreign original body');assert.equal(page.context.entries[0].relations[0].id,host.book.entries[0].id);
 assert.equal(loaded.length,1);assert.equal(readers,closed);
 assert.equal(page.editor.workspaceId,host.book.id);const editorRecord=page.editor.records.find(record=>record.id===foreignId);
 assert.equal(editorRecord.title,'Foreign selected record');assert.equal(editorRecord.attachments.length,1);
 assert.deepEqual(Object.keys(editorRecord.attachments[0]).sort(),['alt','caption','id','kind','share']);assert.equal(Object.hasOwn(editorRecord,'body'),false);
 assert.equal(page.editor.sources[0].workspaceId,source.book.id);
 const references=await websitePreviewSource(host.f.workspace,makeCommand(),{websitePin:host.websitePin,designTarget:'entry:'+host.book.entries[0].id,sourceReader});
 assert.ok(references.context.referencePage.recordIds.includes(foreignId));
 const mediaId=identities.identity(source.book.id,'media',source.book.entries[0].attachments[0].id),media=await page.media.get(mediaId,{streamed:true});
 assert.deepEqual(await contentBuffer(media.bytes),await readFile(new URL('../src/preview-assets/image.png',import.meta.url)));assert.equal(readers,closed);
 const first=home.context.collectionPages[0];assert.ok(first.nextCursor);
 const collections=[{key:first.key,definition:first.definition,query:new URLSearchParams({collection:first.key,cards:first.nextCursor}).toString()}];
 const second=await websitePreviewSource(host.f.workspace,makeCommand(),{websitePin:host.websitePin,designTarget:'home',sourceReader,collections});
 assert.equal(second.context.collectionPages[0].recordIds.some(id=>first.recordIds.includes(id)),false);
 draft.website.researchSources=structuredClone([source.source]);draft.website.researchSources[0].selection.records[0].share=false;
 await assert.rejects(websitePreviewSource(host.f.workspace,makeCommand(),{websitePin:host.websitePin,designTarget:'home',sourceReader,collections}),{code:'INVALID'});
 draft.website.researchSources=[];await assert.rejects(websitePreviewSource(host.f.workspace,makeCommand(),{websitePin:host.websitePin,designTarget:'entry:'+foreignId,sourceReader}),{code:'INVALID'});
 assert.equal((await host.f.workspace.outline()).etag,request.etag);assert.equal(readers,closed);
});


test('explicit foreign historical pages keep their revision and selected sections without entering current collections',async t=>{
 const host=await fixture(t),source=await fixture(t),raw=source.book.entries[0],choice=defaultEditionRecord(raw,recordRevision(raw));choice.sections=[raw.sections[0].id];
 const current={...structuredClone(raw),body:'Later observation',relations:[{id:randomUUID(),type:'Related to',label:'Previous observation',target:{workspaceId:source.book.id,kind:'record',id:raw.id,revision:choice.revision}}]};
 await new ResearchRecords(source.f.workspace,new MediaStore(source.f.workspace)).save({workspaceId:source.book.id,changes:[{id:raw.id,expectedRevision:choice.revision,record:current}]});
 source.source.selection={defaultShare:false,includeProjects:[],records:[{id:raw.id,share:true,attachments:[]}]};source.source.edition={version:1,records:[],history:[choice]};
 const draft=structuredClone(host.book);draft.website.researchSources=[source.source];draft.website.home.sections=[];
 const head=await host.f.workspace.outline(),command={...workspaceSaveRequest(host.book,draft,recordRevisions(host.book)),baseEtag:head.etag},identities=new PublicationOwnerIdentities(host.book.id);
 const currentId=identities.identity(source.book.id,'record',raw.id),oldId=identities.identity(source.book.id,'record',revisionPageId(source.book.id,raw.id,choice.revision));
 const sourceReader=async()=>({...source.reader,verify:async()=>{},close:async()=>{}});
 const present=await websitePreviewSource(host.f.workspace,command,{websitePin:host.websitePin,designTarget:'entry:'+currentId,sourceReader});
 assert.equal(present.context.entries[0].relations[0].id,oldId);
 const historical=await websitePreviewSource(host.f.workspace,command,{websitePin:host.websitePin,designTarget:'entry:'+oldId,sourceReader});
 assert.equal(historical.context.entries[0].body,raw.body);assert.equal(historical.context.entries[0].revisionEdition.revision,choice.revision);assert.equal(historical.context.entries[0].revisionEdition.current,currentId);
 assert.equal(historical.context.entries[0].sections.some(section=>section.body==='Private details'),false);assert.equal(historical.context.browseRecords.some(record=>record.id===oldId),false);
});


test('owner preview counts and forward and reverse windows stay bounded at tenfold growth',async t=>{
 const member=SnapshotIndex.prototype.member,record=ResearchCatalogue.prototype.record,decode=ResearchCatalogue.prototype.decode;
 let measuring=false,members=0,originals=0,decoded=0;const results=[];
 SnapshotIndex.prototype.member=async function(...args){if(measuring)members++;return member.apply(this,args);};
 ResearchCatalogue.prototype.record=function(...args){if(measuring)originals++;return record.apply(this,args);};
 ResearchCatalogue.prototype.decode=function(...args){if(measuring)decoded++;return decode.apply(this,args);};
 t.after(()=>{SnapshotIndex.prototype.member=member;ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.decode=decode;});
 for(const count of [65,650]){
  const f=await fixture(t,book=>{for(const [i,row] of book.entries.entries())row.occurredOn='2026-09-'+String(i%4+1).padStart(2,'0');},count);
  f.source.selection.records=[{id:f.book.entries[2].id,share:false,attachments:[]}];
  const owner=await new PublicationPreviewOwner(f.source,f.reader,f.identities).initialize(),notebooks=new Set(owner.projected.notebooks.map(book=>book.id)),identities=f.identities.origins.size;
  const expected=f.book.entries.filter(row=>row.id!==f.book.entries[2].id).map(row=>({...row,id:owner.id('record',row.id)})).sort((a,b)=>readingKey(a,'date')<readingKey(b,'date')?-1:1);
  members=0;originals=0;decoded=0;measuring=true;
  const found=await owner.find(expected.at(-1).id);assert.equal(found.id,expected.at(-1).id);
  assert.equal(await owner.find(owner.id('record',f.book.entries[2].id)),null);assert.equal(await owner.find(randomUUID()),null);
  const counts=await owner.counts(),first=await owner.window(notebooks,{limit:24}),second=await owner.window(notebooks,{after:first.at(-1),limit:24}),previous=await owner.window(notebooks,{after:second[0],backward:true,limit:24});
  measuring=false;
  assert.equal(Object.values(counts).reduce((a,b)=>a+b,0),count-1);
  assert.deepEqual(first.map(row=>row.id),expected.slice(0,24).map(row=>row.id));assert.deepEqual(second.map(row=>row.id),expected.slice(24,48).map(row=>row.id));assert.deepEqual(previous.map(row=>row.id),first.map(row=>row.id).reverse());
  assert.equal(originals,0);assert.ok(members<=85,JSON.stringify({count,members}));assert.equal(f.identities.origins.size,identities);assert.equal(owner.rows.size,0);assert.equal(owner.descriptors.size,0);
  results.push({count,members,decoded,originals});t.diagnostic(JSON.stringify(results.at(-1)));
 }
 assert.ok(results[1].decoded<=results[0].decoded*3,JSON.stringify(results));
});


test('an explicit record choice cannot disclose a project excluded from its source',async t=>{
 const f=await fixture(t,book=>{
  const project={...structuredClone(book.projects[0]),id:randomUUID(),title:'Unselected project'},notebook={...structuredClone(book.notebooks[0]),id:randomUUID(),projectId:project.id};
  book.projects.push(project);book.notebooks.push(notebook);book.entries.at(-1).notebookId=notebook.id;
 },12),hidden=f.book.entries.at(-1);
 f.source.selection.records=[{id:hidden.id,share:true,attachments:[]}];
 const owner=await new PublicationPreviewOwner(f.source,f.reader,f.identities).initialize(),all=new Set(f.book.notebooks.map(book=>owner.id('notebook',book.id)));
 assert.equal((await owner.window(all)).some(row=>row.recordId===hidden.id),false);assert.equal(await owner.find(owner.id('record',hidden.id)),null);assert.equal(await owner.resolve(owner.id('record',hidden.id)),null);
 assert.equal(Object.values(await owner.counts()).reduce((sum,value)=>sum+value,0),11);
});


test('an independent website combines sibling books without becoming owned by either book',async t=>{
 const host=await fixture(t,()=>{},1),first=await fixture(t,()=>{},12),projectId=first.book.projects[0].id,projectNamespace=randomUUID();
 const second=await fixture(t,book=>{const prior=book.projects[0].id;book.projects[0].id=projectId;for(const notebook of book.notebooks)if(notebook.projectId===prior)notebook.projectId=projectId;},12);
 const draft=structuredClone(host.book);draft.website.researchSources=[first.source,second.source];draft.website.home.sections=[];
 const sourceReader=async()=>({use:(id,revision,consume)=>{const selected=[first,second].find(source=>source.book.id===id);assert.ok(selected);return selected.reader.use(id,revision,(store,snapshot,pinned)=>consume(store,snapshot,{...pinned,projectNamespaceId:projectNamespace}));},verify:async()=>{},close:async()=>{}});
 const command={...workspaceSaveRequest(host.book,draft,recordRevisions(host.book)),baseEtag:(await host.f.workspace.outline()).etag};
 const publicProject=new PublicationOwnerIdentities(host.book.id).project({workspaceId:first.book.id,projectId,projectNamespaceId:projectNamespace},projectId);
 const page=await websitePreviewSource(host.f.workspace,command,{websitePin:host.websitePin,designTarget:'project:'+publicProject,sourceReader});
 assert.equal(page.metadata.projects.filter(project=>project.id===publicProject).length,1);
 assert.equal(page.metadata.notebooks.filter(book=>book.projectId===publicProject).length,2);assert.equal(page.context.recordCards.length,24);
 assert.equal(new Set(page.context.recordCards.map(record=>record.notebookId)).size,2);
 assert.equal(page.metadata.id,host.book.id);assert.deepEqual((await new WebsiteSites(host.f.workspace).read(null)).book.website.researchSources,host.book.website.researchSources);
});


test('canvas initialization captures selected counts without reopening its immutable source',async t=>{
 const f=await fixture(t);f.source.selection.records=[{id:f.book.entries[2].id,share:false,attachments:[]}];
 const owner=await new PublicationPreviewOwner(f.source,f.reader,f.identities).initialize({counts:true}),opens=f.opens;
 assert.equal(Object.values(await owner.counts()).reduce((total,count)=>total+count,0),36);
 assert.equal(f.opens,opens);assert.equal(owner.originals.size,0);assert.equal(owner.descriptors.size,0);
 const entryId=owner.id('record',f.book.entries[1].id),before=f.opens,entry=await new PublicationPreviewOwner(f.source,f.reader,f.identities).initialize({counts:true,entryId});
 assert.equal(f.opens-before,1);assert.equal(entry.entryId,entryId);assert.equal(entry.originals.size,1);assert.ok(entry.descriptors.size<=3);
 const row=entry.rows.get(entryId),descriptor=entry.descriptors.get(entryId),target={id:row.recordId,workspaceIds:descriptor.referenceNamespaces};
 assert.equal((await entry.original(row)).body,f.book.entries[1].body);assert.deepEqual(await entry.counts(),await owner.counts());
 const window=await entry.referenceWindow(target,{after:null,backward:false});assert.ok(window.length<=257);assert.equal(f.opens-before,1);
 await entry.referenceWindow(target,{after:row.position,backward:false});assert.equal(f.opens-before,2,'A different cursor requires its own admitted callback');
 await entry.referenceWindow({...target,id:f.book.entries[0].id},{after:null,backward:false});assert.equal(f.opens-before,3,'A different target cannot reuse the selected entry window');
});
