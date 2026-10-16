import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {desktopFixture} from './fixture.js';
import {preferences} from '../browser/preferences-helper.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {DeviceStore} from '../../src/security/device-store.js';
import {unseal,clearVault} from '../../src/encryption.js';
import {openCatalogue} from '../../src/postgres.js';
import {projectDomainLock} from '../../src/project-domain-lock.js';

test('closing during retained work asks, remains visible and closes only after completion',async()=>{
 test.skip(process.platform!=='win32');test.setTimeout(180000);
 const fixture=await desktopFixture('observanda-desktop-close-'),root=path.join(fixture.directory,'Closing progress');let app,holder,vault;
 try{
  app=await fixture.start();let page=await app.firstWindow();page.on('dialog',()=>{});
  await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
  await page.getByLabel('Workspace name',{exact:true}).fill('Closing progress');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Create in',{exact:true}).fill(fixture.directory);await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Closing progress',{timeout:30000});
  vault=await verifyAccess(await readAccess(root),'','',{deviceStore:new DeviceStore({file:path.join(fixture.directory,...(fixture.packaged?['.observanda']:[]),'preferences.json.device-key')})});
  const encrypted=await readFile(path.join(root,'.observanda/postgresql/service.observanda')),bytes=unseal(encrypted,vault.key,'Observanda/workspace-postgresql/v1/'+vault.id);let config;try{config=JSON.parse(bytes);}finally{bytes.fill(0);}
  holder=await openCatalogue(root,{env:{...process.env,OBSERVANDA_DATABASE_URL:'postgresql://observanda:'+config.appPassword+'@127.0.0.1:'+config.port+'/observanda'}});config=null;await holder.run('BEGIN');await projectDomainLock(holder,'Observanda/workspace-settings/'+holder.id+'/dashboard');
  await preferences(page,'Modules');const retained=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/dashboard/pending'&&response.request().method()==='POST');
  const inventory=page.getByRole('switch',{name:'Enable Inventory',exact:true});await inventory.check();
  const saved=await retained;expect(saved.ok()).toBe(true);expect((await saved.json()).pending?.state).toBe('waiting');await expect(inventory).toBeChecked();await expect(page.locator('.desk-save-message')).toBeHidden();
  await app.evaluate(({dialog,BrowserWindow})=>{globalThis.closeQuestions=[];globalThis.closeChoice=0;dialog.showMessageBox=async(_window,options)=>{globalThis.closeQuestions.push(options.title);return {response:globalThis.closeChoice};};BrowserWindow.getAllWindows()[0].close();});
  await expect.poll(()=>app.evaluate(()=>globalThis.closeQuestions)).toContain('Work is still running');expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isDestroyed())).toBe(false);
  await preferences(page,'General');await expect(page.getByRole('heading',{name:'Workspace details',exact:true})).toBeVisible();
  await app.evaluate(({BrowserWindow})=>{globalThis.closeChoice=1;BrowserWindow.getAllWindows()[0].close();});
  await expect.poll(()=>app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('cancel-scheduled-close').enabled)).toBe(true);
  await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('cancel-scheduled-close').click());
  expect(await app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('cancel-scheduled-close').enabled)).toBe(false);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await expect.poll(()=>app.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('cancel-scheduled-close').enabled)).toBe(true);
  const closed=app.waitForEvent('close');await holder.run('ROLLBACK');await holder.close();holder=null;await closed;app=null;
  app=await fixture.start();page=await app.firstWindow();await expect(page.locator('.workspace-name')).toHaveText('Closing progress',{timeout:60000});await preferences(page,'Modules');await expect(page.getByRole('switch',{name:'Enable Inventory',exact:true})).toBeChecked();
 }finally{await holder?.close();clearVault(vault);await fixture.dispose(app);}
});
