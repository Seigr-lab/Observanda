import {test,expect} from '@playwright/test';
import {mkdtemp,rm,rename,readFile,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {readPreferences,rememberLocation} from '../../src/preferences.js';
import {updateWorkspaceAccess,workspaceAccess} from '../../src/security/workspace-access.js';
import {CATALOGUE_ARCHIVE,CATALOGUE_FILE,openCatalogue} from '../../src/postgres.js';
import {preferences} from './preferences-helper.js';
import {copyPlan,copyWorkspace} from '../../src/locations.js';

test('portable copy can be prepared and retried from the app without consuming the archive or switching workspace',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-portable-ui-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),preferencesFile=path.join(directory,'preferences.json'),destination=path.join(directory,'portable');
 await rememberLocation(preferencesFile,f.workspace.root);
 const accessInfo=await workspaceAccess(f.workspace.root,f.vault),kit=await updateWorkspaceAccess(f.workspace.root,f.vault,{action:'recovery',etag:accessInfo.etag,confirmed:true});
 const app=await startServer({root:f.workspace.root,port:0,headless:true,preferencesFile,deviceStore:f.deviceStore}),before=await f.workspace.read();let requests=0;
 try{
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toHaveText(path.basename(f.workspace.root));await preferences(page,'Storage & access');
  await page.getByRole('button',{name:'Create portable workspace copy',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);await dialog.getByRole('button',{name:'Create verified portable copy',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('Enter the workspace password or recovery key');
  await dialog.getByText('Use a recovery key',{exact:true}).click();await dialog.getByLabel('Recovery key',{exact:true}).fill(kit.recovery);
  await expect(dialog.getByRole('heading',{name:'Review portable workspace copy'})).toHaveCount(0);await expect(dialog).not.toContainText(kit.recovery);
  await page.route('**/api/storage/portable',async route=>{requests++;if(requests===1){await route.fetch();return route.abort('connectionreset');}return route.continue();});
  const confirm=dialog.getByRole('button',{name:'Create verified portable copy',exact:true});await confirm.click();await expect(confirm).toBeEnabled();expect(requests).toBe(1);
  const archive=await readFile(path.join(destination,CATALOGUE_ARCHIVE));await confirm.click();await expect(dialog.getByRole('heading',{name:'Portable copy ready'})).toBeVisible();expect(requests).toBe(2);
  expect(await readFile(path.join(destination,CATALOGUE_ARCHIVE))).toEqual(archive);await expect(access(path.join(destination,CATALOGUE_FILE))).rejects.toMatchObject({code:'ENOENT'});
  expect((await readPreferences(preferencesFile)).workspace).toBe(f.workspace.root);expect(await f.workspace.read()).toEqual(before);
  await page.setViewportSize({width:760,height:900});expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.storage-path').first()).toHaveText(f.workspace.root);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('the launcher reconnects a moved folder and persists its new location',async({page})=>{
 test.setTimeout(60000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-reconnect-ui-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),preferencesFile=path.join(directory,'preferences.json'),destination=path.join(directory,'Moved research');
 await rememberLocation(preferencesFile,f.workspace.root);let app=await startServer({root:f.workspace.root,port:0,headless:true,preferencesFile,deviceStore:f.deviceStore});
 try{
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toHaveText(path.basename(f.workspace.root));await app.close();await rename(f.workspace.root,destination);
  app=await startServer({root:f.workspace.root,port:0,expectedExisting:true,headless:true,preferencesFile,deviceStore:f.deviceStore});await page.goto(app.url);
  await expect(page.getByRole('heading',{name:'Choose a workspace'})).toBeVisible();await page.getByRole('button',{name:'Open workspace',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);await dialog.getByRole('button',{name:'Open workspace',exact:true}).click();
  await expect(dialog).not.toBeVisible();await expect(page.locator('.workspace-name')).toHaveText(path.basename(destination));
  expect((await readPreferences(preferencesFile)).recent.map(item=>item.path)).toEqual([destination]);
  await page.reload();await expect(page.locator('.workspace-name')).toHaveText(path.basename(destination));
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('a folder without its database offers recovery guidance instead of a broken loading screen',async({page})=>{
 test.setTimeout(60000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-missing-database-ui-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'});
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault});
 const db=await openCatalogue(f.workspace.root);try{await db.run('DROP SCHEMA "'+db.schema+'" CASCADE');}finally{await db.close();}
 const app=await startServer({root:f.workspace.root,port:0,expectedExisting:true,headless:true,deviceStore:f.deviceStore});
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Choose a workspace'})).toBeVisible();await page.getByText('Previous location',{exact:true}).click();
  await expect(page.getByText('This workspace’s research database is not available on this installation.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open workspace',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByLabel('Workspace folder',{exact:true}).fill(backup);await dialog.getByRole('button',{name:'Open workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(path.basename(backup));
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
