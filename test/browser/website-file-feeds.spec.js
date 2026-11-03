import {test,expect} from '@playwright/test';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore,websiteSourceId} from '../../src/website-file-store.js';
import {convertPublicationRecord} from '../../src/publication-conversion-render.js';
import {savedWebsiteSearches} from '../../src/website-saved-searches.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('authors design, filter, rearrange and publish automatic entry feeds while research storage is offline',async({page,browser})=>{
 test.setTimeout(240000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-entry-feeds-')),out=path.join(directory,'published'),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app,visitor;
 try{
  const book=sampleNotebook(),base=book.entries[2],notebook=book.notebooks[0];
  book.entries=Array.from({length:5},(_,i)=>({...structuredClone(base),id:randomUUID(),share:true,title:'Transect station '+(i+1),body:'Approved tide reading '+(i+1),tags:[i%2?'east':'west'],
   sections:[{id:randomUUID(),title:'Protected notes',body:'private-landowner-canary',share:false},{id:randomUUID(),title:'Public method',body:'Paired water samples.',share:true}]}));
  fixture=await encryptedFixture(directory,book);const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
  const captures=[];
  for(const entry of book.entries){
   const provenance={workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,recordId:entry.id},sourceId=websiteSourceId(provenance);
   const capture={sourceId,provenance,title:entry.title,...await convertPublicationRecord(fixture.workspace,book,entry)};
   captures.push(capture);if(captures.length<5)await store.putSource(capture,{token:await store.beginSourceUpdate({sourceId})});
  }
  await store.create({id,name:'Transect atlas',html:'<!doctype html><html><head><title>Transect atlas</title></head><body><main><h1>Transect atlas</h1><p>Original introduction.</p></main></body></html>'});
  const rule=await savedWebsiteSearches(store,'save',{siteId:id,id:randomUUID(),name:'Western stations',criteria:{tags:['west'],sort:'title-asc'}});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  await expect(fixture.workspace.catalogue(db=>db.head())).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE'});
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  const unexpected=[];page.on('request',r=>{const p=new URL(r.url()).pathname;if(p.startsWith('/api/')&&!p.startsWith('/api/website-files/')&&!['/api/session','/api/access/status','/api/interface','/api/language'].includes(p))unexpected.push(p);});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await page.locator('[data-website-file-site]').selectOption(id);
  const canvas=page.frameLocator('#website-files-canvas'),feed=canvas.locator('section[data-website-feed]'),dialog=page.locator('dialog[data-website-feed-dialog]');
  const add=async()=>{await page.locator('[data-website-file-block]').selectOption('feed');await page.getByRole('button',{name:'Insert element',exact:true}).click();await expect(dialog).toBeVisible();};
  const save=async()=>{await dialog.locator('[data-feed-apply]').click();await expect(dialog).not.toBeVisible({timeout:30000});};
  const edit=async(title,expected=title)=>{await feed.getByRole('heading',{name:title,exact:true}).click();await page.locator('[data-feed-context]').click();await expect(dialog.locator('[data-feed-heading]')).toHaveValue(expected);};
  await add();await expect(dialog.getByRole('radio',{name:'All eligible entries'})).toBeChecked();
  await expect(dialog.getByRole('radio',{name:'Full entry'})).toBeChecked();
  await dialog.locator('[data-feed-heading]').fill('All stations');await dialog.locator('[data-feed-page-size]').fill('2');
  await dialog.getByRole('radio',{name:'Grid',exact:true}).check();await save();
  const all=feed.filter({hasText:'All stations'});
  await expect(all).toContainText('Paired water samples.');await expect(all).not.toContainText('private-landowner-canary');
  expect(await all.locator('h2').first().evaluate(node=>node.isContentEditable)).toBe(false);
  await expect(all.locator('a[rel=next]')).toHaveCount(1);
  const customHTML='<article class="tide-plate">\n  <h3 data-feed-field="title"></h3>\n  <p data-feed-field="tags"></p>\n  <div data-feed-field="content"></div>\n</article>';
  await add();await dialog.locator('[data-feed-heading]').fill('Western stations');
  await dialog.getByRole('radio',{name:'Matching search',exact:true}).check();
  await dialog.locator('[data-feed-saved-search]').selectOption(rule.id);await dialog.getByRole('radio',{name:'Custom design',exact:true}).check();
  await dialog.getByText('Arrange fields',{exact:true}).click();await dialog.locator('[data-feed-field=tags]').check();
  await dialog.getByRole('button',{name:'Move up · Tags'}).click();await dialog.getByRole('button',{name:'Use this arrangement'}).click();
  await dialog.locator('.website-feed-custom summary').filter({hasText:'Item HTML'}).click();
  await expect(dialog.locator('[data-feed-item-html]')).toHaveValue(/data-feed-field="tags"/);
  await dialog.locator('[data-feed-item-html]').fill(customHTML);await dialog.locator('[data-feed-position]').selectOption('start');await save();
  await expect(feed).toHaveCount(2);const western=feed.filter({hasText:'Western stations'});
  await expect(feed.first()).toContainText('Western stations');await expect(western.locator('.tide-plate')).toHaveCount(2);
  await expect(western).not.toContainText('Transect station 2');await expect(western).not.toContainText('private-landowner-canary');
  await page.reload();await edit('Western stations');await dialog.locator('.website-feed-custom summary').filter({hasText:'Item HTML'}).click();
  await expect(dialog.locator('[data-feed-item-html]')).toHaveValue(customHTML);
  await dialog.getByRole('radio',{name:'Grid',exact:true}).check();await dialog.locator('[data-feed-position]').selectOption('end');await save();
  await expect(feed.last()).toContainText('Western stations');await expect(western).toHaveAttribute('data-layout','grid');
  // A new eligible composition joins the existing filtered feed without an
  // individual placement or an editor operation. Withdrawing a source removes it.
  await edit('Western stations');await dialog.locator('[data-feed-heading]').fill('Unfinished heading');
  const newest=captures[4];await store.putSource(newest,{token:await store.beginSourceUpdate({sourceId:newest.sourceId})});
  await expect(dialog).not.toBeVisible({timeout:30000});
  await expect(western.locator('.tide-plate')).toHaveCount(3,{timeout:30000});
  page.once('dialog',d=>d.accept());await edit('Western stations','Unfinished heading');
  await dialog.locator('[data-feed-heading]').fill('Western stations');await save();
  const removed=captures[0];await store.putSource({...removed,visible:false,html:'',assets:[]},{token:await store.beginSourceUpdate({sourceId:removed.sourceId})});
  await expect(western.locator('.tide-plate')).toHaveCount(2,{timeout:30000});await expect(western).toContainText('Transect station 5');
  await expect(western).not.toContainText('Transect station 1');
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const preview=page.frameLocator('#website-files-preview');await expect(preview.locator('.tide-plate')).toHaveCount(2);
  const more=await preview.locator('section[data-website-feed] a[rel=next]').first().getAttribute('href');
  await mkdir(out);await page.getByRole('button',{name:'Publish to folder',exact:true}).click();
  await page.getByLabel('Destination folder',{exact:true}).fill(out);await page.getByRole('button',{name:'Review file changes'}).click();
  await page.locator('[data-website-file-folder-confirm]').check();await page.getByRole('button',{name:'Write reviewed files'}).click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:60000});
  visitor=await browser.newPage();await visitor.goto(pathToFileURL(path.join(out,'index.html')).href);
  await expect(visitor.locator('.tide-plate')).toHaveCount(2);await visitor.locator('a[rel=next]').first().click();await expect(visitor.locator('section[data-website-feed]')).toBeVisible();
  const published=await readFile(path.join(out,'index.html'),'utf8'),continuation=await readFile(path.join(out,more.split('#')[0]),'utf8');
  expect(published+continuation).not.toMatch(/private-landowner-canary|Transect station 1/);
  await page.reload();await edit('Western stations');page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Remove feed',exact:true}).click();
  await expect(feed).toHaveCount(1);await expect(feed.first()).toContainText('All stations');expect(unexpected).toEqual([]);
 }finally{
  try{await visitor?.close();await app?.close();if(fixture)await clearVault(fixture.vault);}finally{if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;}
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-website-entry-feeds-'))throw Error('Unexpected fixture directory');
  await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:120});
 }
});
