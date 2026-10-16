import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {largestSheet} from '../module-capacity-fixture.js';
import {ModuleCatalogue} from '../../src/modules/catalogue.js';
import {ModuleReader} from '../../src/modules/reader.js';

test('maximum Unicode sheet saves and recovers through the actual app after a lost checkpoint reply',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-largest-sheet-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),data=largestSheet(),id=randomUUID();
 const settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules=['spreadsheet'];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),errors=[],checkpointBodies=[],checkpointReplies=[];
 const original=ModuleCatalogue.prototype.read;ModuleCatalogue.prototype.read=()=>{throw Error('Full module state loaded');};
 const cdp=await page.context().newCDPSession(page);let heap=0;const measure=async()=>{heap=Math.max(heap,(await cdp.send('Runtime.getHeapUsage')).usedSize);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname==='/api/modules/drafts/write')checkpointBodies.push(r.postDataJSON());});
 page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/modules/drafts/write'&&r.ok())checkpointReplies.push((await r.body()).length);});
 try{
  await page.request.post(app.origin+'/api/session',{data:{token:app.launchToken},headers:{Origin:app.origin}});
  const itemRequest=page.waitForRequest(r=>new URL(r.url()).pathname==='/api/modules/items');await page.goto(app.origin+'/#/modules/spreadsheet/sheet');
  const headers=(await itemRequest).headers(),post=(route,body)=>page.request.post(app.origin+route,{data:body,headers:{Origin:app.origin,'x-observanda-workspace':headers['x-observanda-workspace']}});
  // Creation also has to cross the real HTTP boundary at this accepted size.
  const create={workspaceId:book.id,commandId:randomUUID(),action:'sheet.save',payload:{id,expectedRevision:null,data}},response=await post('/api/modules/command?compact=1',create);
  expect(response.ok()).toBe(true);expect((await response.json()).modulePatch.entities[0].data).toEqual(data);
  const newDraft=await post('/api/modules/drafts/write',{workspaceId:book.id,id:randomUUID(),moduleId:'spreadsheet',etag:null,drafts:[{id:randomUUID(),type:'sheet',expectedRevision:null,baseRevision:null,data:{...data,name:'New maximum sheet'}}]});expect(newDraft.ok()).toBe(true);expect((await newDraft.body()).length).toBeLessThan(200);
  await page.reload();const main=page.locator('main');await main.getByRole('button',{name:'Open spreadsheet',exact:true}).click();await expect(main.getByLabel('Name',{exact:true})).toHaveValue(data.name);await measure();
  await expect(main.getByLabel('Cell A1',{exact:true})).toHaveValue(data.cells[0][0]);
  await main.getByRole('button',{name:'Next rows',exact:true}).click();await expect(main.getByLabel('Cell A26',{exact:true})).toHaveValue(data.cells[25][0]);
  let checkpoint;await page.route('**/api/modules/drafts/write',async route=>{checkpoint=route.request().postDataJSON();const response=await route.fetch();expect(response.ok()).toBe(true);await route.fulfill({status:503,json:{message:'Synthetic lost reply'}});},{times:1});
  await main.getByLabel('Name',{exact:true}).fill('Unfinished large sheet');await main.getByRole('button',{name:'Back to spreadsheets',exact:true}).click();
  await expect(main.getByRole('alert')).toContainText('Synthetic lost reply');await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Unfinished large sheet');
  expect(checkpoint.drafts[0].baseRevision).toBe(1);expect(checkpoint.drafts[0].base).toBeUndefined();expect(Buffer.byteLength(JSON.stringify(checkpoint))).toBeLessThan(3*1024*1024);
  await main.getByRole('button',{name:'Back to spreadsheets',exact:true}).click();await expect(main.locator('[data-module-form]')).not.toBeVisible();await measure();
  const recovery=main.locator('[data-recovery-item]').filter({hasText:'Unfinished large sheet'});await expect(recovery).toHaveCount(1);
  await page.reload();await recovery.getByRole('button',{name:'Restore draft',exact:true}).click();await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Unfinished large sheet');await expect(main.getByLabel('Cell A1',{exact:true})).toHaveValue(data.cells[0][0]);await measure();
  await main.getByRole('button',{name:'Save spreadsheet',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  const saved=await new ModuleReader(f.workspace).selected({workspaceId:book.id,id});expect(saved.entity.data).toEqual({...data,name:'Unfinished large sheet'});
  expect(checkpointBodies.filter(b=>b.drafts.length).every(b=>b.drafts.length===1&&b.drafts[0].base===undefined)).toBe(true);expect(Math.max(...checkpointReplies)).toBeLessThan(200);
  expect(errors).toEqual([]);expect(heap).toBeLessThan(96*1024*1024);
  console.log(JSON.stringify({maximumSheetBytes:Buffer.byteLength(JSON.stringify(data)),largestCheckpointReply:Math.max(...checkpointReplies),sampledBrowserHeapMiB:Math.round(heap/1024/1024)}));
 }finally{ModuleCatalogue.prototype.read=original;await cdp.detach();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
