import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {seedWebsitePickerCorpus} from '../helpers/website-picker-corpus.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('a reviewed batch creates title cards or full entries in order in one offline website write',async({page})=>{
 test.setTimeout(150000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-batch-presentations-')),book=sampleNotebook();
 const database=process.env.OBSERVANDA_DATABASE_URL;book.entries=[];let app,fixture;
 try{
  fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();await seedWebsitePickerCorpus(store,{count:36});
  const html=title=>'<!doctype html><html><head><title>'+title+'</title></head><body><main><h1>'+title+'</h1><p>Field results</p></main></body></html>';
  await store.importFiles(id,{name:'Shoreline survey',files:new Map([['index.html',html('Site overview')],['reports.html',html('Full reports')],['style.css','']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';
  await expect(fixture.workspace.catalogue(db=>db.head())).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE'});
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  const writes=[],unexpected=[];page.on('request',r=>{
   const route=new URL(r.url()).pathname;if(route.endsWith('/insert-sources')||route.endsWith('/insert-source')||route.endsWith('/present-placement'))writes.push({route,body:r.postDataJSON()});
   if(route==='/api/storage'||route.includes('/research/'))unexpected.push(route);
  });
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await page.locator('[data-website-file-site]').selectOption(id);
  const picker=page.locator('dialog[data-website-picker-dialog]'),canvas=page.frameLocator('#website-files-canvas');
  const browse=async()=>{await page.locator('[data-action="website-files-picker-open"]').click();await expect(picker.locator('[data-picker-row]')).toHaveCount(12);};
  const idsOnPage=()=>picker.locator('[data-picker-row]').evaluateAll(nodes=>nodes.map(row=>row.dataset.pickerRow));
  const add=async count=>{
   await picker.locator('[data-action="website-files-picker-insert-group"]').click();await expect(picker.getByRole('status')).toContainText('Inserted '+count);
   await picker.locator('[data-action="website-files-picker-close"]').click();
  };
  const format=picker.getByRole('combobox',{name:'Display as',exact:true});
  await browse();
  const firstPage=await idsOnPage();await picker.locator('[data-action="website-files-picker-select-page"]').click();
  await expect(format).toHaveValue('full');await format.selectOption('card');
  await picker.locator('[data-action="website-files-picker-next"]').click();await expect(picker.locator('[data-picker-row]').first()).not.toHaveAttribute('data-picker-row',firstPage[0]);
  const ordered=[...firstPage,...await idsOnPage()];expect(ordered).toHaveLength(24);
  await picker.locator('[data-action="website-files-picker-select-page"]').click();await expect(picker.locator('.website-picker-queue li')).toHaveCount(24);
  await picker.locator('[data-action="website-files-picker-queue-up"]').last().click();
  [ordered[22],ordered[23]]=[ordered[23],ordered[22]];await add(24);
  const cards=canvas.locator('[data-observanda-display="card"]');
  await expect(cards).toHaveCount(24);expect(await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.observandaSource))).toEqual(ordered);
  await expect(cards.first().locator('h2')).not.toBeEmpty();await expect(cards.first()).not.toContainText('Field measurements');
  await page.reload();await expect(canvas.locator('[data-observanda-display="card"]')).toHaveCount(24);
  await page.locator('[data-website-file-page]').selectOption('reports.html');await browse();
  const full=(await idsOnPage()).slice(0,2);expect(full).toHaveLength(2);
  for(const source of full)await picker.locator('[data-picker-check="'+source+'"]').check();
  await expect(format).toHaveValue('full');await add(2);
  const reports=canvas.locator('section[data-observanda-source]');await expect(reports).toHaveCount(2);
  expect(await reports.evaluateAll(nodes=>nodes.map(n=>n.dataset.observandaSource))).toEqual(full);
  await expect(reports.first()).toContainText('Field measurements');
  expect(writes.map(w=>[w.route.split('/').at(-1),w.body.presentation])).toEqual([['insert-sources','card'],['insert-sources','full']]);
  // Two contributors can change a grant after the editor has reviewed the
  // list. Exercise the same native HTTP writer with the now-stale second row.
  const remaining=(await store.searchLibrary({limit:40})).items.filter(r=>!ordered.includes(r.id)&&!full.includes(r.id)).slice(0,2);
  expect(remaining).toHaveLength(2);
  const before=await store.open(id),other=remaining[1],token=await store.beginSourceUpdate({sourceId:other.id});
  await store.putSource({sourceId:other.id,title:other.title,visible:false,html:'',assets:[]},{token});
  const failure=await page.evaluate(async payload=>{
   const session=await (await fetch('/api/website-files/session')).json();
   const r=await fetch('/api/website-files/insert-sources',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':session.contextId},body:JSON.stringify(payload)});
   return {status:r.status,code:(await r.json()).code};
  },{siteId:id,path:'index.html',expectedRevision:before.site.revision,position:'end',presentation:'card',sources:remaining.map(source=>({sourceId:source.id,sourceRevision:source.revision}))});
  expect([404,409]).toContain(failure.status);expect(['NOT_FOUND','CONFLICT','PUBLICATION_PERMISSIONS_CHANGED']).toContain(failure.code);
  const after=await store.open(id);expect(after.site.revision).toBe(before.site.revision);expect(after.html).toBe(before.html);expect(unexpected).toEqual([]);
 }finally{
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;}
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-batch-presentations-'))throw Error('Unexpected fixture directory');
  await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});
 }
});
