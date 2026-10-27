import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {navigate} from './preferences-helper.js';
import {task,chooseWebsitePage} from './composer-helper.js';

for(const count of [65,650])test('website authoring uses summaries and selected originals across '+count+' records',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-outline-')),book=sampleNotebook(),seed=book.entries[0];
 book.website.home.sections=[];book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Take '+String(i).padStart(3,'0'),body:'PRIVATE_BODY_'+i,share:false,attachments:[],relations:[],figures:[],sections:[]}));
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
 const read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record,loaded=[],errors=[],requests=[];
 ResearchCatalogue.prototype.read=()=>{throw Error('Full workspace requested from website editor');};
 ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return record.call(this,id,...args);};
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,data:r.postDataJSON()});});
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await expect(page.frameLocator('#website-draft-preview').locator('body')).toHaveAttribute('data-page','home');loaded.length=0;
  const projectId=book.notebooks.find(n=>n.id===seed.notebookId).projectId;
  await chooseWebsitePage(page,'projects/'+projectId+'.html');
  await expect(page.frameLocator('#website-draft-preview').locator('.publication-card')).toHaveCount(count);
  expect(loaded).toEqual([]);
  await chooseWebsitePage(page,'notebooks/'+seed.notebookId+'.html');
  await expect(page.frameLocator('#website-draft-preview').locator('.publication-card')).toHaveCount(count);
  expect(loaded).toEqual([]);
  await chooseWebsitePage(page,'index.html');await expect(page.frameLocator('#website-draft-preview').locator('body')).toHaveAttribute('data-page','home');
  await task(page,'Content');await expect(page.locator('[data-publish-entry]')).toHaveCount(10);expect(loaded).toEqual([]);
  const selected=book.entries.at(-1),search=page.getByLabel('Find projects or records',{exact:true});await search.fill(selected.title);await expect(page.locator('[data-publish-entry]')).toHaveCount(1);
  await page.locator('[data-publish-entry]').check();await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('[data-publish-entry]')).not.toBeChecked();
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.locator('[data-publish-entry]')).toBeChecked();expect(loaded).toEqual([]);
  // The prepared edition uses unsaved selection but cannot silently save it.
  const before=await f.workspace.outline();await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible();
  expect((await f.workspace.outline()).etag).toBe(before.etag);expect(loaded.every(id=>id===selected.id)).toBe(true);
  await navigate(page,'Website editor');await task(page,'Content');await search.fill(selected.title);await expect(page.locator('[data-publish-entry]')).toBeChecked();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await chooseWebsitePage(page,'entries/'+selected.id+'.html');await expect(page.frameLocator('#website-draft-preview').locator('body')).toContainText(selected.body);
  await page.reload();await expect(page.getByLabel('Page',{exact:true})).toHaveValue('entries/'+selected.id+'.html');
  expect(loaded.every(id=>id===selected.id)).toBe(true);expect(requests.filter(r=>['/api/notebook','/api/workspace/read/page'].includes(r.path))).toEqual([]);
  const write=requests.find(r=>r.path==='/api/workspace/save');expect(write.data.changes).toEqual([]);expect(write.data.selection.records).toEqual([{id:selected.id,share:true,attachments:[]}]);expect(JSON.stringify(write).includes('PRIVATE_BODY')).toBe(false);
  const heap=await page.evaluate(()=>performance.memory?.usedJSHeapSize??0);expect(heap).toBeLessThan(128*1024*1024);expect(errors).toEqual([]);
  test.info().annotations.push({type:'capacity',description:JSON.stringify({records:count,heapMiB:Math.round(heap/1048576),writeBytes:Buffer.byteLength(JSON.stringify(write.data)),originalReads:loaded.length})});
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
