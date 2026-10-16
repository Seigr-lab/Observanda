import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {navigate,preferences} from './preferences-helper.js';
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {createNotebook} from '../../src/model.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

test('normal project creation owns its database, directory and independently navigable subprojects',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-directory-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];let app;
 try{
  const book=createNotebook('Workspace',''),f=await encryptedFixture(path.join(directory,'workspace'),book);vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,book.id);
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  await page.locator('#workspace-navigation [data-action=projects]').click();
  await page.locator('main').getByRole('button',{name:'New project',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByLabel('Name',{exact:true}).fill('Field science');await dialog.getByLabel('Description',{exact:true}).fill('Portable authoring');
  await expect(dialog.locator('[name=projectPath]')).toHaveCount(0);await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('main h1')).toHaveText('Field science');
  const entry=(await registry.read()).value.projects[0];expect(entry.summary.title).toBe('Field science');expect(entry.root).toBe(path.join(f.workspace.root,'Field science'));expect((await f.workspace.outline()).metadata.projects).toHaveLength(0);
  const vault=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:f.deviceStore});vaults.push(vault);let project=new ProjectStorage(entry.root,entry.projectId,vault);expect((await project.outline()).metadata.projects[0].title).toBe('Field science');
  await page.locator('main').getByRole('button',{name:'Settings',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('Field ecology');await dialog.getByRole('button',{name:'Save project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('main h1')).toHaveText('Field ecology');
  const renamed=await registry.locate(entry.projectId);expect(renamed.root).toBe(path.join(f.workspace.root,'Field ecology'));project=new ProjectStorage(renamed.root,entry.projectId,vault);
  await page.locator('main').getByRole('button',{name:'New subproject',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('Stream observations');await expect(dialog.getByLabel('Inside',{exact:true})).toHaveValue(entry.projectId);await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('main h1')).toHaveText('Stream observations');
  const entries=(await registry.read()).value.projects,child=entries.find(p=>p.parentId===entry.projectId);expect(child.summary.title).toBe('Stream observations');expect((await project.outline()).metadata.projects).toHaveLength(1);
  await page.locator('#workspace-navigation [data-action=projects]').click();await expect(page.locator('[data-project-directory=root]')).toContainText('Field ecology');await expect(page.locator('[data-project-directory=root]')).not.toContainText('Stream observations');
  await page.locator('[data-project-directory=root] [data-action=open-project]').click();await expect(page.locator('main h1')).toHaveText('Field ecology');await expect(page.locator('[data-project-directory="'+entry.projectId+'"]')).toContainText('Stream observations');
  await page.reload();await expect(page.locator('main h1')).toHaveText('Field ecology');await expect(page.locator('[data-project-directory="'+entry.projectId+'"]')).toContainText('Stream observations');
  await expect(page.locator('[data-project-storage]')).toContainText(renamed.root);await expect(page.locator('#project-recent-records')).not.toContainText('Loading');
  await page.locator('[data-project-directory="'+entry.projectId+'"] [data-action=open-project]').click();await expect(page.locator('main h1')).toHaveText('Stream observations');
  await page.locator('main .page-heading').getByRole('button',{name:'Settings',exact:true}).click();await dialog.getByLabel('Inside',{exact:true}).selectOption('');await expect.poll(async()=> (await registry.locate(child.projectId)).parentId,{timeout:60000}).toBe(null);expect((await registry.locate(child.projectId)).root).toBe(path.join(f.workspace.root,'Stream observations'));await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('#leave-dialog')).not.toBeVisible();
  await page.locator('#workspace-navigation [data-action=projects]').click();await expect(page.locator('[data-project-directory=root]')).toContainText('Stream observations');
  await expect(page.locator('.app-activity [data-toggle]')).toHaveText('Activity');
  await page.screenshot({path:test.info().outputPath('project-directory.png'),fullPage:true});expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await owner.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-directory-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});


test('document workspace navigation keeps embedded projects without polling catalogue recovery',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-document-directory-ui-')),book=sampleNotebook(),root=path.join(directory,book.title),requests=[],failures=[];let app;
 try{
  await new Workspace(root).create(book);app=await testServer({root,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});
  page.on('request',request=>{const route=new URL(request.url()).pathname;if(route==='/api/projects/list'||/^\/api\/projects\/(?:open|create|delete|move)\/pending$/.test(route))requests.push(route);});
  page.on('pageerror',error=>failures.push(error.message));page.on('response',response=>{if(response.status()>=400)failures.push(response.url()+': '+response.status());});
  await page.goto(app.url);await navigate(page,'Projects');await expect(page.locator('.project-grid')).toContainText(book.projects[0].title);
  await page.locator('main').getByRole('button',{name:book.projects[0].title,exact:true}).click();await expect(page.locator('main h1')).toHaveText(book.projects[0].title);
  await preferences(page,'Appearance');await expect(page.getByRole('heading',{name:'Appearance',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Appearance',exact:true})).toBeVisible();await navigate(page,'Projects');await expect(page.locator('.project-grid')).toContainText(book.projects[0].title);
  await page.getByRole('button',{name:'Dashboard',exact:true}).click();await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();expect(requests).toEqual([]);expect(failures).toEqual([]);
 }finally{await page.close();await app?.close();assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-document-directory-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
