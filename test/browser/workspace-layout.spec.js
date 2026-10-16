import {navigate,preferences,editWorkspace} from './preferences-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
let app,root,preferencesFile;
test.beforeEach(async({page})=>{root=await mkdtemp(path.join(os.tmpdir(),'observanda-layout-'));preferencesFile=path.join(root,'preferences.json');const b=sampleNotebook();b.title='Materials studio';b.projects[0].title='Long-running environmental research';b.notebooks[0].title='Research records and extended field recordings';await new Workspace(root).create(b);app=await startServer({root,preferencesFile,port:0});await page.goto(app.url);});test.afterEach(async()=>app.close());
test('workspace identity, legible tree and a persistent draggable and keyboard-resizable sidebar',async({page})=>{
 await expect(page.locator('.topbar')).toContainText('Materials studio');await expect(page.locator('.topbar [data-action=save]')).toHaveCount(0);await expect(page.locator('.workspace-switch')).toHaveCount(0);await expect(page.locator('.sidebar .tree-kind,.sidebar .notebook-link small')).toHaveCount(0);
 const handle=page.getByRole('separator',{name:'Resize navigation'}),box=await handle.boundingBox();await page.mouse.move(box.x+4,box.y+150);await page.mouse.down();await page.mouse.move(box.x+140,box.y+150,{steps:8});await page.mouse.up();await expect(handle).toHaveAttribute('aria-valuenow','408');
 await expect.poll(async()=>JSON.parse(await readFile(preferencesFile,'utf8').catch(()=>'{"interface":{}}')).interface.navigationWidth).toBe(408);await page.reload();await expect(page.locator('.sidebar')).toHaveCSS('width','408px');await handle.focus();await page.keyboard.press('ArrowRight');await expect(handle).toHaveAttribute('aria-valuenow','424');await expect.poll(async()=>JSON.parse(await readFile(preferencesFile,'utf8').catch(()=>'{"interface":{}}')).interface.navigationWidth).toBe(424);
 await page.screenshot({path:'.local/screenshots/workspace-layout.png',fullPage:true});await page.setViewportSize({width:390,height:844});await expect(handle).toBeHidden();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('record footer saves and discards only the current section and policy forms have their own save',async({page})=>{
 await navigate(page,'All records');await page.getByRole('button',{name:'Watching a seed unfold',exact:true}).click();const footer=page.locator('.section-save');await expect(footer.getByRole('button',{name:'Save record'})).toBeDisabled();await page.getByLabel('Summary / context').fill('Only this record');await footer.getByRole('button',{name:'Save record'}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.getByLabel('Summary / context').fill('Unwanted');await footer.getByRole('button',{name:'Discard changes'}).click();await expect(page.getByLabel('Summary / context')).toHaveValue('Only this record');
 await preferences(page,'Storage & access');await page.getByLabel('Maximum original file (MiB)',{exact:true}).fill('256');await page.getByRole('button',{name:'Save media limits'}).click();await page.reload();await expect(page.getByLabel('Maximum original file (MiB)',{exact:true})).toHaveValue('256');
 await page.getByLabel('Maximum original file (MiB)',{exact:true}).fill('42');await navigate(page,'Projects');await page.getByRole('dialog',{name:'Unsaved changes'}).getByRole('button',{name:'Discard changes'}).click();await preferences(page,'Storage & access');await expect(page.getByLabel('Maximum original file (MiB)',{exact:true})).toHaveValue('256');
});

test('right-side dragging saves only width while appearance edits still require an explicit save',async({page})=>{
 await preferences(page,'Appearance');await page.getByRole('button',{name:'App layout',exact:true}).click();await page.getByLabel('Menu position',{exact:true}).selectOption('right');await page.getByRole('dialog').getByRole('button',{name:'Save app settings',exact:true}).click();await page.getByRole('button',{name:'Done',exact:true}).click();
 const original=(await new Workspace(root).read()).book.appearance.accent;await page.getByLabel('Accent',{exact:true}).fill('#345678');await page.locator('[data-interface=fontSize]').fill('20');
 await page.getByRole('button',{name:'Menu',exact:true}).click();const handle=page.getByRole('separator',{name:'Resize navigation'}),box=await handle.boundingBox();await page.mouse.move(box.x+4,200);await page.mouse.down();await page.mouse.move(box.x-60,200,{steps:6});await page.mouse.up();await expect(handle).toHaveAttribute('aria-valuenow','336');await expect.poll(async()=>JSON.parse(await readFile(preferencesFile,'utf8').catch(()=>'{"interface":{}}')).interface.navigationWidth).toBe(336);expect(JSON.parse(await readFile(preferencesFile,'utf8')).interface.fontSize).toBe(17);expect((await new Workspace(root).read()).book.appearance.accent).toBe(original);
 await navigate(page,'Projects');await page.getByRole('dialog',{name:'Unsaved changes'}).getByRole('button',{name:'Discard changes'}).click();await expect(page.locator('#main-navigation')).toBeVisible();await expect(handle).toHaveAttribute('aria-valuenow','336');
});

test('a failed record removal leaves the record editable instead of stranding an unsaved list',async({page})=>{
 await navigate(page,'All records');await page.getByRole('button',{name:'Watching a seed unfold',exact:true}).click();page.on('dialog',dialog=>dialog.accept());
 await page.route('**/api/notebook/save',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic removal failure'})}));await page.getByRole('button',{name:'Remove entry',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic removal failure');await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Watching a seed unfold');
 await page.unroute('**/api/notebook/save');await page.getByLabel('Summary / context').fill('Still editable');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');expect((await new Workspace(root).read()).book.entries[0].body).toBe('Still editable');
});
