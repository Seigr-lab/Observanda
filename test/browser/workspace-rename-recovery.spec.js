import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {workspaceRename} from '../../src/workspace-rename-state.js';
import {clearVault} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';

test('an interrupted workspace rename stays navigable and continues from its own panel',async({page},testInfo)=>{
 test.setTimeout(120000);
 const parent=await fs.mkdtemp(path.join(os.tmpdir(),'observanda-browser-rename-recovery-')),provider=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),f=await encryptedFixture(parent,sampleNotebook()),source=f.workspace.root,name='Recovered workspace',destination=path.join(parent,name),before=await f.workspace.read(),rename=fs.rename;let app,failed=false,faultActive=true;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  app=await startServer({root:source,port:0,preferencesFile:path.join(parent,'preferences.json'),deviceStore:f.deviceStore});await page.goto(app.url);await preferences(page,'General');
  fs.rename=async(from,to)=>{if(from===source&&to===destination&&faultActive){failed=true;throw Object.assign(Error('Disposable folder rename fault'),{code:'EBUSY'});}return rename(from,to);};syncBuiltinESMExports();
  const form=page.locator('#workspace-name-form');await form.getByLabel('Workspace name',{exact:true}).fill(name);await form.getByRole('button',{name:'Save workspace',exact:true}).click();
  const panel=page.locator('[data-workspace-rename]');await expect(panel).toBeVisible({timeout:45000});expect(failed).toBe(true);await expect(panel).toContainText(name);await expect(panel.getByRole('button',{name:'Continue rename',exact:true})).toBeEnabled();
  await preferences(page,'Storage & access');await expect(panel).toBeVisible();await preferences(page,'General');await expect(panel).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('rename-recovery.png')});
  await page.reload();await expect(panel).toBeVisible({timeout:45000});await expect(panel.getByRole('button',{name:'Continue rename',exact:true})).toBeEnabled();faultActive=false;
  await panel.getByRole('button',{name:'Continue rename',exact:true}).click();
  await expect(page.locator('.topbar .workspace-name')).toContainText(name,{timeout:60000});await expect(panel).toHaveCount(0);expect(await workspaceRename(destination)).toBeNull();
  expect((await new Workspace(destination,f.vault).read()).book.entries).toEqual(before.book.entries);
  await page.reload();await preferences(page,'General');await expect(page.locator('#workspace-name-form').getByLabel('Workspace name',{exact:true})).toHaveValue(name);expect(errors).toEqual([]);
 }finally{fs.rename=rename;syncBuiltinESMExports();await app?.close();await provider.close();detach();clearVault(f.vault);if(path.dirname(path.resolve(parent))!==path.resolve(os.tmpdir())||!path.basename(parent).startsWith('observanda-browser-rename-recovery-'))throw Error('Unexpected fixture');await fs.rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
