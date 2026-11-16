import {navigate,preferences,editWorkspace} from './preferences-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testServer as startServer} from '../device-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';

let app,parent,preferencesFile,fixture;
test.beforeEach(async()=>{parent=await mkdtemp(path.join(os.tmpdir(),'observanda-personalization-'));preferencesFile=path.join(parent,'settings','preferences.json');app=null;fixture=null;});
test.afterEach(async()=>{await app?.close();if(fixture)await clearVault(fixture.vault);await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
const size=locator=>locator.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
async function range(locator,value){await locator.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},String(value));}
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
async function navSize(page,name){const menu=page.getByRole('button',{name:'Menu',exact:true});await menu.waitFor({state:'visible'});const target=page.locator('#main-navigation').getByRole('button',{name,exact:true}),closed=!await target.isVisible();if(closed)await menu.click();const result=await size(target);if(closed)await menu.click();return result;}
// Setup asks for the type and name first, then the folder to create the workspace in;
// the workspace folder is named after the workspace and preferences record where it is.
async function setupWorkspace(page,{type,label,name,folder}){
 await page.getByLabel('Workspace type').selectOption(type);if(label)await page.getByLabel('Your own label').fill(label);
 await page.getByLabel('Workspace name',{exact:true}).fill(name);
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
 await mkdir(folder,{recursive:true});await page.getByLabel('Create in',{exact:true}).fill(folder);await page.getByLabel('Use this device',{exact:false}).check();
 await page.getByRole('button',{name:'Create workspace',exact:true}).click();
 await expect(page.locator('.workspace-name')).toHaveText(name,{timeout:60000});
 return JSON.parse(await readFile(preferencesFile,'utf8')).workspace;
}

test('app text scales menus, fields, dialogs and tables independently of website themes, persists and reflows on phones',async({page})=>{
  const book=sampleNotebook();book.entries[0].body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Unstyled record prose. '},{type:'text',text:'Authored size',marks:[{type:'text_size',attrs:{size:32}}]}]}]};
  fixture=await encryptedFixture(path.join(parent,'personal'),book);
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);
  const initialTextSize=await size(page.locator('html')),initialMenuSize=await navSize(page,'Dashboard');
  // Opening names the workspace after its folder; the research is compared from here on.
  const original=JSON.stringify((await fixture.workspace.read()).book);
  expect(initialTextSize).toBeGreaterThanOrEqual(17);
  // Navigation has its own type scale; the preference must enlarge it proportionally.
  const enlargedMenuSize=initialMenuSize*24/initialTextSize;
  await preferences(page,'App appearance');
  await range(page.locator('main').getByRole('slider',{name:/App text size/}),24);await range(page.locator('main').getByRole('slider',{name:/App line spacing/}),1.9);
  await page.locator('main').getByRole('button',{name:'Save app settings',exact:true}).click();await expect(page.locator('main [data-interface-status]')).toContainText('Saved on this computer');
  expect(await size(page.getByRole('button',{name:'Save app settings',exact:true}))).toBe(24);
  expect(await navSize(page,'Dashboard')).toBeCloseTo(enlargedMenuSize,1);
  await navigate(page,'All records');
  expect(await size(page.locator('.records-table'))).toBe(24);
  // Authored text sizes keep their own size inside app text.
  await page.locator('.records-table').getByRole('link',{name:'Watching a seed unfold',exact:true}).or(page.locator('.records-table').getByRole('button',{name:'Watching a seed unfold',exact:true})).first().click();
  const prose=page.locator('.record-reader .prose').first();await expect(prose).toBeVisible();
  expect(await size(prose)).toBe(24);
  expect(await size(prose.locator('.rt-size-32'))).toBe(32);
  // App text never changes the workspace's research.
  expect(JSON.stringify((await fixture.workspace.read()).book)).toBe(original);
  await preferences(page,'App appearance');
  await expect(page.locator('main').getByRole('slider',{name:/App text size/})).toHaveValue('24');
  await page.reload();expect(await navSize(page,'Dashboard')).toBeCloseTo(enlargedMenuSize,1);
  await page.setViewportSize({width:390,height:844});await noOverflow(page);
  await expect(page.locator('main').getByRole('slider',{name:/App text size/})).toHaveValue('24');
  expect(await navSize(page,'Dashboard')).toBeCloseTo(enlargedMenuSize,1);
  await editWorkspace(page);await noOverflow(page);
  expect(await size(page.getByLabel('Workspace name',{exact:true}))).toBe(24);
  expect(errors).toEqual([]);
});

test('setup and settings accept personal, organizational and custom identities and keep them after reopening',async({page})=>{
  const folder=path.join(parent,'night');
  app=await startServer({root:folder,port:0,preferencesFile});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Text size',exact:true})).toHaveCount(0);
  await setupWorkspace(page,{type:'custom',label:'Observatory & workshop',name:'Night observations',folder});
  // The identity chosen in setup is what the workspace settings show after reopening.
  await page.reload();await editWorkspace(page);
  await expect(page.getByLabel('Workspace type')).toHaveValue('custom');await expect(page.getByLabel('Your own label')).toHaveValue('Observatory & workshop');
  await page.getByLabel('Workspace type').selectOption('organization');
  await expect(page.getByLabel('Your own label')).toBeHidden();
  await page.getByLabel('Workspace name',{exact:true}).fill('Night research association');
  await page.getByRole('button',{name:'Save workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText('Night research association',{timeout:30000});
  await page.reload();await expect(page.locator('.workspace-name')).toHaveText('Night research association');
  await editWorkspace(page);await expect(page.getByLabel('Workspace type')).toHaveValue('organization');await expect(page.getByLabel('Your own label')).toBeHidden();
  // A label is plain text, never markup.
  await page.getByLabel('Workspace type').selectOption('custom');await page.getByLabel('Your own label').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button',{name:'Save workspace',exact:true}).click();await expect(page.getByRole('button',{name:'Save workspace',exact:true})).toBeDisabled();
  await page.reload();await editWorkspace(page);await expect(page.getByLabel('Your own label')).toHaveValue('<img src=x onerror=alert(1)>');
  await expect(page.locator('main img[src="x"]')).toHaveCount(0);
});

test('new workspaces and the recent list keep personal and laboratory data separate without losing text preferences',async({page})=>{
  const personal=sampleNotebook();personal.title='Personal fieldwork';
  fixture=await encryptedFixture(path.join(parent,'personal'),personal);const root=fixture.workspace.root;
  app=await startServer({root,deviceStore:fixture.deviceStore,port:0,preferencesFile});
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toBeVisible();const original=JSON.stringify((await fixture.workspace.read()).book);const title=await page.locator('.workspace-name').innerText();
  await preferences(page,'App appearance');
  await range(page.locator('main').getByRole('slider',{name:/App text size/}),21);await page.locator('main').getByRole('button',{name:'Save app settings',exact:true}).click();await expect(page.locator('main [data-interface-status]')).toContainText('Saved on this computer');
  const preservedNavigationSize=await navSize(page,'Projects');
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();
  await page.getByRole('button',{name:'New workspace',exact:true}).click();
  await page.getByRole('button',{name:'Cancel new workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(title);
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await page.getByRole('button',{name:'New workspace',exact:true}).click();
  const lab=await setupWorkspace(page,{type:'laboratory',name:'Materials lab',folder:path.join(parent,'laboratory')});
  await editWorkspace(page);await expect(page.getByLabel('Workspace type')).toHaveValue('laboratory');
  expect(JSON.stringify((await fixture.workspace.read()).book)).toBe(original);
  expect(await navSize(page,'Projects')).toBe(preservedNavigationSize);
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();
  await page.getByRole('button',{name:'Open '+title,exact:true}).click();
  await expect(page.getByLabel('Workspace folder')).toHaveValue(root);
  await page.getByRole('dialog',{name:'Open an existing workspace'}).getByRole('button',{name:'Open workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(title);
  expect(JSON.stringify((await fixture.workspace.read()).book)).toBe(original);
  expect(await navSize(page,'Projects')).toBe(preservedNavigationSize);
  const settings=JSON.parse(await readFile(preferencesFile,'utf8'));expect(settings.interface.fontSize).toBe(21);expect(settings.recent.map(item=>item.path)).toEqual([root,lab]);
});
