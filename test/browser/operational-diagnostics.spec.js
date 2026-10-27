import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';

test('local diagnostics require an unlocked session and are reviewed before a private-safe download',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-diagnostic-ui-')),book=sampleNotebook();book.title='private-record-sentinel';
 const fixture=await encryptedFixture(directory,book),app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  expect((await fetch(app.origin+'/api/diagnostics')).status).toBe(401);
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toBeVisible({timeout:30000});
  await page.evaluate(async()=>{await fetch('/api/records?private-query-sentinel');});
  await preferences(page,'General');await page.getByRole('button',{name:'Review diagnostics',exact:true}).click();
  const dialog=page.locator('#dialog');await expect(dialog.getByRole('heading',{name:'Local diagnostics',exact:true})).toBeVisible();
  await dialog.getByText('Review report contents',{exact:true}).click();
  const text=await dialog.locator('[data-diagnostic-content]').textContent(),report=JSON.parse(text);
  expect(report.entries.length).toBeGreaterThan(0);expect(text).not.toContain('private-record-sentinel');expect(text).not.toContain('private-query-sentinel');expect(text).not.toContain(directory.replaceAll('\\','\\\\'));
  const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download this report',exact:true}).click();const download=await downloaded;
  expect(download.suggestedFilename()).toBe('observanda-diagnostics.json');const stream=await download.createReadStream();let body='';for await(const bytes of stream)body+=bytes;expect(JSON.parse(body)).toEqual(report);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  const locked=await page.evaluate(async()=>{const context=window.observandaWorkspaceContext;const status=await(await fetch('/api/storage')).json();return (await fetch('/api/access/lock',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':context??status.contextId},body:'{}'})).status;});expect(locked).toBe(200);
  expect(await page.evaluate(async()=>(await fetch('/api/diagnostics')).status)).toBe(401);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(fixture.vault);await rm(directory,{recursive:true,force:true});}
});
