import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {RecordWriting} from '../../src/record-writing.js';
import {operationStage} from '../../src/operation-progress.js';
import {AppError} from '../../src/errors.js';
import {preferences,navigate} from './preferences-helper.js';

for(const kind of ['copy','record','failed-record'])test(`${kind} activity remains available after navigation and reload while the writer is busy`,async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-activity-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),destination=path.join(directory,'copied');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 let release;const gate=new Promise(resolve=>release=resolve),verify=ResearchCatalogue.prototype.verifyRecordHistory,save=RecordWriting.prototype.save;
 if(kind==='copy')ResearchCatalogue.prototype.verifyRecordHistory=async function(...args){await gate;return verify.apply(this,args);};
 else RecordWriting.prototype.save=async function(...args){await operationStage('write-records',{unit:'records',total:1},()=>gate);if(kind==='failed-record')throw new AppError('CONFLICT');return save.apply(this,args);};
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await preferences(page,'General');
  const command=kind==='copy'?{path:destination,confirmed:true}:await new RecordWriting(f.workspace).read({workspaceId:book.id,recordId:book.entries[0].id,sectionId:null});
  await page.evaluate(async({kind,command})=>{
   const status=await (await fetch('/api/storage')).json();
   const data=kind==='copy'?command:{workspaceId:command.workspaceId,recordId:command.recordId,sectionId:null,expectedRevision:command.revision,value:{body:'Saved while navigating.'}};
   window.activityOperation=fetch(kind==='copy'?'/api/storage/copy':'/api/research/records/writing/save',{method:'POST',headers:{Origin:location.origin,'Content-Type':'application/json',Accept:'application/x-ndjson','X-Observanda-Workspace':status.contextId,'X-Observanda-View':location.hash},body:JSON.stringify(data)}).then(response=>response.text());
  },{kind,command});
  await expect(page.locator('.app-activity [data-toggle]')).toContainText('1 running');
  if(kind==='copy'){
   // Configuration browsing remains a read while the destination verifies.
   const configuration=await page.evaluate(async owner=>{
    const context=(await(await fetch('/api/storage')).json()).contextId;
    const request=async(route,data)=>{const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':context,'X-Observanda-Wait':'1'},body:JSON.stringify(data),signal:AbortSignal.timeout(10000)});return {status:response.status,value:await response.json()};};
    const opened=await request('/api/research/configurations/open',{...owner,saved:true});
    const window=opened.status===200?await request('/api/research/configurations/window',{...owner,configurationPin:opened.value.configurationPin,collection:'sections',offset:0,limit:20}):null;
    const invalidReview=await request('/api/sharing/configuration',{workspaceId:owner.workspaceId,reviewId:'invalid',notebookId:owner.notebookId,version:'incoming',operation:'open'});
    return {opened,window,invalidReview};
   },{workspaceId:book.id,projectId:book.notebooks[0].projectId,notebookId:book.notebooks[0].id,slot:'configuration'});
   expect(configuration.opened.status).toBe(200);expect(configuration.window.status).toBe(200);expect(configuration.window.value.rows.length).toBeLessThanOrEqual(20);expect(configuration.invalidReview.status).toBe(422);expect(configuration.invalidReview.value.code).toBe('INVALID');
   await preferences(page,'Integrations');
   await expect(page.locator('#github-connection')).toBeVisible();
   await expect(page.locator('#destination-status')).toBeVisible();
   await expect(page.locator('#notice.error')).toBeHidden();
   await preferences(page,'Your profile');await expect(page.getByLabel('Display name',{exact:true})).toBeVisible();
   await page.getByLabel('Display name',{exact:true}).fill('Profile during copy');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.locator('#notice')).toContainText('Profile saved.');
   const appearance=page.waitForResponse(response=>/\/api\/(appearance|design)-preview$/.test(response.url()));
   await preferences(page,'Appearance');expect((await appearance).status()).toBe(200);
   await expect(page.locator('#design-preview')).toBeVisible();
   const interfaceSave=page.waitForResponse(response=>response.url().endsWith('/api/interface')&&response.request().method()==='POST');
   await page.getByLabel('Header alignment',{exact:true}).selectOption('left');await page.getByRole('button',{name:'Save app settings',exact:true}).click();expect((await interfaceSave).status()).toBe(200);
   await preferences(page,'Your profile');await expect(page.getByLabel('Display name',{exact:true})).toHaveValue('Profile during copy');
   await preferences(page,'Modules');await expect(page.locator('#notice.error')).toBeHidden();
   await preferences(page,'Help');await expect(page.locator('#notice.error')).toBeHidden();
   const summary=page.waitForResponse(response=>response.url().endsWith('/api/website/research/summary'));
   const preview=page.waitForResponse(response=>response.url().endsWith('/api/design-preview'));
   await navigate(page,'Website editor');expect((await summary).status()).toBe(200);expect((await preview).status()).toBe(200);
   const activity=await page.evaluate(async()=>(await(await fetch('/api/activity')).json()).operations);
   expect(activity.map(entry=>entry.kind)).toEqual(['/api/storage/copy']);
  }
  await preferences(page,kind==='copy'?'Storage & access':'General');
  const panel=page.locator('#app-activity-panel'),owned=page.locator('#main [data-owned-activity]');
  await expect(panel).toBeHidden();await expect(owned.locator('[data-status]')).toHaveText('Running');
  await expect(owned.locator('.operation-progress')).toBeVisible();await expect(owned).not.toContainText('Stored objects');
  await page.reload();await expect(owned.locator('[data-status]')).toHaveText('Running');
  await preferences(page,kind==='copy'?'General':'Storage & access');
  await expect(page.locator('#main [data-owned-activity] .operation-progress')).toHaveCount(0);
  await page.locator('.app-activity [data-toggle]').click();await expect(panel.locator('[data-status]')).toHaveText('Running');
  await expect(panel.locator('.operation-progress')).toHaveCount(0);
  expect(await panel.locator('article').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(180);
  await panel.getByRole('link',{name:'Show progress'}).click();await expect(panel).toBeHidden();
  await expect(owned.locator('.operation-progress')).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  expect(await owned.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:'.local/activity-'+kind+'.png'});
  const unauthorized=await fetch(app.origin+'/api/activity');expect(unauthorized.status).toBe(401);
  await page.locator('.app-activity [data-toggle]').click();
  release();await expect(panel.locator('[data-status]')).toHaveText(kind==='failed-record'?'Failed':'Completed',{timeout:45000});
  if(kind==='failed-record')await expect(panel.locator('[data-error]')).toBeVisible();
  await expect(owned.locator('article')).toHaveCount(kind==='failed-record'?1:0);
  await expect(page.locator('#main')).not.toContainText('Workspace operation in progress');
  if(kind==='record')expect((await new RecordWriting(f.workspace).read({workspaceId:book.id,recordId:book.entries[0].id,sectionId:null})).value.body).toBe('Saved while navigating.');
  await expect(page.locator('#notice.error')).toBeHidden();
  if(!await panel.isVisible())await page.locator('.app-activity [data-toggle]').click();
  await panel.getByRole('button',{name:'Clear finished activity'}).click();await expect(panel).toContainText('No operations to show.');
  await expect.poll(()=>page.evaluate(async()=>{
   const response=await fetch('/api/access/lock',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
   return {status:response.status,body:await response.json()};
  })).toEqual({status:200,body:{ok:true}});
  expect(await page.evaluate(async()=>(await fetch('/api/activity')).status)).toBe(401);
  await expect(page.locator('.app-activity')).toBeHidden();
  expect(errors).toEqual([]);
 }finally{release();ResearchCatalogue.prototype.verifyRecordHistory=verify;RecordWriting.prototype.save=save;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('queued and cancelled saves stay compact and never count as running work',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-activity-queue-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),destination=path.join(directory,'copied');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 let release,entered;const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),verify=ResearchCatalogue.prototype.verifyRecordHistory;
 ResearchCatalogue.prototype.verifyRecordHistory=async function(...args){entered();await gate;return verify.apply(this,args);};
 try{
  await page.goto(app.url);await preferences(page,'General');
  const read=await new RecordWriting(f.workspace).read({workspaceId:book.id,recordId:book.entries[0].id,sectionId:null});
  await page.evaluate(async({destination,read})=>{
   const storage=await(await fetch('/api/storage')).json(),headers={'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId,'X-Observanda-View':location.hash,'X-Observanda-Wait':'1'};
   window.queuedSave=new AbortController();window.copyResponse=fetch('/api/storage/copy',{method:'POST',headers,body:JSON.stringify({path:destination,confirmed:true})});
   window.queueSave=()=>{window.saveResponse=fetch('/api/research/records/writing/save',{method:'POST',headers,signal:window.queuedSave.signal,body:JSON.stringify({workspaceId:read.workspaceId,recordId:read.recordId,sectionId:null,expectedRevision:read.revision,value:{body:'Not admitted'}})}).catch(error=>error.name);};
  },{destination,read});
  await ready;await page.evaluate(()=>window.queueSave());
  await expect(page.locator('.app-activity [data-toggle]')).toHaveText('Activity (1 running, 1 queued)');
  const owned=page.locator('#main [data-owned-activity]');await expect(owned).toContainText('Waiting for: Copying workspace');await expect(owned.locator('progress')).toHaveCount(0);
  await page.locator('.app-activity [data-toggle]').click();const panel=page.locator('#app-activity-panel');
  await expect(panel.locator('article').first().locator('[data-title]')).toHaveText('Copying workspace');
  await expect(panel.locator('progress')).toHaveCount(0);await expect(panel).not.toContainText('No progress reported');
  await page.evaluate(()=>window.queuedSave.abort());await expect(panel.locator('article').last().locator('[data-status]')).toHaveText('Cancelled');
  await expect(panel.locator('article').last().locator('[data-error]')).toBeHidden();await expect(page.locator('.app-activity [data-toggle]')).toHaveText('Activity (1 running)');
  release();await expect(panel.locator('article').filter({has:page.locator('[data-title]',{hasText:'Copying workspace'})}).locator('[data-status]')).toHaveText('Completed',{timeout:45000});
 }finally{release();ResearchCatalogue.prototype.verifyRecordHistory=verify;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
