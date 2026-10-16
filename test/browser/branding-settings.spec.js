import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {preferences,navigate} from './preferences-helper.js';
import {task} from './composer-helper.js';
let app,root,errors;
test.beforeEach(async({page})=>{
 root=await mkdtemp(path.join(os.tmpdir(),'observanda-branding-settings-'));
 await new Workspace(root).create(sampleNotebook());
 app=await startServer({root,port:0,preferencesFile:path.join(root,'preferences.json')});
 errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);
});
test.afterEach(async()=>{await app.close();expect(errors).toEqual([]);});
const header=page=>page.locator('.workspace-heading');
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
test('SVG logo upload, return to Appearance, header alignment and order persist with explicit save',async({page})=>{
 await preferences(page,'Appearance');
 await page.getByRole('button',{name:'Logos & branding',exact:true}).click();
 await expect(page.getByRole('navigation',{name:'Preferences sections'})).toBeVisible();
 const input=page.getByLabel('Add logo',{exact:true});expect(await input.getAttribute('accept')).toContain('.svg');
 await input.setInputFiles({name:'studio.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="teal"/></svg>')});
 await expect(page.locator('.logo-editor img')).toBeVisible({timeout:15000});
 await expect(page.getByLabel('Add logo',{exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Save branding',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
 await page.getByRole('button',{name:'Back to Appearance',exact:true}).click();
 await expect(page.getByLabel('Header alignment')).toBeVisible();
 await page.getByLabel('Header alignment').selectOption('right');await page.getByLabel('Logo and title order').selectOption('title-first');
 const positioned=async()=>{
  expect(await header(page).evaluate(el=>getComputedStyle(el).justifySelf)).toBe('end');
  const title=await page.locator('.workspace-name').boundingBox(),logo=await page.locator('.workspace-logo').boundingBox();
  expect(title.x+title.width).toBeLessThanOrEqual(logo.x);
  await expect(page.locator('.workspace-identity > :first-child')).toHaveClass('workspace-name');
 };
 await positioned();
 await page.getByRole('button',{name:'Save appearance',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
 await page.reload();await positioned();await expect(page.getByLabel('Logo and title order')).toHaveValue('title-first');
 await page.getByLabel('Header alignment').selectOption('left');
 await page.getByRole('button',{name:'Discard changes',exact:true}).click();
 // Section discard uses the common leave guard.
 if(await page.locator('#leave-dialog').isVisible())await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();
 await positioned();
 await page.evaluate(()=>window.scrollTo(0,0));
 await mkdir('.local/screenshots',{recursive:true});await page.screenshot({path:'.local/screenshots/branding-appearance-desktop.png'});
 await page.setViewportSize({width:390,height:844});await noOverflow(page);await positioned();
 await page.screenshot({path:'.local/screenshots/branding-appearance-phone.png'});
});
test('General directly edits workspace details and protects unsaved form changes',async({page})=>{
 await preferences(page,'General');
 await expect(page.getByRole('button',{name:'Logos & branding',exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Edit workspace',exact:true})).toHaveCount(0);
 const form=page.locator('#workspace-name-form'),before=(await new Workspace(root).read()).book;
 await form.getByLabel('Workspace name',{exact:true}).fill('Creative collective');
 await preferences(page,'Appearance');
 await expect(page.locator('#leave-dialog')).toBeVisible();
 await page.locator('#leave-dialog').getByRole('button',{name:'Stay here',exact:true}).click();
 expect((await new Workspace(root).read()).book.title).toBe(before.title);
 await form.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(form.getByLabel('Workspace name',{exact:true})).toHaveValue(before.title);
 await form.getByLabel('Workspace name',{exact:true}).fill('Creative collective');await form.getByLabel('Workspace type').selectOption('custom');await form.getByLabel('Your own label').fill('Sound studio');
 await form.getByRole('button',{name:'Save workspace',exact:true}).click();
 await expect(page.locator('.workspace-name')).toHaveText('Creative collective');
 await page.reload();await expect(form.getByLabel('Your own label')).toHaveValue('Sound studio');
 const after=(await new Workspace(root).read()).book;expect(after.website).toEqual(before.website);expect(after.projects).toEqual(before.projects);
 await form.getByLabel('Workspace name',{exact:true}).fill('');
 await preferences(page,'Appearance');await page.locator('#leave-dialog').getByRole('button',{name:'Save and continue',exact:true}).click();
 await expect(page.locator('#leave-dialog [role=alert]')).toContainText('required fields');
 await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();
 await preferences(page,'General');await page.setViewportSize({width:390,height:844});await noOverflow(page);
 await page.screenshot({path:'.local/screenshots/general-settings-phone.png'});
});
test('branding returns to website editor and guards a changed logo description',async({page})=>{
 await navigate(page,'Website editor');await task(page,'Site');
 await page.getByRole('button',{name:'Layout & branding',exact:true}).click();
 await page.getByRole('button',{name:'Website logos',exact:true}).click();
 await expect(page.getByRole('button',{name:'Back to website editor',exact:true})).toBeVisible();
 await page.getByLabel('Add logo',{exact:true}).setInputFiles({name:'mark.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>')});
 await expect(page.getByLabel('Logo 1 alternative text')).toBeVisible({timeout:15000});
 await page.getByLabel('Logo 1 alternative text').fill('Draft mark');
 await page.getByRole('button',{name:'Back to website editor',exact:true}).click();
 await expect(page.locator('#leave-dialog')).toBeVisible();await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();
 await expect(page.locator('#website-preview-page')).toBeVisible();
 expect((await new Workspace(root).read()).book.branding).toEqual([]);
});

test('four logos and a long title reflow at narrow and enlarged layouts with keyboard controls',async({page})=>{
 await preferences(page,'General');await page.getByLabel('Workspace name',{exact:true}).fill('A long title for the shared creative and field research workspace');
 await page.getByRole('button',{name:'Save workspace',exact:true}).click();await expect(page.locator('#workspace-name-form').getByRole('status')).toHaveText('Saved');
 await preferences(page,'Appearance');await page.getByRole('button',{name:'Logos & branding',exact:true}).click();
 for(let index=0;index<4;index++){
  await page.getByLabel('Add logo',{exact:true}).setInputFiles({name:'logo.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="140" height="40"><rect width="140" height="40" fill="teal"/></svg>')});
  await expect(page.locator('.logo-editor')).toHaveCount(index+1,{timeout:15000});
 }
 await page.getByRole('button',{name:'Save branding',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
 const back=page.getByRole('button',{name:'Back to Appearance',exact:true});await back.focus();await page.keyboard.press('Enter');
 const alignment=page.getByLabel('Header alignment');await alignment.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(alignment).toHaveValue('right');
 await page.getByLabel('Logo and title order').selectOption('title-first');
 for(const width of [320,640]){
  await page.setViewportSize({width,height:900});await page.evaluate(zoom=>document.documentElement.style.zoom=zoom,width===640?'2':'1');await noOverflow(page);
  const bounds=await header(page).boundingBox(),menu=await page.getByRole('button',{name:'Menu',exact:true}).boundingBox();
  expect(bounds.x).toBeGreaterThan(menu.x+menu.width);
  expect(bounds.x+bounds.width).toBeLessThan(width);
  const name=await page.locator('.workspace-name').boundingBox();expect(name.width).toBeGreaterThan(25);
 }
});
