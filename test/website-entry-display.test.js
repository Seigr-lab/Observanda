import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {parse} from 'parse5';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {placementPresentationOptions,setPlacementPresentation,changeWebsitePlacement} from '../src/website-file-placements.js';
import {WebsiteFilesCandidate} from '../src/website-files-candidate.js';
import {attr,descendants} from '../src/website-migration-views.js';
import {contentBuffer} from '../src/file-content.js';

test('different copies publish only their selected writing, sections and current assets and restore those choices on regrant',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-entry-display-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{
  await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('website-entry-display-'))throw Error('Unexpected fixture');
  await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:150});
 });
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace);
 workspace.openCatalogue=workspace.catalogue=()=>assert.fail('File editor contacted research');
 const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()});
 const site=randomUUID(),method=randomUUID(),notes=randomUUID(),otherPart='section:'+notes,chosenPart='section:'+method;
 const articlePath='pages/method.html',draft='drafts/full.html';
 const html='<html><head><title>Results</title></head><body><main><h1>Observations</h1></main></body></html>';
 await store.importFiles(site,{name:'Field guide',files:new Map([['index.html',html],[articlePath,html],['style.css','']]),draftFiles:new Map([[draft,html],['draft-styles.css','']])});
 function asset(value){const bytes=Buffer.from(value),digest=createHash('sha256').update(bytes).digest('hex');return {path:'assets/'+digest+'.png',bytes,contentType:'image/png'};}
 const selected=asset('Chosen permit image'),unselected=asset('Unused image');
 const fragment=(permitted=true,body='Field method overview.')=>'<h2 data-observanda-part="title">Coastal study</h2><article><div data-observanda-part="body"><p>'+body+'</p><p>More detail excluded from the card.</p></div>'+
  (permitted?'<section id="record-section-'+method+'" data-observanda-part="'+chosenPart+'"><div hidden><h3>Hidden title</h3></div><h3>Conductivity protocol</h3><p>Immerse the <em>probe</em> twice.</p><figure><img src="'+selected.path+'" alt="Probe"><figcaption>Reference probe</figcaption></figure><a href="#record-section-'+method+'">Return to method</a></section>':'')+
  '<section data-observanda-part="'+otherPart+'"><h3>Unselected details</h3><img src="'+unselected.path+'"><p>Exclude these readings.</p></section></article>';
 let source;
 async function publishSource(permitted=true,visible=true,body){
  const token=await store.beginSourceUpdate({sourceId});
  source=await store.putSource({sourceId,title:'Coastal study',visible,html:visible?fragment(permitted,body):'',assets:visible?(permitted?[selected,unselected]:[unselected]):[]},{token});
 }
 await publishSource();let page=await store.open(site);
 for(const p of ['index.html',articlePath,draft,'index.html'])page=await store.insertSource(site,{expectedRevision:page.site.revision,path:p,sourceId,sourceRevision:source.revision});
 const opts=(p,ordinal=0)=>({expectedRevision:page.site.revision,path:p,sourceId,sourceRevision:source.revision,ordinal});
 const set=async(p,mode,choice,ordinal=0)=>{page=await setPlacementPresentation(store,site,{...opts(p,ordinal),presentation:mode,choice});};
 const options=(p,ordinal=0,extra={})=>placementPresentationOptions(store,site,{...opts(p,ordinal),...extra});
 const before=await options('index.html',0,{limit:1});assert.equal(before.presentation,'full');assert.equal(before.items.length,1);assert.ok(before.next);
 assert.equal((await options(articlePath)).items.find(x=>x.key===chosenPart).title,'Conductivity protocol');
 const old=opts(articlePath);
 await set('index.html','card','body');await assert.rejects(setPlacementPresentation(store,site,{...old,presentation:'section',choice:chosenPart}),{code:'CONFLICT'});
 await set('index.html','card','title',1);await set(articlePath,'section',chosenPart);
 assert.match(page.html,/Immerse the <em>probe<\/em> twice/);assert.doesNotMatch(page.html,/Hidden title|Unselected details|Field method overview/);
 assert.ok(page.html.includes('../'+selected.path));assert.ok(!page.html.includes(unselected.path));assert.ok(!page.html.includes('source-'+sourceId+'.css'));
 const section=[...descendants(parse(page.html))].find(n=>attr(n,'data-observanda-part')===chosenPart);
 assert.match(attr(section,'id'),/^entry-/);assert.equal(attr([...descendants(section)].find(n=>n.tagName==='a'),'href'),'#'+attr(section,'id'));
 await assert.rejects(store.save(site,{...page,expectedRevision:page.site.revision,html:page.html.replace('Immerse the','Disallowed local copy')}),{code:'CONFLICT'});
 page=await store.save(site,{...page,expectedRevision:page.site.revision,html:page.html.replace('<h1>Observations','<h1>Revised observations')});
 assert.equal((await options(articlePath)).choice,chosenPart);
 const exported=async()=>{const candidate=await WebsiteFilesCandidate.open(store,site,page.site.revision);await candidate.verify({});return candidate.files;};
 const files=await exported(),cardHTML=(await contentBuffer(files.get('index.html'))).toString();
 assert.match(cardHTML,/Field method overview/);assert.doesNotMatch(cardHTML,/More detail|Unselected details|Reference probe|record-section/);
 assert.equal([...descendants(parse(cardHTML))].filter(n=>attr(n,'data-observanda-display')==='card').length,2);
 assert.deepEqual(await contentBuffer(files.get(selected.path)),selected.bytes);assert.ok(!files.has(unselected.path));assert.ok(!files.has('source-'+sourceId+'.css'));
 assert.deepEqual(await contentBuffer((await store.file(site,unselected.path,{editor:true})).content),unselected.bytes);
 await assert.rejects(store.file(site,unselected.path),{code:'NOT_FOUND'});
 await publishSource(false,true,'Changed field text.');page=await store.open(site,{path:articlePath});
 assert.doesNotMatch(page.html,/Conductivity protocol|Immerse|Reference probe/);assert.ok(!page.html.includes(method));assert.match(page.html,/Coastal study/);
 const missing=await options(articlePath);assert.equal(missing.choice,null);assert.ok(missing.unavailable);assert.ok(!(await exported()).has(selected.path));
 assert.match((await store.open(site)).html,/Changed field text/);
 await publishSource(true,false);page=await store.open(site,{path:articlePath});assert.doesNotMatch(page.html,/Coastal study|Conductivity protocol/);assert.ok(!(await exported()).has(selected.path));
 await publishSource();page=await store.open(site,{path:articlePath});assert.match(page.html,/Conductivity protocol/);assert.equal((await options(articlePath)).choice,chosenPart);assert.ok((await exported()).has(selected.path));
 await set('index.html','full',null,1);assert.match(page.html,/More detail excluded/);assert.ok((await exported()).has(unselected.path));
 await set('index.html','card',chosenPart,1);assert.match(page.html,/Immerse the probe twice/);assert.ok(!page.html.includes(selected.path));
 page=await changeWebsitePlacement(store,site,'remove',{...opts(articlePath)});assert.doesNotMatch(page.html,/Conductivity protocol/);
 assert.ok(!(await exported()).has(selected.path));assert.ok(!(await exported()).has(unselected.path));
 const raw=await store.scope(()=>store.raw(site));assert.deepEqual(raw.pages.find(p=>p.path===articlePath).entryDisplays,{});
});
