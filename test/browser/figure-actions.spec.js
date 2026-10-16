import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createFigure} from '../../src/web/figure-model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';

test('figure source preparation disables conflicting controls and restores them after success or failure',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-figure-actions-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0],figure=createFigure();figure.series[0].points=[{x:0,y:3,error:null}];record.figures=[figure];
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});let release;
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  let entered;const requested=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>release=resolve);
  await page.route('**/api/research/materials/figure-sources',async route=>{entered();await waiting;await route.continue();});
  const cards=page.locator('.record-figures > [data-figure-cards] > .figure-workbench'),add=page.getByRole('button',{name:'Add multi-panel figure',exact:true});
  await cards.first().getByRole('button',{name:'Duplicate',exact:true}).click();await requested;
  await expect(add).toBeDisabled();await expect(cards.first().getByLabel('Value 1',{exact:true})).toBeDisabled();release();
  await expect(cards).toHaveCount(2);await expect(add).toBeEnabled();await page.unrouteAll({behavior:'wait'});
  await add.click();await expect(page.locator('.figure-composition')).toHaveCount(1);
  await page.route('**/api/research/materials/figure-sources',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic source interruption'})}));
  await cards.first().getByRole('button',{name:'Duplicate',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic source interruption');
  await expect(add).toBeEnabled();await expect(cards.first().getByLabel('Value 1',{exact:true})).toBeEnabled();await expect(cards).toHaveCount(3);
 }finally{release?.();await page.unrouteAll({behavior:'wait'});await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
