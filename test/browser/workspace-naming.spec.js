import {rememberLocation} from '../../src/preferences.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {clearVault} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';

test('existing workspace name, rename form, reopen and delete confirmation follow the exact folder',async({page})=>{
 test.setTimeout(120000);
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-browser-name-')),owner=new WorkspaceDatabases({directory:path.join(parent,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 const f=await encryptedFixture(parent,sampleNotebook()),preferencesFile=path.join(parent,'preferences.json');let app;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await rememberLocation(preferencesFile,f.workspace.root);const before=await f.workspace.read();app=await startServer({root:f.workspace.root,port:0,preferencesFile,deviceStore:f.deviceStore});
  await page.goto(app.url);await preferences(page,'General');
  const form=page.locator('#workspace-name-form');await expect(form.getByLabel('Workspace name',{exact:true})).toHaveValue('workspace');
  for(const [width,name] of [[1440,'Research Workspace 1'],[390,'Research Workspace 1 – café']]){
   await page.setViewportSize({width,height:1000});await form.getByLabel('Workspace name',{exact:true}).fill(name);
   await form.getByRole('button',{name:'Save workspace',exact:true}).click();
   await expect(form.getByLabel('Workspace name',{exact:true})).toHaveValue(name,{timeout:45000});
   const target=path.join(parent,name);await expect.poll(async()=>JSON.parse(await readFile(preferencesFile,'utf8')).workspace,{timeout:45000}).toBe(target);
   const retained=await new Workspace(target,f.vault).read();expect(retained.book.title).toBe(name);expect(retained.book.entries).toEqual(before.book.entries);
   await expect(form.getByRole('button',{name:'Save workspace',exact:true})).toBeDisabled({timeout:45000});
   await expect(page.locator('.topbar .workspace-name')).toContainText(name,{timeout:45000});
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await page.screenshot({path:'.local/workspace-name-mobile.png'});
  await page.reload();await preferences(page,'General');await expect(form.getByLabel('Workspace name',{exact:true})).toHaveValue('Research Workspace 1 – café');
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Delete workspace',exact:true}).click();
  const dialog=page.locator('#dialog');await expect(dialog.getByText('Research Workspace 1 – café',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(errors).toEqual([]);
 }finally{await app?.close();await owner.close();detach();clearVault(f.vault);if(path.dirname(parent)!==await realpath(os.tmpdir())||!path.basename(parent).startsWith('observanda-browser-name-'))throw Error('Unexpected fixture root');await rm(parent,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
