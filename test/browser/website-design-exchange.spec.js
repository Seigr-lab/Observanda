import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {randomUUID,randomBytes} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {componentOperation} from '../../src/website-component-storage.js';
import {regionOperation} from '../../src/website-region-storage.js';
import {websiteThemes} from '../../src/website-scoped-themes.js';
import {websitePageDesigns} from '../../src/website-page-designs.js';
import {safeError} from '../../src/errors.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('a site design is exported as a package and imported into another site after a review',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'website-design-exchange-'));await mkdir(path.join(directory,'.observanda'));
 const workspace=new Workspace(directory,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace);
 workspace.catalogue=workspace.openCatalogue=()=>{throw Error('Design exchange opened research storage');};
 const doc=(title,body)=>'<html lang="en"><head><title>'+title+'</title><link rel="stylesheet" href="style.css"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';
 let origin,defaultSiteId;
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,origin),json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  const body=async()=>{const chunks=[];for await(const part of req)chunks.push(part);return JSON.parse(Buffer.concat(chunks).toString()||'{}');};
  try{
   // The application issues a one-time download address; this harness returns the address itself.
   if(url.pathname==='/api/session/download'){const data=await body();return json({url:data.url});}
   if(!await websiteFilesHttp(req,res,{workspace,url,body,json,check:async()=>{},title:'Apiary',preparation:async()=>({state:'ready',defaultSiteId})})){res.statusCode=404;res.end();}
  }catch(error){if(!res.headersSent){res.statusCode=422;json(safeError(error));}else res.destroy();}
 });
 try{
  // The source site: a component shown as the site footer, a section theme and a named page design.
  const source=randomUUID();
  let state=await store.importFiles(source,{name:'Apiary',files:new Map([['style.css','body{font:18px sans-serif}'],['index.html',doc('Hives','<section><p>Hive notes</p></section><aside><p>Apiary legend</p></aside>')]])});
  state=await componentOperation(store,'create',source,{expectedRevision:state.site.revision,blockPath:'0/2',name:'Legend'});
  const legend=(await store.scope(()=>store.raw(source))).components[0].id;
  state=await regionOperation(store,'assign',source,{expectedRevision:state.site.revision,slot:'footer',component:legend});
  state=await websiteThemes(store,source,{path:'index.html',expectedRevision:state.site.revision,action:'create',scope:'section',blockPath:'0/1',name:'Hive accent',values:{accent:'#124955'}},true);
  state=await websitePageDesigns(store,source,{expectedRevision:state.site.revision,action:'name',path:'index.html',name:'Hive page'});
  const target=randomUUID();await store.create({id:target,name:'Orchard'});
  defaultSiteId=source;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  await mountFilesEditor(page,{httpOrigin:origin});
  await expect(page.frameLocator('#website-files-canvas').getByRole('heading',{name:'Hives'})).toBeVisible();

  // Export from the site design tools.
  await page.getByRole('button',{name:'Export or import design',exact:true}).click();
  const panel=page.locator('.website-files-design-exchange');
  await expect(panel.getByRole('heading',{name:'Export or import design'})).toBeVisible();
  const downloading=page.waitForEvent('download');
  await panel.getByRole('button',{name:'Export design',exact:true}).click();
  const download=await downloading;expect(download.suggestedFilename()).toBe('Apiary.observanda-design');
  const saved=path.join(directory,'apiary.observanda-design');await download.saveAs(saved);
  expect((await readFile(saved)).subarray(0,2).toString()).toBe('PK');
  await panel.getByRole('button',{name:'Return to editing'}).click();

  // Import into the other site, choosing the footer region.
  await page.locator('[data-website-file-site]').first().selectOption({label:'Orchard'});
  await expect(page.frameLocator('#website-files-canvas').getByRole('heading',{name:'Orchard'})).toBeVisible();
  await page.getByRole('button',{name:'Export or import design',exact:true}).click();
  await panel.getByLabel('Design package').setInputFiles(saved);
  await panel.getByRole('button',{name:'Review import',exact:true}).click();
  const review=panel.getByRole('region',{name:'Review import'});
  await expect(review.getByRole('heading',{name:'Design from Apiary'})).toBeVisible();
  for(const row of ['Theme: Hive accent','Component: Legend','Page design: Hive page'])await expect(review.getByText(row,{exact:true})).toBeVisible();
  await review.getByRole('checkbox',{name:'Show Legend as the site Footer'}).check();
  await review.getByRole('button',{name:'Import design',exact:true}).click();
  await expect(panel.getByRole('status')).toHaveText('The design was imported.');
  const site=await store.scope(()=>store.raw(target));
  expect(site.components.map(c=>c.name)).toEqual(['Legend']);
  expect(site.themeBook.items.map(t=>t.name)).toEqual(['Hive accent']);
  expect(site.pageDesigns.map(d=>d.name)).toEqual(['Hive page']);
  expect((await store.open(target)).html).toMatch(/<footer data-website-region="footer"><aside data-website-instance="[^"]+"><p>Apiary legend<\/p><\/aside><\/footer>/);
 }finally{await page.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await closeIdleMutationFiles();await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
});
