import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {createNotebook} from '../../src/model.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {clearVault} from '../../src/encryption.js';

test('successful project creation opens the project without waiting for background directory refresh',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-navigation-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime);
 let app,vault,created=false,held=0,release;const pending=new Promise(resolve=>release=resolve),errors=[];
 try{
  const f=await encryptedFixture(path.join(directory,'workspace'),createNotebook('Workspace',''));vault=f.vault;
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/projects/create',async route=>{const response=await route.fetch();created=response.ok();await route.fulfill({response});});
  await page.route('**/api/projects/list',async route=>{if(created){held++;await pending;}await route.continue();});
  await page.goto(app.url);await page.locator('#workspace-navigation [data-action=projects]').click();
  await page.locator('main').getByRole('button',{name:'New project',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByLabel('Name',{exact:true}).fill('New observations');await dialog.getByRole('button',{name:'Create project',exact:true}).click();
  await expect.poll(()=>held,{timeout:60000}).toBeGreaterThan(0);
  await expect(dialog).not.toBeVisible();await expect(page.locator('main h1')).toHaveText('New observations');
  release();await expect(page.locator('#workspace-navigation')).toContainText('New observations');expect(errors).toEqual([]);
 }finally{release();await page.close();await app?.close();await runtime.close();detach();clearVault(vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-navigation-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
