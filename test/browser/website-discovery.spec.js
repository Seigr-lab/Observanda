import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../../src/model.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {pageInclusion} from '../../src/website-page-inclusion.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('a bilingual project publishes search and sharing declarations for its public pages without contacting the address',async({page})=>{
 test.setTimeout(150000);
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-discovery-')),out=path.join(dir,'Publication'),db=process.env.OBSERVANDA_DATABASE_URL;
 let app,fixture;
 try{
  await mkdir(out);fixture=await encryptedFixture(dir,createNotebook('Survey'));const id=randomUUID();
  const html=(title,lang)=>'<!doctype html><html lang="'+lang+'"><head><title>'+title+'</title><link rel="stylesheet" href="'+(lang==='ca'?'../':'')+'style.css"></head><body><main><h1>'+title+'</h1><p>Sampling stations.</p></main></body></html>';
  const store=new WebsiteFileStore(fixture.workspace);
  await store.importFiles(id,{name:'Estuary survey',files:new Map([['index.html',html('Estuary survey','en')],['ca/index.html',html('Estudi de l’estuari','ca')],['notes.html',html('Unpublished canary','en')],['style.css','main{max-width:40rem}']])});
  const opened=await store.open(id),privately={expectedRevision:opened.site.revision,path:'notes.html',inclusion:'private'};
  await pageInclusion(store,id,{...privately,reviewId:(await pageInclusion(store,id,privately,false)).reviewId},true);
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(dir,'preferences.json'),port:0});
  const errors=[],remote=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
  page.on('request',request=>{if(new URL(request.url()).hostname.endsWith('example.org'))remote.push(request.url());});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),tools=page.getByRole('navigation',{name:'Website'}),panel=page.locator('[data-website-discovery]');
  await expect(canvas.getByRole('heading',{name:'Estuary survey'})).toBeVisible();
  expect(opened.site.pages.length).toBe(3);

  await page.locator('[data-website-file-page]').selectOption('index.html');
  await expect(canvas.getByRole('heading',{name:'Estuary survey'})).toBeVisible();
  await tools.getByRole('button',{name:'Search and sharing',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'Search and sharing'})).toBeFocused();
  const address=panel.getByLabel('Public address');await address.fill('https://example.org/estuary');
  await panel.getByRole('button',{name:'Save settings'}).click();
  await expect(address).toHaveValue('https://example.org/estuary/');
  await expect(panel).toContainText('Search engines read robots.txt only at the root of a site');
  await panel.getByRole('button',{name:'Return to editing'}).click();

  // Link the Catalan page as a language version of the home page.
  await page.locator('[data-website-file-page]').selectOption('ca/index.html');
  await expect(canvas.getByRole('heading',{name:'Estudi de l’estuari'})).toBeVisible();
  await tools.getByRole('button',{name:'Search and sharing',exact:true}).click();
  await panel.getByLabel('Language version of').selectOption({label:'Estuary survey · index.html'});
  await panel.getByLabel('Translation status').selectOption('outdated');
  const link=panel.getByRole('button',{name:'Link language version'});await link.focus();await link.press('Enter');
  const group=panel.locator('.website-discovery-group li');await expect(group).toHaveCount(2);
  await expect(group.first()).toContainText('en · Original');await expect(group.last()).toContainText('ca · Needs update');
  await panel.getByRole('button',{name:'Return to editing'}).click();

  await tools.getByRole('button',{name:'Publish to folder',exact:true}).click();await page.getByLabel('Destination folder',{exact:true}).fill(out);
  await page.getByRole('button',{name:'Review file changes'}).click();await page.locator('[data-website-file-folder-confirm]').check();
  await page.getByRole('button',{name:'Write reviewed files'}).click();await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();

  const home=await readFile(path.join(out,'index.html'),'utf8'),catalan=await readFile(path.join(out,'ca','index.html'),'utf8');
  expect(home).toContain('<link rel="canonical" href="https://example.org/estuary/">');
  expect(home).toContain('<link rel="alternate" hreflang="ca" href="https://example.org/estuary/ca/">');
  expect(home).toContain('<link rel="alternate" hreflang="x-default" href="https://example.org/estuary/">');
  expect(catalan).toContain('<link rel="canonical" href="https://example.org/estuary/ca/">');
  expect(catalan).toContain('<meta property="og:locale" content="ca">');
  const sitemap=await readFile(path.join(out,'sitemap.xml'),'utf8');
  expect(sitemap).toContain('<loc>https://example.org/estuary/ca/</loc>');
  const names=await readdir(out);expect(names).not.toContain('robots.txt');expect(names).not.toContain('notes.html');
  expect(sitemap).not.toContain('notes.html');for(const name of names.filter(name=>/\.(?:html|xml|json)$/.test(name)))expect(await readFile(path.join(out,name),'utf8')).not.toContain('Unpublished canary');
  expect(remote).toEqual([]);expect(errors).toEqual([]);
 }finally{
  if(db===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=db;
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(dir,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
 }
});
