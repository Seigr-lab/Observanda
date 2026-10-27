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

for(const compiled of [false,true])test('figure authoring loads on demand and saves retained measurements '+(compiled?'compiled':'source'),async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-deferred-figure-')),book=sampleNotebook(),errors=[];
 let fixture,app,requests=0;
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(new URL(request.url()).pathname==='/figure-editor.js')requests++;});
 try{
  let browserAssets;if(compiled){const out=path.join(directory,'frontend');await buildBrowser({out});browserAssets=await createApplicationAssets({builtDirectory:pathToFileURL(out+path.sep)});}
  fixture=await encryptedFixture(directory,book);app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets});
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();expect(requests).toBe(0);
  if(!compiled)await page.route('**/figure-editor.js',route=>route.abort(),{times:1});
  await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[0].id);
  await page.getByRole('button',{name:'New record',exact:true}).click();await page.getByRole('button',{name:'Create observation',exact:true}).click();
  await page.getByLabel('Record title',{exact:true}).fill('Retained deferred figure');
  if(!compiled){await page.getByRole('button',{name:'Retry figure editor',exact:true}).click();await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Retained deferred figure');}
  await page.getByRole('button',{name:'Add figure',exact:true}).click();await page.getByRole('button',{name:'Add measurement',exact:true}).click();
  await page.getByLabel('Coordinate 1',{exact:true}).fill('1');await page.getByLabel('Coordinate 2',{exact:true}).fill('2');
  await page.getByLabel('Value 1',{exact:true}).fill('3');await page.getByLabel('Value 2',{exact:true}).fill('8');
  await page.locator('.section-save [data-action=save]').click();
  await expect(page.locator('.record-editing')).toContainText('Retained deferred figure');
  await page.reload();await expect(page.locator('.record-reader')).toContainText('Retained deferred figure',{timeout:20000});
  const saved=(await fixture.workspace.read()).book.entries.find(record=>record.title==='Retained deferred figure');
  expect(saved.figures).toHaveLength(1);expect(saved.figures[0].series[0].points.map(({x,y})=>({x,y}))).toEqual([{x:1,y:3},{x:2,y:8}]);expect(errors).toEqual([]);
 }finally{
  await app?.close();if(fixture)clearVault(fixture.vault);
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-deferred-figure-'))throw Error('Unexpected disposable folder');
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
