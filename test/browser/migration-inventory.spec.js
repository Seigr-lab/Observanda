import {test,expect} from '@playwright/test';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';import {sampleNotebook} from '../../src/sample.js';import {startServer} from '../../src/server.js';import {clearVault} from '../../src/encryption.js';
import {migrationFixture} from '../migration-fixture.js';import {navigate} from './preferences-helper.js';
import {createHash} from 'node:crypto';
import {migrationGrowthFixture} from '../migration-growth-fixture.js';
test('Workspaces opens a private inventory preview, accounts for blocked items and never imports on open or scan',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-inventory-ui-')),source=path.join(directory,'source'),f=await encryptedFixture(path.join(directory,'app'),sampleNotebook());
 await migrationFixture(source,{creative:true});let scans=0;
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().endsWith('/api/migration/inventory'))scans++;});
 try{
  const before=await f.workspace.read();await page.goto(app.url);await navigate(page,'Workspaces');await page.getByRole('button',{name:'Inspect external logbook',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Inspect external logbook',exact:true})).toBeVisible();expect(scans).toBe(0);
  await page.getByLabel('Source folder',{exact:true}).fill(source);await page.getByRole('button',{name:'Inspect source',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Inventory fully accounted for',exact:true})).toBeVisible();await expect(page.locator('.inventory-report')).toContainText('4 objects / 5 files');
  await page.locator('.inventory-objects article').filter({hasText:'morning-one'}).getByText('Inspect declaration',{exact:true}).click();
  await expect(page.locator('.inventory-objects article').filter({hasText:'morning-one'})).toContainText('2026-04');
  await writeFile(path.join(source,'extra.txt'),'explicit unresolved file');
  await page.getByRole('button',{name:'Inspect source',exact:true}).click();await expect(page.getByRole('heading',{name:'Inventory needs resolution',exact:true})).toBeVisible();
  await page.locator('#inventory-filter').selectOption('unsupported');await expect(page.locator('.inventory-objects')).toContainText('extra.txt');await expect(page.locator('.inventory-objects article')).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:test.info().outputPath('inventory-phone.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Back to workspaces',exact:true}).click();await expect(page.getByRole('heading',{name:'Your workspaces',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByLabel('Source folder',{exact:true}).fill(source+'-missing');
  await page.getByRole('button',{name:'Back to workspaces',exact:true}).click();await expect(page.locator('#leave-dialog')).not.toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();
  expect((await f.workspace.read()).etag).toBe(before.etag);expect(scans).toBe(2);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('source target problems are reviewable in the app and correcting the declaration clears them',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-target-ui-')),source=path.join(directory,'source'),f=await encryptedFixture(path.join(directory,'app'),sampleNotebook());
 const fixture=await migrationFixture(source,{creative:true}),record=fixture.manifest.objects[1];
 const html='<!doctype html><section id="observation"><h2>Dawn calls</h2></section><script>throw Error("source executed")</script>';
 await writeFile(path.join(source,'field/one.json'),html);
 record.files[0]={path:'field/one.json',bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex'),selector:{kind:'anchor',value:'absent'}};
 const save=()=>writeFile(path.join(source,'inventory.observanda-source.json'),JSON.stringify(fixture.manifest));await save();
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences')}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  const before=await f.workspace.read();await page.goto(app.url);await navigate(page,'Workspaces');await page.getByRole('button',{name:'Inspect external logbook',exact:true}).click();
  await page.getByLabel('Source folder',{exact:true}).fill(source);await page.getByRole('button',{name:'Inspect source',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Inventory needs resolution'})).toBeVisible();
  await page.getByLabel('Show',{exact:true}).selectOption('conflict');
  const row=page.locator('.inventory-objects article').filter({has:page.locator('strong').filter({hasText:/^morning-one$/})});
  await expect(row).toContainText('Source target absent does not exist');await row.getByText('Original files and targets',{exact:true}).click();await expect(row).toContainText('HTML element: #absent — Unresolved');
  record.files[0].selector.value='observation';await save();await page.getByRole('button',{name:'Inspect source',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Inventory fully accounted for'})).toBeVisible();
  await row.getByText('Original files and targets',{exact:true}).click();await expect(row).toContainText('HTML element: #observation — Verified');
  await row.getByText('Source dates',{exact:true}).click();await expect(row).toContainText('2026-04');
  await row.getByText('Exact relationships',{exact:true}).click();await expect(row).toContainText('listening-method @ r1');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await row.scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:test.info().outputPath('inventory-targets-phone.png')});
  expect((await f.workspace.read()).etag).toBe(before.etag);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('leaving an inspection ignores its late result and cancellation permits a fresh scan',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-inspection-lifecycle-')),source=path.join(directory,'source'),f=await encryptedFixture(path.join(directory,'app'),sampleNotebook());
 await migrationFixture(source,{creative:true});
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences')});
 let release,entered;const blocked=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);let first=true,calls=0,releaseCancelled,enteredCancelled;const cancelledRequest=new Promise(resolve=>enteredCancelled=resolve),cancelledReply=new Promise(resolve=>releaseCancelled=resolve);
 await page.route('**/api/migration/inventory',async route=>{
  calls++;if(calls===3){enteredCancelled();await cancelledReply;try{await route.fulfill({status:200,contentType:'application/x-ndjson',body:'{\"result\":{\"complete\":true}}\\n'});}catch{}return;}
  if(first){first=false;entered();await blocked;try{await route.fulfill({status:200,contentType:'application/x-ndjson',body:'{"result":{"complete":true}}\n'});}catch{}return;}
  await route.continue();
 });
 try{
  await page.goto(app.url);await navigate(page,'Workspaces');await page.getByRole('button',{name:'Inspect external logbook',exact:true}).click();
  await page.getByLabel('Source folder',{exact:true}).fill(source);await page.getByRole('button',{name:'Inspect source',exact:true}).click();await started;
  await navigate(page,'Dashboard');await navigate(page,'Workspaces');await page.getByRole('button',{name:'Inspect external logbook',exact:true}).click();
  release();await expect(page.getByRole('heading',{name:'Inventory fully accounted for'})).toHaveCount(0);
  await page.getByRole('button',{name:'Inspect source',exact:true}).click();await expect(page.getByRole('heading',{name:'Inventory fully accounted for'})).toBeVisible();
  await page.getByRole('button',{name:'Inspect source',exact:true}).click();await cancelledRequest;await page.getByRole('button',{name:'Cancel inspection',exact:true}).click();releaseCancelled();
  await expect(page.locator('#inventory-progress')).toHaveText('Inspection cancelled. No records were imported.');
  await page.getByRole('button',{name:'Inspect source',exact:true}).click();await expect(page.getByRole('heading',{name:'Inventory fully accounted for'})).toBeVisible();
 }finally{release();releaseCancelled();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('tenfold physical inventory is usable through the app with bounded result pages',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-inventory-growth-ui-')),source=path.join(directory,'source'),f=await encryptedFixture(path.join(directory,'app'),sampleNotebook());
 const expected=await migrationGrowthFixture(source);
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'Workspaces');await page.getByRole('button',{name:'Inspect external logbook',exact:true}).click();
  const before=await f.workspace.read(),cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
  const heap=async()=>((await cdp.send('Performance.getMetrics')).metrics.find(m=>m.name==='JSHeapUsedSize')).value;
  const initialHeap=await heap(),start=Date.now();
  await page.getByLabel('Source folder',{exact:true}).fill(source);await page.getByRole('button',{name:'Inspect source',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Inventory fully accounted for'})).toBeVisible({timeout:120000});
  const report=page.locator('.inventory-report');await expect(report).toContainText(expected.objects+' objects / '+expected.files+' files');
  await expect(page.locator('.inventory-objects article')).toHaveCount(50);
  await page.getByRole('button',{name:'Next items',exact:true}).click();await expect(report.getByRole('status')).toContainText('Page 2 of 79');
  await page.getByRole('button',{name:'Next items',exact:true}).click();await expect(report.getByRole('status')).toContainText('Page 3 of 79');
  const preparation=page.locator('.inventory-objects article').filter({has:page.locator('strong').filter({hasText:/^preparation-1$/})});
  await preparation.getByText('Exact relationships',{exact:true}).click();await expect(preparation.locator('details').filter({has:page.getByText('Exact relationships',{exact:true})}).locator('li')).toHaveCount(246);
  const search=page.getByRole('searchbox',{name:'Search inventory',exact:true});
  await search.pressSequentially('capture.bin');await expect(search).toBeFocused();await expect(search).toHaveValue('capture.bin');await expect(page.locator('.inventory-objects article')).toHaveCount(10);
  await search.fill('batch-7:artifact-246');await expect(page.locator('.inventory-objects article')).toHaveCount(1);
  await search.fill('nothing matches this source');await expect(page.locator('.inventory-objects article')).toHaveCount(0);
  await search.fill('');
  await page.getByLabel('Show',{exact:true}).selectOption('excluded');await expect(page.locator('.inventory-objects article')).toHaveCount(10);
  await expect(report.getByRole('status')).toContainText('Page 1 of 1');
  await page.getByLabel('Show',{exact:true}).selectOption('conflict');await expect(page.locator('.inventory-objects article')).toHaveCount(0);
  await page.getByLabel('Show',{exact:true}).selectOption('all');await expect(page.locator('.inventory-objects article')).toHaveCount(50);
  const finalHeap=await heap();expect(finalHeap).toBeLessThan(256*1024*1024);
  console.log(JSON.stringify({workload:'A1 tenfold app inventory',elapsedMs:Date.now()-start,initialHeapBytes:initialHeap,finalHeapBytes:finalHeap,objects:expected.objects,files:expected.files,bytes:expected.bytes}));
  await page.screenshot({path:test.info().outputPath('inventory-growth-desktop.png')});
  expect((await f.workspace.read()).etag).toBe(before.etag);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
