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
  const exported=await store.export(id,{expectedRevision:authored.site.revision});let published='';for await(const part of exported.files.get('index.html').stream())published+=part;assert.equal(published,authored.html);
  await assert.rejects(store.save(id,{expectedRevision:authored.site.revision,path:'index.html',html:authored.html.replace('data-observanda-source=','data-old-source='),css:authored.css}),{code:'CONFLICT'});
  const abandoned=await store.beginSourceUpdate({sourceId}),update=await store.beginSourceUpdate({sourceId});await assert.rejects(store.open(id),{code:'CONFLICT'});
  await assert.rejects(store.cancelSourceUpdate({sourceId,token:abandoned}),{code:'CONFLICT'});await assert.rejects(store.cancelSourceUpdate({sourceId,token:update}),{code:'CONFLICT'});
  await store.putSource({sourceId,title:'Observation',html:publicPart+newPart},{token:update});const reopened=await store.open(id);assert.match(reopened.html,/Website wording/);assert.match(reopened.html,/Released method/);assert.equal(reopened.css,'body{color:navy}');
  await assert.rejects(store.export(id,{expectedRevision:authored.site.revision}),{code:'CONFLICT'});await assert.rejects(store.file(id,assetPath),{code:'NOT_FOUND'});
  const withdraw=await store.beginSourceUpdate({sourceId});await store.putSource({sourceId,title:'Observation',visible:false},{token:withdraw});const privatePage=await store.open(id);assert.doesNotMatch(privatePage.html,/Released method|Website wording/);assert.match(privatePage.html,/data-observanda-source=/);
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
  const edit=await writer.beginSourceUpdate({sourceId:websiteId,target:'website'});
  await assert.rejects(reader.siteVersion(id),{code:'CONFLICT'});
  await writer.cancelSourceUpdate({sourceId:websiteId,token:edit});
  assert.equal(await reader.siteVersion(id),placed.site.revision);assert.equal(await reader.pdfVersion(),settled);
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
