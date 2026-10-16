import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ExchangeIdentity} from '../../src/collaboration/exchange-identity.js';
import {CollaborationRecovery} from '../../src/collaboration/identity-recovery.js';
import {navigate,preferences} from './preferences-helper.js';

test('encrypted collaboration identity backup, verified recovery and return to a saved identity work through the app',async({browser})=>{
 test.setTimeout(150000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-identity-ui-')),fixtures=[],apps=[],contexts=[],pages=[],errors=[],password='Synthetic portable identity password';
 try{
  for(const name of ['original','replacement']){
   const fixture=await encryptedFixture(path.join(directory,name),sampleNotebook());fixtures.push(fixture);await new ExchangeIdentity(fixture.deviceStore).contact();
   const app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,name+'.prefs'),headless:true,port:0});apps.push(app);
   const context=await browser.newContext(),page=await context.newPage();contexts.push(context);pages.push(page);page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Storage & access');
  }
  const [a,b]=pages,ad=a.locator('#dialog'),bd=b.locator('#dialog'),initial=await new CollaborationRecovery(fixtures[1].deviceStore).state();
  await a.getByRole('button',{name:'Back up collaboration identity',exact:true}).click();await ad.getByLabel('Identity backup password',{exact:true}).fill(password);await ad.getByLabel('Confirm identity backup password',{exact:true}).fill(password);
  const [download]=await Promise.all([a.waitForEvent('download'),ad.getByRole('button',{name:'Download encrypted backup',exact:true}).click()]);const chunks=[];for await(const chunk of await download.createReadStream())chunks.push(chunk);const buffer=Buffer.concat(chunks);expect(download.suggestedFilename()).toBe('collaboration.observanda-identity-backup');expect(buffer.toString()).not.toContain(password);await expect(ad).not.toBeVisible();
  const source=await new CollaborationRecovery(fixtures[0].deviceStore).state();
  await b.getByRole('button',{name:'Recover collaboration identity',exact:true}).click();await expect(b.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await bd.getByLabel('Encrypted identity backup',{exact:true}).setInputFiles({name:download.suggestedFilename(),mimeType:'application/json',buffer});await bd.getByLabel('Identity backup password',{exact:true}).fill('Wrong password for the backup');await bd.getByRole('button',{name:'Review backup',exact:true}).click();await expect(bd.locator('[data-identity-error]')).not.toBeEmpty();expect(await new CollaborationRecovery(fixtures[1].deviceStore).state()).toEqual(initial);
  await bd.getByLabel('Identity backup password',{exact:true}).fill(password);await bd.getByRole('button',{name:'Review backup',exact:true}).click();await expect(bd.getByRole('heading',{name:'Review collaboration identity',exact:true})).toBeVisible();await expect(bd).toContainText(initial.current.signing.id);await expect(bd).toContainText(source.current.signing.id);
  await b.setViewportSize({width:390,height:844});expect(await bd.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await b.screenshot({path:test.info().outputPath('identity-review-phone.png')});
  await bd.getByRole('checkbox').check();await bd.getByRole('button',{name:'Use this identity',exact:true}).click();await expect(bd).not.toBeVisible();await expect(b.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();expect((await new CollaborationRecovery(fixtures[1].deviceStore).state()).current).toEqual(source.current);
  expect((await b.request.get(apps[1].origin+'/api/notebook')).status()).toBe(401);
  await b.getByRole('button',{name:'Recover collaboration identity',exact:true}).click();await bd.getByText('Previously used identities on this installation',{exact:true}).click();await bd.getByRole('button',{name:'Review saved identity',exact:true}).click();await expect(bd).toContainText(initial.current.signing.id);await bd.getByRole('checkbox').check();await bd.getByRole('button',{name:'Use this identity',exact:true}).click();await expect(bd).not.toBeVisible();expect((await new CollaborationRecovery(fixtures[1].deviceStore).state()).current).toEqual(initial.current);
  await b.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(b.getByRole('heading',{name:'Unlock workspace',exact:true})).toHaveCount(0);expect(errors).toEqual([]);
 }finally{for(const context of contexts)await context.close();for(const app of apps)await app.close();for(const fixture of fixtures)clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:5});}
});
