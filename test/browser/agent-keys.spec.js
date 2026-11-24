import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';

test('the owner creates an agent key shown once, the key works, and revoking it stops it',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-agent-keys-ui-')),f=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'});let app;
 try{
  app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});await page.goto(app.url);
  await expect(page.locator('.workspace-name')).toHaveText('workspace');
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByRole('button',{name:'Manage agent keys',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Agent keys'})).toBeVisible();await expect(dialog.locator('[data-agent-keys-empty]')).toHaveText('No agent keys yet.');
  await dialog.getByText('Create an agent key',{exact:true}).click();
  await dialog.getByLabel('Name').fill('Documentation agent');await dialog.getByLabel('Reaches').selectOption('workspace');await dialog.getByLabel('Access').selectOption('read');
  await dialog.getByRole('button',{name:'Create key',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Copy the new agent key'})).toBeVisible();
  const key=await dialog.getByLabel('Agent key').inputValue();expect(key).toMatch(/^obsk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/);
  await expect(dialog.getByLabel('Agent API description')).toHaveValue(app.origin+'/api/v1/openapi.json');
  // The address changes each time the app starts; programs read it from this file.
  const endpointFile=path.join(directory,'device.key.agents','endpoint.json');await expect(dialog.getByLabel('Address file')).toHaveValue(endpointFile);
  expect(JSON.parse(await readFile(endpointFile,'utf8')).description).toBe(app.origin+'/api/v1/openapi.json');
  // The key works from a program on this computer, with no browser session.
  const me=await fetch(app.origin+'/api/v1/agent/me',{headers:{Authorization:'Bearer '+key}});expect(me.status).toBe(200);
  const described=await me.json();expect(described.name).toBe('Documentation agent');expect(described.access).toBe('read');
  await dialog.getByRole('button',{name:'Done',exact:true}).click();
  const listed=dialog.locator('[data-agent-keys] li');await expect(listed).toHaveCount(1);
  await expect(listed).toContainText('Documentation agent');await expect(listed).toContainText('Whole workspace');await expect(listed).toContainText('Read only');await expect(listed).toContainText('No expiry');
  await listed.getByRole('button',{name:'Revoke',exact:true}).click();await expect(dialog.locator('[data-agent-keys-empty]')).toBeVisible();
  expect((await fetch(app.origin+'/api/v1/agent/me',{headers:{Authorization:'Bearer '+key}})).status).toBe(401);
 }finally{await app?.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
