import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectCreation} from '../../src/project-creation.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm,access,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {WorkspaceDeletions} from '../../src/workspace-deletion.js';
import {rememberLocation,readPreferences} from '../../src/preferences.js';
import {clearVault} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';

test('deleting from Workspaces confirms the name, clears local bindings, and leaves another workspace usable',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-delete-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'application'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),f=await encryptedFixture(directory,sampleNotebook()),other=await encryptedFixture(path.join(directory,'other'),sampleNotebook());
 const prefs=path.join(directory,'settings.json');await rememberLocation(prefs,other.workspace.root,{title:'Keep this workspace',label:'Workspace'});await rememberLocation(prefs,f.workspace.root,{title:'Delete this workspace',label:'Workspace'});
 const registry=new ProjectRegistry(f.workspace,(await f.workspace.outline()).metadata.id),projectId=randomUUID(),created=await new ProjectCreation(registry,f.deviceStore).create({id:randomUUID(),username:'',password:'Protected project password',project:{id:projectId,title:'Protected project',description:'',parentId:null,share:false,logoId:null}}),projectVault=await verifyAccess(await readAccess(created.project.root),'','Protected project password',{deviceStore:f.deviceStore});
 await new LabBookCreation(new ProjectStorage(created.project.root,projectId,projectVault),f.deviceStore).create({id:randomUUID(),username:'',password:'Protected book password',book:{id:randomUUID(),projectId,title:'Protected observations'}});
 const deviceBefore=await readFile(f.deviceStore.file),app=await startServer({root:f.workspace.root,port:0,headless:true,preferencesFile:prefs,deviceStore:f.deviceStore});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await page.getByRole('button',{name:'Workspaces',exact:true}).click();
  const dialog=page.locator('#dialog');await page.locator('.workspace-management article').filter({hasText:f.workspace.root}).getByRole('button',{name:'Delete workspace',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Permanently delete workspace'})).toBeVisible();
  await expect(dialog.getByText(f.workspace.root,{exact:true})).toBeVisible();
  await expect(dialog.getByText("The workspace's dedicated PostgreSQL database will also be removed.",{exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('workspace-delete-dialog.png')});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await access(f.workspace.root);
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Delete workspace',exact:true}).click();
  await dialog.getByLabel('Type the workspace name to confirm').fill('wrong name');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Delete workspace',exact:true}).click();
  await expect(dialog).toBeVisible();await access(f.workspace.root);
  await dialog.getByLabel('Type the workspace name to confirm').fill(path.basename(f.workspace.root));
  await dialog.getByRole('button',{name:'Delete workspace',exact:true}).click();
  for(const [label,password] of [['Project password','Protected project password'],['Lab book password','Protected book password']]){
   await expect(dialog.getByLabel(label,{exact:true})).toBeVisible();await dialog.getByLabel(label,{exact:true}).fill(password);await dialog.getByRole('button',{name:'Unlock',exact:true}).click();
  }
  await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('#create-form')).toBeVisible();
  await expect(access(f.workspace.root)).rejects.toMatchObject({code:'ENOENT'});
  const saved=await readPreferences(prefs);expect(saved.workspace).toBe(null);expect(saved.recent.map(r=>r.path)).toEqual([other.workspace.root]);
  expect(await readFile(f.deviceStore.file)).toEqual(deviceBefore);expect((await other.workspace.read()).book.title).toBe(sampleNotebook().title);
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();await expect(page.locator('.workspace-management').getByText(other.workspace.root,{exact:true})).toBeVisible();await expect(page.locator('.workspace-management').getByText(f.workspace.root,{exact:true})).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{await app.close();await owner.close();detach();clearVault(f.vault);clearVault(other.vault);clearVault(projectVault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

for(const interruption of ['frozen','retired'])test('restart exposes unfinished deletion after '+interruption+' and Finish deletion removes its remaining data',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-delete-resume-ui-')),f=await encryptedFixture(directory,sampleNotebook()),prefs=path.join(directory,'settings.json');
 await rememberLocation(prefs,f.workspace.root,{title:'Pending workspace',label:'Workspace'});
 const deletion=new WorkspaceDeletions(prefs+'.workspace-deletions');
 await expect(deletion.begin(f.workspace,await deletion.review(f.workspace),{checkpoint:phase=>{if(phase===interruption)throw Error('interrupted');}})).rejects.toThrow('interrupted');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,preferencesFile:prefs,deviceStore:f.deviceStore});
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Workspaces',exact:true}).click();const dialog=page.locator('#dialog');
  await expect(page.locator('.workspace-management').getByRole('heading',{name:'Unfinished workspace deletions',exact:true})).toBeVisible();await page.locator('.workspace-management').getByRole('button',{name:'Finish deletion',exact:true}).click();
  await page.setViewportSize({width:760,height:950});await dialog.getByRole('button',{name:'Finish deletion',exact:true}).click();
  await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('.workspace-management').getByRole('heading',{name:'Workspaces',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Unfinished workspace deletions',exact:true})).toHaveCount(0);
  await expect(access(f.workspace.root)).rejects.toMatchObject({code:'ENOENT'});expect(await deletion.list()).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
