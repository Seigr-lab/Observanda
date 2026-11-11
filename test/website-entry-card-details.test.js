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
import {readableDay} from '../src/website-record-language.js';
import {attr,descendants} from '../src/website-migration-views.js';

async function fixture(t,prefix){
 const root=await mkdtemp(path.join(os.tmpdir(),prefix));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{
  await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith(prefix))throw Error('Unexpected fixture');
  await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:150});
 });
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace);
 workspace.openCatalogue=workspace.catalogue=()=>assert.fail('File editor contacted research');
 return {workspace,store};
}
const png=label=>{const bytes=Buffer.from(label),name='assets/'+createHash('sha256').update(bytes).digest('hex')+'.png';return {path:name,bytes,contentType:'image/png'};};
const photo=randomUUID(),other=randomUUID();
function fragment(cover,second,{date='2026-05-02'}={}){
 return '<section data-observanda-part="title"><h2>Hive 4 inspection</h2></section><article class="record-page">'+
  '<div class="entry-meta" data-observanda-part="metadata"><span>observation</span><time datetime="'+date+'">'+date+'</time><span>completed</span></div>'+
  '<div class="prose rich-document" data-observanda-part="body"><p>Brood frames inspected.</p></div>'+
  (cover?'<div id="record-figure-'+photo+'" data-observanda-part="media:'+photo+'"><figure class="media-figure"><img src="'+cover.path+'" alt="Capped brood frame" width="1200" height="800"><figcaption>Capped brood</figcaption></figure></div>':'')+
  '<div id="record-figure-'+other+'" data-observanda-part="media:'+other+'"><figure class="media-figure"><img src="'+second.path+'" alt="Entrance"><figcaption>Hive entrance</figcaption></figure></div></article>';
}

test('a card copy can show one of the entry\'s photographs and its date, chosen in the presentation dialog',async t=>{
 const {workspace,store}=await fixture(t,'website-entry-card-details-');
 const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()}),site=randomUUID();
 const html='<html lang="es"><head><title>Colmenar</title></head><body><main><h1>Colmenar</h1></main></body></html>';
 await store.importFiles(site,{name:'Colmenar',files:new Map([['index.html',html],['notes/index.html',html],['style.css','']])});
 const cover=png('Capped brood frame bytes'),second=png('Entrance bytes');
 let source;
 async function publish(withCover=true){const token=await store.beginSourceUpdate({sourceId});source=await store.putSource({sourceId,title:'Hive 4 inspection',html:fragment(withCover?cover:null,second),assets:withCover?[cover,second]:[second]},{token});}
 await publish();let page=await store.open(site,{path:'notes/index.html'});
 page=await store.insertSource(site,{expectedRevision:page.site.revision,path:'notes/index.html',sourceId,sourceRevision:source.revision,presentation:'card'});
 const pin=()=>({expectedRevision:page.site.revision,path:'notes/index.html',sourceId,sourceRevision:source.revision,ordinal:0});
 page=await setPlacementPresentation(store,site,{...pin(),presentation:'card',choice:'title'});
 const options=await placementPresentationOptions(store,site,pin());
 assert.deepEqual(options.card,{covers:[{key:'media:'+photo,label:'Capped brood'},{key:'media:'+other,label:'Hive entrance'}],date:true,cover:null,showDate:false});
 await assert.rejects(setPlacementPresentation(store,site,{...pin(),presentation:'card',choice:'title',cover:'media:'+randomUUID()}),{code:'NOT_FOUND'});
 await assert.rejects(async()=>setPlacementPresentation(store,site,{...pin(),presentation:'full',date:true}),{code:'INVALID'});
 page=await setPlacementPresentation(store,site,{...pin(),presentation:'card',choice:'body',cover:'media:'+photo,date:true});
 const card=[...descendants(parse(page.html))].find(n=>attr(n,'data-observanda-source')===sourceId);
 const image=[...descendants(card)].find(n=>n.tagName==='img');
 assert.equal(attr(image,'class'),'website-entry-cover');assert.equal(attr(image,'src'),'../'+cover.path);assert.equal(attr(image,'alt'),'Capped brood frame');
 assert.match(page.html,new RegExp('<time datetime="2026-05-02" data-observanda-term="date">'+readableDay('2026-05-02','es')+'</time>'));
 assert.match(page.html,/Brood frames inspected/);
 const manifest=await store.scope(()=>store.raw(site));
 assert.ok(manifest.files.some(f=>f.name===cover.path));assert.ok(!manifest.files.some(f=>f.name===second.path));
 assert.deepEqual((await placementPresentationOptions(store,site,pin())).card,{covers:[{key:'media:'+photo,label:'Capped brood'},{key:'media:'+other,label:'Hive entrance'}],date:true,cover:'media:'+photo,showDate:true});
 // Withdrawing the photograph leaves a card without a cover; nothing breaks.
 await publish(false);page=await store.open(site,{path:'notes/index.html'});
 assert.doesNotMatch(page.html,/website-entry-cover/);assert.match(page.html,/data-observanda-term="date"/);
 assert.ok(!(await store.scope(()=>store.raw(site))).files.some(f=>f.name===cover.path));
});
