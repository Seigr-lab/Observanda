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

test('stored HTML admits only site-local resources and vetted scripts, even on nested pages',()=>{
 const html='<html><head><link rel="stylesheet" href="../styles.css"></head><body><button type="button">Open menu</button><img src="../assets/photo.png"><script src="../public-book.js"></script></body></html>';
 assert.doesNotThrow(()=>validateWebsiteHTML(html,{file:'entries/entry.html',scripts:new Set(['public-book.js'])}));
 for(const target of ['/api/media','../../secret.png','https://remote.invalid/pixel','javascript:alert(1)','//remote.invalid'])assert.throws(()=>validateWebsiteHTML(html.replace('../assets/photo.png',target),{file:'entries/entry.html',scripts:new Set(['public-book.js'])}),{code:'INVALID'});
 assert.throws(()=>validateWebsiteHTML('<button onclick="alert(1)">Open</button>'),{code:'INVALID'});assert.throws(()=>validateWebsiteHTML(html,{file:'entries/entry.html'}),{code:'INVALID'});
 for(const css of ['@import "https://remote.invalid/style"','body{background:url(/api/asset)}','body{background:image-set("https://remote.invalid/pixel" 1x)}'])assert.throws(()=>validateWebsiteCSS(css),{code:'INVALID'});
});
