import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {saveWebsiteFeed} from '../../src/website-dynamic-feeds.js';
import {starterStyles} from '../../src/web/website-file-starter.js';
import {WebsiteFilesCandidate} from '../../src/website-files-candidate.js';
import {LocalExport} from '../../src/local-export.js';
import {websitePublicationMetadata} from '../../src/website-publication-metadata.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {contentBuffer} from '../../src/file-content.js';
import {mountFilesEditor} from './mount-files-editor.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('site appearance previews and publishes shared scientific pages while raw and private styles stay independently owned',async({page,browser})=>{
 test.setTimeout(120000);page.setDefaultTimeout(12000);const dir=await mkdtemp(path.join(os.tmpdir(),'website-appearance-')),root=path.join(dir,'workspace'),out=path.join(dir,'publication');
 await mkdir(path.join(root,'.observanda'),{recursive:true});await mkdir(out);let visitor;
 try{
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),id=randomUUID();
  workspace.catalogue=workspace.openCatalogue=()=>{throw Error('Appearance opened research storage');};
  const method='reports/method.html',draft='draft/working.html',publicCSS=starterStyles+'\n/* Keep these raw author rules. */\n#station{color:rgb(104,36,89)}',privateCSS='/* PRIVATE_DESIGN_TOKEN */ body{--local-notebook:"PRIVATE_DESIGN_TOKEN"}',imported='p.note{margin:23px}';
  const html=(title,css,body)=>'<!doctype html><html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="'+css+'"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';
  await store.importFiles(id,{name:'Coastal measurements',files:new Map([['index.html',html('Coastal measurements','style.css','<p id="station">Station 11</p>')],[method,html('Salinity method','../website-appearance.css','<table><caption>Estuary readings</caption><tr><td>23</td></tr></table>')],['style.css',publicCSS],['website-appearance.css',imported]]),draftFiles:new Map([[draft,html('Private notebook','../draft-styles.css','<p>Private field technique</p>')],['draft-styles.css',privateCSS]])});
  for(const title of ['First transect','Second transect']){
   const provenance={workspaceId:workspace.vault.id,notebookId:randomUUID(),recordId:randomUUID()},sourceId=websiteSourceId(provenance);
   await store.putSource({sourceId,provenance,title,html:'<section data-observanda-part="body"><p>'+title+'</p></section>'},{token:await store.beginSourceUpdate({sourceId,target:'website',provenance})});
  }
  const feed=await saveWebsiteFeed(store,id,{expectedRevision:await store.siteVersion(id),path:method,heading:'Field entries',pageSize:1});const continuation=feed.site.feedPages[0].path;
  const call=async(route,data)=>{let result;await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace,url:new URL(route,'https://website.test'),body:async()=>data??{},json:r=>{result=r;},check:async()=>{},title:'Coastal measurements',preparation:async()=>({state:'ready',defaultSiteId:id})});return result;};
  await page.exposeFunction('filesAPI',call);await mountFilesEditor(page);
  await page.route('https://website.test/api/website-files/preview/**',async route=>{
   const url=new URL(route.request().url());if(url.searchParams.has('canvas'))return route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'});
   const [,revision,name]=url.pathname.match(/\/preview\/[^/]+\/([a-f0-9]{64})\/(.+)$/),file=await store.file(id,name,{revision,editor:true});
   return route.fulfill({contentType:file.contentType,body:file.bytes??await contentBuffer(file.content)});
  });
  const openTool=()=>page.getByRole('button',{name:'Site appearance',exact:true}).press('Enter');await openTool();
  const dialog=page.getByRole('dialog',{name:'Site appearance'}),preview=dialog.frameLocator('iframe'),apply=dialog.getByRole('button',{name:'Apply to website'});
  await expect(preview.getByRole('heading',{name:'Coastal measurements'})).toBeVisible();await expect(apply).toBeDisabled();
  await dialog.getByRole('combobox',{name:'Palette',exact:true}).selectOption('night');await dialog.getByLabel('Links and accents · HEX',{exact:true}).fill('#ffb366');
  await dialog.getByRole('combobox',{name:'Body font',exact:true}).selectOption('mono');await dialog.getByRole('combobox',{name:'Heading font',exact:true}).selectOption('serif');
  await expect(preview.locator('body')).toHaveCSS('background-color','rgb(24, 35, 44)');await expect(preview.locator('body')).toHaveCSS('font-family',/monospace/);
  await expect(preview.locator('#station')).toHaveCSS('color','rgb(104, 36, 89)');
  await apply.press('Enter');await expect(dialog).not.toBeVisible();
  await page.locator('[data-website-file-page]').selectOption(draft);await expect(page.frameLocator('#website-files-canvas').getByRole('heading',{name:'Private notebook'})).toBeVisible();
  await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('New method');await page.getByLabel('Page file name').fill('studies/new-method.html');await page.getByRole('button',{name:'Add page',exact:true}).click();
  await expect(page.locator('[data-website-file-page]')).toHaveValue('studies/new-method.html');await openTool();await expect(dialog.getByRole('combobox',{name:'Body font',exact:true})).toHaveValue('mono');await dialog.getByRole('button',{name:'Cancel'}).click();
  const manifest=await store.scope(()=>store.raw(id));const sheet=manifest.appearance.file;expect(sheet).toBe('website-appearance-2.css');
  for(const name of ['index.html',method,draft,'studies/new-method.html',continuation]){
   const file=manifest.files.find(f=>f.name===name),body=await store.scope(()=>store.readText(file));expect(body).toContain('href="'+path.posix.relative(path.posix.dirname(name),sheet)+'"');expect(body.match(/data-website-appearance=/g)).toHaveLength(1);
  }
  for(const [name,css] of [['style.css',publicCSS],['draft-styles.css',privateCSS],['website-appearance.css',imported]])expect(await store.scope(()=>store.readText(manifest.files.find(f=>f.name===name)))).toBe(css);
  const candidate=await WebsiteFilesCandidate.open(store,id,manifest.revision,{blockedValues:['PRIVATE_DESIGN_TOKEN','Private field technique']});await candidate.verify({});
  const exporter=new LocalExport(websitePublicationMetadata(store.publicationWorkspace(id)),{fileOwner:{locked:(_dir,work)=>store.withSite(id,manifest.revision,work),candidate:async()=>candidate}});
  const plan=await exporter.plan({reviewId:candidate.reviewId,directory:out});await exporter.apply({id:plan.id,reviewed:true});
  await expect(readFile(path.join(out,draft))).rejects.toMatchObject({code:'ENOENT'});await expect(readFile(path.join(out,'draft-styles.css'))).rejects.toMatchObject({code:'ENOENT'});
  visitor=await browser.newPage();for(const name of [method,'studies/new-method.html',continuation]){
   await visitor.goto(pathToFileURL(path.join(out,name)).href);await expect(visitor.locator('body'),name).toHaveCSS('background-color','rgb(24, 35, 44)');await expect(visitor.locator('body'),name).toHaveCSS('font-family',/monospace/);await expect(visitor.locator('h1,h2').first(),name).toHaveCSS('font-family',/Georgia/);
  }
  await openTool();await dialog.getByRole('button',{name:'Use the original site styles'}).click();await apply.click();await expect(dialog).not.toBeVisible();
  const restored=await store.scope(()=>store.raw(id));expect(restored.appearance).toBeUndefined();expect(restored.files.some(f=>f.name===sheet)).toBe(false);expect((await store.open(id,{path:method})).html).not.toContain('data-website-appearance');
 }finally{await visitor?.close();await closeIdleMutationFiles();await rm(dir,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
});
