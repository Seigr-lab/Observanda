import {test,expect} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {testServer as startServer} from '../device-fixture.js';
import {TestDeviceStore as DeviceStore} from '../device-fixture.js';
import {encrypted} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';
test('a solo encrypted workspace can authorize another device and recover without exposing research',{tag:'@security'},async({page,browser})=>{
 test.setTimeout(60000);page.setDefaultTimeout(8000);
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-sharing-ui-')),root=path.join(parent,'work');
 const apps=[],contexts=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function server(name){const app=await startServer({root,port:0,preferencesFile:path.join(parent,name+'.preferences.json'),deviceStore:new DeviceStore({file:path.join(parent,name+'.device')})});apps.push(app);return app;}
 try{
  const app=await server('owner');await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Shared research');
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(page.getByLabel('Use this device',{exact:false})).toBeChecked();
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Shared research');
  expect(encrypted(await readFile(path.join(root,'workspace.observanda')))).toBe(true);
  expect(JSON.parse(await readFile(path.join(root,'.observanda','research.observanda'),'utf8')).format).toBe('observanda-postgresql');
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('1 authorized device');
  await page.getByRole('button',{name:'Create recovery key',exact:true}).click();await page.getByRole('button',{name:'Generate recovery key',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Save your recovery key'})).toBeVisible();const recovery=await page.getByLabel('Recovery key',{exact:true}).inputValue();
  await page.getByRole('button',{name:'Done',exact:true}).click();await expect(page.locator('[data-recovery-secret]')).toHaveValue('');
  const peer=await server('peer'),peerContext=await browser.newContext();contexts.push(peerContext);const peerPage=await peerContext.newPage();peerPage.setDefaultTimeout(8000);await peerPage.goto(peer.url);
  await expect(peerPage.getByRole('heading',{name:'Unlock workspace'})).toBeVisible();await peerPage.getByRole('button',{name:'Get this device’s access request'}).click();
  const request=await peerPage.getByLabel('Public access request').inputValue();await peerPage.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();await page.getByText('Add a device',{exact:true}).click();await page.getByLabel('Recipient’s public access request').fill(request);
  await expect(page.locator('[data-recipient-fingerprint]')).toContainText('Recipient fingerprint:');
  await page.getByLabel('I verified the recipient’s fingerprint',{exact:false}).check();await page.getByRole('button',{name:'Grant workspace access',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('2 authorized devices');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.getByRole('heading',{name:'Workspace access',exact:true})).toBeInViewport();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Close',exact:true})).toBeInViewport();
  await page.getByText('Add a device',{exact:true}).click();
  await page.getByRole('button',{name:'Grant workspace access',exact:true}).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading',{name:'Workspace access',exact:true})).toBeInViewport();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Close',exact:true})).toBeInViewport();
  await peerPage.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(peerPage.locator('.workspace-name')).toHaveText('Shared research');
  const replacement=await server('replacement'),replacementContext=await browser.newContext();contexts.push(replacementContext);const replacementPage=await replacementContext.newPage();replacementPage.setDefaultTimeout(8000);
  await replacementPage.goto(replacement.url);await expect(replacementPage.getByRole('heading',{name:'Unlock workspace'})).toBeVisible();
  await replacementPage.getByText('Use a recovery key',{exact:true}).click();await replacementPage.getByLabel('Recovery key',{exact:true}).fill(recovery);
  await replacementPage.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(replacementPage.locator('.workspace-name')).toHaveText('Shared research');
  expect(errors).toEqual([]);
 }finally{for(const context of contexts)await context.close().catch(()=>{});for(const app of apps)await app.close();}
});

test('setup requires portable encryption when OS device protection is unavailable',async({page})=>{
 const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-portable-ui-')),root=path.join(parent,'work'),deviceStore=new DeviceStore({file:path.join(parent,'device'),protector:{available:()=>false}});
 let app=await startServer({root,port:0,deviceStore,preferencesFile:path.join(parent,'preferences')});
 try{
  await page.goto(app.url);await page.getByLabel('Workspace name',{exact:true}).fill('Portable research');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.getByLabel('Use this device',{exact:false})).toBeDisabled();
  await expect(page.getByLabel('Use a password',{exact:false})).toBeChecked();
  await page.getByLabel('Password',{exact:true}).fill('portable browser test passphrase');await page.getByLabel('Confirm password',{exact:true}).fill('portable browser test passphrase');
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Portable research');
  expect(encrypted(await readFile(path.join(root,'workspace.observanda')))).toBe(true);
  expect(JSON.parse(await readFile(path.join(root,'.observanda','research.observanda'),'utf8')).format).toBe('observanda-postgresql');
  await app.close();app=await startServer({root,port:0,deviceStore,preferencesFile:path.join(parent,'preferences')});await page.goto(app.url);await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await page.getByLabel('Password',{exact:true}).fill('portable browser test passphrase');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText('Portable research');
 }finally{await app.close();}
});
