import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {authoringGrowthFixture} from '../authoring-growth-fixture.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {navigate,preferences} from './preferences-helper.js';

test('large saved workspaces open, edit, recover drafts and change lab-book settings without complete reads',async({page})=>{
 test.setTimeout(360000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-authoring-app-'));let f,app;
 const errors=[],fullReads=[],sizes=[],measured=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.url().includes('/api/workspace/read/page'))fullReads.push(request.url());});
 page.on('response',response=>{if(response.url().includes('/api/'))measured.push(response.body().then(bytes=>sizes.push(bytes.length),()=>{}));});
 try{
  f=await authoringGrowthFixture(directory,{copies:10});
  app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  const complete=ResearchCatalogue.prototype.read;ResearchCatalogue.prototype.read=()=>{throw Error('Unexpected complete document in the current app');};
  try{
   await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
   await page.evaluate(id=>location.hash='#/records/'+id,f.first.id);
   const title=page.getByLabel('Record title',{exact:true});await expect(title).toHaveValue(f.first.title);
   await title.fill('Large workspace recovered draft');
   await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');
   await page.reload();await expect(title).toHaveValue(f.first.title);
   await page.getByRole('button',{name:'Review drafts',exact:true}).click();
   await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
   await page.getByRole('dialog',{name:'Recover record draft',exact:true}).getByRole('button',{name:'Continue editing',exact:true}).click();
   await expect(title).toHaveValue('Large workspace recovered draft');
   await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
   await expect.poll(async()=> (await new ResearchDrafts(f.workspace).list()).drafts.length).toBe(0);
   await page.locator('[data-action="new-project"]').first().click();
   await page.getByRole('dialog').getByLabel('Name',{exact:true}).fill('Created from a selected record');
   await page.getByRole('button',{name:'Save project',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Created from a selected record',exact:true})).toBeVisible();
   await page.evaluate(id=>location.hash='#/projects/'+id,f.book.projects[0].id);
   await expect(page.getByRole('heading',{name:f.book.projects[0].title,exact:true})).toBeVisible();
   // Settings and deletion use metadata counts, including records not in the
   // current view. Merely opening this dialog must never mislabel it as empty.
   await page.locator('[data-action="edit-notebook"][data-id="'+f.book.notebooks[0].id+'"]').first().click();
   await page.locator('[data-action="lab-book-delete"]').click();
   await expect(page.getByRole('dialog')).toContainText(f.ids.length+' records');
   await page.locator('[data-action="lab-book-delete-cancel"]').click();
   await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
   await page.locator('[data-action="edit-project"][data-id="'+f.book.projects[0].id+'"]').first().click();
   await page.getByRole('dialog').getByLabel('Name',{exact:true}).fill('Renamed large study');
   await page.getByRole('button',{name:'Save project',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Renamed large study',exact:true})).toBeVisible();
   await page.evaluate(id=>location.hash='#/records/'+id,f.first.id);await expect(title).toHaveValue('Large workspace recovered draft');
   // Cross from selected-record state into metadata and optional tools using
   // real controls. None may silently rebuild the complete research document.
   await preferences(page,'General');
   await page.getByLabel('Workspace name',{exact:true}).fill('Capacity workspace');
   await page.getByRole('button',{name:'Save workspace',exact:true}).click();
   await expect(page.locator('[data-workspace-status]')).toHaveText('Saved');
   await preferences(page,'Appearance');
   await page.getByRole('button',{name:'Logos & branding',exact:true}).click();
   await expect(page.getByLabel('Branding scope',{exact:true})).toBeVisible();
   await page.getByRole('button',{name:'Back to Appearance',exact:true}).click();
   await expect(page.getByLabel('Header alignment',{exact:true})).toBeVisible();
   await preferences(page,'Modules');
   await page.getByRole('switch',{name:'Enable Scientific calculator',exact:true}).check();
   await expect(page.locator('#desk-save-state')).toHaveText('');
   await navigate(page,'Scientific calculator');
   await page.getByRole('button',{name:'New calculation',exact:true}).click();
   await page.locator('main').getByLabel('Name',{exact:true}).fill('Large workspace calculation');
   await page.getByLabel('Expressions (one per line)',{exact:true}).fill('mean(2, 4, 6)');
   await expect(page.locator('[data-tool-output="scientific-calculator"] output')).toHaveText('4');
   await page.getByRole('button',{name:'Save calculation',exact:true}).click();
   await expect(page.locator('[data-module-status]')).toHaveText('Saved');
   await page.reload();
   await expect(page.getByLabel('Expressions (one per line)',{exact:true})).toHaveValue('mean(2, 4, 6)');
   await preferences(page,'Help');
   await page.getByLabel('Search documentation',{exact:true}).fill('record');
   await expect(page.locator('main')).toContainText('matching section');
   await preferences(page,'General');await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('Capacity workspace');
   await page.evaluate(id=>location.hash='#/records/'+id,f.first.id);await expect(title).toHaveValue('Large workspace recovered draft');
   await Promise.all(measured);expect(sizes.length).toBeGreaterThan(10);
   const heap=await page.evaluate(()=>performance.memory?.usedJSHeapSize??null);
   expect(fullReads).toEqual([]);expect(errors).toEqual([]);expect(Math.max(...sizes)).toBeLessThan(3*1024*1024);if(heap!==null)expect(heap).toBeLessThan(128*1024*1024);
   console.log(JSON.stringify({...f.metrics,browserHeapMiB:heap===null?null:Math.ceil(heap/1024/1024),largestResponseBytes:Math.max(...sizes),completePageRequests:0}));
  }finally{ResearchCatalogue.prototype.read=complete;}
 }finally{await app?.close();if(f)clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
