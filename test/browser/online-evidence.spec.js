import {test,expect} from '@playwright/test';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {collaborationFixture} from '../fixtures/collaboration.js';
import {LiveConnections} from '../../src/collaboration/live-connections.js';
import {startLiveHost} from '../../src/collaboration/live-host.js';
import {startServer} from '../../src/server.js';
import {workspaceJobs} from '../../src/workspace-jobs.js';
import {ResearchMaterials,EVIDENCE_CHUNK} from '../../src/research-materials.js';
import {digest} from '../../src/storage-format.js';
import {navigate,preferences} from './preferences-helper.js';

test('shared evidence authoring resumes a lost chunk acknowledgement after reload and verifies native originals',async({browser},testInfo)=>{
 test.setTimeout(150000);const cleanup=[],errors=[],f=await collaborationFixture({after:fn=>cleanup.push(fn)}),recordId=f.book.entries[0].id;
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0}),card=await host.card(f.grant.id),manager=new LiveConnections(f.member.workspace,f.member.deviceStore),jobs=workspaceJobs(f.author.workspace);
 await manager.command('connect',{card,verifiedFingerprint:card.identity.id});await manager.close();
 const app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'evidence.prefs')}),context=await browser.newContext({acceptDownloads:true}),page=await context.newPage();
 try{
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();
  async function open(){await navigate(page,'Organizations & teams');await page.getByRole('button',{name:'Open shared books',exact:true}).click();await page.locator('[data-online-record]').selectOption(recordId);await page.locator('[data-live-evidence]>summary').click();await expect(page.locator('[data-evidence-owner]')).toHaveAttribute('aria-busy','false');}
  await open();const view=page.locator('[data-live-evidence]'),form=view.locator('form'),bytes=Buffer.alloc(EVIDENCE_CHUNK+37,42),file={name:'returned.img',mimeType:'application/octet-stream',buffer:bytes};
  await form.getByLabel('Original file',{exact:true}).setInputFiles(file);await form.getByLabel('Relative source path (optional)',{exact:true}).fill('run-37/current-return/returned.img');await form.getByLabel('Source purpose',{exact:true}).selectOption('current-return');await form.getByLabel('Provenance / acquisition notes',{exact:true}).fill('Original captured bytes with independent hash verification.');
  let lost=false;await page.route('**/api/live/request',async route=>{const body=route.request().postDataJSON();if(!lost&&body.operation==='evidence-chunk'){lost=true;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic lost acknowledgement'})});}else await route.continue();});
  await form.getByRole('button',{name:'Upload original',exact:true}).click();await expect(view.locator('[data-evidence-status]')).toContainText('could not be confirmed');await expect(view.locator('[data-evidence-pending]')).toContainText('1048576 / 1048613 bytes received');
  await page.unroute('**/api/live/request');await page.reload();await open();await view.getByRole('button',{name:'Resume returned.img',exact:true}).click();await expect(form.getByLabel('Relative source path (optional)',{exact:true})).toHaveValue('run-37/current-return/returned.img');
  await form.getByLabel('Original file',{exact:true}).setInputFiles({...file,buffer:Buffer.alloc(bytes.length,43)});await form.getByRole('button',{name:'Upload original',exact:true}).click();await expect(view.locator('[data-evidence-status]')).toContainText('differs from the saved upload');await expect(view.locator('[data-evidence-pending]')).toContainText('1048576 / 1048613');
  await form.getByLabel('Original file',{exact:true}).setInputFiles(file);await form.getByRole('button',{name:'Upload original',exact:true}).click();await expect(view.locator('[data-evidence-pending]')).toContainText('Waiting for verification');jobs.worker.start();
  await expect(view.locator('[data-evidence-list]')).toContainText(digest(bytes),{timeout:30000});await expect(view.locator('[data-evidence-list]')).toContainText('run-37/current-return/returned.img');await expect(view.locator('[data-evidence-list]')).toContainText('Current return');await expect(view.locator('[data-evidence-pending]')).toContainText('No unfinished uploads.');
  const downloadPromise=page.waitForEvent('download');await view.getByRole('link',{name:'Download original',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toBe('returned.img');expect(digest(await readFile(await download.path()))).toBe(digest(bytes));
  const originals=(await new ResearchMaterials(f.author.workspace).heads()).filter(h=>h.kind==='artifact');expect(originals).toHaveLength(1);expect(originals[0].recordId).toBe(recordId);
  await page.setViewportSize({width:390,height:844});await view.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('shared-evidence-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Close shared books',exact:true}).click();expect(errors).toEqual([]);
 }finally{await context.close();await app.close();await jobs.worker.stop();await host.close();for(const fn of cleanup.reverse())await fn();}
});
