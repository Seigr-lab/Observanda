import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {TestDeviceStore} from '../device-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {readAccess,changeAccess} from '../../src/access.js';
import {exportAccessCheckpoint} from '../../src/security/access-checkpoint.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';

test('an old backup imports verified current settings and unlocks with the current password on a new device',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-access-settings-ui-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'}),file=path.join(f.workspace.root,'.observanda/access.json');
 const previous='Synthetic previous password',current='Synthetic current password';let app;
 try{
  await changeAccess(f.workspace.root,{username:'',password:previous},(await readAccess(f.workspace.root)).etag,{deviceStore:f.deviceStore,vault:f.vault});const older=await readFile(file);
  await changeAccess(f.workspace.root,{username:'',password:current},(await readAccess(f.workspace.root,{deviceStore:f.deviceStore})).etag,{deviceStore:f.deviceStore,vault:f.vault});
  const exported=await exportAccessCheckpoint(f.workspace.root,f.vault,f.deviceStore);await writeFile(file,older);
  const deviceStore=new TestDeviceStore({file:path.join(directory,'new-device.key')});
  app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore,preferencesFile:path.join(directory,'preferences.json')});await page.goto(app.url);
  await page.getByRole('button',{name:'Import current access settings',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.locator('[name=settingsRoot]').fill(f.workspace.root);
  await dialog.locator('[data-access-checkpoint]').setInputFiles({name:'current.observanda-access',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported.checkpoint))});
  await expect(dialog.locator('[name=verifiedFingerprint]')).toBeVisible();await dialog.locator('[name=verifiedFingerprint]').fill(exported.fingerprint);await dialog.locator('[name=confirmed]').check();await dialog.locator('[name=password]').fill(current);
  await dialog.getByRole('button',{name:'Import current access settings',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.locator('#storage-unlock-form [name=password]').fill(previous);await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('#notice [role=alert]')).toContainText('credentials are incorrect');
  await page.locator('#storage-unlock-form [name=password]').fill(current);await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('workspace');
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Save current access settings',exact:true}).click();const downloaded=await downloading;
  expect(JSON.parse(await readFile(await downloaded.path(),'utf8'))).toEqual(exported.checkpoint);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.locator('#storage-access-form').getByRole('button',{name:'Lock workspace',exact:true}).click();
  await page.reload();await page.locator('#storage-unlock-form [name=password]').fill(current);await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('workspace');
 }finally{await app?.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
