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

test('retained template choices recover without losing typed names, focus or saved definitions',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-retained-template-')),book=sampleNotebook(),projectId=book.projects[0].id,f=await encryptedFixture(directory,book),errors=[];
 let app,release=()=>{};
 try{
  await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
   const head=await store.head(),current=await store.indexed(await store.snapshot(head)),metadata=structuredClone(current.metadata),owner={workspaceId:book.id,projectId,notebookId:null,slot:'labBookTemplate'};
   metadata.projects[0].labBookTemplate={name:'Computer / IT',configuration:await new ConfigurationDocuments(store).retainInline(owner,starterTemplate('computer-it').configuration)};
   await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[]);
  }));
  const before=await f.workspace.outline();
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),browserAssets:await sourceAssets()});
  page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await page.goto(app.origin+'/#/projects/'+projectId);
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
  expect((await f.workspace.outline()).metadata.projects[0].labBookTemplate).toEqual(before.metadata.projects[0].labBookTemplate);
  expect(errors).toEqual([]);
 }finally{release();await app?.close();await clearVault(f.vault);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));expect(path.basename(directory).startsWith('observanda-retained-template-')).toBe(true);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
