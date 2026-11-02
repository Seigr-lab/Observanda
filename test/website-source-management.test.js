import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {websiteLibraryFacets,validateWebsiteLibraryRows} from '../src/website-file-library.js';
import {websiteSourceUsage,changeWebsitePlacement} from '../src/website-file-placements.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-source-management-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await rm(root,{recursive:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('unexpected research database read');
 const store=new WebsiteFileStore(workspace);
 async function put({projectId=randomUUID(),notebookId=randomUUID(),recordId=randomUUID(),projectTitle='Picker-only owner',notebookTitle='Field log',visible=true}={}){
  const provenance={workspaceId:workspace.vault.id,projectId,notebookId,recordId},id=websiteSourceId(provenance),sectionIds=Array.from({length:13},()=>randomUUID());
  let html='<h2>Sample</h2><div data-observanda-part="metadata"><time datetime="2021-11-03">3 November</time></div>';
  for(const [i,key] of sectionIds.entries())html+='<section data-observanda-part="section:'+key+'"><h2>Section '+(i+1)+'</h2><p>Approved details '+(i+1)+'</p></section>';
  html+='<div hidden><section data-observanda-part="section:'+randomUUID()+'"><h2>Hidden section</h2></section></div>';
  const token=await store.beginSourceUpdate({sourceId:id,target:'website'});
  const row=await store.putSource({sourceId:id,title:'Sample',html,visible,provenance,pickerContext:{projectTitle,notebookTitle}},{token});
  return {...row,...provenance,sectionIds,projectTitle,notebookTitle};
 }
 return {store,put};
}
test('scoped eligible sources keep private owner labels, permitted dates and paged section previews in the editor',async t=>{
 const {store,put}=await fixture(t),first=await put(),second=await put({projectTitle:'Other project'}),privateBook=await put({notebookTitle:'Secret book',visible:false});
 const facets=options=>store.scope(scope=>websiteLibraryFacets(store,scope,options));
 const all=await facets({kind:'book',search:'Field log'});
 assert.equal(all.totalEntries,2);assert.deepEqual(all.items.map(b=>b.title),['Field log','Field log']);
 assert.deepEqual(all.items.map(b=>b.projectTitle).sort(),['Other project','Picker-only owner']);assert.ok(all.items.every(b=>b.count===1));
 assert.equal((await facets({kind:'book',projectId:second.projectId})).items[0].id,second.notebookId);
 assert.equal((await facets({kind:'book',projectId:privateBook.projectId})).items.length,0);
 const search=await store.searchLibrary({projectId:first.projectId,notebookId:first.notebookId});
 assert.equal(search.items.length,1);assert.equal(search.items[0].id,first.id);assert.equal(search.items[0].displayDate,'2021-11-03');
 const preview=await store.previewSource({sourceId:first.id,sourceRevision:first.revision});assert.equal(preview.sections.length,12);assert.equal(preview.nextSection,12);
 assert.deepEqual(preview.sections[0],{id:first.sectionIds[0],title:'Section 1',preview:'Approved details 1'});
 const last=await store.previewSource({sourceId:first.id,sourceRevision:first.revision,sectionAfter:12});assert.equal(last.sections.length,1);assert.equal(last.nextSection,null);
 const pending=await store.beginSourceUpdate({sourceId:first.id,target:'website'}),validation=await store.scope(()=>validateWebsiteLibraryRows(store,{items:[],generation:all.generation}));
 assert.notEqual(validation.visibilityToken,all.visibilityToken);assert.equal((await facets({kind:'project'})).totalEntries,1);
 await store.cancelSourceUpdate({sourceId:first.id,token:pending});
 const site=await store.create({name:'Field site'}),placed=await store.insertSource(site.site.id,{expectedRevision:site.site.revision,sourceId:first.id});
 assert.doesNotMatch(placed.html,/Picker-only owner|Field log/);
 const publication=await store.export(site.site.id),content=publication.files.get('index.html');let html='';for await(const chunk of content.readStaged())html+=chunk;
 assert.doesNotMatch(html,/Picker-only owner|Field log/);
});

test('pinned occurrence lookup and edits distinguish repeats and generated labels, then fail closed on withdrawal',async t=>{
 const {store,put}=await fixture(t),source=await put(),{id,revision}=source;
 const attrs='data-observanda-source="'+id+'" data-observanda-source-revision="'+revision+'"',link='data-observanda-link="'+id+'" data-observanda-link-revision="'+revision+'" data-observanda-link-key="1" href="index.html"';
 const site=await store.importFiles(randomUUID(),{name:'Field work',files:new Map([['index.html','<html><head><title>Field work</title></head><body><main><h1>Field stations</h1><p>Between</p></main></body></html>'],['style.css','']]),draftFiles:new Map([['notes.html','<html><head><title '+attrs+' data-observanda-view="document-title">Sample</title></head><body><a '+link+'>Sample</a></body></html>'],['draft-styles.css','']])});
 const siteId=site.site.id;let pin=site.site.revision;
 const args=()=>({sourceId:id,sourceRevision:revision,expectedRevision:pin,path:'index.html'});
 pin=(await store.insertSource(siteId,{...args(),position:'end'})).site.revision;
 pin=(await store.insertSource(siteId,{...args(),position:{before:1}})).site.revision;
 const uses=await websiteSourceUsage(store,siteId,{...args(),limit:1});
 assert.equal(uses.total,4);assert.equal(uses.pageCount,2);assert.equal(uses.onPage,2);assert.equal(uses.next,1);
 assert.deepEqual(uses.items[0],{path:'index.html',pageTitle:'Field work',draft:false,ordinal:0,kind:'block',blockPath:'0/1',sectionTitle:'Field stations',editable:true});
 const remaining=await websiteSourceUsage(store,siteId,{...args(),offset:1});
 assert.deepEqual(remaining.items.map(u=>[u.kind,u.editable,u.blockPath]),[['block',true,'0/3'],['view',false,null],['link',false,'0']]);
 await assert.rejects(changeWebsitePlacement(store,siteId,'remove',{...args(),path:'notes.html',ordinal:1}),{code:'CONFLICT'});
 const moved=await changeWebsitePlacement(store,siteId,'move',{...args(),ordinal:1,position:'start'});
 assert.match(moved.html,/<main><section data-observanda-source=/);assert.match(moved.html,/<h1>Field stations<\/h1><section data-observanda-source=/);
 await assert.rejects(changeWebsitePlacement(store,siteId,'remove',{...args(),ordinal:1}),{code:'CONFLICT'});pin=moved.site.revision;
 const removed=await changeWebsitePlacement(store,siteId,'remove',{...args(),ordinal:0});pin=removed.site.revision;
 assert.match(removed.html,/<main><h1>Field stations<\/h1><section data-observanda-source=/);
 const final=await changeWebsitePlacement(store,siteId,'remove',{...args(),ordinal:0});pin=final.site.revision;
 assert.doesNotMatch(final.html,/source-[a-f0-9]{64}\.css|data-observanda-source=/);assert.equal((await websiteSourceUsage(store,siteId,args())).onPage,0);
 const pending=await store.beginSourceUpdate({sourceId:id,target:'website'});
 await assert.rejects(websiteSourceUsage(store,siteId,args()),{code:'CONFLICT'});await assert.rejects(changeWebsitePlacement(store,siteId,'remove',{...args(),path:'notes.html',ordinal:0}),{code:'CONFLICT'});
 await store.putSource({sourceId:id,title:'Private entry',visible:false,target:'website'},{token:pending});
 await assert.rejects(websiteSourceUsage(store,siteId,{...args(),expectedRevision:(await store.open(siteId)).site.revision}),{code:'NOT_FOUND'});
});
