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
import {renderPublication} from '../src/publication.js';
import {defaultPageLayout} from '../src/web/website-layouts.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

async function fixture(t,count=8){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-scope-')),book=sampleNotebook(),seed=book.entries[0];
 book.projects.push({...structuredClone(book.projects[0]),id:randomUUID(),title:'Unrelated project'});
 book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),projectId:book.projects[1].id,title:'Unrelated book'});
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:(i===0?'Selected record ':'Private record ')+i,body:'Original body '+i,share:i===0,sections:[{id:randomUUID(),title:'Exact section',body:'Section content'}],relations:[],figures:[],attachments:[],contributors:[],tags:[],notebookId:book.notebooks[i%2].id}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const sites=new WebsiteSites(f.workspace),site=await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Independent website'});
 return {...f,book,directory,sites,id:site.id,scoped:websiteWorkspace(f.workspace,site.id)};
}
function command(read){return {workspaceId:read.book.id,baseEtag:read.etag,metadata:{},projects:[],changes:[],removed:[],selection:read.site.selection};}

test('legacy ownership fallback preserves site counts and selected project identities without rewriting history',async t=>{
 const f=await fixture(t),initial=await f.sites.read(f.id),edit=command(initial);edit.selection.records=[{id:f.book.entries[0].id,share:true,attachments:[]}];
 const saved=await f.sites.save(f.id,{...edit,websitePin:initial.websitePin});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  const manifest=await store.manifest(saved.etag);manifest.records=manifest.records.map(({notebookId,queryRevision,summaryRevision,...row})=>row);
  await store.db.run('UPDATE snapshots SET payload=$1 WHERE id=$2',store.encode('snapshot',saved.etag,manifest),saved.etag);
 }));
 const read=await f.sites.read(f.id);assert.equal(read.total,8);assert.deepEqual(read.notebookCounts,saved.notebookCounts);assert.deepEqual(read.selectionProjects,saved.selectionProjects);assert.equal(read.etag,saved.etag);
});
