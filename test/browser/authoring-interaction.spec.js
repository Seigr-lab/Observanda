import {test,expect} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {navigate,preferences} from './preferences-helper.js';
let app,root,book;
test.beforeEach(async({page})=>{root=path.join(await mkdtemp(path.join(os.tmpdir(),'observanda-interaction-')),'workspace');book=sampleNotebook();await new Workspace(root).create(book);app=await startServer({root,preferencesFile:path.join(path.dirname(root),'preferences.json'),port:0});await page.goto(app.url);});
test.afterEach(async()=>app.close());

test('Menu opens and closes on workspace screens, carries the user choice and does not edit preferences or records',async({page})=>{
 const menu=page.getByRole('button',{name:'Menu',exact:true}),nav=page.locator('#main-navigation');
 await expect(menu).toBeVisible();
 // Read the starting preferences once the browser session is authorized.
 const original=await readFile(path.join(root,'observanda.json'),'utf8'),before=await page.evaluate(async()=>(await fetch('/api/interface')).json());expect(before.appTheme).toBeTruthy();await menu.click();await expect(nav).toBeHidden();
 await navigate(page,'Projects');await expect(nav).toBeVisible();await menu.click();await expect(nav).toBeHidden();
 await navigate(page,'All records');await expect(nav).toBeVisible();await preferences(page,'Appearance');if(!await nav.isVisible())await menu.click();await expect(nav).toBeVisible();await menu.click();await expect(nav).toBeHidden();
 expect(await page.evaluate(async()=>(await fetch('/api/interface')).json())).toEqual(before);expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(original);
 await page.setViewportSize({width:390,height:844});await menu.click();await expect(nav.getByRole('button',{name:'Website editor',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(nav).toBeHidden();
});
