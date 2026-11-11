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
import {placementPresentationOptions,setPlacementPresentation} from '../src/website-file-placements.js';
import {presentRecordParts,recordPartGroups,recordPresentation,validRecordPresentation} from '../src/website-entry-display.js';
import {entryCSS,entryStyleName,styledPageHTML} from '../src/website-entry-styles.js';
import {validateWebsiteCSS} from '../src/website-file-policy.js';
import {attr,descendants} from '../src/website-migration-views.js';

const section=randomUUID(),figure=randomUUID(),photo=randomUUID();
function fragment({body='Brood frames inspected.',tags=['varroa']}={}){
 return '<section data-observanda-part="title"><h2>Hive 4 inspection</h2></section><article class="record-page">'+
  '<div class="entry-meta" data-observanda-part="metadata"><span>observation</span><time datetime="2026-05-02">2026-05-02</time><span>completed</span></div>'+
  '<p data-observanda-part="outcome"><strong data-observanda-label="websiteRecordText:outcome">Outcome</strong>: Queen present</p>'+
  '<div class="prose rich-document" data-observanda-part="body"><p>'+body+'</p></div>'+
  '<section id="record-section-'+section+'" data-observanda-part="section:'+section+'"><h2>Mite count</h2><p>Three mites per hundred bees.</p></section>'+
  '<figure id="record-figure-'+figure+'" data-observanda-part="figure:'+figure+'"><figcaption>Mite trend</figcaption></figure>'+
  '<div id="record-figure-'+photo+'" data-observanda-part="media:'+photo+'"><figure class="media-figure"><figcaption>Frame photo</figcaption></figure></div>'+
  (tags.length?'<ul class="tags" aria-label="Tags" data-observanda-part="tags">'+tags.map(t=>'<li>'+t+'</li>').join('')+'</ul>':'')+'</article>';
}
const parts=html=>[...descendants(parse(html))].map(n=>attr(n,'data-observanda-part')).filter(Boolean);

test('record parts are grouped in converter order and can be left out and shown again',()=>{
 const source=fragment();
 assert.deepEqual(recordPartGroups(source),['title','details','outcome','body','sections','figures','media','tags']);
 const hidden=presentRecordParts(source,source,['tags','figures','details']);
 assert.deepEqual(parts(hidden),['title','outcome','body','section:'+section,'media:'+photo]);
 assert.match(hidden,/^<section data-observanda-part="title">.*<article class="record-page">.*<\/article>$/s);
 // A part already on the page keeps its saved markup; one shown again comes from the source.
 const saved=hidden.replace('Queen present','Queen present and marked');
 const shown=presentRecordParts(saved,fragment({tags:['varroa','spring']}),['figures']);
 assert.match(shown,/Queen present and marked/);assert.match(shown,/<li>spring<\/li>/);assert.match(shown,/data-observanda-part="metadata"/);
 assert.deepEqual(parts(shown),['title','metadata','outcome','body','section:'+section,'media:'+photo,'tags']);
 assert.ok(validRecordPresentation({hidden:['tags'],layout:'split'}));
 for(const value of [{hidden:['secret']},{hidden:['tags','tags']},{layout:'wide'},{hidden:'tags'}])assert.equal(validRecordPresentation(value),false);
});

test('a record layout links the managed display sheet, whose rules use the site tokens only',()=>{
 const page='<!doctype html><html><head><title>T</title></head><body><main><section data-observanda-source="'+'a'.repeat(64)+'" data-observanda-source-revision="'+'b'.repeat(64)+'" data-observanda-layout="split"></section></main></body></html>';
 const styled=styledPageHTML(page,'notes/index.html');
 assert.equal(styled.used,true);assert.match(styled.html,new RegExp('href="../'+entryStyleName+'"'));
 assert.equal(styledPageHTML(page.replace(' data-observanda-layout="split"',''),'index.html').used,false);
 validateWebsiteCSS(entryCSS);
 assert.doesNotMatch(entryCSS,/url\(|@import|#[0-9a-f]{3,6}\b/i);
 for(const layout of ['plain','compact','split'])assert.match(entryCSS,new RegExp('\\[data-observanda-layout="'+layout+'"\\]'));
 assert.match(entryCSS,/@media \(min-width:64rem\)\{\s*\[data-observanda-layout="split"\]/);
});

test('a full copy keeps its chosen parts and layout through source updates and can be restored',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-record-presentation-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{
  await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('website-record-presentation-'))throw Error('Unexpected fixture');
  await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:150});
 });
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace);
 workspace.openCatalogue=workspace.catalogue=()=>assert.fail('File editor contacted research');
 const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()}),site=randomUUID();
 const html='<html lang="ca"><head><title>Apiari</title></head><body><main><h1>Apiari</h1></main></body></html>';
 await store.importFiles(site,{name:'Apiari',files:new Map([['index.html',html],['style.css','']])});
 const image=Buffer.from('Frame photo bytes'),asset={path:'assets/'+createHash('sha256').update(image).digest('hex')+'.png',bytes:image,contentType:'image/png'};
 let source;
 async function publish(options){const token=await store.beginSourceUpdate({sourceId});source=await store.putSource({sourceId,title:'Hive 4 inspection',html:fragment(options),assets:[asset]},{token});}
 await publish();let page=await store.open(site);
 page=await store.insertSource(site,{expectedRevision:page.site.revision,path:'index.html',sourceId,sourceRevision:source.revision});
 const pin=()=>({expectedRevision:page.site.revision,path:'index.html',sourceId,sourceRevision:source.revision,ordinal:0});
 const before=await placementPresentationOptions(store,site,pin());
 assert.deepEqual(before.record,{groups:['title','details','outcome','body','sections','figures','media','tags'],hidden:[],layout:'article'});
 await assert.rejects(setPlacementPresentation(store,site,{...pin(),presentation:'full',hidden:['title','details','outcome','body','sections','figures','media','tags']}),{code:'INVALID'});
 await assert.rejects(async()=>setPlacementPresentation(store,site,{...pin(),presentation:'card',choice:'title',hidden:['tags']}),{code:'INVALID'});
 page=await setPlacementPresentation(store,site,{...pin(),presentation:'full',hidden:['tags','details'],layout:'split'});
 const copy=()=>[...descendants(parse(page.html))].find(n=>attr(n,'data-observanda-source')===sourceId);
 assert.deepEqual(recordPresentation(copy()),{hidden:['details','tags'],layout:'split'});
 assert.doesNotMatch(page.html,/<li>varroa<\/li>|data-observanda-part="metadata"/);assert.match(page.html,/Three mites per hundred bees/);
 assert.match(page.html,new RegExp('<link rel="stylesheet" href="'+entryStyleName+'"'));assert.match(page.html,new RegExp('source-'+sourceId+'.css'));
 // The page language labels the copy (src/website-record-language.js).
 assert.match(page.html,/>Resultat<\/strong>: Queen present/);
 assert.deepEqual((await placementPresentationOptions(store,site,pin())).record,{groups:['title','details','outcome','body','sections','figures','media','tags'],hidden:['details','tags'],layout:'split'});
 // A source update changes the shown parts and never brings the hidden ones back.
 await publish({body:'Brood frames inspected again.',tags:['varroa','swarm cells']});page=await store.open(site);
 assert.match(page.html,/Brood frames inspected again/);assert.doesNotMatch(page.html,/swarm cells|data-observanda-part="metadata"/);
 assert.deepEqual(recordPresentation(copy()),{hidden:['details','tags'],layout:'split'});
 // Hand edits cannot change the protected choices.
 await assert.rejects(store.save(site,{...page,expectedRevision:page.site.revision,html:page.html.replace(' data-observanda-layout="split"','')}),{code:'CONFLICT'});
 page=await setPlacementPresentation(store,site,{...pin(),presentation:'full',hidden:[],layout:'article'});
 assert.match(page.html,/<li>swarm cells<\/li>/);assert.match(page.html,/data-observanda-part="metadata"/);
 assert.equal(attr(copy(),'data-observanda-layout'),undefined);assert.equal(attr(copy(),'data-observanda-hide'),undefined);
 assert.ok(!page.html.includes(entryStyleName));
 // A card copy can return to a presented full copy.
 page=await setPlacementPresentation(store,site,{...pin(),presentation:'card',choice:'title'});
 page=await setPlacementPresentation(store,site,{...pin(),presentation:'full',hidden:['media'],layout:'plain'});
 assert.deepEqual(recordPresentation(copy()),{hidden:['media'],layout:'plain'});assert.doesNotMatch(page.html,/Frame photo/);assert.match(page.html,/Mite trend/);
});
