import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {preferences} from './preferences-helper.js';
import {OperationActivity} from '../../src/operation-activity.js';
import {OperationalDiagnostics} from '../../src/operational-diagnostics.js';
import {AppError} from '../../src/errors.js';
import {openRecordWriting} from './record-editing-helper.js';
import {websiteUpgradeStatus} from '../../src/website-files-migration.js';

test('local diagnostics require an unlocked session and are reviewed before a private-safe download',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-diagnostic-ui-')),book=sampleNotebook();book.title='private-record-sentinel';
 const diagnostics=new OperationalDiagnostics({directory:path.join(directory,'diagnostics')});
 const snapshot=diagnostics.snapshot.bind(diagnostics);let logReads=0;
 diagnostics.snapshot=()=>{logReads++;return snapshot();};
 const fixture=await encryptedFixture(directory,book),app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),diagnostics});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  expect((await fetch(app.origin+'/api/diagnostics')).status).toBe(401);
  expect((await fetch(app.origin+'/api/diagnostics/status')).status).toBe(401);
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toBeVisible({timeout:30000});
  await page.evaluate(async()=>{await fetch('/api/records?private-query-sentinel');});
  await preferences(page,'General');await page.getByRole('button',{name:'Review diagnostics',exact:true}).click();
  const dialog=page.locator('#dialog');await expect(dialog.getByRole('heading',{name:'Local diagnostics',exact:true})).toBeVisible();
  await expect(dialog.getByText('The local service is responding.',{exact:true})).toBeVisible();
  await expect(dialog.getByText('The selected workspace’s research storage is readable.',{exact:true})).toBeVisible();
  expect(logReads).toBe(0);
  await dialog.getByText('Review report contents',{exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Download this report',exact:true})).toBeVisible();
  const text=await dialog.locator('[data-diagnostic-content]').textContent(),report=JSON.parse(text);
  expect(report.entries.length).toBeGreaterThan(0);expect(text).not.toContain('private-record-sentinel');expect(text).not.toContain('private-query-sentinel');expect(text).not.toContain(directory.replaceAll('\\','\\\\'));
  const downloaded=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download this report',exact:true}).click();const download=await downloaded;
  expect(download.suggestedFilename()).toBe('observanda-diagnostics.json');const stream=await download.createReadStream();let body='';for await(const bytes of stream)body+=bytes;expect(JSON.parse(body)).toEqual(report);
  expect(logReads).toBe(1);
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  const locked=await page.evaluate(async()=>{const context=window.observandaWorkspaceContext;const status=await(await fetch('/api/storage')).json();return (await fetch('/api/access/lock',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':context??status.contextId},body:'{}'})).status;});expect(locked).toBe(200);
  expect(await page.evaluate(async()=>(await fetch('/api/diagnostics')).status)).toBe(401);expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true});}
});

test('health review returns a waiting writer to its owner and keeps an uncertain save distinct from a cancellation',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-health-actions-')),book=sampleNotebook(),fixture=await encryptedFixture(directory,book);
 const diagnostics=new OperationalDiagnostics(),original=OperationActivity.prototype.list;
 let app,seed=false,replayed=false;
 OperationActivity.prototype.list=function(scope){
  if(seed&&!replayed){
   replayed=true;
   this.begin(scope,'/api/storage/copy').running();
   this.begin(scope,'/api/storage/move').waiting();
   this.begin(scope,'/api/storage/rename').finish(new AppError('DURABILITY_UNCERTAIN'));
   this.begin(scope,'/api/sharing/prepare',{view:'#/preferences'}).finish(new AppError('WRITE_CANCELLED'));
   this.begin(scope,'/api/settings/save',{view:'#/preferences'}).finish();
  }
  return original.call(this,scope);
 };
 try{
  app=await startServer({root:fixture.workspace.root,port:0,headless:true,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),diagnostics});
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toBeVisible();
  await preferences(page,'General');
  // Signing in starts the workspace's own website preparation, a separate activity.
  // Let it finish and clear it, so the review counts only the operations seeded below.
  await expect.poll(async()=>(await websiteUpgradeStatus(fixture.workspace)).state,{timeout:60000}).toBe('ready');
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/activity')).json()).operations.filter(entry=>['running','queued'].includes(entry.state)).length),{timeout:30000}).toBe(0);
  expect(await page.evaluate(async()=>{
   const {sessionHeaders}=await import('/session-store.js'),snapshot=await(await fetch('/api/activity')).json();
   await fetch('/api/activity/clear',{method:'POST',headers:await sessionHeaders({'Content-Type':'application/json','X-Observanda-Workspace':snapshot.contextId}),body:'{}'});
   return (await(await fetch('/api/activity')).json()).operations;
  })).toEqual([]);
  seed=true;
  const review=page.getByRole('button',{name:'Review diagnostics',exact:true}),dialog=page.locator('#dialog');
  await review.click();
  const summary=dialog.locator('[data-health-summary]');
  for(const status of ['Outcome unconfirmed','Queued','Running','Completed','Cancelled'])await expect(summary).toContainText(status+' (1)');
  const row=summary.getByRole('listitem').filter({hasText:'Waiting for: Copying workspace'});
  const owner=row.getByRole('link',{name:'Show progress',exact:true});await expect(owner).toHaveAttribute('href','#/preferences/storage');
  await expect(summary.getByText('Inspect the saved operation before retrying.',{exact:false})).toBeVisible();
  await owner.click();await expect(dialog).not.toBeVisible();await expect(page).toHaveURL(/#\/preferences\/storage$/);
  await preferences(page,'General');
  diagnostics.snapshot=async()=>{throw new AppError('IO');};
  await review.click();await dialog.getByText('Review report contents',{exact:true}).click();
  await expect(dialog).toContainText('Some diagnostics could not be written.');
  await expect(dialog.getByRole('button',{name:'Download this report',exact:true})).toHaveCount(0);
  await dialog.getByRole('button',{name:'View all activity',exact:true}).click();
  await expect(dialog).not.toBeVisible();
  const close=page.getByRole('button',{name:'Close activity',exact:true});await expect(close).toBeVisible();
  await expect(page.locator('[data-operation] [data-status]').filter({hasText:'Outcome unconfirmed'}).first()).toBeVisible();
  await close.click();
  await page.evaluate(id=>location.hash='#/records/'+id,book.entries[0].id);
  const writing=await openRecordWriting(page);await writing.locator('.ProseMirror').fill('Observation captured while diagnostics were unavailable.');
  await writing.getByRole('button',{name:'Save changes',exact:true}).click();await expect(writing).not.toBeVisible();
  await page.reload();const reopened=await openRecordWriting(page);
  await expect(reopened.locator('.ProseMirror')).toHaveText('Observation captured while diagnostics were unavailable.');
 }finally{OperationActivity.prototype.list=original;await app?.close();await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
});
