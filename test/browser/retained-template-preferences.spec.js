import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {ConfigurationDocuments} from '../../src/configuration-documents.js';
import {starterTemplate} from '../../src/web/project-templates.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sourceAssets} from './built-assets-helper.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectCreation} from '../../src/project-creation.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {randomUUID} from 'node:crypto';

test('retained template choices recover without losing typed names, focus or saved definitions',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-template-')),book=sampleNotebook(),projectId=randomUUID(),errors=[],keys=[];
 const databases=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(databases);
 let f,app,project,release=()=>{};
 try{
  f=await encryptedFixture(directory,book);keys.push(f.vault);
  // New lab books are added only to a project of its own, held in its own store with its retained template.
  const entry=(await new ProjectCreation(new ProjectRegistry(f.workspace,book.id),f.deviceStore).create({id:randomUUID(),project:{id:projectId,title:'Template project',description:'Retained template choices',parentId:null,share:false,logoId:null},username:'',password:''})).project,key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:f.deviceStore});keys.push(key);project=new ProjectStorage(entry.root,entry.projectId,key);
  await project.withLock(()=>project.catalogue(async store=>{
   const head=await store.head(),current=await store.snapshot(head),metadata=structuredClone(current.metadata),owner={workspaceId:metadata.id,projectId,notebookId:null,slot:'labBookTemplate'};
   metadata.projects.find(value=>value.id===projectId).labBookTemplate={name:'Computer / IT',configuration:await new ConfigurationDocuments(store).retainInline(owner,starterTemplate('computer-it').configuration)};
   await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[]);
  }));
  const before=await project.outline();
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets:await sourceAssets()});
  page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  // A project of its own opens from the workspace navigation, as the author opens it.
  await page.locator('#workspace-navigation .tree-project-link',{hasText:'Template project'}).click();await expect(page.locator('main h1')).toHaveText('Template project');
  const dialog=page.locator('#dialog'),open=()=>page.locator('main').getByRole('button',{name:'New lab book',exact:true}).click();
  await page.context().route('**/configurations/window',route=>route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE'}}),{times:1});
  await open();await expect(dialog.locator('[data-notebook-error]')).toContainText('Could not load these record types');await expect(dialog.getByRole('button',{name:'Save lab book',exact:true})).toBeDisabled();
  let arrived;const held=new Promise(resolve=>release=resolve),received=new Promise(resolve=>arrived=resolve);
  await page.context().route('**/configurations/window',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});},{times:1});
  await dialog.getByRole('button',{name:'Retry',exact:true}).click();await received;
  const name=dialog.getByLabel('Lab book name',{exact:true});await name.fill('Retained while templates load');release();
  await expect(dialog.getByRole('button',{name:'Save lab book',exact:true})).toBeEnabled();await expect(name).toHaveValue('Retained while templates load');await expect(name).toBeFocused();
  await expect(dialog.getByLabel('Lab-book template',{exact:true})).toHaveValue('blank');await expect(dialog).toContainText('The project default uses a type that is turned off');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();
  let lateArrived;const lateHeld=new Promise(resolve=>release=resolve),lateReceived=new Promise(resolve=>lateArrived=resolve);
  await page.context().route('**/configurations/window',async route=>{const response=await route.fetch();lateArrived();await lateHeld;await route.fulfill({response}).catch(()=>{});},{times:1});
  await open();await lateReceived;await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).not.toBeVisible();
  await open();release();await expect(dialog.getByRole('button',{name:'Save lab book',exact:true})).toBeEnabled();await expect(name).toHaveValue('');await expect(dialog.locator('[data-notebook-error]')).toBeHidden();
  expect((await project.outline()).metadata.projects[0].labBookTemplate).toEqual(before.metadata.projects[0].labBookTemplate);
  expect(errors).toEqual([]);
 }finally{release();await app?.close();await databases.close();detach();for(const key of keys)await clearVault(key);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));expect(path.basename(directory).startsWith('observanda-retained-template-')).toBe(true);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
