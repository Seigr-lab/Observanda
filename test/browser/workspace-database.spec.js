import {test,expect} from '@playwright/test';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {catalogueBinding} from '../../src/postgres-activation.js';
import {preferences} from './preferences-helper.js';
import {moveWorkspaceTo} from '../../src/workspace-move.js';
import {websiteUpgradeStatus} from '../../src/website-files-migration.js';

test('workspace owns its database, locks it and moves the whole workspace in the app',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-database-ui-')),destination=path.join(directory,'complete move');
 const owner=new WorkspaceDatabases({directory:path.join(directory,'application'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}});
 const detach=installDatabaseProvider(owner),f=await encryptedFixture(directory,sampleNotebook()),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await preferences(page,'Storage & access');
  await expect(page.getByText('This workspace owns its database files.',{exact:false})).toBeVisible();
  expect((await catalogueBinding(f.workspace.root)).placement).toBe('workspace');
  await expect(page.locator('p.storage-path').filter({hasText:path.join(f.workspace.root,'.observanda','postgresql')})).toBeVisible();
  // Signing in starts website preparation and its writes; locking refuses while a writer is active.
  await expect.poll(async()=>(await websiteUpgradeStatus(f.workspace)).state,{timeout:60000}).toBe('ready');
  await expect(page.getByRole('button',{name:'Activity',exact:true})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'Lock workspace',exact:true}).last().click();
  await expect(page.getByRole('button',{name:'Unlock workspace',exact:true})).toBeVisible();
  expect(owner.instances.instances.has(f.workspace.root)).toBe(false);
  await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await preferences(page,'Storage & access');
  await page.getByRole('button',{name:'Move workspace to another folder',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);
  await dialog.getByRole('button',{name:'Move and use this folder',exact:true}).click();
  await expect(dialog).not.toBeVisible({timeout:60000});await preferences(page,'Storage & access');
  await expect(page.locator('p.storage-path').filter({hasText:path.join(destination,'.observanda','postgresql')})).toBeVisible({timeout:60000});
  await expect.poll(async()=>{try{await access(f.workspace.root);return true;}catch{return false;}}).toBe(false);
  await access(path.join(destination,'.observanda','postgresql','data','PG_VERSION'));
  await page.setViewportSize({width:760,height:950});await page.evaluate(()=>document.documentElement.style.fontSize='24px');
  expect(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:'.local/workspace-database-ui.png'});expect(errors).toEqual([]);
 }finally{await app.close();await owner.close();detach();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('restarting after interrupted move offers the verified destination and finishes cleanup',async({page})=>{
 test.setTimeout(150000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-move-restart-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'application'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);let f,app;
 try{
  f=await encryptedFixture(directory,sampleNotebook());const destination=path.join(directory,'destination');
  await expect(moveWorkspaceTo(f.workspace.root,destination,{vault:f.vault,activate:()=>{throw Error('Interrupted before activation');}})).rejects.toThrow('Interrupted before activation');
  app=await startServer({root:f.workspace.root,port:0,expectedExisting:true,headless:true,deviceStore:f.deviceStore});
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Choose a workspace',exact:true})).toBeVisible();
  expect(owner.instances.instances.has(f.workspace.root)).toBe(false);
  await page.getByRole('button',{name:'Open moved workspace',exact:true}).click();
  const dialog=page.locator('#dialog');await expect(dialog.getByLabel('Workspace folder',{exact:true})).toHaveValue(destination);
  await dialog.getByRole('button',{name:'Open workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText(path.basename(destination));
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Retry original cleanup',exact:true}).click();
  await dialog.getByRole('button',{name:'Retry original cleanup',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:45000});
  await expect(access(f.workspace.root)).rejects.toMatchObject({code:'ENOENT'});
 }finally{await app?.close();await owner.close();detach();await clearVault(f?.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
