import {sessionRequest} from './session-fixture.js';
import {test,expect} from '@playwright/test';
import {preferences} from './preferences-helper.js';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';

test('application artwork follows the actual surface and browser icons follow browser chrome',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-brand-'));
 const {workspace,vault,deviceStore}=await encryptedFixture(directory,upgradeNotebook(sampleNotebook()));
 const app=await startServer({root:workspace.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.emulateMedia({colorScheme:'dark'});
  await page.goto(app.url);await expect(page.locator('#main-navigation .app-logo-black')).toBeVisible();
  await expect(page.locator('#main-navigation .app-logo-white')).toBeHidden();
  for(const variant of ['black','white']){
   const response=await sessionRequest(page,'get',app.origin+'/observanda-'+variant+'.svg');
   expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('image/svg+xml');
   expect(await response.body()).toEqual(await readFile('desktop/icon_'+variant+'.svg'));
  }
  const selectedIcon=()=>page.evaluate(()=>[...document.querySelectorAll('link[rel="icon"]')].filter(link=>matchMedia(link.media).matches).map(link=>new URL(link.href).pathname));
  expect(await selectedIcon()).toEqual(['/observanda-white.svg']);
  await page.emulateMedia({colorScheme:'light'});expect(await selectedIcon()).toEqual(['/observanda-black.svg']);
  // The app's own theme sets the surface; the artwork follows it.
  const set=async(key,value)=>page.locator('[data-app-theme="'+key+'"]').evaluate((el,v)=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},value);
  await preferences(page,'App appearance');await page.getByRole('region',{name:'App theme',exact:true}).getByRole('button',{name:'Create my own theme',exact:true}).click();
  await set('surface','#17283f');await set('text','#ffffff');await set('muted','#bac6d8');
  await expect(page.locator('#main-navigation .app-logo-white')).toBeVisible();
  await expect(page.locator('#main-navigation .app-logo-black')).toBeHidden();
  expect(await page.locator('#main-navigation .app-logo-white').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await page.locator('#main-navigation .brand').screenshot({path:test.info().outputPath('logo-dark-surface.png')});
  await page.getByRole('button',{name:'Save app settings',exact:true}).click();await expect(page.locator('main [data-interface-status]')).toContainText('Saved on this computer');
  await page.reload();await expect(page.locator('#main-navigation .app-logo-white')).toBeVisible();
  await set('surface','#ffffff');await set('text','#17283f');
  await expect(page.locator('#main-navigation .app-logo-black')).toBeVisible();
  await expect(page.locator('#main-navigation .app-logo-white')).toBeHidden();
  await page.locator('#main-navigation .brand').screenshot({path:test.info().outputPath('logo-light-surface.png')});
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(vault);await rm(directory,{recursive:true,force:true});}
});
