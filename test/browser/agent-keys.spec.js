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
  // Agents is a settings category of its own; the access dialog leads to the same page.
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();
  await page.locator('#dialog').getByRole('button',{name:'Manage agent keys',exact:true}).click();
  await expect(page.locator('#dialog[open]')).toHaveCount(0);
  const sections=page.getByRole('navigation',{name:'Preferences sections',exact:true});
  await expect(sections.getByRole('button',{name:'Agents',exact:true})).toHaveAttribute('aria-current','page');await expect(page).toHaveURL(/#\/preferences\/agents$/);
  const main=page.locator('main');
  await expect(main.getByRole('heading',{name:'Agent keys',exact:true})).toBeVisible();await expect(main.locator('[data-agent-keys-empty]')).toHaveText('No agent keys yet.');
  // How programs connect is shown on the page, not only after a key is created.
  await expect(main.getByLabel('Agent API description')).toHaveValue(app.origin+'/api/v1/openapi.json');
  // The address changes each time the app starts; programs read it from this file.
  const endpointFile=path.join(directory,'device.key.agents','endpoint.json');await expect(main.getByLabel('Address file')).toHaveValue(endpointFile);
  expect(JSON.parse(await readFile(endpointFile,'utf8')).description).toBe(app.origin+'/api/v1/openapi.json');
  await main.getByLabel('Name').fill('Documentation agent');await main.getByLabel('Reaches').selectOption('workspace');await main.getByLabel('Access').selectOption('read');
  await main.getByRole('button',{name:'Create key',exact:true}).click();
  const dialog=page.locator('#dialog');
  await expect(dialog.getByRole('heading',{name:'Copy the new agent key'})).toBeVisible();
  const key=await dialog.getByLabel('Agent key').inputValue();expect(key).toMatch(/^obsk_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/);
  await expect(dialog.getByLabel('Address file')).toHaveValue(endpointFile);
  // The key works from a program on this computer, with no browser session.
  const me=await fetch(app.origin+'/api/v1/agent/me',{headers:{Authorization:'Bearer '+key}});expect(me.status).toBe(200);
  const described=await me.json();expect(described.name).toBe('Documentation agent');expect(described.access).toBe('read');
  await dialog.getByRole('button',{name:'Done',exact:true}).click();await expect(page.locator('#dialog[open]')).toHaveCount(0);
  // The key is never kept by the page once its dialog closes.
  expect(await page.content()).not.toContain(key);
  const listed=main.locator('[data-agent-keys] li');await expect(listed).toHaveCount(1);
  await expect(listed).toContainText('Documentation agent');await expect(listed).toContainText('Whole workspace');await expect(listed).toContainText('Read only');await expect(listed).toContainText('No expiry');
  await listed.getByRole('button',{name:'Revoke the key Documentation agent',exact:true}).click();await expect(main.locator('[data-agent-keys-empty]')).toBeVisible();
  expect((await fetch(app.origin+'/api/v1/agent/me',{headers:{Authorization:'Bearer '+key}})).status).toBe(401);
  // The page opens again from its own address.
  await page.reload();await expect(main.getByRole('heading',{name:'Recent agent changes',exact:true})).toBeVisible();
  // An agent works with the app's own commands, here a website, and the owner sees the change under its name.
  await main.getByLabel('Name').fill('Website agent');await main.getByLabel('Reaches').selectOption('workspace');await main.getByLabel('Access').selectOption('write');
  await main.getByRole('button',{name:'Create key',exact:true}).click();
  const writer=await dialog.getByLabel('Agent key').inputValue();await dialog.getByRole('button',{name:'Done',exact:true}).click();
  const made=await fetch(app.origin+'/api/v1/agent/app/website-files/create',{method:'POST',headers:{Authorization:'Bearer '+writer,'Content-Type':'application/json'},body:JSON.stringify({name:'Lab site',html:'<!doctype html><html><head><title>Lab</title></head><body><main><p>Hello</p></main></body></html>'})});
  expect(made.status).toBe(200);
  await page.reload();await expect(main.locator('[data-agent-activity] li').first()).toContainText('Website agent changed a website (website-files/create)');
 }finally{await app?.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
