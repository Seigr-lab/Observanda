import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {createNotebook} from '../../src/model.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {emptyConfiguration} from '../../src/web/notebook-schema.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('parent and saved-template choices find unloaded projects, retain edited fields and never open unrelated databases',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-choices-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];let app;
 try{
  const book=createNotebook('Workspace',''),f=await encryptedFixture(path.join(directory,'workspace'),book);vaults.push(f.vault);const registry=new ProjectRegistry(f.workspace,book.id);
  const research=sampleNotebook(),project=research.projects[0];research.title=project.title='Zoology';project.labBookTemplate={name:'Zoology starter',configuration:emptyConfiguration()};
  const access=await createWorkspaceAccess('','Template password',f.deviceStore),vault=takeCreatedVault(access);vaults.push(vault);const storage=await initializeProjectLocation(path.join(directory,'Zoology'),project.id,research,access,vault);await registry.attach(storage,{expected:(await registry.read()).revision});
  await registry.change((await registry.read()).revision,value=>{value.projects.unshift(...Array.from({length:61},(_,i)=>({projectId:randomUUID(),parentId:null,root:path.join(directory,'unavailable-'+i),namespaceId:randomUUID(),vaultId:randomUUID(),summary:{title:'Archive '+i,description:'',kind:'Project',templateName:'Archive template '+i}})));return value;});
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();await page.locator('#workspace-navigation [data-action=projects]').click();
  await expect(page.locator('[data-project-directory=root]')).not.toContainText('Zoology');await page.locator('main').getByRole('button',{name:'New project',exact:true}).click();const dialog=page.locator('#dialog');
  await expect(dialog.locator('[data-project-choices=parents] [data-choice-status]')).toHaveText('25 of 62');
  await dialog.getByLabel('Name',{exact:true}).fill('Field study');await dialog.getByLabel('Description',{exact:true}).fill('Keep these edits while searching');
  await dialog.locator('[data-project-choices=parents]').getByRole('button',{name:'More choices',exact:true}).click();await expect(dialog.locator('[name=parentId] option')).toHaveCount(51);
  const input=dialog.getByRole('searchbox',{name:'Search projects',exact:true});await input.fill('zoology');await expect(dialog.locator('[data-project-choices=parents] [data-choice-status]')).toHaveText('1 of 1');await expect(input).toBeFocused();await expect(dialog.getByLabel('Name',{exact:true})).toHaveValue('Field study');await expect(dialog.getByLabel('Description',{exact:true})).toHaveValue('Keep these edits while searching');
  await dialog.getByLabel('Inside',{exact:true}).selectOption(project.id);await input.fill('Archive 60');await expect(dialog.locator('[data-project-choices=parents] [data-choice-status]')).toHaveText('1 of 1');await expect(dialog.getByLabel('Inside',{exact:true})).toHaveValue(project.id);
  await dialog.getByRole('searchbox',{name:'Search saved templates',exact:true}).fill('zoology');await expect(dialog.locator('[data-project-choices=templates] [data-choice-status]')).toHaveText('1 of 1');await dialog.getByLabel('Default lab-book template',{exact:true}).selectOption('project:'+project.id);
  await expect(dialog.locator('#project-unlock-form')).toBeVisible();await dialog.getByLabel('Project password',{exact:true}).fill('Template password');await dialog.getByRole('button',{name:'Unlock',exact:true}).click();await expect(dialog.locator('#structure-project-form')).toBeVisible();await expect(dialog.getByLabel('Default lab-book template',{exact:true})).toHaveValue('project:'+project.id);
  await dialog.getByRole('searchbox',{name:'Search saved templates',exact:true}).fill('Archive 60');await expect(dialog.locator('[data-project-choices=templates] [data-choice-status]')).toHaveText('1 of 1');await expect(dialog.getByLabel('Default lab-book template',{exact:true})).toHaveValue('project:'+project.id);await expect(dialog.getByLabel('Name',{exact:true})).toHaveValue('Field study');
  await page.screenshot({path:test.info().outputPath('project-choices-desktop.png')});await page.setViewportSize({width:600,height:850});await page.screenshot({path:test.info().outputPath('project-choices-narrow.png')});expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('main h1')).toHaveText('Field study');const child=(await registry.read()).value.projects.find(entry=>entry.summary?.title==='Field study');expect(child.parentId).toBe(project.id);expect(child.summary.templateName).toBe('Zoology starter');
  await page.locator('main .page-heading').getByRole('button',{name:'Settings',exact:true}).click();await expect(dialog.getByLabel('Inside',{exact:true})).toHaveValue(project.id);await dialog.getByRole('searchbox',{name:'Search projects',exact:true}).fill('missing choice');await expect(dialog.locator('[data-project-choices=parents] [data-choice-status]')).toHaveText('0 of 0');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('#leave-dialog')).not.toBeVisible();expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await owner.close();detach();vaults.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-choices-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
