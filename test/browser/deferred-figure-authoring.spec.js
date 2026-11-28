import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {buildBrowser} from '../../scripts/browser-build.js';
import {createApplicationAssets} from '../../src/application-assets.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {revealInEditor} from './record-editor-helper.js';
import {newRecordOpened,setNewRecordTitle,saveNewRecord,saveRecordValue} from './record-editing-helper.js';
import {figureDialog,figureArea,addFigureItem,setFigureProperty,figurePoints} from './figure-authoring-controls.js';

for(const compiled of [false,true])test('figure authoring loads on demand and saves retained measurements '+(compiled?'compiled':'source'),async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-deferred-figure-')),book=sampleNotebook(),errors=[];
 let fixture,app,requests=0;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(new URL(request.url()).pathname==='/record-values-ui.js')requests++;});
 try{
  let browserAssets;if(compiled){const out=path.join(directory,'frontend');await buildBrowser({out});browserAssets=await createApplicationAssets({builtDirectory:pathToFileURL(out+path.sep)});}
  fixture=await encryptedFixture(directory,book);app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets});
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();expect(requests).toBe(0);
  // The value dialogs (with the figure editor) load when one first opens; a failed load is retried on the next open.
  if(!compiled)await page.context().route('**/record-values-ui.js',route=>route.abort(),{times:1});
  await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[0].id);
  // A new record opens on the record page; the figure editor loads with the record's value editors, only when one opens.
  await page.getByRole('button',{name:'New record',exact:true}).click();await page.getByRole('button',{name:'Create observation',exact:true}).click();
  await newRecordOpened(page);const heading=await page.locator('main h1').first().textContent();
  const add=await revealInEditor(page,page.getByRole('button',{name:'Add figure',exact:true}),'Evidence and results'),dialog=figureDialog(page);
  // An editor that failed to load is fetched again by the next attempt, and the record being written is kept.
  if(!compiled){await add.click();await expect(page.locator('#notice')).toBeVisible();await expect(dialog).toHaveCount(0);await expect(page.locator('main h1').first()).toHaveText(heading);}
  await add.click();await expect(dialog.locator('[data-authored-editor]')).toBeVisible();
  for(const [x,y] of [['1','3'],['2','8']]){await figureArea(dialog,'points');await addFigureItem(page,dialog);await setFigureProperty(page,dialog,'x',x);await setFigureProperty(page,dialog,'y',y);}
  await saveRecordValue(dialog,{timeout:60000});
  await setNewRecordTitle(page,'Retained deferred figure');await saveNewRecord(page);
  await expect(page.locator('.record-editing')).toContainText('Retained deferred figure');
  await page.reload();await expect(page.locator('.record-editing, .record-reader').first()).toContainText('Retained deferred figure',{timeout:20000});
  const saved=(await fixture.workspace.read()).book.entries.find(record=>record.title==='Retained deferred figure');
  expect(saved.figures).toHaveLength(1);expect((await figurePoints(fixture.workspace,saved.figures[0]))[0][0].map(({x,y})=>({x,y}))).toEqual([{x:1,y:3},{x:2,y:8}]);expect(errors).toEqual([]);
 }finally{
  await app?.close();if(fixture)await clearVault(fixture.vault);
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-deferred-figure-'))throw Error('Unexpected disposable folder');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
