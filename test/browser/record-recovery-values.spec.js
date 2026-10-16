import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createFigure} from '../../src/web/figure-model.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {proseText} from '../../src/web/prose-model.js';

test('draft conflict review displays numerical figure settings and preserves the selected values',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-conflict-values-')),book=upgradeNotebook(sampleNotebook()),figure=createFigure();
 figure.series[0].points=[{x:3,y:4,error:null}];figure.x.min=1;book.entries[0].figures=[figure];
 const f=await encryptedFixture(directory,book),base=book.entries[0],mine=structuredClone(base),remote=structuredClone(base);
 mine.figures[0].x.min=0;remote.figures[0].x.min=-2;
 await new ResearchDrafts(f.workspace).write({id:randomUUID(),workspaceId:book.id,expectedRevision:null,changes:[{base,record:mine,expectedRevision:recordRevision(base)}]});
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:remote}]});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Recover record draft',exact:true}),conflict=dialog.locator('.record-conflict');
  await expect(conflict).toHaveCount(1);
  await expect(conflict.locator('[data-conflict-preview="mine"] pre')).toContainText('min: 0');
  await expect(conflict.locator('[data-conflict-preview="stored"] pre')).toContainText('min: -2');
  await dialog.getByRole('button',{name:'Continue editing',exact:true}).click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose a version for each conflicting field.');
  await conflict.getByText('Version you started from',{exact:true}).click();await expect(conflict.locator('details pre')).toContainText('min: 1');
  await conflict.getByLabel('Your version',{exact:false}).check();
  await dialog.getByRole('button',{name:'Continue editing',exact:true}).click();
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const saved=(await f.workspace.read()).book;expect(saved.entries[0].figures[0].x.min).toBe(0);expect(saved.entries.slice(1)).toEqual(book.entries.slice(1));expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('long conflict values page independently and choosing a version restores its complete evidence',async({page},info)=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-conflict-parts-')),book=upgradeNotebook(sampleNotebook()),figure=createFigure(),base=book.entries[0];
 figure.series[0].points=Array.from({length:800},(_,i)=>({x:i,y:1,error:null}));base.figures=[figure];base.body='Original interpretation';
 const f=await encryptedFixture(directory,book),mine=structuredClone(base),remote=structuredClone(base);
 mine.body='Local exact 9007199254740993 / 3 <authored> 😀 '.repeat(800)+'LOCAL END';remote.body='Saved interpretation '.repeat(1600)+'REMOTE END';
 for(const p of mine.figures[0].series[0].points)p.y=2;for(const p of remote.figures[0].series[0].points)p.y=3;
 const drafts=new ResearchDrafts(f.workspace),id=randomUUID();await drafts.write({id,workspaceId:book.id,expectedRevision:null,changes:[{base,record:mine,expectedRevision:recordRevision(base)}]});
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:base.id,expectedRevision:recordRevision(base),record:remote}]});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  const listing=page.getByRole('dialog',{name:'Recoverable record drafts',exact:true});await listing.getByRole('button',{name:'Review draft',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Recover record draft',exact:true}),local=dialog.locator('[data-conflict-preview="mine"]'),saved=dialog.locator('[data-conflict-preview="stored"]');
  await expect(dialog.locator('[data-combined]')).toHaveCount(0);await expect(local.locator('pre')).not.toContainText('LOCAL END');
  await local.getByRole('button',{name:'Next part',exact:true}).focus();await page.keyboard.press('Enter');await expect(local.getByRole('status')).toHaveText('Part 2');await expect(saved.getByRole('status')).toHaveText('Part 1');
  await expect(local.getByRole('button',{name:'Next part',exact:true})).toBeFocused();await local.getByRole('button',{name:'Previous part',exact:true}).click();
  const parts=[];for(;;){const value=await local.locator('pre').textContent();expect(value.length).toBeLessThanOrEqual(8193);parts.push(value);const next=local.getByRole('button',{name:'Next part',exact:true});if(!await next.isEnabled())break;await next.click();}
  expect(parts.join('')).toBe(mine.body);await expect(local.locator('pre')).toContainText('LOCAL END');await expect(dialog.locator('authored')).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='150%');expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);await local.locator('.record-value-navigation').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('conflict-value-parts-phone.png')});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect((await drafts.read(id)).draft.changes[0].record).toEqual(mine);
  await listing.getByRole('button',{name:'Review draft',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('draft-list-large-text-phone.png')});await listing.getByRole('button',{name:'Review draft',exact:true}).click();await dialog.getByLabel('Your version',{exact:true}).check();await dialog.getByRole('button',{name:'Next field',exact:true}).click();
  await expect(local.locator('pre')).toContainText('y: 2');await expect(saved.locator('pre')).toContainText('y: 3');
  while(await saved.getByRole('button',{name:'Next part',exact:true}).isEnabled())await saved.getByRole('button',{name:'Next part',exact:true}).click();
  await expect(saved.locator('pre')).toContainText('x: 799');await dialog.getByLabel('Saved version',{exact:true}).check();await dialog.getByRole('button',{name:'Continue editing',exact:true}).click();
  await expect(page.locator('[data-record-checkpoint]')).toContainText('Record draft checkpointed');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const result=(await f.workspace.read()).book.entries[0];expect(proseText(result.body)).toBe(mine.body);expect(result.figures).toEqual(remote.figures);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
