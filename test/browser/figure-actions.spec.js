import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {workDirectory} from '../../scripts/work-directory.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {revealInEditor} from './record-editor-helper.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {createFigure} from '../../src/web/figure-model.js';
import {clearVault} from '../../src/encryption.js';

// Duplicating a saved figure prepares its calculation sources on the server inside the figure command.
test('figure source preparation disables conflicting controls and restores them after success or failure',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(await workDirectory('test-work'),'figure-actions-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0],figure=createFigure();figure.title='Duplicated observation';figure.series[0].points=[{x:0,y:3,error:null}];record.figures=[figure];
 const f=await encryptedFixture(directory,book),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];let release;
 page.on('pageerror',error=>errors.push(error.message));
 const figures=async()=>(await f.workspace.read()).book.entries.find(entry=>entry.id===record.id).figures;
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+record.id+'/read');
  const card=page.locator('#record-figure-'+figure.id),duplicate=card.getByRole('button',{name:'Duplicate figure',exact:true}),remove=card.getByRole('button',{name:'Remove figure',exact:true});
  const add=page.getByRole('button',{name:'Add figure',exact:true}),panels=page.getByRole('button',{name:'Add multi-panel figure',exact:true});
  await revealInEditor(page,duplicate,'Evidence and results');await expect(duplicate).toBeEnabled();
  let entered;const requested=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>release=resolve);
  await page.context().route('**/api/research/records/figures',async route=>{entered();await waiting;await route.continue();});
  await duplicate.click();await requested;
  await expect(panels).toBeDisabled();await expect(add).toBeDisabled();await expect(duplicate).toBeDisabled();await expect(remove).toBeDisabled();release();
  await expect.poll(async()=>(await figures()).length).toBe(2);
  // After duplicating, the figure list moves to the new figure, whose controls are available again.
  const copy=page.locator('#record-figure-'+(await figures())[1].id),copyDuplicate=copy.getByRole('button',{name:'Duplicate figure',exact:true}),copyRemove=copy.getByRole('button',{name:'Remove figure',exact:true});
  await expect(panels).toBeEnabled();await expect(add).toBeEnabled();await expect(copyDuplicate).toBeEnabled();await expect(copyRemove).toBeEnabled();await page.context().unrouteAll({behavior:'wait'});
  expect((await figures())[1].series[0].points.map(({x,y})=>({x,y}))).toEqual([{x:0,y:3}]);
  await page.context().route('**/api/research/records/figures',route=>route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({code:'MATERIAL_MISSING',message:'Synthetic source interruption'})}));
  await copyDuplicate.click();await expect(page.locator('#notice')).toContainText('Synthetic source interruption');
  await expect(panels).toBeEnabled();await expect(add).toBeEnabled();await expect(copyDuplicate).toBeEnabled();await expect(copyRemove).toBeEnabled();expect(await figures()).toHaveLength(2);
  expect(errors).toEqual([]);
 }finally{release?.();await page.context().unrouteAll({behavior:'wait'});await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
