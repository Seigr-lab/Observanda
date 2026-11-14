import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import {randomUUID} from 'node:crypto';
import {workDirectory} from '../../scripts/work-directory.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {createNotebook} from '../../src/model.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {clearVault} from '../../src/encryption.js';
import {navigate,preferences} from './preferences-helper.js';

// Finding a record type matches the names and descriptions the author reads,
// in their language, across the lab book's own and the general record types.
test('record type search filters lab book and general types by their translated text',async({page})=>{
 test.setTimeout(300000);
 const work=await workDirectory('test-work'),directory=await mkdtemp(path.join(work,'record-type-search-'));
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),vaults=[];let app;
 try{
  const book=createNotebook('Workspace',''),f=await encryptedFixture(path.join(directory,'workspace'),book);vaults.push(f.vault);
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const main=page.locator('main'),dialog=page.locator('#dialog');
  await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Templates');await main.getByRole('switch',{name:'Enable Research & development',exact:true}).check();
  await navigate(page,'Projects');await main.getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('Field Lab');
  await dialog.getByLabel('Project type',{exact:true}).selectOption('profile:research-development');await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});
  await main.getByRole('button',{name:'New lab book',exact:true}).click();await dialog.getByLabel('Lab book name',{exact:true}).fill('Bench work');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});
  await expect(main.locator('h1')).toHaveText('Bench work');
  const types=dialog.locator('.record-type-option strong'),search=dialog.getByLabel('Find record types',{exact:true}),status=dialog.locator('[role=status]').first();
  await main.getByRole('button',{name:'New record',exact:true}).first().click();await expect(search).toBeVisible({timeout:30000});
  await search.fill('experiment');
  // "Materials & reagents" names every experiment in its description.
  await expect(types).toHaveText(['Experiments & prototypes','Materials & reagents','Experiment'],{timeout:30000});
  await expect(dialog.locator('details').filter({hasText:'General record types'})).toHaveJSProperty('open',true);
  await search.fill('no such type');await expect(types).toHaveCount(0);await expect(status).toHaveText('No record types match this search.');
  await search.fill('');await expect(types.filter({hasText:'Questions & hypotheses'})).toHaveCount(1);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).not.toBeVisible();
  // The same search in Catalan finds the Catalan names.
  await page.evaluate(()=>location.hash='#/preferences/help');await page.locator('[data-language-choice]').selectOption('ca');await expect(page.locator('html')).toHaveAttribute('lang','ca');
  await page.locator('#workspace-navigation .notebook-link',{hasText:'Bench work'}).click();await expect(main.locator('h1')).toHaveText('Bench work');
  await main.getByRole('button',{name:'Registre nou',exact:true}).first().click();const cerca=dialog.getByLabel('Troba tipus de registre',{exact:true});await expect(cerca).toBeVisible({timeout:30000});
  // "prototip" is only in the Catalan name; the stored English name says "prototypes".
  await cerca.fill('prototip');await expect(types.filter({hasText:'Experiments i prototips'})).toHaveCount(1,{timeout:30000});await expect(types.filter({hasText:'Preguntes i hipòtesis'})).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await owner.close();detach();await Promise.all(vaults.map(clearVault));assert.ok(path.basename(directory).startsWith('record-type-search-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
