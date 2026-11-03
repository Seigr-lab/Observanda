import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {websiteThemes} from '../src/website-scoped-themes.js';
import {saveWebsiteFeed} from '../src/website-dynamic-feeds.js';
import {contentBuffer} from '../src/file-content.js';

test('a folder theme follows new feed pages, selected sections override it and private themes stay out of publication',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'website-theme-atlas-'));await mkdir(path.join(dir,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(dir,{recursive:true,force:true,maxRetries:12,retryDelay:150});});
 const workspace=new Workspace(dir,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),id=randomUUID();
 workspace.catalogue=workspace.openCatalogue=()=>assert.fail('Theme editor read research');
 const html=title=>'<!doctype html><html lang="en"><head><title>'+title+'</title></head><body><main><section><h1>'+title+'</h1></section></main></body></html>';
 const methods='atlas/depths.html',privatePage='drafts/unreleased.html';
 await store.importFiles(id,{name:'Ocean survey',files:new Map([['index.html',html('Home')],[methods,html('Depth profiles')],['atlas/core/samples.html',html('Core samples')],['style.css','p{margin:.8rem}']]),draftFiles:new Map([[privatePage,html('Private')],['draft-styles.css','']])});
 const change=async(options,page=methods)=>websiteThemes(store,id,{path:page,expectedRevision:await store.siteVersion(id),...options},true);
 const palette=await change({action:'create',name:'Ocean atlas',values:{background:'#083a49',heading:'serif'},scope:'folder'});
 assert.match(palette.html,new RegExp('<body data-website-page-theme="'+palette.themeId+'"'));
 const section=await change({action:'create',name:'Deep-sea observations',values:{accent:'#88aa99'},scope:'section',blockPath:'0/0'});
 assert.match(section.html,new RegExp('<section data-website-theme="'+section.themeId+'"'));
 const secret=await change({action:'create',name:'Unreleased scheme',values:{text:'#884466'},scope:'page'},privatePage);
 for(const name of ['One','Two']){
  const provenance={workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()},sourceId=websiteSourceId(provenance);
  await store.putSource({sourceId,provenance,title:name,html:'<p>'+name+'</p>'},{token:await store.beginSourceUpdate({sourceId,target:'website',provenance})});
 }
 const feed=await saveWebsiteFeed(store,id,{expectedRevision:await store.siteVersion(id),path:methods,heading:'Stations',pageSize:1});
 const next=feed.site.feedPages[0].path,exported=await store.export(id),text=async name=>(await contentBuffer(exported.files.get(name))).toString();
 for(const p of [methods,'atlas/core/samples.html',next])assert.match(await text(p),new RegExp('data-website-page-theme="'+palette.themeId+'"'));
 assert.doesNotMatch(await text('index.html'),/data-website-theme/);
 assert.ok(!exported.files.has('website-themes/'+secret.themeId+'.css'));
 const update=await change({action:'design',themeId:palette.themeId,name:'Ocean atlas',values:{background:'#0a5c58'}});
 assert.equal((await store.open(id,{path:methods})).html,update.html);
 await assert.rejects(websiteThemes(store,id,{action:'apply',themeId:palette.themeId,scope:'page',path:methods,expectedRevision:palette.site.revision},true),{code:'CONFLICT'});
 await change({action:'remove',themeId:section.themeId});assert.doesNotMatch((await store.open(id,{path:methods})).html,new RegExp(section.themeId));
 await change({action:'apply',scope:'folder',themeId:null});assert.doesNotMatch((await store.open(id,{path:methods})).html,new RegExp(palette.themeId));
});
