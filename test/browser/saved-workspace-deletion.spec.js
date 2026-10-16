import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectCreation} from '../../src/project-creation.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm,access,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {rememberLocation,readPreferences} from '../../src/preferences.js';
import {clearVault} from '../../src/encryption.js';
import {createWorkspaceAccess,createAccess,takeCreatedVault} from '../../src/access.js';
import {initializeLocation} from '../../src/locations.js';
import {Workspace} from '../../src/storage.js';
import {preferences} from './preferences-helper.js';

test('every saved workspace has deletion; closed device, password and legacy owners delete in place',async({page})=>{
 test.setTimeout(240000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-saved-delete-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),prefs=path.join(directory,'settings.json'),targets=[];
 for(const [title,password,plain] of [['Closed device','',false],['Closed password','a-long-test-password',false],['Closed legacy','',true]]){
  const root=path.join(directory,title),access=plain?await createAccess():await createWorkspaceAccess('',password,f.deviceStore),vault=takeCreatedVault(access);
  await initializeLocation(root,{...sampleNotebook(),id:randomUUID(),title},access,vault);await rememberLocation(prefs,root,{title:'Saved workspace',label:'Workspace'});targets.push({root,title,password,vault,workspace:new Workspace(root,vault)});
 }
 const target=targets[0],registry=new ProjectRegistry(target.workspace,(await target.workspace.outline()).metadata.id),projectId=randomUUID(),created=await new ProjectCreation(registry,f.deviceStore).create({id:randomUUID(),username:'',password:'Protected project password',project:{id:projectId,title:'Saved private project',description:'',parentId:null,share:false,logoId:null}}),projectVault=await verifyAccess(await readAccess(created.project.root),'','Protected project password',{deviceStore:f.deviceStore});
 await new LabBookCreation(new ProjectStorage(created.project.root,projectId,projectVault),f.deviceStore).create({id:randomUUID(),username:'',password:'Protected book password',book:{id:randomUUID(),projectId,title:'Saved observations'}});
 await rememberLocation(prefs,f.workspace.root,{title:'Keep active',label:'Workspace'});
 const before=await f.workspace.read(),device=await readFile(f.deviceStore.file),app=await startServer({root:f.workspace.root,port:0,headless:true,preferencesFile:prefs,deviceStore:f.deviceStore}),errors=[],opened=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>{if(r.url().endsWith('/api/storage/open'))opened.push(r.url());});
 try{
  await page.goto(app.url);await page.evaluate(()=>window.deletionTestMarker='same document');await page.getByRole('button',{name:'Workspaces',exact:true}).click();
  const dialog=page.locator('#dialog'),management=page.locator('.workspace-management');await expect(management.getByRole('button',{name:'Delete workspace',exact:true})).toHaveCount(4);
  for(const target of targets){
   await management.locator('article').filter({hasText:target.root}).getByRole('button',{name:'Delete workspace',exact:true}).click();
   if(target.password){
    await expect(dialog.locator('#storage-delete-unlock-form')).toBeVisible();await dialog.getByLabel('Workspace password',{exact:true}).fill('incorrect-password');await dialog.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(dialog.getByRole('button',{name:'Continue',exact:true})).toBeEnabled();await expect(dialog.locator('#storage-delete-unlock-form')).toBeVisible();
    await dialog.getByLabel('Workspace password',{exact:true}).fill(target.password);await dialog.getByRole('button',{name:'Continue',exact:true}).click();
   }
   await expect(dialog.getByRole('heading',{name:'Permanently delete workspace',exact:true})).toBeVisible();await expect(dialog.getByText(target.root,{exact:true})).toBeVisible();
   await dialog.getByLabel('Type the workspace name to confirm').fill(target.title);await dialog.getByRole('checkbox').check();
   if(target===targets[0])await page.screenshot({path:test.info().outputPath('saved-workspace-delete-review.png')});
   await dialog.getByRole('button',{name:'Delete workspace',exact:true}).click();
   if(target===targets[0]){
    await expect(dialog.getByLabel('Project password',{exact:true})).toBeVisible();await expect(dialog.getByText('Saved private project',{exact:true})).toBeVisible();await dialog.locator('[data-project-unlock-cancel]').click();await expect(dialog).not.toBeVisible();await expect(management.getByRole('heading',{name:'Workspaces',exact:true})).toBeVisible();await access(target.root);
    await management.locator('article').filter({hasText:target.root}).getByRole('button',{name:'Delete workspace',exact:true}).click();await dialog.getByLabel('Type the workspace name to confirm').fill(target.title);await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Delete workspace',exact:true}).click();
    for(const [label,password] of [['Project password','Protected project password'],['Lab book password','Protected book password']]){await expect(dialog.getByLabel(label,{exact:true})).toBeVisible();await dialog.getByLabel(label,{exact:true}).fill(password);await dialog.getByRole('button',{name:'Unlock',exact:true}).click();}
   }
   await expect(management.getByRole('heading',{name:'Workspaces',exact:true})).toBeVisible({timeout:60000});
   await expect(management.getByText(target.root,{exact:true})).toHaveCount(0,{timeout:60000});await expect(dialog).not.toBeVisible();await expect(management.getByText(f.workspace.root,{exact:true})).toBeVisible();await expect(access(target.root)).rejects.toMatchObject({code:'ENOENT'});
  }
  expect((await readPreferences(prefs)).workspace).toBe(f.workspace.root);expect(await f.workspace.read()).toEqual(before);expect(await readFile(f.deviceStore.file)).toEqual(device);
  expect(opened).toEqual([]);expect(errors).toEqual([]);expect(await page.evaluate(()=>window.deletionTestMarker)).toBe('same document');
  await preferences(page,'General');await expect(page.locator('#create-form')).toHaveCount(0);await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('workspace');await expect(page.locator('#leave-dialog')).not.toBeVisible();
 }finally{await app.close();await owner.close();detach();clearVault(projectVault);clearVault(f.vault);targets.forEach(t=>clearVault(t.vault));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
