import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {publicationSelection} from '../src/publication-selection.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {publicationText} from './publication-fixture.js';
import {websitePreviewSource} from '../src/website-preview-source.js';
import {renderPublication} from '../src/publication.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t,count=8){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-scope-')),book=sampleNotebook(),seed=book.entries[0];
 book.projects.push({...structuredClone(book.projects[0]),id:randomUUID(),title:'Unrelated project'});
 book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),projectId:book.projects[1].id,title:'Unrelated book'});
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Private record '+i,body:'Original body '+i,share:false,sections:[{id:randomUUID(),title:'Exact section',body:'Section content'}],relations:[],figures:[],attachments:[],contributors:[],tags:[],notebookId:book.notebooks[i%2].id}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const sites=new WebsiteSites(f.workspace),site=await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Project website',projectId:book.projects[0].id});
 return {...f,book,directory,sites,id:site.id,scoped:websiteWorkspace(f.workspace,site.id)};
}
function command(read){return {workspaceId:read.book.id,baseEtag:read.etag,metadata:{},projects:[],changes:[],removed:[],selection:read.site.selection};}

test('opening, saving and previewing a project site use indexed counts and selected identities at tenfold growth',async t=>{
 for(const count of [80,800]){
  const f=await fixture(t,count),members=ResearchCatalogue.prototype.members,member=ResearchCatalogue.prototype.member,record=ResearchCatalogue.prototype.record;let reads=0;
  ResearchCatalogue.prototype.members=()=>{throw Error('Website traversed the research corpus');};
  ResearchCatalogue.prototype.record=()=>{throw Error('Website loaded an original body');};
  ResearchCatalogue.prototype.member=function(...args){reads++;return member.apply(this,args);};
  try{
   const initial=await f.sites.read(f.id);assert.equal(initial.total,count/2);assert.deepEqual(initial.notebookCounts,{[f.book.notebooks[0].id]:count/2});assert.equal(reads,0);
   const edit=command(initial);edit.metadata.website={...initial.book.website,footer:'Scoped footer',home:{...initial.book.website.home,enabled:true,sections:[]}};
   edit.selection={defaultShare:false,includeProjects:[],records:[{id:f.book.entries[0].id,share:true,attachments:[]}]};
   const saved=await f.sites.save(f.id,edit);assert.equal(saved.total,count/2);assert.deepEqual(saved.selectionProjects,{[f.book.entries[0].id]:f.book.projects[0].id});assert.ok(reads<12);
   reads=0;const draft=command(saved);draft.metadata.website={...saved.book.website,footer:'Unsaved scoped footer'};
   const choices=await publicationSelection(f.scoped,{source:{etag:saved.etag,draft}});assert.deepEqual(choices.items.map(r=>r.id),[f.book.entries[0].id]);assert.ok(reads<=4);
   await websitePreviewSource(f.scoped,draft,{designTarget:'home'});
   assert.equal((await f.sites.read(f.id)).book.website.footer,'Scoped footer');
   const controller=new AbortController();controller.abort();await assert.rejects(f.sites.read(f.id,{signal:controller.signal}),{name:'AbortError'});
   t.diagnostic(JSON.stringify({count,siteRecords:saved.total,originalBodies:0,corpusIterations:0}));
  }finally{ResearchCatalogue.prototype.members=members;ResearchCatalogue.prototype.member=member;ResearchCatalogue.prototype.record=record;}
 }
});

test('site-specific record layouts save, preview, publish and restore while foreign targets and identity collisions fail',async t=>{
 const f=await fixture(t),initial=await f.sites.read(f.id),record=f.book.entries[0],foreign=f.book.entries[1],target='entry:'+record.id,edit=command(initial);
 edit.metadata.website={...initial.book.website,layouts:[{...defaultPageLayout(target),heading:'Dedicated entry heading'}]};
 edit.selection={defaultShare:false,includeProjects:[],records:[{id:record.id,share:true,attachments:[]}]};
 let saved=await f.sites.save(f.id,edit);assert.equal(saved.book.website.layouts[0].heading,'Dedicated entry heading');
 const {context}=await websitePreviewSource(f.scoped,command(saved),{designTarget:target}),rendered=renderPublication(context,{designTarget:target,workspaceContent:true,singlePage:true});
 assert.ok([...rendered.files.values()].some(v=>typeof v==='string'&&v.includes('Dedicated entry heading')));
 const candidate=await new PublicationJobs(f.scoped).inline({etag:saved.etag});const text=await publicationText(candidate);
 assert.match(text,/Dedicated entry heading/);assert.ok(!text.includes(foreign.body));
 for(const patch of [
  {website:{...saved.book.website,layouts:[defaultPageLayout('entry:'+foreign.id)]}},
  {pages:[{id:foreign.id,title:'Identity collision',body:'',share:true,sections:[]}]},
  {pages:[{id:record.sections[0].id,title:'Section collision',body:'',share:true,sections:[]}]}
 ]){
  const invalid={...command(saved),metadata:patch};
  await assert.rejects(f.sites.save(f.id,invalid),{code:'INVALID'});
  await assert.rejects(websitePreviewSource(f.scoped,invalid,{designTarget:'home'}),{code:'INVALID'});
  assert.equal((await f.workspace.outline()).etag,saved.etag);
 }
 const copy=await copyWorkspace(await copyPlan(f.workspace.root,path.join(f.directory,'copy')),{vault:f.vault}),restored=new Workspace(copy,f.vault);
 assert.deepEqual((await new WebsiteSites(restored).read(f.id)).book,saved.book);
 assert.match(await publicationText(await new PublicationJobs(websiteWorkspace(restored,f.id)).inline({etag:saved.etag})),/Dedicated entry heading/);
});

test('legacy ownership fallback preserves site counts and selected project identities without rewriting history',async t=>{
 const f=await fixture(t),initial=await f.sites.read(f.id),edit=command(initial);edit.selection.records=[{id:f.book.entries[0].id,share:true,attachments:[]}];
 const saved=await f.sites.save(f.id,edit);
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const manifest=await store.manifest(saved.etag);manifest.records=manifest.records.map(({notebookId,queryRevision,summaryRevision,...row})=>row);
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',saved.etag,manifest),saved.etag);
 }));
 const read=await f.sites.read(f.id);assert.equal(read.total,4);assert.deepEqual(read.notebookCounts,saved.notebookCounts);assert.deepEqual(read.selectionProjects,saved.selectionProjects);assert.equal(read.etag,saved.etag);
});
