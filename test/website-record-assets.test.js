import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {Workspace} from '../src/storage.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {setPlacementPresentation} from '../src/website-file-placements.js';

const asset=(label,type='image/png',ext='png')=>{const bytes=Buffer.from(label);return {path:'assets/'+createHash('sha256').update(bytes).digest('hex')+'.'+ext,bytes,contentType:type};};

test('a full copy that leaves parts out publishes only the files it still shows, with its stylesheet and fonts',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-record-assets-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{
  await closeIdleMutationFiles();if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('website-record-assets-'))throw Error('Unexpected fixture');
  await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:150});
 });
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace);
 workspace.openCatalogue=workspace.catalogue=()=>assert.fail('File editor contacted research');
 const sourceId=websiteSourceId({workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()}),site=randomUUID();
 await store.importFiles(site,{name:'Apiary',files:new Map([['index.html','<html><head><title>A</title></head><body><main><h1>A</h1></main></body></html>'],['style.css','']])});
 const photo=asset('frame photo'),plot=asset('<svg xmlns="http://www.w3.org/2000/svg"></svg>','image/svg+xml','svg'),font=asset('font bytes','font/woff2','woff2');
 const media=randomUUID(),figure=randomUUID();
 const html='<section data-observanda-part="title"><h2>Hive 4</h2></section><article class="record-page"><div data-observanda-part="body"><p>Text</p></div>'+
  '<figure id="record-figure-'+figure+'" data-observanda-part="figure:'+figure+'"><img src="'+plot.path+'" alt="Mites"></figure>'+
  '<div id="record-figure-'+media+'" data-observanda-part="media:'+media+'"><figure><img src="'+photo.path+'" alt="Frame"></figure></div></article>';
 const token=await store.beginSourceUpdate({sourceId});
 const source=await store.putSource({sourceId,title:'Hive 4',html,css:'@font-face{font-family:Reading;src:url('+font.path+')}',assets:[photo,plot,font]},{token});
 let page=await store.open(site);
 page=await store.insertSource(site,{expectedRevision:page.site.revision,path:'index.html',sourceId,sourceRevision:source.revision});
 const files=async()=>new Set((await store.scope(()=>store.raw(site))).files.map(f=>f.name));
 let names=await files();for(const a of [photo,plot,font])assert.ok(names.has(a.path),a.path);assert.ok(names.has('source-'+sourceId+'.css'));
 const pin=()=>({expectedRevision:page.site.revision,path:'index.html',sourceId,sourceRevision:source.revision,ordinal:0});
 page=await setPlacementPresentation(store,site,{...pin(),presentation:'full',hidden:['media']});
 names=await files();
 assert.ok(!names.has(photo.path),'hidden photograph still published');
 for(const name of [plot.path,font.path,'source-'+sourceId+'.css'])assert.ok(names.has(name),name);
 page=await setPlacementPresentation(store,site,{...pin(),presentation:'full',hidden:[]});
 assert.ok((await files()).has(photo.path));
});
