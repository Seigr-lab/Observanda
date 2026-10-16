import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {ProjectModuleCommands} from '../../src/project-module-commands.js';
import {ProjectModuleReader} from '../../src/project-module-reader.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

test('project sidebar inventory and planning retain their database while global tools return to the workspace',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-module-navigation-'));
 const runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),vaults=[],errors=[],requests=[];
 let app;
 try{
  const rootBook=sampleNotebook(),f=await encryptedFixture(directory,rootBook);vaults.push(f.vault);
  const settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules=['resources','planning'];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
  const book=sampleNotebook();book.title=book.projects[0].title='Project instruments';book.projects[0].tools=['resources','planning'];
  const projectId=book.projects[0].id,access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);
  const storage=await initializeProjectLocation(path.join(f.workspace.root,book.title),projectId,book,access,vault),commands=new ProjectModuleCommands(storage,book.id);await commands.initialize();
  const registry=new ProjectRegistry(f.workspace,rootBook.id);await registry.attach(storage,{expected:(await registry.read()).revision});
  const options={root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')};app=await testServer(options);
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/modules/command'))requests.push({path:new URL(r.url()).pathname,data:r.postDataJSON()});});
  const main=page.locator('main'),nav=page.locator('#workspace-navigation'),projectTool=id=>nav.locator('details[data-project-id="'+projectId+'"] > [data-module-id="'+id+'"]');
  await page.goto(app.url);await page.goto(app.origin+'/#/owners/'+projectId+'/projects/'+projectId);
  await expect(projectTool('resources')).toBeVisible();await projectTool('resources').click();
  await expect(page).toHaveURL(new RegExp('/owners/'+projectId+'/modules/resources/'));
  await main.getByRole('button',{name:'New item',exact:true}).click();await main.getByLabel('Item name',{exact:true}).fill('Bench instrument');await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.getByRole('heading',{name:'Placement',exact:true})).toBeVisible();await main.getByRole('button',{name:'Details',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  const reader=new ProjectModuleReader(storage,book.id),rootReader=new ProjectModuleReader(f.workspace,rootBook.id),list=await reader.list({workspaceId:book.id,type:'resource'}),item=list.items[0];
  expect(list.total).toBe(1);expect(item.title).toBe('Bench instrument');expect((await rootReader.list({workspaceId:rootBook.id,type:'resource'})).total).toBe(0);
  await main.getByRole('button',{name:'Details',exact:true}).click();await main.getByLabel('Item name',{exact:true}).fill('Calibrated bench instrument');await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  await projectTool('planning').click();await expect(page).toHaveURL(new RegExp('/owners/'+projectId+'/modules/planning/'));await expect(main.locator('[data-calendar-view]')).toBeVisible();
  await main.locator('[data-command="list"][data-type="task"]').click();await main.getByRole('button',{name:'New task',exact:true}).click();await main.getByLabel('Task title',{exact:true}).fill('Inspect the instrument');await main.getByRole('button',{name:'Save task',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  expect((await reader.list({workspaceId:book.id,type:'task'})).items.map(item=>item.title)).toEqual(['Inspect the instrument']);expect((await rootReader.list({workspaceId:rootBook.id,type:'task'})).total).toBe(0);
  await nav.locator('[data-module-nav="resources"] [data-module-id="resources"]').click();await expect(page).toHaveURL(/#\/modules\/resources/);await expect(main.locator('[data-module-items-status]')).toContainText('No matching');
  await nav.getByRole('button',{name:'Projects',exact:true}).click();await main.locator('.location-tools [data-module-id="resources"]').click();await expect(page).toHaveURL(/#\/modules\/resources\/scope\/workspace\/resource/);await expect(main.locator('[data-module-items-status]')).toContainText('No matching');
  expect(requests.length).toBe(3);expect(requests.every(request=>request.path==='/api/projects/'+projectId+'/modules/command'&&request.data.workspaceId===book.id)).toBe(true);
  await page.goto('about:blank');await app.close();app=await testServer(options);
  await page.goto(app.url);await page.goto(app.origin+'/#/owners/'+projectId+'/projects/'+projectId);await expect(projectTool('resources')).toBeVisible();await projectTool('resources').click();await main.getByRole('button',{name:'Open item',exact:true}).click();
  await expect(main.getByLabel('Item name',{exact:true})).toHaveValue('Calibrated bench instrument');await main.getByRole('button',{name:'History',exact:true}).click();await main.locator('[data-command="history-open"][data-revision="1"]').click();await expect(main.locator('.module-history')).toContainText('Bench instrument');
  expect((await reader.selected({workspaceId:book.id,id:item.id})).entity.data.name).toBe('Calibrated bench instrument');expect((await rootReader.list({workspaceId:rootBook.id,type:'resource'})).total).toBe(0);expect(errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath('project-inventory-history.png'),fullPage:true});
 }finally{
  await page.close();await app?.close();await runtime.close();detach();vaults.forEach(clearVault);
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-module-navigation-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
