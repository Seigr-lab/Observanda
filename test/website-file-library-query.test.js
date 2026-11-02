import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseFragment} from 'parse5';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {websiteSearchFields} from '../src/website-file-library-fields.js';
import {searchWebsiteLibrary,websiteLibraryFacets} from '../src/website-file-library.js';
import {pinnedQueryResults} from '../src/pinned-query-result.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {sampleNotebook} from '../src/sample.js';
import {defaultPublicationPrivacy} from '../src/web/record-publication-privacy.js';
import {convertPublicationRecord} from '../src/publication-conversion-render.js';

const metadata=(date,tags=[],type='analysis',status='completed')=>'<article><div data-observanda-part="metadata"><span>'+type+'</span>'+date+'<span>'+status+'</span></div><ul data-observanda-part="tags">'+tags.map(t=>'<li>'+t+'</li>').join('')+'</ul></article>';
const exact=date=>'<time datetime="'+date+'">'+date+'</time>';
const stated=date=>'<span class="record-date">'+date+'</span>';
async function page(request,query,after=null,limit=3){
 const rows=[],seen=new Set();let reply;
 do{
  assert.ok(!seen.has(after),'Cursor made no progress');seen.add(after);
  reply=await request({...query,limit:limit-rows.length,after});rows.push(...reply.items);after=reply.next;
 }while(after&&rows.length<limit);
 return {...reply,items:rows,next:after};
}

test('only visible entry metadata and literal tags contribute to scientific filters',()=>{
 const hidden='<div hidden>'+metadata(exact('1901-02-03'),['Hidden'])+'</div><div data-observanda-part="body">'+metadata(exact('1902-02-03'),['Nested'])+'</div>';
 const projected=date=>websiteSearchFields(parseFragment(hidden+metadata(date,['Co','CO','café','Co'])));
 const feb=projected(stated('Estimació: febrer de 2024'));
 assert.deepEqual([feb.dateFrom,feb.dateTo,feb.dateKnowledge],['2024-02-01','2024-02-29','estimated']);assert.deepEqual(feb.tags,['Co','CO','café']);
 const year=projected(stated('2023 (solo año)'));assert.deepEqual([year.dateFrom,year.dateTo],['2023-01-01','2023-12-31']);
 const range=projected(stated('2024-04-30 til 2024-05-02'));assert.deepEqual([range.dateFrom,range.dateTo],['2024-04-30','2024-05-02']);
 const unknown=projected(stated('Date unknown'));assert.equal(unknown.dateKnowledge,'unknown');assert.equal(unknown.dateFrom,null);
 const unbounded=projected(stated('around excavation season'));assert.equal(unbounded.dateKnowledge,null);assert.equal(unbounded.dateFrom,null);assert.equal(unbounded.displayDate,'around excavation season');
 const denied=websiteSearchFields(parseFragment('<ul data-observanda-part="tags"><li aria-hidden="true">withheld</li><li><span hidden>withheld</span></li><li>Allowed</li></ul>'));assert.deepEqual(denied.tags,['Allowed']);
});

test('independent website and PDF tag consent controls what the indexed website fragment can expose',async()=>{
 const book=sampleNotebook(),entry=book.entries[1];entry.publication=defaultPublicationPrivacy();entry.tags=['Reserved study'];entry.publication.website.tags=false;entry.publication.pdf.tags=true;
 const storage={root:'unused'},render=()=>convertPublicationRecord(storage,book,entry,{target:'website'});
 let site=await render();assert.equal(site.visible,true);assert.deepEqual(websiteSearchFields(parseFragment(site.html)).tags,[]);assert.doesNotMatch(site.html,/Reserved study/);
 entry.publication.website.tags=true;site=await render();assert.deepEqual(websiteSearchFields(parseFragment(site.html)).tags,['Reserved study']);
});

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-library-query-'));await mkdir(path.join(root,'.observanda'));
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 for(const key of ['catalogue','openCatalogue','storageKind'])workspace[key]=()=>assert.fail('Website metadata search accessed research '+key);
 t.after(async()=>{await pinnedQueryResults.clear();await closeIdleMutationFiles();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
 const files=new WebsiteFileStore(workspace),projectId=randomUUID(),notebookId=randomUUID(),otherBook=randomUUID();
 async function put(title,html,{notebook=notebookId,visible=true,target='website'}={}){
  const provenance={workspaceId:workspace.vault.id,projectId,notebookId:notebook,recordId:randomUUID()},id=websiteSourceId({...provenance,target}),token=await files.beginSourceUpdate({sourceId:id,target});
  await files.putSource({sourceId:id,target,provenance,visible,title,html,pickerContext:{projectTitle:'Measurements',notebookTitle:notebook===notebookId?'Routine':'Other'},...(target==='pdf'?{pdfParts:{version:1}}:{})},{token});
  return id;
 }
 return {files,workspace,projectId,notebookId,otherBook,put};
}
test('fielded search, contextual tag counts and duplicate-safe pages use permitted saved files after a restart',async t=>{
 const {workspace,files,notebookId,otherBook,put}=await fixture(t);
 const a=await put('Ångström 2',metadata(stated('Estimated: February 2024'),['Co','café']));
 const b=await put('Ångström 2',metadata(exact('2024-02-29'),['CO','café']));
 const c=await put('Ångström 10',metadata(stated('2024-02-29 to 2024-03-05'),['Co','remote'],'experiment','planned'),{notebook:otherBook});
 const d=await put('Undated',metadata(stated('Date unknown'),['Co']));
 await put('Private',metadata(exact('2024-02-29'),['withheld']),{visible:false});await put('PDF',metadata(exact('2024-02-29'),['PDF-only']),{target:'pdf'});
 // Retain the encrypted HTML and the old summary shape, then reopen with a
 // fresh vault object. None of the fields may be synthesized from research.
 await files.scope(async()=>{
  const location='.observanda/website-files/picker/'+a.slice(0,2)+'.json',shard=await files.control(location);
  for(const key of ['searchVersion','tags','recordType','status','dateFrom','dateTo','dateKnowledge'])delete shard[a][key];
  await files.writeControl(location,shard);
 },{write:true});
 const openedWorkspace=new Workspace(workspace.root,{...workspace.vault});
 for(const key of ['catalogue','openCatalogue','storageKind'])openedWorkspace[key]=workspace[key];
 const reopened=new WebsiteFileStore(openedWorkspace);
 const request=q=>reopened.searchLibrary(q),facets=q=>reopened.scope(scope=>websiteLibraryFacets(reopened,scope,q));
 const ids=async q=>(await page(request,q,null,20)).items.map(row=>row.id);
 assert.deepEqual(await ids({tags:['Co','café']}),[a]);assert.deepEqual(await ids({tags:['CO']}),[b]);assert.deepEqual(await ids({tags:['cafe']}),[]);
 assert.deepEqual(new Set(await ids({tags:['Co','CO'],tagMode:'any'})),new Set([a,b,c,d]));
 assert.deepEqual(new Set(await ids({search:'cafe',searchField:'tag'})),new Set([a,b]));
 assert.deepEqual(await ids({search:'angstrom',searchField:'reference'}),[]);assert.deepEqual(await ids({search:b,searchField:'reference'}),[b]);
 assert.deepEqual(await ids({dateFrom:'2024-02-29',dateTo:'2024-02-29',dateKnowledge:'estimated'}),[a]);
 assert.deepEqual(await ids({dateFrom:'2024-03-05',dateTo:'2024-03-05',status:'planned',recordType:'experiment'}),[c]);
 assert.deepEqual(await ids({dateKnowledge:'unknown'}),[d]);
 assert.deepEqual(await ids({sort:'date-asc'}),[a,b,c,d]);assert.deepEqual(await ids({sort:'date-desc'}),[c,b,a,d]);
 const expected=[...[a,b].sort(),c,d],first=await page(request,{sort:'title-asc'},null,1),second=await page(request,{sort:'title-asc'},first.next,1);
 assert.deepEqual([first.items[0].id,second.items[0].id],expected.slice(0,2));
 assert.equal((await page(request,{sort:'title-asc',locale:'nb'},null,1)).items[0].id,d);
 await assert.rejects(request({sort:'title-asc',locale:'nb',after:first.next}),{code:'WEBSITE_CHANGED'});
 const tagPage=await page(facets,{kind:'tag',criteria:{notebookId,status:'completed',dateFrom:'2024-02-29',tags:['café']}},null,20);
 assert.deepEqual(tagPage.items.map(v=>[v.title,v.count]),[['CO',1],['Co',1],['café',2]]);
 const unionSuggestions=await page(facets,{kind:'tag',criteria:{notebookId,tags:['CO'],tagMode:'any'}},null,20);
 assert.deepEqual(unionSuggestions.items.find(v=>v.id==='Co')?.count,2);
 const fence=await files.beginSourceUpdate({sourceId:b,target:'website'});
 await assert.rejects(request({sort:'title-asc',after:first.next}),{code:'WEBSITE_CHANGED'});
 assert.deepEqual(await ids({tags:['CO']}),[]);assert.deepEqual((await page(facets,{kind:'tag',search:'CO',criteria:{notebookId}},null,20)).items.map(v=>v.id),['Co']);
 await files.cancelSourceUpdate({sourceId:b,token:fence});await assert.rejects(request({sort:'date-desc',after:second.next}),{code:'WEBSITE_CHANGED'});
 await assert.rejects(request({dateFrom:'2024-02-30'}),{code:'INVALID'});
});

test('large sorted catalogues reuse an encrypted file-only result and make progress with a bounded fallback',async t=>{
 const {workspace}=await fixture(t),shards=new Map(),names=[],pending=new Set(),allowed=[];
 for(let i=0;i<14000;i++){
  const prefix=(i%64).toString(16).padStart(2,'0'),id=prefix+i.toString(16).padStart(62,'0');
  if(!shards.has(prefix))shards.set(prefix,{});
  const day=String(i%3+1).padStart(2,'0'),date='2024-01-'+day;
  const item={id,revision:id,projectId:null,notebookId:null,searchVersion:1,title:'Repeated '+('x'.repeat(172)),stamp:i,recordType:'observation',status:'completed',media:false,tags:[i%5?'other':'selected'],displayDate:date,dateFrom:date,dateTo:date,dateKnowledge:'known'};
  shards.get(prefix)[id]=item;names.push(id);if(!i||i%5===0)allowed.push(item);
 }
 allowed.sort((a,b)=>a.dateFrom.localeCompare(b.dateFrom)||a.id.localeCompare(b.id));
 let reads=0,censuses=0;
 const store={workspace,absolute:s=>s,pendingSources:async()=>pending,source:()=>assert.fail('Indexed query read entry head'),readText:()=>assert.fail('Indexed query opened HTML'),
  control:async name=>{if(name.endsWith('/generation.json'))return 'permission-generation';reads++;return shards.get(name.split('/').at(-1).slice(0,2));}};
 const scope={member:async(_p,fn)=>{censuses++;return fn({async *entries(){for(const name of names)yield {directory:true,name};}});}};
 const request=options=>searchWebsiteLibrary(store,scope,options),q={tags:['selected'],sort:'date-asc'},size=19;
 const first=await page(request,q,null,size);assert.deepEqual(first.items.map(r=>r.id),allowed.slice(0,size).map(r=>r.id));
 assert.equal(pinnedQueryResults.stats().entries,1);reads=0;
 const next=await page(request,q,first.next,size);assert.deepEqual(next.items.map(r=>r.id),allowed.slice(size,2*size).map(r=>r.id));
 assert.ok(reads<=size,'continuation touched unrelated shards');assert.equal(censuses,1);
 const other={...store,workspace:{root:'other-disposable-workspace',vault:{}}};
 await assert.rejects(searchWebsiteLibrary(other,scope,{...q,after:first.next}),{code:'WEBSITE_CHANGED'});
 // No cache admission: each step visits a bounded scan window. No dataset
 // size cutoff, no missing equal-date matches, no widening of the query.
 const noCache={...store,workspace:{root:workspace.root,vault:{}}},uncached=opts=>searchWebsiteLibrary(noCache,scope,opts);
 const pressured=await page(uncached,q,null,size),following=await page(uncached,q,pressured.next,size);
 assert.deepEqual(pressured.items.map(v=>v.id),first.items.map(v=>v.id));assert.deepEqual(following.items.map(v=>v.id),next.items.map(v=>v.id));
 const tags=options=>websiteLibraryFacets(noCache,scope,options),firstTag=await page(tags,{kind:'tag',criteria:{dateFrom:'2024-01-02',recordType:'observation'}},null,1);
 const nextTag=await page(tags,{kind:'tag',criteria:{dateFrom:'2024-01-02',recordType:'observation'}},firstTag.next,1);
 const dated=allowed.filter(item=>item.dateFrom>='2024-01-02').length;assert.equal(nextTag.items[0].title,'selected');assert.equal(nextTag.items[0].count,dated);
 pending.add(first.items[0].id);await assert.rejects(uncached({...q,after:pressured.next}),{code:'WEBSITE_CHANGED'});
});
