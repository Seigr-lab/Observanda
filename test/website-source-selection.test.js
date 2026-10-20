import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {populateImageEvidence} from './image-evidence-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteResearch} from '../src/website-research.js';
import {WebsiteSites} from '../src/website-sites.js';
import {StructureCommands} from '../src/structure-commands.js';

test('website source counts respect book, record and media permissions before publication',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-source-selection-')),book=sampleNotebook(),project=book.projects[0],template=book.entries[0],publicImage=randomUUID(),privateImage=randomUUID();
 book.projects=[project];book.notebooks=[{id:randomUUID(),projectId:project.id,title:'Available research'},{id:randomUUID(),projectId:project.id,title:'Private research',share:false}];
 const record=(notebook,title,share)=>({...structuredClone(template),id:randomUUID(),notebookId:notebook.id,title,share,sections:[],attachments:[],relations:[],figures:[]});
 book.entries=[record(book.notebooks[0],'Available record',true),record(book.notebooks[0],'Private record',false),record(book.notebooks[1],'Private book record',true)];
 book.entries[0].attachments=[{id:publicImage,kind:'image',caption:'Public image',alt:'Public image',transcript:'',share:true},{id:privateImage,kind:'image',caption:'Private image',alt:'Private image',transcript:'',share:false}];
 const f=await encryptedFixture(directory,book,{populate:workspace=>populateImageEvidence(workspace,[publicImage,privateImage])});
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-source-selection-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const service=new WebsiteResearch(f.workspace),outline=await f.workspace.outline(),base={workspaceId:book.id,snapshotId:outline.etag,websitePin:(await new WebsiteSites(f.workspace).read(null)).websitePin,search:''},selection={defaultShare:false,includeProjects:[project.id],records:[]};
 const available=await service.run('summary',{...base,selection});assert.equal(available.entries,1);assert.equal(available.media,1);assert.equal(available.projects[0].included,1);assert.deepEqual(available.notebookIds,[book.notebooks[0].id]);
 selection.records=[{id:book.entries[0].id,share:true,attachments:[{id:publicImage,share:false},{id:privateImage,share:true}]},{id:book.entries[1].id,share:true,attachments:[]},{id:book.entries[2].id,share:true,attachments:[]}];
 const narrowed=await service.run('summary',{...base,selection});assert.equal(narrowed.entries,1);assert.equal(narrowed.media,0);assert.equal((await f.workspace.outline()).etag,outline.etag);
 await new StructureCommands(f.workspace).execute('structure',{etag:outline.etag,commandId:randomUUID(),response:'outline',change:{kind:'notebook',value:{...book.notebooks[0],share:false}}});
 const current=await f.workspace.outline(),withdrawn=await service.run('summary',{...base,snapshotId:current.etag,websitePin:(await new WebsiteSites(f.workspace).read(null)).websitePin,selection});assert.equal(withdrawn.entries,0);assert.equal(withdrawn.media,0);assert.deepEqual(withdrawn.notebookIds,[]);
});

test('website section destinations exclude private sections and paginate the remaining labels',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-source-sections-')),book=sampleNotebook(),record=book.entries[0];
 book.entries=[record];record.share=true;record.attachments=[];record.figures=[];record.relations=[];record.sections=Array.from({length:31},(_,index)=>({id:randomUUID(),title:'Section '+index,body:'Retained source prose. '.repeat(1000),...(index%10===0?{share:false}:{})}));
 const visible=record.sections.filter(section=>section.share!==false),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-source-sections-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const service=new WebsiteResearch(f.workspace),outline=await f.workspace.outline(),base={workspaceId:book.id,snapshotId:outline.etag,websitePin:(await new WebsiteSites(f.workspace).read(null)).websitePin,recordId:record.id};
 const first=await service.run('sections',{...base,offset:0}),last=await service.run('sections',{...base,offset:25});
 assert.equal(first.total,27);assert.equal(first.items.length,25);assert.equal(first.next,25);assert.equal(last.items.length,2);assert.equal(last.previous,0);assert.equal(last.next,null);
 assert.deepEqual([...first.items,...last.items].map(item=>item.title),visible.map(section=>section.title));
 assert.deepEqual([...first.items,...last.items].map(item=>item.id),visible.map(section=>'record-section-'+section.id));
 assert.equal((await f.workspace.outline()).etag,outline.etag);assert.deepEqual((await f.workspace.read()).book.entries[0].sections,record.sections);
 await new StructureCommands(f.workspace).execute('structure',{etag:outline.etag,commandId:randomUUID(),response:'outline',change:{kind:'notebook',value:{...book.notebooks.find(value=>value.id===record.notebookId),share:false}}});
 const current=await f.workspace.outline(),closed=await service.run('sections',{...base,snapshotId:current.etag,websitePin:(await new WebsiteSites(f.workspace).read(null)).websitePin,offset:0});assert.equal(closed.total,0);assert.deepEqual(closed.items,[]);
});
