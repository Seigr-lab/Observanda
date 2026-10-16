import {TestDeviceStore as DeviceStore} from '../device-fixture.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {navigate,preferences,editWorkspace} from './preferences-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testServer as startServer} from '../device-fixture.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';

let app,root,parent,preferencesFile;
test.beforeEach(async()=>{parent=await mkdtemp(path.join(os.tmpdir(),'observanda-personalization-'));root=path.join(parent,'personal');preferencesFile=path.join(parent,'settings','preferences.json');app=await startServer({root,port:0,preferencesFile});});
test.afterEach(async()=>{await app.close();});
async function openStored(root){return new Workspace(root,await verifyAccess(await readAccess(root),'','',{deviceStore:new DeviceStore({file:preferencesFile+'.device-key'})}));}
const size=locator=>locator.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
async function range(locator,value){await locator.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}

test('app text scales menus, fields, dialogs and tables independently of website themes, persists and reflows on phones',async({page})=>{
  const book=sampleNotebook();book.entries[0].body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Unstyled record prose. '},{type:'text',text:'Authored size',marks:[{type:'text_size',attrs:{size:32}}]}]}]};
  await new Workspace(root).create(book);const original=await readFile(path.join(root,'observanda.json'),'utf8');
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);
  const initialTextSize=await size(page.locator('html')),initialMenuSize=await navSize(page,'Dashboard');
  expect(initialTextSize).toBeGreaterThanOrEqual(17);
  // Navigation has its own type scale; the preference must enlarge it proportionally.
  const enlargedMenuSize=initialMenuSize*24/initialTextSize;
  await preferences(page,'Appearance');
  await range(page.locator('main').getByRole('slider',{name:/App text size/}),24);await range(page.locator('main').getByRole('slider',{name:/App line spacing/}),1.9);
  await page.locator('main').getByRole('button',{name:'Save app settings',exact:true}).click();await expect(page.locator('main [data-interface-status]')).toContainText('Saved on this computer');
  expect(await size(page.getByRole('button',{name:'Save app settings',exact:true}))).toBe(24);
  expect(await navSize(page,'Dashboard')).toBeCloseTo(enlargedMenuSize,1);
  await navigate(page,'All records');
  expect(await size(page.locator('.records-table'))).toBe(24);
  await page.getByRole('button',{name:'Watching a seed unfold',exact:true}).click();
  expect(await size(page.getByLabel('Record title'))).toBeGreaterThanOrEqual(24);
  expect(await size(page.getByLabel('Summary / context'))).toBe(24);
  expect(await size(page.getByLabel('Summary / context').locator('.rt-size-32'))).toBe(32);
  expect(await page.getByLabel('Summary / context').evaluate(el=>parseFloat(getComputedStyle(el).lineHeight))).toBeCloseTo(24*1.9,1);
  await expect(page.locator('#save-status')).toHaveText('Saved');
  expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(original);
  await preferences(page,'Appearance');
  await expect(page.getByText('Readability checks',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/Studio/}).click();
  await expect(page.locator('main [data-interface="fontSize"]')).toHaveValue('24');
  await expect(page.frameLocator('#design-preview').locator('body')).toBeVisible();
  expect(await page.frameLocator('#design-preview').locator('body').evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(18);
  await page.locator('.section-save [data-action=save]').click();
  await page.reload();expect(await navSize(page,'Dashboard')).toBeCloseTo(enlargedMenuSize,1);
  await mkdir('.local/screenshots',{recursive:true});
  await page.screenshot({path:'.local/screenshots/app-text-24-desktop.png'});
  await page.setViewportSize({width:390,height:844});await noOverflow(page);
  await noOverflow(page);
  await expect(page.locator('main').getByRole('slider',{name:/App text size/})).toHaveValue('24');
  await page.screenshot({path:'.local/screenshots/app-text-24-phone-dialog.png'});

  expect(await navSize(page,'Dashboard')).toBeCloseTo(enlargedMenuSize,1);
  await editWorkspace(page);await noOverflow(page);
  expect(await size(page.getByLabel('Workspace name',{exact:true}))).toBe(24);
  await preferences(page,'Appearance');
  expect(errors).toEqual([]);
});

test('setup and settings accept personal, organizational and custom identities without rearranging records',async({page})=>{
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Text size',exact:true})).toHaveCount(0);
  await page.getByLabel('Workspace type').selectOption('custom');
  await page.getByLabel('Your own label').fill('Observatory & workshop');
  await page.getByLabel('Workspace name',{exact:true}).fill('Night observations');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByLabel('Use this device',{exact:false}).check();
  await expect(page.getByLabel('Your own label')).toHaveValue('Observatory & workshop');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('Night observations');expect((await (await openStored(root)).read()).book.identity.label).toBe('Observatory & workshop');
  const before=(await (await openStored(root)).read()).book;
  await editWorkspace(page);
  await page.getByLabel('Workspace type').selectOption('organization');
  await expect(page.getByLabel('Your own label')).toBeHidden();
  await page.getByLabel('Workspace name',{exact:true}).fill('Night research association');
  await page.getByRole('button',{name:'Save workspace',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();expect((await (await openStored(root)).read()).book.identity.kind).toBe('organization');
  await page.reload();await expect(page.locator('.workspace-name')).toHaveText('Night research association');
  const after=(await (await openStored(root)).read()).book;
  expect(after.id).toBe(before.id);expect(after.projects).toEqual(before.projects);expect(after.notebooks).toEqual(before.notebooks);expect(after.entries).toEqual(before.entries);
  expect(after.identity).toEqual({kind:'organization',label:''});
  await editWorkspace(page);
  await page.getByLabel('Workspace type').selectOption('custom');await page.getByLabel('Your own label').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button',{name:'Save workspace',exact:true}).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();await editWorkspace(page);await expect(page.getByLabel('Your own label')).toHaveValue('<img src=x onerror=alert(1)>');
  await expect(page.locator('#dialog img')).toHaveCount(0);
});

test('new workspaces and the recent list keep personal and laboratory data separate without losing text preferences',async({page})=>{
  const personal=sampleNotebook();personal.title='Personal fieldwork';await new Workspace(root).create(personal);
  const original=await readFile(path.join(root,'observanda.json'),'utf8');
  await page.goto(app.url);await preferences(page,'Appearance');
  await range(page.locator('main').getByRole('slider',{name:/App text size/}),21);await page.locator('main').getByRole('button',{name:'Save app settings',exact:true}).click();await expect(page.locator('main [data-interface-status]')).toContainText('Saved on this computer');const preservedNavigationSize=await navSize(page,'Projects');
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();
  await page.getByRole('button',{name:'New workspace',exact:true}).click();
  await expect(page.getByLabel('Workspace folder')).toHaveValue('');
  await page.getByRole('button',{name:'Cancel new workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('Personal fieldwork');
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await page.getByRole('button',{name:'New workspace',exact:true}).click();
  await page.getByLabel('Workspace type').selectOption('laboratory');await page.getByLabel('Workspace name',{exact:true}).fill('Materials lab');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();const lab=path.join(parent,'laboratory');await page.getByLabel('Workspace folder').fill(lab);await page.getByLabel('Use this device',{exact:false}).check();
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('#create-form')).toHaveCount(0);expect((await (await openStored(lab)).read()).book.identity.kind).toBe('laboratory');
  expect((await (await openStored(lab)).read()).book.entries).toHaveLength(0);
  expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(original);
  expect(await navSize(page,'Projects')).toBe(preservedNavigationSize);
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();
  await page.getByRole('button',{name:'Open Personal fieldwork',exact:true}).click();
  await expect(page.getByLabel('Workspace folder')).toHaveValue(root);
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('Personal fieldwork');
  expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(original);
  expect(await navSize(page,'Projects')).toBe(preservedNavigationSize);
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await expect(page.locator('.workspace-list article').filter({hasText:lab}).getByRole('button',{name:'Open workspace',exact:true})).toBeVisible();
  const settings=JSON.parse(await readFile(preferencesFile,'utf8'));expect(settings.recent.find(item=>item.path===lab).title).toBe('');expect(settings.interface.fontSize).toBe(21);expect(settings.recent.map(item=>item.path)).toEqual([root,lab]);
  await page.screenshot({path:test.info().outputPath('workspace-switcher.png')});
});

async function navSize(page,name){const menu=page.getByRole('button',{name:'Menu',exact:true});await menu.waitFor({state:'visible'});const target=page.locator('#main-navigation').getByRole('button',{name,exact:true}),closed=!await target.isVisible();if(closed)await menu.click();const result=await size(target);if(closed)await menu.click();return result;}
