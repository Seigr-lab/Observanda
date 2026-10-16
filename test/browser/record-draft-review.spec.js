import {projectTemplateFixture} from './project-template-fixture.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {retainedDraft} from '../fixtures/record-draft-review.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchDrafts} from '../../src/research-drafts.js';

for(const dedicated of [false,true])test((dedicated?'project: ':'workspace: ')+'checkpoint recovery reviews bounded values, resumes decisions and saves without opening the full editor',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-review-ui-')),book=sampleNotebook(),base=book.entries[0],mine={...base,title:'Recovered observation',body:'Draft writing. '.repeat(1000)};
 const f=dedicated?await projectTemplateFixture(directory,book):await encryptedFixture(directory,book),draft=await retainedDraft(f.workspace,book.id,base,mine);
 await new ResearchRecords(f.workspace,{get:async()=>{throw Error('Unexpected media');}}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:{...base,title:'Concurrent title',body:'Concurrent writing'}}]},{receipt:true});
 const app=await testServer({root:f.applicationRoot??f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),read=ResearchCatalogue.prototype.record,errors=[],requests=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Review reconstructed a complete record');};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 const open=async()=>{
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.locator('.record-draft-list').getByRole('button',{name:'Review draft',exact:true}).click();
  await page.locator('.record-draft-preview [data-preview-recover]').click();await expect(page.locator('.record-draft-review [role=status]')).toContainText('of 2');
 };
 try{
  await page.goto(app.url);if(dedicated)await page.evaluate(({project,notebook})=>location.hash='#/owners/'+project+'/notebooks/'+notebook,{project:book.projects[0].id,notebook:book.notebooks[0].id});await expect(page.getByRole('button',{name:'Review drafts',exact:true})).toBeVisible();requests.length=0;await open();let dialog=page.locator('.record-draft-review');
  await dialog.locator('[data-review=choose-mine]').click();await expect(dialog.locator('[role=status]')).toContainText('1 of 2');
  await dialog.getByRole('button',{name:'Close review',exact:true}).click();await open();await expect(dialog.locator('[role=status]')).toContainText('1 of 2');
  await dialog.getByRole('button',{name:'Next change',exact:true}).click();await dialog.locator('[data-review=value-mine-next]').click();await expect(dialog.locator('pre').first()).toContainText('Draft writing');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.locator('[data-review=choose-mine]').click();await dialog.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(dialog).toHaveCount(0);
  await expect(page.locator('.record-reader h1')).toHaveText(mine.title);expect(await new ResearchDrafts(f.workspace).read(draft.draft.id,{header:true})).toBe(null);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);if(dedicated)expect(requests.filter(route=>route.includes('/research/drafts/')).every(route=>route.startsWith('/api/projects/'+book.projects[0].id+'/'))).toBe(true);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;await app.close();if(f.close)await f.close();else clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
