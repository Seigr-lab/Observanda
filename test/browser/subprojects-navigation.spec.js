import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {createNotebook} from '../../src/model.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {clearVault} from '../../src/encryption.js';

// A project with several subprojects shows every one of them, on its page and
// beneath it in the workspace navigation, however many are created.
test('every subproject appears on its project page and beneath its project in the navigation',async({page})=>{
 test.setTimeout(300000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-subprojects-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];let app;
 try{
  const book=createNotebook('Workspace',''),f=await encryptedFixture(path.join(directory,'workspace'),book);vaults.push(f.vault);
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  const dialog=page.locator('#dialog');
  const create=async(name,{inside=false}={})=>{
   await page.locator('main').getByRole('button',{name:inside?'New subproject':'New project',exact:true}).click();
   await dialog.getByLabel('Name',{exact:true}).fill(name);await dialog.getByRole('button',{name:'Create project',exact:true}).click();
   await expect(dialog).not.toBeVisible({timeout:60000});await expect(page.locator('main h1')).toHaveText(name);
  };
  await page.locator('#workspace-navigation [data-action=projects]').click();await create('Electronics lab');
  const children=['Firmware','Measurement rig','Field tests','Archive'];
  for(const name of children){
   await page.locator('#workspace-navigation .tree-project-link',{hasText:'Electronics lab'}).click();await expect(page.locator('main h1')).toHaveText('Electronics lab');
   await create(name,{inside:true});
  }
  await page.locator('#workspace-navigation .tree-project-link',{hasText:'Electronics lab'}).click();await expect(page.locator('main h1')).toHaveText('Electronics lab');
  const cards=page.locator('main [data-directory-project] .card-title');
  await expect(cards).toHaveText(children.slice().sort((a,b)=>a.localeCompare(b)),{timeout:30000}).catch(async error=>{console.log('PAGE',JSON.stringify(await cards.allTextContents()));throw error;});
  const parent=page.locator('#workspace-navigation details.tree-project',{has:page.locator('> summary .tree-project-link',{hasText:'Electronics lab'})});
  const nested=parent.locator('details.tree-project .tree-project-link');
  console.log('NAV',JSON.stringify(await nested.allTextContents()));
  for(const name of children)await expect(nested.filter({hasText:name})).toHaveCount(1);
  expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await owner.close();detach();await Promise.all(vaults.map(clearVault));assert.ok(path.basename(directory).startsWith('observanda-subprojects-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
