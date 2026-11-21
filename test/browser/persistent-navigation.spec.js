import {test,expect} from '@playwright/test';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';

test('navigation retains live nodes, disclosure, scroll and focus while pages and workspace contents change',async({page})=>{
 test.setTimeout(300000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-navigation-'));
 // Creating a dedicated project needs the application's database owner.
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 const book=sampleNotebook(),first=book.projects[0],second={...first,id:randomUUID(),title:'Instrument research'};
 book.projects.push(second);
 const moved=book.notebooks[0];
 for(let i=0;i<9;i++)book.notebooks.push({id:randomUUID(),projectId:first.id,title:'Field notebook '+(i+1)});
 book.notebooks.push({id:randomUUID(),projectId:second.id,title:'Calibration'});
 const f=await encryptedFixture(path.join(directory,'workspace'),book);
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const nav=page.locator('#main-navigation');
 const go=async(action)=>nav.locator('button[data-action="'+action+'"]').click();
 const stable=async()=>expect(await page.evaluate(()=>({
   shell:kept.shell===document.querySelector('.shell'),
   sidebar:kept.sidebar===document.querySelector('#main-navigation'),
   header:kept.header===document.querySelector('.workspace-identity'),
   projects:kept.projects.every(node=>node.isConnected),
   notebook:kept.notebook===document.querySelector('#main-navigation [data-action="filter-notebook"][data-id="'+kept.id+'"]')
 }))).toEqual({shell:true,sidebar:true,header:true,projects:true,notebook:true});
 try {
  await page.goto(app.url);await page.locator('.desk-card').first().waitFor();
  await page.evaluate(id=>{
   const sidebar=document.querySelector('#main-navigation'),projects=[...sidebar.querySelectorAll('.tree-project')];
   projects.forEach(node=>node.open=true);
   window.kept={shell:document.querySelector('.shell'),sidebar,header:document.querySelector('.workspace-identity'),projects,
     notebook:sidebar.querySelector('[data-action="filter-notebook"][data-id="'+id+'"]'),id};
   window.navMutations=[];
   new MutationObserver(records=>navMutations.push(...records)).observe(sidebar,{subtree:true,childList:true});
  },moved.id);
  await nav.locator('.notebook-link').first().focus();
  await page.evaluate(()=>{kept.sidebar.scrollTop=160;window.navScroll=kept.sidebar.scrollTop;navMutations.length=0;});
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp('/notebooks/'+moved.id));
  await stable();
  expect(await page.evaluate(()=>({scroll:kept.sidebar.scrollTop===navScroll,focus:document.activeElement===kept.notebook,open:kept.projects.every(node=>node.open),mutations:navMutations.length})))
   .toEqual({scroll:true,focus:true,open:true,mutations:0});
  // A user-closed active branch stays closed when revisiting the lab book.
  await nav.locator('.tree-project > summary').first().focus();await page.keyboard.press('Enter');
  await go('workspace');await page.goBack();
  await expect(page).toHaveURL(new RegExp('/notebooks/'+moved.id));
  await stable();expect(await page.evaluate(()=>kept.projects.map(node=>node.open))).toEqual([false,true]);
  expect(await page.evaluate(()=>navMutations.length)).toBe(0);
  await go('preferences');await page.locator('.preferences-tabs [data-action="dashboard-settings"]').click();
  await page.locator('[data-desk-module="resources"]').check();
  await expect(nav.locator('[data-module-nav="resources"]')).toBeVisible();await stable();
  await expect(page.locator('[data-desk-module="research"]')).toHaveCount(0);
  await page.locator('[data-desk-module="resources"]').uncheck();
  await expect(nav.locator('[data-module-nav="resources"]')).toBeHidden();
  await expect(nav.locator('[data-nav-section="projects"]')).toBeVisible();await stable();
  expect(await page.evaluate(()=>kept.projects.map(node=>node.open))).toEqual([false,true]);
  await nav.locator('.tree-project > summary').first().focus();await page.keyboard.press('Enter');
  await nav.locator('.notebook-link').first().click();
  await page.getByRole('button',{name:'Lab book settings',exact:true}).click();
  await page.getByLabel('Lab book name',{exact:true}).fill('Retained field journal');
  await page.locator('#dialog').getByLabel('Project',{exact:true}).selectOption(second.id);
  await page.getByRole('button',{name:'Save lab book',exact:true}).click();
  await expect(nav.locator('.notebook-link .tree-title').filter({hasText:'Retained field journal'})).toBeVisible();
  await stable();
  expect(await page.evaluate(()=>kept.notebook.closest('.tree-project')===kept.projects[1])).toBe(true);
  // New lab books belong to dedicated projects; projects held in the workspace keep theirs.
  const dialog=page.locator('#dialog');
  await go('projects');await page.locator('main').getByRole('button',{name:'New project',exact:true}).click();
  await dialog.getByLabel('Name',{exact:true}).fill('Field instruments');await dialog.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('main h1')).toHaveText('Field instruments');
  await page.locator('main').getByRole('button',{name:'New lab book',exact:true}).click();await dialog.getByLabel('Lab book name',{exact:true}).fill('New lab book');
  await dialog.getByLabel('Lab-book template',{exact:true}).selectOption('blank');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();
  await expect(nav.getByText('New lab book',{exact:true})).toBeVisible({timeout:60000});await stable();
  await go('workspace');
  await page.evaluate(()=>{kept.sidebar.scrollTop=170;scrollTo(0,0);});
  await page.screenshot({path:test.info().outputPath('persistent-sidebar.png')});
  // Responsive drawer uses the same tree; navigation closes it without resetting it.
  await page.setViewportSize({width:600,height:900});
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await go('preferences');
  await expect(nav).toBeHidden();
  await page.getByRole('button',{name:'Menu',exact:true}).click();
  await expect(nav).toBeVisible();await stable();
  expect(await page.evaluate(()=>kept.projects.every(node=>node.open))).toBe(true);
  expect(errors).toEqual([]);
 } finally {await app.close();await owner.close();detach();await clearVault(f.vault);if(path.dirname(directory)===path.resolve(os.tmpdir()))await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
