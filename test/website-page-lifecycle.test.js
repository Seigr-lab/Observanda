import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {archivedWebsitePages,websitePageLifecycle} from '../src/website-page-lifecycle.js';
import {readWebsiteFeed,saveWebsiteFeed} from '../src/website-dynamic-feeds.js';
import {componentOperation} from '../src/website-component-storage.js';
import {websiteThemes} from '../src/website-scoped-themes.js';
import {websiteSiteLifecycle} from '../src/website-site-lifecycle.js';
import {websitePageDesigns} from '../src/website-page-designs.js';
import {websiteVersionDesign} from '../src/website-version-design.js';
import {websitePublishTarget,rememberPublishTarget} from '../src/website-publish-target.js';
import {websitePublicationMetadata} from '../src/website-publication-metadata.js';
import {websiteVersions} from '../src/website-versions.js';
import {restoreWebsitePageVersion} from '../src/website-version-restore.js';
import {saveWebsiteRecovery,discardWebsiteRecovery} from '../src/website-recovery.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {contentBuffer} from '../src/file-content.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'page-lifecycle-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('Page lifecycle opened a research store');
 return {store:new WebsiteFileStore(workspace),id:randomUUID()};
}
const document=(title,body)=>'<!doctype html><html><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body>'+body+'</body></html>';
const text=async(file)=>(await contentBuffer(file,2*1024*1024)).toString();

test('review and move into and out of a folder revise incoming and outgoing URLs in the independent candidate',async t=>{
 const {store,id}=await fixture(t);
 const home=document('Home','<nav><a href="field.html#plots">Plots</a></nav><template><a href="field.html">Fallback</a></template>');
 const field=document('Field','<main id="plots"><img src="images/lake.png"><a href="#plots">Here</a><a href="index.html">Home</a><a href="https://example.org/external">External</a><p style="background:URL(images/lake.png)">Label</p></main>');
 const literal='.legend:after{content:"url(field.html#plots)"}',pages=new Map([['index.html',home],['field.html',field],['images/lake.png',Buffer.from([1,2,3])],['style.css',literal+'.panel{mask:URL(field.html#plots)}']]);
 let result=await store.importFiles(id,{name:'Atlas',files:pages}),source='field.html';
 for(const [destination,image,homePath] of [['studies/2026/survey.html','../../images/lake.png','../../index.html'],['field.html','images/lake.png','index.html']]){
  const options={expectedRevision:result.site.revision,path:source,action:'move',destination};
  const review=await websitePageLifecycle(store,id,options);
  assert.equal(review.blocked,null);assert.ok(review.items.some(r=>r.kind==='menu'&&r.name==='index.html'));
  assert.ok(review.items.some(r=>r.kind==='asset'&&r.name==='style.css'));
  result=await websitePageLifecycle(store,id,{...options,reviewId:review.reviewId},true);
  const candidate=await store.export(id,{expectedRevision:result.site.revision});
  for(const [name,wanted] of [['index.html',destination+'#plots'],['style.css',destination+'#plots'],[destination,image],[destination,homePath],[destination,'#plots'],[destination,'https://example.org/external']]){
   const bytes=await text(candidate.files.get(name));assert.ok(bytes.includes(wanted),name+' is missing '+wanted);
  }
  assert.equal(candidate.files.has(source),false);assert.equal(result.path,destination);source=destination;
  assert.ok((await text(candidate.files.get('style.css'))).startsWith(literal));
 }
 for(const [path,destination,code] of [['index.html','root.html','WEBSITE_HOME_REQUIRED'],['field.html','FIELD.html','EXISTS'],['field.html','STYLE.css/deep.html','EXISTS']]){
  await assert.rejects(websitePageLifecycle(store,id,{path,destination,action:'move',expectedRevision:result.site.revision}),{code});
 }
 const rename={action:'rename',path:source,title:'Field & Methods',expectedRevision:result.site.revision};
 const review=await websitePageLifecycle(store,id,rename);
 result=await websitePageLifecycle(store,id,{...rename,reviewId:review.reviewId},true);
 assert.match(result.html,/<title>Field &amp; Methods<\/title>/);assert.equal(result.site.pages.find(p=>p.path===source).title,rename.title);
});

test('fresh page copies preserve opted-in current grants, scoped design and feeds; archived or withdrawn material stays out of publication',async t=>{
 const {store,id}=await fixture(t),sourceIds=[];
 const put=async(i,visible)=>{
  const provenance=sourceIds[i]??={workspaceId:store.workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()};
  const sourceId=websiteSourceId(provenance),title='Permission '+i;
  return store.putSource({sourceId,title,visible,provenance,html:visible?'<p data-observanda-part="title">'+title+'</p>':''},{token:await store.beginSourceUpdate({sourceId})});
 };
 const s=await put(0,true);await put(1,true);
 const name='field.html',pages=new Map([['index.html',document('Home','<a href="field.html">Read field observations</a>')],[name,document('Field','<main><section><h2>Equipment list</h2></section></main>')],['style.css','main{color:navy}']]);
 let saved=await store.importFiles(id,{name:'Reports',files:pages});
 saved=await componentOperation(store,'create',id,{expectedRevision:saved.site.revision,path:name,name:'Equipment',blockPath:'0/0'});
 saved=await websiteThemes(store,id,{expectedRevision:saved.site.revision,path:name,action:'create',name:'Night',values:{text:'#224466'},scope:'page'},true);
 saved=await store.insertSources(id,{expectedRevision:saved.site.revision,path:name,sources:[{sourceId:s.id,sourceRevision:s.revision}]});
 saved=await saveWebsiteFeed(store,id,{expectedRevision:saved.site.revision,path:name,heading:'All observations',template:'card',pageSize:1});
 const perform=async(action,path,options={})=>{
  const input={action,path,expectedRevision:saved.site.revision,...options},review=await websitePageLifecycle(store,id,input);
  saved=await websitePageLifecycle(store,id,{...input,reviewId:review.reviewId},true);return review;
 };
 const feedId=saved.feedId;
 const moved='team/2026/field.html';
 await perform('move',name,{destination:moved});
 const continuation=saved.site.feedPages[0].path;
 let exported=(await store.export(id)).files;
 assert.ok((await text(exported.get(continuation))).includes('../../'+moved+'#website-feed-'+feedId));
 assert.match(await text(exported.get(moved)),/data-website-page-theme/);
 const first=await perform('duplicate',moved,{destination:'design.html',title:'Author copy'});
 assert.ok(first.items.some(i=>i.kind==='feed'));
 assert.match(saved.html,/Equipment list/);assert.doesNotMatch(saved.html,/Permission [01]|data-website-feed=/);
 await perform('duplicate',moved,{destination:'live.html',title:'With current entries',includeEntries:true});
 assert.match(saved.html,/Permission 0/);
 const copied=(await readWebsiteFeed(store,id,{expectedRevision:saved.site.revision,path:'live.html'})).feeds[0];
 assert.notEqual(copied.id,feedId);assert.equal(copied.total,2);
 const manifest=await store.scope(()=>store.raw(id)),instances=manifest.pages.flatMap(p=>(p.instances??[]).map(i=>i.id));
 assert.equal(instances.length,3);assert.equal(new Set(instances).size,3);
 const review=await perform('archive',moved);
 assert.ok(review.items.some(i=>i.kind==='link'&&i.name==='index.html'));
 assert.equal(saved.site.archivedPages,1);assert.equal(saved.site.pages.some(p=>p.path===moved),false);
 assert.equal((await archivedWebsitePages(store,id,{expectedRevision:saved.site.revision})).items[0].path,moved);
 await assert.rejects(store.open(id,{path:moved}),{code:'NOT_FOUND'});
 exported=(await store.export(id)).files;assert.equal(exported.has(moved),false);assert.equal(exported.has(continuation),false);
 assert.doesNotMatch(await text(exported.get('index.html')),/Read field observations/);
 await put(0,false);
 saved=await store.open(id,{path:'live.html'});assert.doesNotMatch(saved.html,/Permission 0/);
 await perform('restore',moved);assert.equal(saved.site.pages.find(p=>p.path===moved).draft,true);
 assert.doesNotMatch(saved.html,/Permission 0/);assert.equal((await store.export(id)).files.has(moved),false);
});

test('whole website duplication creates an independent publication owner, respects research inclusion and can be safely retried',async t=>{
 const {store,id}=await fixture(t);
 const provenance={workspaceId:store.workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()},sourceId=websiteSourceId(provenance);
 const put=async visible=>store.putSource({sourceId,provenance,title:'Restricted title',visible,html:visible?'<p data-observanda-part="title">Restricted title</p>':''},{token:await store.beginSourceUpdate({sourceId})});
 const source=await put(true);
 const second={...provenance,recordId:randomUUID()},other=websiteSourceId(second);
 await store.putSource({sourceId:other,provenance:second,title:'Additional observation',visible:true,html:'<p>Additional observation</p>'},{token:await store.beginSourceUpdate({sourceId:other})});
 let site=await store.create({id,name:'Atlas',html:document('Field programme','<main><section><h2>Instruments</h2></section></main>')});
 site=await componentOperation(store,'create',id,{expectedRevision:site.site.revision,path:'index.html',name:'Instruments',blockPath:'0/0'});
 site=await websiteThemes(store,id,{expectedRevision:site.site.revision,path:'index.html',action:'create',name:'Evening',scope:'page',values:{text:'#123456'}},true);
 site=await store.insertSources(id,{expectedRevision:site.site.revision,sources:[{sourceId,sourceRevision:source.revision}]});
 site=await saveWebsiteFeed(store,id,{expectedRevision:site.site.revision,path:'index.html',heading:'All observations',template:'card',pageSize:1});
 const firstContinuation=site.site.feedPages[0].path,originalFeed=site.feedId;
 site=await store.createPage(id,{expectedRevision:site.site.revision,path:'contents.html',title:'Contents',inclusion:'included'});
 site=await store.save(id,{path:'contents.html',expectedRevision:site.site.revision,html:site.html.replace('</body>','<a href="'+firstContinuation+'">Continued</a><a href="index.html#website-feed-'+originalFeed+'">Latest</a></body>'),css:site.css});
 const metadata=async owner=>websitePublicationMetadata(await store.publicationWorkspace(owner)),remote=async()=>({configured:false});
 const directory=path.join(os.tmpdir(),'original-atlas-publication');
 await rememberPublishTarget(await metadata(id),'folder',directory);
 const firstRevision=site.site.revision;
 const change=async(owner,revision,options)=>{
  const payload={expectedRevision:revision,...options},review=await websiteSiteLifecycle(store,owner,payload);
  return websiteSiteLifecycle(store,owner,{...payload,reviewId:review.reviewId},true);
 };
 let archivedCopy;
 for(const includeEntries of [true,false]){
  const copyId=randomUUID(),options={action:'duplicate',title:'Independent field programme',copyId,includeEntries};
  const result=await change(id,firstRevision,options);assert.equal(result.site.id,copyId);
  assert.equal((await change(id,firstRevision,options)).site.revision,result.site.revision);
  assert.equal(await store.siteVersion(id),firstRevision);
  assert.equal(result.html.includes('Restricted title'),includeEntries);
  assert.deepEqual(await websitePublishTarget(await metadata(copyId),remote),{kind:'choose'});
  assert.deepEqual(await websitePublishTarget(await metadata(id),remote),{kind:'folder',directory});
  const edition=await store.export(copyId),contents=await text(edition.files.get('contents.html'));
  assert.equal(edition.files.has(firstContinuation),false);assert.ok(!contents.includes(firstContinuation));
  if(includeEntries){
   const next=result.site.feedPages[0].path,feed=(await readWebsiteFeed(store,copyId,{expectedRevision:result.site.revision,path:'index.html'})).feeds[0].id;
   assert.notEqual(next,firstContinuation);assert.notEqual(feed,originalFeed);
   assert.ok(contents.includes(next));assert.ok(contents.includes('index.html#website-feed-'+feed));assert.ok(edition.files.has(next));
  }
  const [from,to]=await store.scope(()=>Promise.all([store.raw(id),store.raw(copyId)]));
  assert.notEqual(from.components[0].id,to.components[0].id);
  assert.notEqual(from.themeBook.items[0].id,to.themeBook.items[0].id);
  assert.notEqual(from.pages[0].instances[0].id,to.pages[0].instances[0].id);
  assert.equal(to.files.some(f=>f.blob.includes('/sites/'+id+'/')),false);
  let updated=await change(copyId,result.site.revision,{action:'rename',title:'Separate programme'});
  assert.equal(updated.site.name,'Separate programme');
  const archived=await change(copyId,updated.site.revision,{action:'archive'});
  assert.equal((await store.list()).items.some(s=>s.id===copyId),false);
  assert.ok((await store.list({archived:true})).items.some(s=>s.id===copyId));
  await assert.rejects(store.export(copyId),{code:'NOT_FOUND'});
  if(includeEntries)archivedCopy=copyId;
  else assert.equal((await change(copyId,archived.revision,{action:'restore'})).site.name,'Separate programme');
 }
 await put(false);
 const archivedSites=await store.list({archived:true});
 const restored=await change(archivedCopy,archivedSites.items.find(s=>s.id===archivedCopy).revision,{action:'restore'});
 assert.doesNotMatch(restored.html,/Restricted title/);
 for(const item of (await store.list()).items)assert.doesNotMatch((await store.open(item.id)).html,/Restricted title/);
});

test('a move retains its own history across path reuse, protects recovery receipts, and exposes either complete state across an interruption',async t=>{
 const {id,store:initial}=await fixture(t);let store=initial;
 const source='methods.html',destination='coast/methods.html',image='figures/map.png';
 const earlier=document('Methods','<p>Earlier method</p><img src="'+image+'">');
 let saved=await store.importFiles(id,{name:'Atlas',files:new Map([['index.html',document('Home','<a href="methods.html">Read methods</a>')],[source,earlier],[image,Buffer.from('figure')],['style.css','p{color:navy}']])});
 saved=await websiteThemes(store,id,{expectedRevision:saved.site.revision,path:source,action:'create',name:'Coast',values:{text:'#224466'},scope:'page'},true);
 saved=await websitePageDesigns(store,id,{expectedRevision:saved.site.revision,path:source,action:'name',name:'Field protocol'});
 saved=await websiteVersions(store,id,'name',{expectedRevision:saved.site.revision,label:'Review'});
 const version=(await websiteVersions(store,id,'list',{expectedRevision:saved.site.revision})).items[0].id;
 saved=await store.open(id,{path:source});
 const note=await saveWebsiteRecovery(store,id,{id:randomUUID(),operationId:randomUUID(),path:source,baseRevision:saved.site.revision,html:saved.html.replace('Earlier','Unsaved'),css:saved.css});
 let request={action:'move',path:source,destination,expectedRevision:saved.site.revision};
 const guarded=await websitePageLifecycle(store,id,request);assert.equal(guarded.blocked,'recovery');
 await assert.rejects(websitePageLifecycle(store,id,{...request,reviewId:guarded.reviewId},true),{code:'CONFLICT'});
 await discardWebsiteRecovery(store,id,{path:source,id:note.id,revision:note.revision});
 saved=await store.save(id,{...saved,expectedRevision:saved.site.revision,html:saved.html.replace('Earlier method','Later method')});
 request={...request,expectedRevision:saved.site.revision};
 for(const afterHead of [false,true]){
  const reviewed=await websitePageLifecycle(store,id,request),write=store.writeControl.bind(store);
  store.writeControl=async(file,...args)=>{
   if(file!=='.observanda/website-files/sites/'+id+'/head.json')return write(file,...args);
   if(afterHead)await write(file,...args);
   throw Object.assign(Error('Interrupted lifecycle transaction'),{code:'EIO'});
  };
  await assert.rejects(websitePageLifecycle(store,id,{...request,reviewId:reviewed.reviewId},true),{code:'EIO'});
  store=new WebsiteFileStore(initial.workspace);const edition=await store.export(id);
  assert.equal(edition.files.has(destination),afterHead);assert.equal(edition.files.has(source),!afterHead);
  assert.ok((await text(edition.files.get('index.html'))).includes('href="'+(afterHead?destination:source)+'"'));
 }
 saved=await store.open(id,{path:destination});
 saved=await store.createPage(id,{expectedRevision:saved.site.revision,path:source,title:'Different document'});
 for(const kind of ['themeBook','pageDesigns']){
  const request={expectedRevision:saved.site.revision,path:destination,kind,version},review=await websiteVersionDesign(store,id,request);
  assert.equal(review.total,0);assert.equal(review.status,'ready');
  saved=await websiteVersionDesign(store,id,{...request,reviewId:review.reviewId},true);
 }
 let desired={expectedRevision:saved.site.revision,path:source,version};
 const occupied=await restoreWebsitePageVersion(store,id,desired);assert.equal(occupied.status,'occupied');
 await assert.rejects(restoreWebsitePageVersion(store,id,{...desired,reviewId:occupied.reviewId},true),{code:'CONFLICT'});
 desired={...desired,path:destination};const reviewed=await restoreWebsitePageVersion(store,id,desired);assert.equal(reviewed.status,'ready');
 saved=await restoreWebsitePageVersion(store,id,{...desired,reviewId:reviewed.reviewId},true);
 assert.match(saved.html,/Earlier method/);assert.match(saved.html,/src="\.\.\/figures\/map.png"/);
 assert.equal((await store.open(id,{path:source})).site.pages.find(p=>p.path===source).title,'Different document');
});

test('reviewing a measured 6,400 incoming links pages metadata without rereading any HTML or stylesheet',async t=>{
 const {store,id}=await fixture(t),target='methods.html',links='<a href="methods.html">Methods</a>'.repeat(80);
 const files=new Map([['index.html',document('Home',links)],[target,document('Methods','Methods')],['style.css','']]);
 for(let i=1;i<80;i++)files.set('station-'+i+'.html',document('Station',links));
 const saved=await store.importFiles(id,{name:'Sampling stations',files});
 const reader=new WebsiteFileStore(store.workspace),read=reader.readText.bind(reader),head=reader.revisionManifest.bind(reader);
 let reads=0,manifests=0;
 reader.readText=(...args)=>{reads++;return read(...args);};
 reader.revisionManifest=(...args)=>{manifests++;return head(...args);};
 const input={action:'move',path:target,destination:'bays/methods.html',expectedRevision:saved.site.revision};
 let review=await websitePageLifecycle(reader,id,input),total=0;
 const first=review.reviewId;assert.equal(review.items.length,40);assert.equal(manifests,1);
 while(true){
  total+=review.items.filter(r=>r.kind==='link').reduce((n,row)=>n+row.count,0);
  if(review.next===null)break;review=await websitePageLifecycle(reader,id,{...input,offset:review.next});
 }
 assert.equal(total,6400);assert.equal(reads,0);assert.equal(manifests,1);
 await store.createPage(id,{expectedRevision:saved.site.revision,path:'new.html',title:'New'});
 await assert.rejects(websitePageLifecycle(reader,id,{...input,offset:40}),{code:'CONFLICT'});
 await assert.rejects(websitePageLifecycle(reader,id,{...input,reviewId:first},true),{code:'CONFLICT'});
});
