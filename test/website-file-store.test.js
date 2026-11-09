import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {insertWebsiteSource,updateWebsiteSource} from '../src/website-file-html.js';
import {validateWebsiteHTML,validateWebsiteCSS} from '../src/website-file-policy.js';
import {contentBuffer} from '../src/file-content.js';
import {bindConvertedPage} from '../src/website-files-migration.js';

test('a reviewed batch of eligible entries is placed in order or leaves the saved page untouched',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-reviewed-batch-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('Placement opened research');
 const store=new WebsiteFileStore(workspace),id=randomUUID(),book=randomUUID(),sources=[];
 for(const title of ['Station one','Station two','Unselected station']){
  const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:book,recordId:randomUUID()});
  const token=await store.beginSourceUpdate({sourceId});
  const source=await store.putSource({sourceId,title,html:'<p>'+title+'</p>'},{token});
  sources.push({sourceId,sourceRevision:source.revision});
 }
 const page=await store.create({id,name:'Stations'}),pin=page.site.revision;
 const submit=sources=>store.insertSources(id,{expectedRevision:pin,sources,position:{before:0}});
 const [first,second,unselected]=sources;
 await assert.rejects(submit([first,first]),{code:'INVALID'});
 await assert.rejects(submit([first,{sourceId:second.sourceId}]),{code:'INVALID'});
 await assert.rejects(submit([first,{...second,sourceRevision:'f'.repeat(64)}]),{code:'CONFLICT'});
 const token=await store.beginSourceUpdate({sourceId:second.sourceId});
 await assert.rejects(submit([first,second]),{code:'CONFLICT'});
 assert.equal((await store.open(id)).site.revision,pin);
 await store.cancelSourceUpdate({sourceId:second.sourceId,token});
 const source=store.source.bind(store);store.source=(key,options)=>{assert.notEqual(key,unselected.sourceId);return source(key,options);};
 const placed=await submit([second,first]);
 assert.match(placed.html,/Station two[\s\S]+Station one[\s\S]+<h1/);
 assert.doesNotMatch(placed.html,/Unselected station/);assert.notEqual(placed.site.revision,pin);
 await assert.rejects(submit([first,second]),{code:'CONFLICT'});
 await store.putSource({sourceId:second.sourceId,title:'Withdrawn',visible:false},{token:await store.beginSourceUpdate({sourceId:second.sourceId})});
 const revoked=await store.open(id);
 await assert.rejects(store.insertSources(id,{expectedRevision:revoked.site.revision,sources:[first,second]}),{code:'NOT_FOUND'});
 assert.equal((await store.open(id)).html,revoked.html);
});

test('cross-entry references retain authored labels, revoke target titles and never grant target assets',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-entry-links-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('Link update opened research');
 const store=new WebsiteFileStore(workspace),site=randomUUID(),parent=randomUUID(),target=randomUUID(),href='entries/'+target+'.html';
 const parentId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:parent}),targetId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:target});
 const fragment=title=>'<div data-observanda-part="title"><h2>'+title+'</h2></div>';
 const asset=Buffer.from('Unplaced target image'),assetName='assets/'+createHash('sha256').update(asset).digest('hex')+'.png';
 const put=async(sourceId,title,visible=true)=>store.putSource({sourceId,title,visible,html:visible?fragment(title):'',assets:visible&&sourceId===targetId?[{path:assetName,bytes:asset,contentType:'image/png'}]:[]},{token:await store.beginSourceUpdate({sourceId})});
 const a=await put(parentId,'Parent'),b=await put(targetId,'Original title');
 const record=(id,source,title)=>[id,{source,media:new Map(),record:{title,tags:[],type:'note',attachments:[]}}];
 const records=new Map([record(parent,a,'Parent'),record(target,b,'Original title')]);
 const source='<html><body data-page="entry:'+parent+'"><main><article class="record-page"><div class="rich-document"><p>Surrounding copy <a href="'+href+'">my wording</a> and <a href="'+href+'"><em>Read </em><strong aria-label="Original title">Original</strong> title next</a>.</p></div><section class="record-related"><ul><li><a href="'+href+'">Original title</a></li></ul></section></article></main><footer>Footer</footer></body></html>';
 const bound=bindConvertedPage('index.html',source,{records,aliases:new Map()});
 let opened=await store.importFiles(site,{name:'Study',files:new Map([['index.html',bound],['style.css','']])});
 assert.ok(opened.html.includes('my wording'));assert.match(opened.html,/<em>Read <\/em><strong aria-label="Original title">/);assert.equal((await store.export(site)).files.has(assetName),false);
 await assert.rejects(store.file(site,assetName),{code:'NOT_FOUND'});
 opened=await store.save(site,{...opened,expectedRevision:opened.site.revision,html:opened.html.replace('my wording','my edited wording')});
 await put(targetId,'Original title',false);opened=await store.open(site);
 assert.doesNotMatch(opened.html,/Original title/);assert.equal(opened.html.includes(href),false);assert.match(opened.html,/my edited wording/);assert.match(opened.html,/Surrounding copy/);assert.match(opened.html,/Read .* next/);
 await assert.rejects(store.save(site,{...opened,expectedRevision:opened.site.revision,html:opened.html.replace('<a ','<a href="'+href+'" ')}),{code:'CONFLICT'});
 opened=await store.save(site,{...opened,expectedRevision:opened.site.revision,html:opened.html.replace('Footer','Authored footer')});
 await put(targetId,'Revised target title');opened=await store.open(site);
 assert.ok(opened.html.includes('href="'+href+'"'));assert.match(opened.html,/Revised target title/);assert.match(opened.html,/Authored footer/);assert.match(opened.html,/my edited wording/);
 assert.equal((await store.export(site)).files.has(assetName),false);assert.equal((await store.export(site)).files.has('source-'+targetId+'.css'),false);
 await put(parentId,'Parent',false);await put(targetId,'Another title');opened=await store.open(site);
 assert.equal(opened.html.includes(href),false);assert.doesNotMatch(opened.html,/Another title|my edited wording|Surrounding copy/);assert.match(opened.html,/Authored footer/);
});

test('private drafts remain editable and a draft-only placement contributes no published files',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-draft-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>assert.fail('Draft editor opened research');
 const store=new WebsiteFileStore(workspace),id=randomUUID(),draft='pages/private.html',privateCSS='draft-styles.css';
 const files=new Map([['index.html','<html><head><title>Home</title></head><body>Public site</body></html>'],['style.css','body{color:navy}']]);
 const draftFiles=new Map([[draft,'<html><head><title>Working copy</title><link rel="stylesheet" href="../draft-styles.css"></head><body><main><h1>Working copy</h1></main></body></html>'],[privateCSS,'body{color:red}'],['private.png',Buffer.from('Draft image')]]);
 await store.importFiles(id,{name:'Site',files,draftFiles});
 let opened=await store.open(id,{path:draft});assert.equal(opened.site.cssPath,privateCSS);
 opened=await store.save(id,{...opened,expectedRevision:opened.site.revision,css:'p{color:purple}',html:opened.html.replace('<h1>Working copy','<h1>Revised draft')});
 const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()}),asset=Buffer.from('Draft source asset'),assetPath='assets/'+createHash('sha256').update(asset).digest('hex')+'.png';
 const token=await store.beginSourceUpdate({sourceId});await store.putSource({sourceId,title:'Source',html:'<p data-observanda-part="body">Source detail</p>',assets:[{path:assetPath,bytes:asset,contentType:'image/png'}]},{token});
 opened=await store.insertSource(id,{path:draft,expectedRevision:opened.site.revision,sourceId});
 assert.match(opened.html,/Source detail/);assert.match(opened.html,/Revised draft/);
 for(const member of [draft,privateCSS,'private.png',assetPath,'source-'+sourceId+'.css']){
  await assert.rejects(store.file(id,member),{code:'NOT_FOUND'});assert.ok((await store.file(id,member,{editor:true})).content);
 }
 const exported=await store.export(id);assert.deepEqual([...exported.files.keys()].sort(),['index.html','style.css']);assert.deepEqual(exported.site.pages.map(p=>p.path),['index.html']);
 assert.equal((await contentBuffer(exported.files.get('style.css'))).toString(),'body{color:navy}');
 const shared=await store.insertSource(id,{path:'index.html',expectedRevision:opened.site.revision,sourceId});assert.ok((await store.export(id)).files.has(assetPath));
 const withdrew=await store.beginSourceUpdate({sourceId});await store.putSource({sourceId,title:'Withdrawn',visible:false},{token:withdrew});
 assert.doesNotMatch((await store.open(id,{path:draft})).html,/Source detail/);assert.equal((await store.export(id)).files.has(assetPath),false);
 await assert.rejects(store.file(id,assetPath,{revision:shared.site.revision,editor:true}),{code:'CONFLICT'});
 const currentExport=await store.export(id);
 store.readText=()=>assert.fail('Listing this site read a page or asset body');
 const inventory=await store.publicationInventory(id,{expectedRevision:currentExport.revision});
 assert.deepEqual(inventory.files.sort(),[...currentExport.files.keys()].sort());assert.deepEqual(inventory.pages,currentExport.site.pages);
 await assert.rejects(store.publicationInventory(id,{expectedRevision:shared.site.revision}),{code:'CONFLICT'});
});

test('saved HTML, CSS and copied source survive unavailable research; changing visibility updates existing placements and revokes stale publications',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-files-'));await mkdir(path.join(root,'.observanda'));
 try{
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
  for(const method of ['catalogue','withLock','readMetadata','writeMetadata','outline'])workspace[method]=()=>assert.fail('research opened: '+method);
  const store=new WebsiteFileStore(workspace),id=randomUUID(),sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()});
  const first=await store.create({id,name:'Laboratory'});assert.match(first.html,/<h1>Laboratory/);
  const publicPart='<section data-observanda-part="summary">Original summary</section>',newPart='<section data-observanda-part="method">Released method</section>';
  const image=Buffer.from('retained asset'),assetPath='assets/'+createHash('sha256').update(image).digest('hex')+'.png';
  const token=await store.beginSourceUpdate({sourceId});await store.putSource({sourceId,title:'Observation',html:publicPart,assets:[{path:assetPath,bytes:image,contentType:'image/png'}]},{token});
  const placed=await store.insertSource(id,{sourceId,expectedRevision:first.site.revision});assert.match(placed.html,/Original summary/);
  const authored=await store.save(id,{path:'index.html',expectedRevision:placed.site.revision,html:placed.html.replace('Original summary','Website wording'),css:'body{color:navy}'});
  assert.match(placed.sourceStamp,/^[a-f0-9]{64}$/);assert.equal(authored.sourceStamp,placed.sourceStamp);
  const exported=await store.export(id,{expectedRevision:authored.site.revision});let published='';for await(const part of exported.files.get('index.html').stream())published+=part;assert.equal(published,authored.html);
  await assert.rejects(store.save(id,{expectedRevision:authored.site.revision,path:'index.html',html:authored.html.replace('data-observanda-source=','data-old-source='),css:authored.css}),{code:'CONFLICT'});
  const abandoned=await store.beginSourceUpdate({sourceId}),update=await store.beginSourceUpdate({sourceId});await assert.rejects(store.open(id),{code:'CONFLICT'});
  await assert.rejects(store.cancelSourceUpdate({sourceId,token:abandoned}),{code:'CONFLICT'});await assert.rejects(store.cancelSourceUpdate({sourceId,token:update}),{code:'CONFLICT'});
  await store.putSource({sourceId,title:'Observation',html:publicPart+newPart},{token:update});const reopened=await store.open(id);assert.match(reopened.html,/Website wording/);assert.match(reopened.html,/Released method/);assert.equal(reopened.css,'body{color:navy}');
  await assert.rejects(store.export(id,{expectedRevision:authored.site.revision}),{code:'CONFLICT'});await assert.rejects(store.file(id,assetPath),{code:'NOT_FOUND'});
  const withdraw=await store.beginSourceUpdate({sourceId});await store.putSource({sourceId,title:'Observation',visible:false},{token:withdraw});const privatePage=await store.open(id);assert.doesNotMatch(privatePage.html,/Released method|Website wording/);assert.match(privatePage.html,/data-observanda-source=/);
  assert.notEqual(privatePage.sourceStamp,authored.sourceStamp);
  const restore=await store.beginSourceUpdate({sourceId});await store.putSource({sourceId,title:'Observation',html:publicPart},{token:restore});assert.match((await store.open(id)).html,/Original summary/);
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true});}
});

test('a nested revoked figure disappears without replacing the surrounding website writing',()=>{
 const id='1'.repeat(64),revision='a'.repeat(64),article='<section data-observanda-part="body"><p>Author text</p><figure data-observanda-part="figure:one"><img src="assets/figure.png"></figure></section>';
 const page=insertWebsiteSource('<!doctype html><html><head><title>A</title></head><body><main>Before</main></body></html>',{id,revision,html:article}).replace('Author text','Edited on website');
 const changed=updateWebsiteSource(page,{id,revision:'b'.repeat(64),previousHtml:article,html:article.replace(/<figure\b[\s\S]+?<\/figure>/,'')+'<section data-observanda-part="section:two">New section</section>'});
 assert.match(changed,/Edited on website/);assert.match(changed,/New section/);assert.match(changed,/Before/);assert.doesNotMatch(changed,/figure\.png|figure:one/);
});

test('version polling uses compact files and observes PDF fences, cancellation, failure and settlement',async()=>{
 const temporary=await mkdtemp(path.join(os.tmpdir(),'website-version-'));
 await mkdir(path.join(temporary,'.observanda'));
 try{
  const vault={id:randomUUID(),key:randomBytes(32)},workspace=new Workspace(temporary,vault);
  for(const name of ['catalogue','withLock','outline','readMetadata'])workspace[name]=()=>assert.fail('Unexpected research read');
  const writer=new WebsiteFileStore(workspace),reader=new WebsiteFileStore(workspace),reads=[];
  const control=reader.control.bind(reader);reader.control=async(file,...args)=>{reads.push(file);return control(file,...args);};
  const site=await writer.create({name:'Example'}),id=site.site.id;
  assert.equal(await reader.siteVersion(id),site.site.revision);
  assert.equal(await reader.pdfVersion(),null);
  assert.deepEqual(reads.map(file=>file.split('/').pop()),['head.json','pending.json','pdf-version.json']);
  await assert.rejects(reader.siteVersion(randomUUID()),{code:'NOT_FOUND'});
  const provenance={workspaceId:vault.id,recordId:randomUUID(),notebookId:randomUUID(),target:'pdf'},sourceId=websiteSourceId(provenance);
  const first=await writer.beginSourceUpdate({sourceId,target:'pdf'}),pending=await reader.pdfVersion();
  assert.ok(pending);await assert.rejects(reader.pdfSource(sourceId),{code:'CONFLICT'});
  await writer.cancelSourceUpdate({sourceId,token:first});
  const cancelled=await reader.pdfVersion();assert.notEqual(cancelled,pending);
  const second=await writer.beginSourceUpdate({sourceId,target:'pdf'}),retry=await reader.pdfVersion();
  assert.notEqual(retry,cancelled);
  await assert.rejects(writer.putSource({sourceId,provenance,target:'pdf',title:'Example',html:'<script>bad()</script>'},{token:second}),{code:'INVALID'});
  assert.equal(await reader.pdfVersion(),retry);await assert.rejects(reader.pdfSource(sourceId),{code:'CONFLICT'});
  await writer.putSource({sourceId,provenance,target:'pdf',title:'Example',visible:false},{token:second});
  const settled=await reader.pdfVersion();assert.notEqual(settled,retry);
  const websiteId=websiteSourceId({...provenance,target:'website'}),webToken=await writer.beginSourceUpdate({sourceId:websiteId,target:'website'});
  await writer.putSource({sourceId:websiteId,title:'Website source',html:'<p>Public</p>'},{token:webToken});
  const placed=await writer.insertSource(id,{expectedRevision:site.site.revision,sourceId:websiteId});
  const overlay=await writer.beginSourceUpdate({sourceId:websiteId,target:'website',liveOnly:true,feedBackfill:true});
  assert.equal(await reader.siteVersion(id),placed.site.revision);
  await assert.rejects(writer.putSource({sourceId:websiteId,title:'Withdrawn',target:'website',visible:false},{token:overlay}),{code:'CONFLICT'});
  await writer.cancelSourceUpdate({sourceId:websiteId,token:overlay});
  const {content}=await reader.file(id,'index.html',{revision:placed.site.revision});
  reads.length=0;
  assert.match((await contentBuffer(content)).toString(),/Public/);
  assert.deepEqual(reads.map(file=>file.split('/').pop()),['head.json','pending.json']);
  const edit=await writer.beginSourceUpdate({sourceId:websiteId,target:'website'});
  await assert.rejects(reader.siteVersion(id),{code:'CONFLICT'});
  await assert.rejects(contentBuffer(content),{code:'CONFLICT'});
  await writer.cancelSourceUpdate({sourceId:websiteId,token:edit});
  assert.equal(await reader.siteVersion(id),placed.site.revision);assert.equal(await reader.pdfVersion(),settled);
  const unchanged=await writer.createPage(id,{expectedRevision:placed.site.revision,path:'methods.html',title:'Methods',inclusion:'included'});
  const version=await reader.versionStatus(id,{expectedRevision:placed.site.revision,path:'index.html'});
  assert.equal(version.revision,unchanged.site.revision);assert.equal(version.surfaceStamp,placed.surfaceStamp);
  const mounted=await reader.file(id,placed.site.cssPath,{revision:placed.assetStamp,editor:true});
  assert.equal((await contentBuffer(mounted.content)).toString(),placed.css);
  await writer.save(id,{path:'index.html',expectedRevision:unchanged.site.revision,html:placed.html,css:'body { color: teal }'});
  await assert.rejects(reader.file(id,placed.site.cssPath,{revision:placed.assetStamp,editor:true}),{code:'CONFLICT'});
  await assert.rejects(reader.file(id,'index.html',{revision:placed.assetStamp,editor:true}),{code:'CONFLICT'});
  await assert.rejects(contentBuffer(content),{code:'CONFLICT'});
 }finally{
  await closeIdleMutationFiles();assert.equal(path.dirname(temporary),os.tmpdir());assert.ok(path.basename(temporary).startsWith('website-version-'));
  await rm(temporary,{recursive:true,force:true,maxRetries:6,retryDelay:100});
 }
});

test('stored HTML admits only site-local resources and vetted scripts, even on nested pages',()=>{
 const html='<html><head><link rel="stylesheet" href="../styles.css"></head><body><button type="button">Open menu</button><img src="../assets/photo.png"><script src="../public-book.js"></script></body></html>';
 assert.doesNotThrow(()=>validateWebsiteHTML(html,{file:'entries/entry.html',scripts:new Set(['public-book.js'])}));
 for(const target of ['/api/media','../../secret.png','https://remote.invalid/pixel','javascript:alert(1)','//remote.invalid'])assert.throws(()=>validateWebsiteHTML(html.replace('../assets/photo.png',target),{file:'entries/entry.html',scripts:new Set(['public-book.js'])}),{code:'INVALID'});
 assert.throws(()=>validateWebsiteHTML('<button onclick="alert(1)">Open</button>'),{code:'INVALID'});assert.throws(()=>validateWebsiteHTML(html,{file:'entries/entry.html'}),{code:'INVALID'});
 for(const css of ['@import "https://remote.invalid/style"','body{background:url(/api/asset)}','body{background:image-set("https://remote.invalid/pixel" 1x)}'])assert.throws(()=>validateWebsiteCSS(css),{code:'INVALID'});
});
