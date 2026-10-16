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
import {ProjectCreation} from '../../src/project-creation.js';
import {clearVault} from '../../src/encryption.js';

test('Projects discovers interrupted creation after service restart and resumes the same protected project',async({page,context})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-creation-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),attach=ProjectRegistry.prototype.attach;let app,vault,view=page,interruptedId,failed=false;
 try{
  const book=createNotebook('Workspace',''),f=await encryptedFixture(path.join(directory,'workspace'),book);vault=f.vault;
  const registry=new ProjectRegistry(f.workspace,book.id),creation=new ProjectCreation(registry,f.deviceStore),options={root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')};
  ProjectRegistry.prototype.attach=async function(storage,settings){if(!failed&&this.workspace.root===f.workspace.root){failed=true;interruptedId=storage.projectId;throw Error('Interrupted before project registration');}return attach.call(this,storage,settings);};
  app=await testServer(options);await view.goto(app.url);await view.locator('#workspace-navigation [data-action=projects]').click();
  await view.locator('main').getByRole('button',{name:'New project',exact:true}).click();
  let dialog=view.locator('#dialog');await dialog.getByLabel('Name',{exact:true}).fill('Recovered project');await dialog.getByLabel(/^Project password/).fill('My retained project password');await dialog.getByRole('button',{name:'Create project',exact:true}).click();
  await expect(dialog.locator('[data-project-error]')).not.toBeEmpty({timeout:60000});expect((await registry.read()).value.projects).toHaveLength(0);expect((await creation.pending()).items[0].projectId).toBe(interruptedId);
  ProjectRegistry.prototype.attach=attach;await view.close();await app.close();app=null;await owner.closeProject(path.join(directory,'protected'));
  app=await testServer(options);view=await context.newPage();const errors=[];view.on('pageerror',e=>errors.push(e.message));await view.goto(app.url);await view.locator('#workspace-navigation [data-action=projects]').click();
  const recovery=view.locator('[data-project-creation-recovery]');await expect(recovery).toContainText('Finish creating Recovered project');await view.screenshot({path:test.info().outputPath('unfinished-project.png'),fullPage:true});await view.setViewportSize({width:600,height:850});await expect(recovery.getByRole('button',{name:'Resume creation',exact:true})).toBeVisible();await view.screenshot({path:test.info().outputPath('unfinished-project-narrow.png'),fullPage:true});await view.setViewportSize({width:1440,height:1000});await recovery.getByRole('button',{name:'Resume creation',exact:true}).click();
  dialog=view.locator('#dialog');await dialog.getByLabel('Project password',{exact:true}).fill('Wrong password');await dialog.getByRole('button',{name:'Resume creation',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(recovery.locator('[role=alert]')).toBeVisible();expect((await registry.read()).value.projects).toHaveLength(0);
  await recovery.getByRole('button',{name:'Resume creation',exact:true}).click();await dialog.getByLabel('Project password',{exact:true}).fill('My retained project password');await dialog.getByRole('button',{name:'Resume creation',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(recovery).not.toBeVisible({timeout:60000});await expect(view.locator('[data-project-directory=root]')).toContainText('Recovered project');
  const entries=(await registry.read()).value.projects;expect(entries).toHaveLength(1);expect(entries[0].projectId).toBe(interruptedId);expect(entries[0].root).toBe(path.join(directory,'protected'));expect((await creation.pending()).items).toHaveLength(0);
  await view.locator('[data-project-directory=root] [data-action=open-project]').click();await expect(view.locator('main h1')).toHaveText('Recovered project');await expect(dialog).not.toBeVisible();
  await view.locator('#workspace-navigation [data-action=projects]').click();await expect(view.locator('[data-project-directory=root]')).toContainText('Recovered project');await expect(view.locator('.app-activity [data-toggle]')).toHaveText('Activity');await expect(view.locator('[data-owned-activity] [data-operation]')).toHaveCount(0);await view.screenshot({path:test.info().outputPath('recovered-project.png'),fullPage:true});expect(errors).toEqual([]);
 }finally{ProjectRegistry.prototype.attach=attach;await view.close();await app?.close();await owner.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-creation-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
