import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {UserProfile} from '../../src/user-profile.js';
import {exchangeContact} from '../../src/collaboration/exchange-identity.js';
import {navigate,preferences} from './preferences-helper.js';

test('personal profile is editable, survives restart, guards unsaved navigation and exports the existing sharing identity',async({page})=>{
 test.setTimeout(90000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-profile-ui-')),f=await encryptedFixture(directory,sampleNotebook()),errors=[];
 let app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'prefs'),headless:true,port:0});
 try{
  page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Your profile');
  const form=page.locator('#user-profile-form');await expect(form).toBeVisible();const identity=await page.locator('[data-user-id]').textContent();expect(identity).toMatch(/^observanda:user:[a-f0-9]{64}$/);
  await form.getByLabel('Username',{exact:true}).fill('field-researcher');await form.getByLabel('Display name',{exact:true}).fill('Synthetic Observer');await form.getByLabel('Email address',{exact:true}).fill('observer@example.test');
  await form.getByRole('button',{name:'Add identifier',exact:true}).click();const identifier=form.locator('[data-profile-identifier]');await identifier.getByLabel('Label',{exact:true}).fill('My research directory');await identifier.getByLabel('Identifier or value',{exact:true}).fill('000123');await identifier.getByLabel('Link (optional)',{exact:true}).fill('https://example.test/research/000123');
  await page.getByRole('button',{name:'General',exact:true}).click();const guard=page.locator('#leave-dialog');await expect(guard).toBeVisible();await guard.getByRole('button',{name:'Stay here',exact:true}).click();await expect(identifier.getByLabel('Identifier or value',{exact:true})).toHaveValue('000123');
  await form.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.locator('#notice')).toContainText('Profile saved.');expect((await new UserProfile(f.deviceStore).state()).profile.identifiers[0].value).toBe('000123');
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export sharing contact',exact:true}).click()]);const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);const contact=JSON.parse(Buffer.concat(chunks));exchangeContact(contact);expect(identity).toBe('observanda:user:'+contact.identity.id);expect(JSON.stringify(contact)).not.toContain('observer@example.test');
  await form.getByLabel('Display name',{exact:true}).fill('Unsaved revision');await page.getByRole('button',{name:'General',exact:true}).click();await guard.getByRole('button',{name:'Discard changes',exact:true}).click();await preferences(page,'Your profile');await expect(form.getByLabel('Display name',{exact:true})).toHaveValue('Synthetic Observer');
  await app.close();app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'prefs'),headless:true,port:0});await page.goto(app.url);await page.goto(app.origin+'/#/preferences/user');await expect(form.getByLabel('Username',{exact:true})).toHaveValue('field-researcher');await expect(page.locator('[data-user-id]')).toHaveText(identity);
  await page.setViewportSize({width:390,height:844});await expect(form).toBeVisible();expect(await page.locator('main').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('user-profile-phone.png'),fullPage:true});
  const unauthenticated=await fetch(app.origin+'/api/user-profile',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({operation:'read'})});expect(unauthenticated.status).toBe(401);
  await navigate(page,'Lock workspace');await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();expect((await page.request.post(app.origin+'/api/user-profile',{headers:{Origin:app.origin},data:{operation:'read'}})).status()).toBe(401);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5});}
});
