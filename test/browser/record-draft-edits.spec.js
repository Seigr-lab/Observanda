import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {retainedDraft} from '../fixtures/record-draft-review.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {createFigure} from '../../src/web/figure-model.js';
import {RecordValues} from '../../src/record-values.js';

test('unfinished recovery corrections keep native controls, survive reload and retry, then admit the corrected record',async({page})=>{
 test.setTimeout(180000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-edit-checkpoint-')),book=sampleNotebook(),base=book.entries[0],mine=structuredClone(base);
 mine.title='';mine.sections=Array.from({length:12},(_,i)=>({id:randomUUID(),title:'Section '+i,body:'Checkpoint observations '+i}));
 const figure=createFigure();figure.title='Checkpoint figure';figure.series[0].points=[{x:0,y:1,error:null}];mine.figures=[figure];
 mine.results={version:1,statements:[{id:randomUUID(),kind:'figure',figureId:figure.id,title:'Checkpoint result',text:'Result narrative',limitations:'',basis:'authored',source:null}]};
 const f=await encryptedFixture(directory,book);await retainedDraft(f.workspace,book.id,base,mine);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,errors=[],requests=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Full record loaded during correction');};page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(new URL(r.url()).pathname);});
 const review=page.locator('.record-draft-review'),editor=page.locator('.record-draft-edit');
 const open=async()=>{await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.locator('.record-draft-list').getByRole('button',{name:'Review draft',exact:true}).click();await page.locator('[data-preview-recover]').click();await review.getByRole('button',{name:'Edit checkpoint',exact:true}).click();await expect(editor.locator('[data-record-value]')).toBeVisible();};
 try{
  await page.goto(app.url);await open();await editor.locator('[data-record-value]').fill('Corrected recovery');await expect(editor.locator('[data-checkpoint-status]')).toHaveText('Checkpoint changes kept.');
  await editor.getByRole('button',{name:'Keep changes and return to review'}).click();await expect(review.locator('h2')).toHaveText('Corrected recovery');await review.getByRole('button',{name:'Close review',exact:true}).click();await page.reload();await open();await expect(editor.locator('[data-record-value]')).toHaveValue('Corrected recovery');
  await editor.locator('[data-checkpoint-select]').selectOption('type');await editor.getByLabel('Record type',{exact:true}).selectOption('observation');await expect(editor.locator('[data-checkpoint-status]')).toHaveText('Checkpoint changes kept.');
  await editor.getByLabel('Record type',{exact:true}).selectOption('analysis');await expect(editor.locator('[data-checkpoint-status]')).toHaveText('Checkpoint changes kept.');
  await editor.locator('[data-checkpoint-group]').selectOption('writing');await editor.getByRole('button',{name:'Next values',exact:true}).click();await editor.locator('[data-checkpoint-select]').selectOption({label:'Section 11'});await expect(editor.locator('[data-writing-heading]')).toHaveValue('Section 11');await expect(editor.locator('[data-checkpoint-select]')).toBeEnabled();await editor.locator('[data-writing-heading]').fill('Corrected late section');
  await editor.locator('.ProseMirror').fill('Faithful checkpoint writing');await expect(editor.locator('[data-checkpoint-status]')).toHaveText('Checkpoint changes kept.');
  await editor.locator('[data-checkpoint-group]').selectOption('results');await expect(editor.locator('[data-result-value="title"]')).toHaveValue('Checkpoint result');await expect(editor.locator('[data-checkpoint-select]')).toBeEnabled();await editor.locator('[data-result-choose-figure]').click();await editor.locator('[data-result-use-figure]').filter({hasText:'Checkpoint figure'}).click();
  await editor.locator('[data-result-value="title"]').fill('Edited native result');await editor.locator('[data-result-value="limitations"]').fill('Synthetic result only.');await expect(editor.locator('[data-checkpoint-status]')).toHaveText('Checkpoint changes kept.');
  await editor.locator('[data-checkpoint-group]').selectOption('details');await expect(editor.locator('[data-record-value]')).toHaveValue('Corrected recovery');await expect(editor.locator('[data-checkpoint-select]')).toBeEnabled();
  await page.route('**/api/research/drafts/review/editWrite',async route=>{await route.fetch();await route.abort('failed');},{times:1});await editor.locator('[data-record-value]').fill('Retry retained correction');await expect(editor.locator('[data-checkpoint-error]')).not.toBeEmpty();await editor.getByRole('button',{name:'Retry keeping changes'}).click();await expect(editor.locator('[data-checkpoint-status]')).toHaveText('Checkpoint changes kept.');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await editor.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await editor.locator('[data-record-value]').scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('checkpoint-edit-mobile.png')});
  await editor.getByRole('button',{name:'Keep changes and return to review'}).click();await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review).toHaveCount(0,{timeout:30000});await expect(page.locator('.record-reader > h1')).toHaveText('Retry retained correction');
  expect((await new RecordValues(f.workspace).read({workspaceId:book.id,recordId:base.id,field:'type'})).value.value).toBe('analysis');
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
