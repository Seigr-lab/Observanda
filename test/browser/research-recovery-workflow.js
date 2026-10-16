import {expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {startServer} from '../../src/server.js';
import {TestDeviceStore} from '../device-fixture.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {Workspace} from '../../src/storage.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {PublicationJobs} from '../../src/publication-jobs.js';
import {contentBuffer} from '../../src/file-content.js';
import {preferences} from './preferences-helper.js';

// Continue the app-authored journey without the owner's device identity,
// session cookies or key. Inspection uses only the exported recovery key.
export async function recoverResearch({browser,directory,root,recovery,before,runId,protocol,files,analysis,analysisDoc,originalAnalysis,originalCalculation,exported,editionId}){
 const deviceStore=new TestDeviceStore({file:path.join(directory,'replacement.device')}),preferencesFile=path.join(directory,'replacement.preferences');
 const context=await browser.newContext(),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000);
 let app,vault,freshVault;const originalGrants=(await readAccess(root)).value.devices;
 const launch=async(selected=root)=>{app=await startServer({root:selected,port:0,headless:true,deviceStore,preferencesFile});await page.goto(app.url);};
 try{
  await launch();await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await page.getByText('Use a recovery key',{exact:true}).click();await page.getByLabel('Recovery key',{exact:true}).fill('incorrect recovery key');
  const denied=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/access/unlock');await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();expect((await denied).status()).toBe(401);await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await expect(page.locator('#main')).not.toContainText('Apparatus run one');
  await page.getByLabel('Recovery key',{exact:true}).fill(recovery);await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText(before.book.title);
  vault=await verifyAccess(await readAccess(root),'','',{deviceStore,recovery});const ws=new Workspace(root,vault),materials=new ResearchMaterials(ws);
  expect(await ws.read()).toEqual(before);await materials.verify();expect((await materials.read(protocol)).title).toBe('PRIVATE decoding method');
  expect((await materials.read(analysis)).content).toEqual(analysisDoc.content);expect(await materials.read(originalAnalysis)).toEqual(originalCalculation);
  await page.evaluate(id=>location.hash='#/records/'+id+'/read',runId);await expect(page.locator('.record-reader')).toContainText('Three records decoded');
  const dialog=page.locator('#dialog');await page.locator('.record-reader [data-action="attempt-open-ref"]').filter({hasText:'PRIVATE decoding method'}).first().click();
  await expect(dialog).toContainText('Compare the returned bytes with the declared reference.');await expect(dialog).not.toContainText('PRIVATE revised decoding method');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await expect(dialog.locator('.material-file-summary')).toHaveCount(files.size);
  for(const [name,bytes] of files){const downloading=page.waitForEvent('download');await dialog.getByRole('link',{name:'Download '+name,exact:true}).click();expect(await readFile(await (await downloading).path())).toEqual(bytes);}
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>location.hash='#/publishing');await page.getByRole('button',{name:'Website preparations',exact:true}).click();
  const opening=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/publication-jobs/open');await dialog.getByRole('button',{name:'Open review',exact:true}).click();expect((await (await opening).json()).id).toBe(editionId);
  await page.getByLabel('I have reviewed this website and its media for sharing.').check();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Download website ZIP',exact:true}).click();expect(await readFile(await (await downloading).path())).toEqual(exported);
  // Enrollment must be explicit; possession of a recovery key alone must not
  // silently alter the workspace's device grants.
  expect((await readAccess(root)).value.devices).toEqual(originalGrants);
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();
  await page.getByRole('button',{name:'Authorize this device for passwordless access',exact:true}).click();await expect(dialog).toContainText('2 authorized devices');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await app.close();app=null;await context.clearCookies();await launch();await expect(page.locator('.workspace-name')).toHaveText(before.book.title);
  await page.evaluate(id=>location.hash='#/records/'+id,runId);await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Apparatus run one');
  await page.getByLabel('Record title',{exact:true}).fill('Continued after independent-profile recovery');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const continued=(await ws.read()).book.entries.find(record=>record.id===runId);expect(continued.title).toBe('Continued after independent-profile recovery');expect(continued.attempt).toEqual(before.book.entries.find(record=>record.id===runId).attempt);
  expect(await materials.read(originalAnalysis)).toEqual(originalCalculation);expect((await materials.read(analysis)).content).toEqual(analysisDoc.content);
  const successor=path.join(directory,'fresh-key-successor'),password='synthetic successor password',saved=await ws.read(),edition=await new PublicationJobs(ws).read(editionId);
  await preferences(page,'Storage & access');await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();await page.getByText('Continue with a different group',{exact:true}).click();await page.getByRole('button',{name:'Create private successor',exact:true}).click();
  await dialog.getByLabel('Workspace folder',{exact:true}).fill(successor);await dialog.getByLabel('Workspace password',{exact:true}).fill(password);await dialog.getByLabel('Confirm password',{exact:true}).fill(password);
  await dialog.getByRole('button',{name:'Review encrypted copy',exact:true}).click();
  const rekeyed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/storage/encrypt',{timeout:60000});
  await dialog.getByRole('button',{name:'Encrypt and use this copy',exact:true}).click();expect((await rekeyed).ok()).toBe(true);await expect(dialog).not.toBeVisible({timeout:60000});
  const access=await readAccess(successor);expect(access.value.vaultId).not.toBe(vault.id);expect(access.value.devices).toEqual([]);expect(access.value.recovery).toBeNull();
  await expect(verifyAccess(access,'','',{deviceStore,recovery})).rejects.toMatchObject({code:'ACCESS_DENIED'});freshVault=await verifyAccess(access,'',password,{deviceStore});
  const fresh=new Workspace(successor,freshVault),freshMaterials=new ResearchMaterials(fresh);expect(await fresh.read()).toEqual(saved);expect(await ws.read()).toEqual(saved);await freshMaterials.verify();
  expect(await freshMaterials.read(originalAnalysis)).toEqual(originalCalculation);expect((await freshMaterials.read(protocol)).title).toBe('PRIVATE decoding method');
  const retainedEdition=await new PublicationJobs(fresh).read(editionId);expect(retainedEdition.id).toBe(edition.id);for(const [name,content] of edition.files)expect(await contentBuffer(retainedEdition.files.get(name))).toEqual(await contentBuffer(content));
  await app.close();app=null;await context.clearCookies();await launch(successor);await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(page.locator('.workspace-name')).toHaveText(before.book.title);
  await page.evaluate(id=>location.hash='#/records/'+id+'/read',runId);await expect(page.locator('.record-reader')).toContainText('Continued after independent-profile recovery');await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();
  for(const [name,bytes] of files){const download=page.waitForEvent('download');await dialog.getByRole('link',{name:'Download '+name,exact:true}).click();expect(await readFile(await (await download).path())).toEqual(bytes);}
  expect(errors).toEqual([]);
 }finally{await context.close();await app?.close();clearVault(vault);clearVault(freshVault);}
}
