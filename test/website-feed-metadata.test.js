import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {PublicationConversion} from '../src/publication-conversion.js';
import {saveWebsiteFeed} from '../src/website-dynamic-feeds.js';
import {enumerateFeedMembers} from '../src/website-feed-query.js';
import {makeFeedRenderer} from '../src/website-feed-render.js';
import {sampleNotebook} from '../src/sample.js';
import {convertPublicationRecord} from '../src/publication-conversion-render.js';

test('retained entry styles share one public file while a footer actually present in the row retains its own rules',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-feed-styles-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook(),workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace);
 const start=await store.create({name:'Reports'}),id=start.site.id,notebookId=book.entries[0].notebookId;
 let common,first;
 for(const hasFooter of [false,false,true]){
  const record={...book.entries[1],id:randomUUID(),notebookId,sections:[],attachments:[],share:true};
  const provenance={recordId:record.id,workspaceId:workspace.vault.id,notebookId},sourceId=websiteSourceId(provenance);
  first??={sourceId,provenance};
  const converted=await convertPublicationRecord({},book,record);assert.ok(converted.visible);
  if(common)assert.equal(common,converted.css);common=converted.css;
  // Model the CSS already stored by an earlier producer, including the record-
  // specific page rule. A real footer in the saved markup must retain it.
  const rule='[data-page="entry:'+record.id+'"] .site-footer{--footer-text-align:center}';
  const css=converted.css.slice(0,-1)+rule+'\n}',html=converted.html+(hasFooter?'<div data-page="entry:'+record.id+'"><footer class="site-footer">Note</footer></div>':'');
  await store.putSource({sourceId,provenance,title:record.title,html,css,assets:converted.assets},{token:await store.beginSourceUpdate({sourceId,target:'website',provenance})});
 }
 await saveWebsiteFeed(store,id,{expectedRevision:start.site.revision,path:'index.html',heading:'Entries',template:'full',layout:'list',pageSize:1});
 const {files}=await store.export(id);
 assert.equal([...files.keys()].filter(name=>name.startsWith('feed-assets/styles-')).length,2);
 await store.putSource({...first,title:'Withdrawn',visible:false},{token:await store.beginSourceUpdate({...first,target:'website'})});
 const current=await store.export(id);
 assert.equal([...current.files.keys()].filter(name=>name.startsWith('feed-assets/styles-')).length,2);
});

test('card and metadata templates share index and fence reads but still reject replayed publication metadata',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-feed-metadata-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.openCatalogue=workspace.catalogue=()=>assert.fail('Opened research storage');
 const store=new WebsiteFileStore(workspace),publisher=new PublicationConversion(workspace,{store});
 const owner={workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()},sourceId=websiteSourceId(owner);
 const begin=()=>store.beginSourceUpdate({sourceId,target:'website',provenance:owner});
 const base=await store.putSource({sourceId,provenance:owner,title:'Saved snapshot',html:'<p>Historical body</p>'},{token:await begin()});
 for(const visible of [true,false]){
  const provenance={...owner,recordId:randomUUID()},id=websiteSourceId(provenance),token=await store.beginSourceUpdate({sourceId:id,target:'website',provenance});
  await store.putSource({sourceId:id,provenance,visible,title:visible?'Unchanged observation':'Withheld title',html:'<p>Rich content only</p>',css:visible?'p{color:navy}':''},{token});
 }
 const publish=async(title,date,tag)=>{
  const html='<p data-observanda-part="metadata"><span>analysis</span><time datetime="'+date+'">'+date+'</time></p><ul data-observanda-part="tags"><li>'+tag+'</li></ul><p>Rich content only</p>';
  await publisher.commitLive(sourceId,{title,provenance:owner,html,css:'p{color:navy}',assets:[]},await begin());
 };
 await publish('Live tidal survey','2026-06-02','low tide');
 const site=(await store.create({name:'Field observations'})).site.id;
 const save=async options=>saveWebsiteFeed(store,site,{path:'index.html',heading:'Observations',expectedRevision:await store.siteVersion(site),...options});
 const read=store.readText.bind(store),control=store.control.bind(store),reads=[];
 const bodies=t.mock.method(store,'readText',(file,options)=>{
  assert.ok(!file.blob.includes('/sources/'),'Opened encrypted source body');return read(file,options);
 });
 const controls=t.mock.method(store,'control',(file,options)=>{reads.push(file);return control(file,options);});
 const card=await save({template:'card'});assert.match(card.html,/Live tidal survey/);assert.match(card.html,/Unchanged observation/);assert.doesNotMatch(card.html,/Saved snapshot|Rich content only|low tide|Withheld title/);
 const itemHTML='<h3 data-feed-field="title"></h3><time data-feed-field="date"></time><p data-feed-field="type"></p><ul data-feed-field="tags"></ul>';
 const custom=await save({template:'custom',itemHTML});assert.match(custom.html,/<time[^>]*>2026-06-02<\/time>/);assert.match(custom.html,/<li>low tide<\/li>/);assert.match(custom.html,/>analysis<\/p>/);
 assert.doesNotMatch(custom.html,/Rich content only|Saved snapshot|Withheld title/);
 // Two revision lookups, two start/end library stamps, one existing feed check.
 assert.ok(reads.filter(file=>file.endsWith('/pending.json')).length<=7);
 for(const key of ['picker','feed-index'])assert.equal(reads.filter(file=>file.endsWith('/'+key+'/'+sourceId.slice(0,2)+'.json')).length,2);
 const manifest=await store.scope(()=>store.raw(site));
 for(const feed of manifest.feeds){assert.equal(feed.members.length,2);for(const member of feed.members)assert.deepEqual(Object.keys(member).sort(),['id','revision']);assert.notEqual(feed.members.find(m=>m.id===sourceId).revision,base.revision);}
 for(const {id} of manifest.feeds[0].members)for(const name of ['head','feed'])assert.equal(reads.filter(file=>file.endsWith('/sources/'+id+'/'+name+'.json')).length,2);
 // A group may split after its row is rendered. Reusing that row for the
 // continuation in the same writer needs no further source controls.
 let formerRenderer,formerMember;
 await store.scope(async()=>{
  const renderer=makeFeedRenderer(manifest.feeds[0],false,site,false),rows=await enumerateFeedMembers(store,{},{admittedRows:renderer.admittedRows});
  const member=rows.find(m=>m.id===sourceId),start=reads.length;
  await renderer.render(store,member,'index.html');const next=await renderer.render(store,member,'feeds/example.html');
  assert.match(next.html,/Live tidal survey/);assert.equal(reads.slice(start).filter(file=>file.includes('/sources/')).length,2);
  formerRenderer=renderer;formerMember=member;
 },{write:true});
 await assert.rejects(save({template:'full'}),/Opened encrypted source body/);
 assert.equal(await store.siteVersion(site),custom.site.revision);controls.mock.restore();bodies.mock.restore();

 const full=(await store.create({name:'Full observations'})).site,fullReads=[],fullWrites=[],texts=[];
 const sourceReads=t.mock.method(store,'readText',(file,options)=>{if(file.blob.includes('/sources/'))texts.push(file.name);return read(file,options);});
 const fullControls=t.mock.method(store,'control',(name,options)=>{fullReads.push(name);return control(name,options);});
 const write=store.writeControl.bind(store),fullControlsWritten=t.mock.method(store,'writeControl',(name,...args)=>{fullWrites.push(name);return write(name,...args);});
 const complete=await saveWebsiteFeed(store,full.id,{path:'index.html',heading:'Full observations',pageSize:1,expectedRevision:full.revision});
 assert.equal(complete.site.feedPages.length,1);assert.match(complete.html,/Rich content only/);
 assert.deepEqual(texts.sort(),['fragment.html','fragment.html','source.css']);
 assert.equal(fullReads.filter(name=>name.endsWith('/pending.json')).length,2);
 for(const {id} of manifest.feeds[0].members){
  for(const name of ['head','feed'])assert.equal(fullReads.filter(file=>file.endsWith('/sources/'+id+'/'+name+'.json')).length,1);
  for(const key of ['picker','feed-index'])assert.equal(fullReads.filter(file=>file.endsWith('/'+key+'/'+id.slice(0,2)+'.json')).length,1);
 }
 assert.equal(fullWrites.filter(name=>name.includes('/placements/')).length,0);
 assert.equal(fullWrites.filter(name=>name.includes('/feed-usage/nodes/')).length,1);
 sourceReads.mock.restore();fullControls.mock.restore();fullControlsWritten.mock.restore();

 await publish('Revised field survey','2026-06-03','high tide');
 const reopened=await new WebsiteFileStore(workspace).open(site);
 assert.equal(reopened.html.match(/Revised field survey/g)?.length,2);assert.match(reopened.html,/<li>high tide<\/li>/);assert.match(reopened.html,/2026-06-03/);
 assert.doesNotMatch(reopened.html,/Live tidal survey|low tide|2026-06-02|Rich content only/);
 const token=await begin();await assert.rejects(save({template:'card'}),{code:'CONFLICT'});await store.cancelSourceUpdate({sourceId,token});

 // A stale live binding cannot authorize the snapshot's older presentation.
 const shard='.observanda/website-files/feed-index/'+sourceId.slice(0,2)+'.json';
 const picker='.observanda/website-files/picker/'+sourceId.slice(0,2)+'.json';
 const liveBytes=await readFile(store.absolute(shard)),baseBytes=await readFile(store.absolute(picker));
 const replay=(file,bytes)=>store.scope(()=>writeFile(store.absolute(file),bytes),{write:true});
 await store.scope(async()=>{const data=await store.control(shard);data[sourceId].baseRevision='f'.repeat(64);await store.writeControl(shard,data);},{write:true});
 await assert.rejects(save({template:'card'}),{code:'CONFLICT'});assert.equal(await store.siteVersion(site),reopened.site.revision);

 await replay(shard,liveBytes);await publisher.commitLive(sourceId,null,await begin());
 const withdrawn=await store.open(site);assert.doesNotMatch(withdrawn.html,/Revised field survey|high tide|Saved snapshot/);
 await store.scope(()=>assert.rejects(formerRenderer.render(store,formerMember,'index.html'),{code:'NOT_FOUND'}),{write:true});
 await replay(shard,liveBytes);await assert.rejects(save({template:'card'}),{code:'NOT_FOUND'});
 await store.scope(()=>store.remove(shard),{write:true});await assert.rejects(save({template:'custom',itemHTML}),{code:'NOT_FOUND'});
 assert.equal(await store.siteVersion(site),withdrawn.site.revision);

 // Replay the actual pre-withdrawal picker ciphertext after the base grant
 // is gone too. Its visible row still cannot create a new occurrence.
 await store.putSource({sourceId,provenance:owner,title:'Private',visible:false},{token:await begin()});
 await replay(picker,baseBytes);await assert.rejects(save({template:'card'}),{code:'NOT_FOUND'});
 assert.equal(await store.siteVersion(site),withdrawn.site.revision);
});
