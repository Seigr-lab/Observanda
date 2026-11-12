import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm,rename,readFile,writeFile,access} from 'node:fs/promises';
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
import {TestDeviceStore} from '../device-fixture.js';
import {WorkspaceProjectCopy} from '../../src/workspace-project-copy.js';

test('portable copy can be prepared and retried from the app without consuming the archive or switching workspace',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-portable-ui-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),preferencesFile=path.join(directory,'preferences.json'),destination=path.join(directory,'portable');
 await rememberLocation(preferencesFile,f.workspace.root);
 const accessInfo=await workspaceAccess(f.workspace.root,f.vault,{deviceStore:f.deviceStore}),kit=await updateWorkspaceAccess(f.workspace.root,f.vault,{action:'recovery',etag:accessInfo.etag,confirmed:true},{deviceStore:f.deviceStore});
 const app=await startServer({root:f.workspace.root,port:0,headless:true,preferencesFile,deviceStore:f.deviceStore}),before=await f.workspace.read();
 try{
  // Drop the completed response between the authenticated service worker
  // and the form. Both attempts go through the actual service and storage.
  await page.addInitScript(()=>{
   const fetch=window.fetch.bind(window);
   window.backupReplyTest={armed:false,requests:0,dropped:false};
   window.fetch=async(input,options)=>{
    const state=window.backupReplyTest;
    const watch=state.armed&&new URL(input instanceof Request?input.url:input,location.href).pathname==='/api/storage/portable';
    const first=watch&&++state.requests===1;
    const response=await fetch(input,options);
    if(first){await response.arrayBuffer();state.dropped=true;throw new TypeError('Connection lost after backup');}
    return response;
   };
  });
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toHaveText(path.basename(f.workspace.root),{timeout:30000});await preferences(page,'Storage & access');
  await page.getByRole('button',{name:'Create portable workspace copy',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);await dialog.getByRole('button',{name:'Create verified portable copy',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('Enter the workspace password or recovery key');
  await dialog.getByText('Use a recovery key',{exact:true}).click();await dialog.getByLabel('Recovery key',{exact:true}).fill(kit.recovery);
  await expect(dialog.getByRole('heading',{name:'Review portable workspace copy'})).toHaveCount(0);await expect(dialog).not.toContainText(kit.recovery);
  await page.evaluate(()=>{window.backupReplyTest.armed=true;});
  const confirm=dialog.getByRole('button',{name:'Create verified portable copy',exact:true});
  await confirm.click();await page.waitForFunction(()=>window.backupReplyTest.dropped,null,{timeout:60000});await expect(confirm).toBeEnabled();expect(await page.evaluate(()=>window.backupReplyTest.requests)).toBe(1);
  const archive=await readFile(path.join(destination,CATALOGUE_ARCHIVE));await confirm.click();await expect(dialog.getByRole('heading',{name:'Portable copy ready'})).toBeVisible({timeout:60000});expect(await page.evaluate(()=>window.backupReplyTest.requests)).toBe(2);
  await expect(dialog.getByText(/^Copy completed on /)).toBeVisible();
  await expect(dialog.getByText(/registered projects \(0\)/)).toBeVisible();
  expect(await readFile(path.join(destination,CATALOGUE_ARCHIVE))).toEqual(archive);await expect(access(path.join(destination,CATALOGUE_FILE))).rejects.toMatchObject({code:'ENOENT'});
  expect((await readPreferences(preferencesFile)).workspace).toBe(f.workspace.root);expect(await f.workspace.read()).toEqual(before);
  await page.setViewportSize({width:760,height:900});expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.storage-path').first()).toHaveText(f.workspace.root);
  await page.getByRole('button',{name:'Backup status',exact:true}).click();
  await expect(dialog.getByText('This backup has not been checked again since it was created.')).toBeVisible();
  await dialog.getByRole('button',{name:'Check backup files'}).click();
  await expect(dialog.getByText(/^Last successful check on /)).toBeVisible({timeout:60000});
  await expect(dialog.locator('.storage-path')).toHaveText(destination);
  const firstCheck=await dialog.getByText(/^Last successful check on /).textContent();
  await writeFile(path.join(destination,CATALOGUE_ARCHIVE),archive.subarray(0,-1));
  await dialog.getByRole('button',{name:'Check backup files'}).click();
  await expect(dialog.getByText(/^The latest check on .* could not verify this backup\.$/)).toBeVisible({timeout:60000});
  await expect(dialog.getByText(firstCheck,{exact:true})).toBeVisible();
  await writeFile(path.join(destination,CATALOGUE_ARCHIVE),archive);
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('first launch restores a detached backup with the separately retained recovery key',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-clean-restore-'));
 let app,donor;
 try{
  donor=await encryptedFixture(directory,sampleNotebook());
  const {etag}=await workspaceAccess(donor.workspace.root,donor.vault,{deviceStore:donor.deviceStore});
  const {recovery}=await updateWorkspaceAccess(donor.workspace.root,donor.vault,{action:'recovery',etag,confirmed:true},{deviceStore:donor.deviceStore});
  const saved=path.join(directory,'Portable copy'),moved=path.join(directory,'Field drive'),destination=path.join(directory,'Recovered study');
  await new WorkspaceProjectCopy(donor.workspace).exportPortable(saved);
  await rename(saved,moved);await rename(donor.workspace.root,path.join(directory,'disconnected-original'));
  const independent=path.join(directory,'fresh-installation');await mkdir(independent);
  const preferencesFile=path.join(independent,'preferences.json'),deviceStore=new TestDeviceStore({file:path.join(independent,'device.key')});
  app=await startServer({root:path.join(independent,'default'),preferencesFile,deviceStore,headless:true,port:0});
  await page.goto(app.url);
  const dialog=page.locator('#dialog'),button=name=>dialog.getByRole('button',{name,exact:true});
  await page.getByRole('button',{name:'Restore a portable backup',exact:true}).click();
  const occupied=path.join(directory,'Occupied');await mkdir(occupied);await writeFile(path.join(occupied,'retained.txt'),'Retained independently.');
  await dialog.getByLabel('Backup folder',{exact:true}).fill(moved);
  const target=dialog.getByLabel('Empty folder for restored workspace');await target.fill(occupied);
  await dialog.getByText('Use a recovery key',{exact:true}).click();const key=dialog.getByLabel('Recovery key',{exact:true});
  await key.fill('incorrect');await button('Review restore').click();
  await expect(page.locator('#notice')).toContainText('credentials');
  await key.fill(recovery);await button('Review restore').click();
  await expect(page.locator('#notice')).toContainText('already exists');
  expect(await readFile(path.join(occupied,'retained.txt'),'utf8')).toBe('Retained independently.');
  await target.fill(destination);await button('Review restore').click();
  await expect(dialog.locator('[data-restore-review]')).toContainText(destination);
  await expect(access(destination)).rejects.toMatchObject({code:'ENOENT'});
  await target.fill(occupied);await expect(button('Restore to this folder')).toHaveCount(0);
  await expect(dialog.locator('[data-restore-review]')).toBeEmpty();
  await target.fill(destination);await button('Review restore').click();
  await expect(dialog.locator('[data-restore-review]')).toContainText(destination);
  await button('Restore to this folder').click();
  await expect(dialog.getByRole('heading',{name:'Workspace restored'})).toBeVisible({timeout:60000});
  expect(await readFile(path.join(destination,CATALOGUE_ARCHIVE))).toEqual(await readFile(path.join(moved,CATALOGUE_ARCHIVE)));
  await button('Open workspace').click();await expect(dialog.getByLabel('Workspace folder',{exact:true})).toHaveValue(destination);
  await dialog.getByText('Use a recovery key',{exact:true}).click();await dialog.getByLabel('Recovery key',{exact:true}).fill(recovery);
  await button('Open workspace').click();
  await expect(page.locator('.workspace-name').first()).toHaveText(path.basename(destination),{timeout:45000});
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Backup status',exact:true}).click();
  await expect(dialog.getByText(/^Restored and checked /)).toBeVisible();
  await expect(dialog.locator('.storage-path')).toHaveText(destination);
 }finally{await app?.close();if(donor)await clearVault(donor.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
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
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('a folder without its database offers recovery guidance instead of a broken loading screen',async({page})=>{
 test.setTimeout(60000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-missing-database-ui-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'});
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup'),{vault:f.vault}),{vault:f.vault});
 const db=await openCatalogue(f.workspace.root);try{await db.run('DROP SCHEMA "'+db.schema+'" CASCADE');}finally{await db.close();}
 const app=await startServer({root:f.workspace.root,port:0,expectedExisting:true,headless:true,deviceStore:f.deviceStore});
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Choose a workspace'})).toBeVisible();await page.getByText('Previous location',{exact:true}).click();
  await expect(page.getByText('This workspace’s research database is not available on this installation.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open workspace',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Open workspace',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByLabel('Workspace folder',{exact:true}).fill(backup);await dialog.getByRole('button',{name:'Open workspace',exact:true}).click();
  await expect(page.locator('.workspace-name')).toHaveText(path.basename(backup));
 }finally{await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
