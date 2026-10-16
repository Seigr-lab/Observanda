import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {Laboratory} from '../../src/laboratory.js';
import {SampleAnalysisReader} from '../../src/sample-analysis-reader.js';
import {seedSampleAnalysis} from '../sample-analysis-fixture.js';
import {digest,serialize} from '../../src/storage-format.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {defaultDashboard,createPanel} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';

for(const count of [65,650])test('sample-analysis navigation retains pages and one form across '+count+' samples and reply failures',async({page,context})=>{
 test.setTimeout(120000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-sample-browser-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),lab={formatVersion:1,revision:count,samples:[],analyses:[],events:[]},instant='2026-10-01T00:00:00.000Z';
 for(let i=0;i<count;i++)lab.samples.push({id:randomUUID(),code:'S-'+String(i).padStart(4,'0'),material:'Synthetic water',source:'PRIVATE_SAMPLE_SOURCE',collectedOn:'2026-10-01',receivedOn:'2026-10-01'});
 for(let i=0;i<count*2;i++)lab.analyses.push({id:randomUUID(),code:'A-'+String(i).padStart(4,'0'),sampleId:lab.samples[i%count].id,result:{method:'Synthetic method v1',analyte:'Absorbance',kind:'numeric',value:0.3,unit:'AU',lower:0,upper:1,notes:'PRIVATE_ANALYSIS_NOTES '.repeat(80)},status:'draft',review:null,updatedAt:instant});
 for(let i=0;i<count;i++){const event={id:randomUUID(),at:instant,action:'save-result',recordId:lab.analyses[0].id,actor:'',reason:'Correction '+i,previous:lab.events.at(-1)?.hash??''};lab.events.push({...event,hash:digest(serialize(event))});}
 await new Laboratory(f.workspace).catalogue(store=>seedSampleAnalysis(store,lab),{write:true});
 const settings=defaultDashboard();settings.enabledModules.push('laboratory');settings.views[0].panels=['samples','analyses','lab-events','laboratory'].map(id=>createPanel(id,id));await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],requests=[],responses=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 page.on('response',r=>{if(new URL(r.url()).pathname==='/api/laboratory/read/query'&&r.ok())responses.push(r.json());});
 const read=Laboratory.prototype.read;Laboratory.prototype.read=()=>{throw Error('Full sample-analysis read during browsing or editing');};
 const main=page.locator('main'),dialog=page.locator('#dialog'),cdp=await context.newCDPSession(page);let peak=0;const measure=async()=>{peak=Math.max(peak,(await cdp.send('Runtime.getHeapUsage')).usedSize);};
 try{
  await page.goto(app.url);await expect(main.getByRole('heading',{name:'Sample analysis overview',exact:true})).toBeVisible();await measure();
  await page.evaluate(()=>location.hash='#/laboratory/samples');await expect(main.locator('tbody tr')).toHaveCount(25);await expect(main.getByRole('button',{name:'S-0000',exact:true})).toBeVisible();
  await main.getByRole('button',{name:/^Analyses /}).click();await expect(main.locator('tbody tr')).toHaveCount(25);await expect(main.getByRole('button',{name:'A-0000',exact:true})).toBeVisible();await main.getByRole('button',{name:/^Samples /}).click();await expect(main.getByRole('button',{name:'S-0000',exact:true})).toBeVisible();
  await page.route('**/api/laboratory/read/query',route=>route.fulfill({status:503,json:{message:'Synthetic list interruption'}}),{times:1});
  await main.getByRole('button',{name:'Next page',exact:true}).click();await expect(main.getByRole('alert')).toContainText('Synthetic list interruption');await expect(main.getByRole('button',{name:'S-0000',exact:true})).toBeVisible();
  await main.getByRole('button',{name:'Retry loading',exact:true}).click();await expect(main.getByRole('button',{name:'S-0025',exact:true})).toBeVisible();await main.getByRole('button',{name:'Previous page',exact:true}).click();await expect(main.getByRole('button',{name:'S-0000',exact:true})).toBeVisible();
  let release,arrive;const held=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r);
  await page.route('**/api/laboratory/read/query',async route=>{const response=await route.fetch();arrive();await held;await route.fulfill({response}).catch(()=>{});},{times:1});
  await main.getByLabel('Search laboratory records').fill('S-000');await arrived;await main.getByLabel('Search laboratory records').fill('S-0060');await expect(main.locator('tbody tr')).toHaveCount(1);release();await expect(main.getByRole('button',{name:'S-0060',exact:true})).toBeVisible();
  await main.getByRole('button',{name:'Record analysis',exact:true}).click();await dialog.getByLabel('Analysis code',{exact:true}).fill('New bounded analysis');await dialog.getByLabel('Method / version').fill('Method v2');await dialog.getByLabel('Analyte',{exact:true}).fill('Absorbance');await dialog.getByLabel('Result value',{exact:true}).fill('0.7');await dialog.getByLabel('Unit (required for numeric results)').fill('AU');
  await dialog.getByRole('button',{name:'Next page',exact:true}).click();await expect(dialog.getByLabel('Sample',{exact:true}).locator('option')).toHaveCount(25);await expect(dialog.getByLabel('Result value',{exact:true})).toHaveValue('0.7');
  await dialog.getByLabel('Find a sample').fill('S-0060');await expect(dialog.getByLabel('Sample',{exact:true}).locator('option')).toHaveCount(1);await dialog.getByLabel('Sample',{exact:true}).selectOption(lab.samples[60].id);
  const commands=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/laboratory/change')commands.push(r.postDataJSON());});
  await page.route('**/api/laboratory/change*',async route=>{const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');},{times:1});
  await dialog.getByRole('button',{name:'Save analysis',exact:true}).click();await expect(dialog.getByLabel('Result value',{exact:true})).toHaveValue('0.7');await expect(page.getByRole('status')).toContainText(/fetch|network|Failed/i);
  await dialog.getByRole('button',{name:'Save analysis',exact:true}).click();await expect(dialog).not.toBeVisible();expect(commands).toHaveLength(2);expect(commands[0].commandId).toBeTruthy();expect(commands[1]).toEqual(commands[0]);
  const current=await new SampleAnalysisReader(new Laboratory(f.workspace.root,f.vault)).query({workspaceId:book.id,view:'analyses',search:'New bounded analysis'});expect(current.counts.analyses).toBe(count*2+1);expect(current.items).toHaveLength(1);expect(current.items[0].sampleId).toBe(lab.samples[60].id);
  await main.getByLabel('Search laboratory records').fill('A-0000');await main.getByRole('button',{name:'A-0000',exact:true}).click();await dialog.getByLabel('Result value',{exact:true}).fill('0.8');await dialog.locator('summary').filter({hasText:'Record history'}).click();await dialog.getByRole('button',{name:'Load record history',exact:true}).click();await expect(dialog.locator('.lab-history time')).toHaveCount(20);await dialog.getByRole('button',{name:'Next page',exact:true}).click();await expect(dialog.locator('.lab-history')).toContainText('Correction 20');await expect(dialog.getByLabel('Result value',{exact:true})).toHaveValue('0.8');await measure();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('dialog',{name:'Unsaved changes'}).getByRole('button',{name:'Discard changes',exact:true}).click();await navigate(page,'Dashboard');await measure();
  expect(requests.filter(p=>p==='/api/laboratory')).toEqual([]);const pages=await Promise.all(responses);expect(pages.every(p=>p.items.length<=25&&!JSON.stringify(p).includes('PRIVATE_ANALYSIS_NOTES'))).toBe(true);expect(errors).toEqual([]);expect(peak).toBeLessThan(192*1024*1024);
  console.log(JSON.stringify({samples:count,analyses:count*2,largestPageBytes:Math.max(...pages.map(p=>Buffer.byteLength(JSON.stringify(p)))),sampledBrowserHeapMiB:Math.round(peak/1024**2),sourceBytes:Buffer.byteLength(serialize(lab))}));
 }finally{Laboratory.prototype.read=read;await cdp.detach();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
