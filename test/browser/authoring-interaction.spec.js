import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {navigate,preferences} from './preferences-helper.js';
let app,directory,f,book;
test.beforeEach(async({page})=>{directory=await mkdtemp(path.join(os.tmpdir(),'observanda-interaction-'));book=sampleNotebook();f=await encryptedFixture(directory,book);app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});await page.goto(app.url);});
test.afterEach(async()=>{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});

test('Menu opens and closes on workspace screens, carries the user choice and does not edit preferences or records',async({page})=>{
 const menu=page.getByRole('button',{name:'Menu',exact:true}),nav=page.locator('#main-navigation');
 await expect(menu).toBeVisible();
 // Read the starting preferences once the browser session is authorized.
 const original=(await f.workspace.read()).etag,before=await page.evaluate(async()=>(await fetch('/api/interface')).json());expect(before.appTheme).toBeTruthy();await menu.click();await expect(nav).toBeHidden();
 await navigate(page,'Projects');await expect(nav).toBeVisible();await menu.click();await expect(nav).toBeHidden();
 await navigate(page,'All records');await expect(nav).toBeVisible();await preferences(page,'App appearance');if(!await nav.isVisible())await menu.click();await expect(nav).toBeVisible();await menu.click();await expect(nav).toBeHidden();
 expect(await page.evaluate(async()=>(await fetch('/api/interface')).json())).toEqual(before);expect((await f.workspace.read()).etag).toBe(original);
 await page.setViewportSize({width:390,height:844});await menu.click();await expect(nav.getByRole('button',{name:'Website editor',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(nav).toBeHidden();
});
