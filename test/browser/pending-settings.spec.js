import {RecordWriting} from '../../src/record-writing.js';
import {projectDomainLock} from '../../src/project-domain-lock.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {Workspace} from '../../src/storage.js';
import {openCatalogue} from '../../src/postgres.js';
import {preferences,navigate} from './preferences-helper.js';

test('module edits remain usable through copy, navigation, reload and verified destination activation',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pending-ui-')),f=await encryptedFixture(directory,sampleNotebook()),destination=path.join(directory,'copied'),initial=await readWorkspaceDashboard(f.workspace);
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});let release;const gate=new Promise(resolve=>release=resolve),verify=ResearchCatalogue.prototype.verifyRecordHistory;
 ResearchCatalogue.prototype.verifyRecordHistory=async function(...args){await gate;return verify.apply(this,args);};const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await preferences(page,'General');
  await page.evaluate(async destination=>{const storage=await(await fetch('/api/storage')).json();window.copying=fetch('/api/storage/copy',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId,Accept:'application/x-ndjson'},body:JSON.stringify({path:destination,confirmed:true})}).then(r=>r.text());},destination);
  await expect(page.locator('.app-activity [data-toggle]')).toContainText('1 running');
  await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Planning',exact:true}).check();await page.getByRole('switch',{name:'Enable Inventory',exact:true}).check();
  await expect(page.locator('#desk-save-state')).toHaveText('Saved');
  await navigate(page,'Inventory');await expect(page.getByRole('heading',{name:path.basename(f.workspace.root)+' inventory',exact:true})).toBeVisible();await expect(page.locator('[data-module-items-status]')).toHaveText('No matching items.');
  await navigate(page,'Dashboard');await navigate(page,'All records');await expect(page.locator('[data-action="browse-record"]').first()).toBeVisible();
  await preferences(page,'General');await expect(page.getByRole('heading',{name:'Workspace details',exact:true})).toBeVisible();await preferences(page,'Modules');await expect(page.getByRole('switch',{name:'Enable Planning',exact:true})).toBeChecked();
  const independent=await page.evaluate(async()=>{const storage=await(await fetch('/api/writer-recovery')).json();return(await fetch('/api/interface',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},body:JSON.stringify({fontSize:18,lineHeight:1.7})})).status;});expect(independent).toBe(200);
  expect((await readWorkspaceDashboard(f.workspace)).etag).toBe(initial.etag);
  await page.reload();await expect(page.getByRole('switch',{name:'Enable Planning',exact:true})).toBeChecked();
  await expect(page.locator('.app-activity [data-toggle]')).toContainText('running');
  release();await expect(page.getByRole('switch',{name:'Enable Planning',exact:true})).toBeChecked({timeout:45000});
  await expect.poll(async()=>(await readWorkspaceDashboard(new Workspace(destination,f.vault))).settings.enabledModules,{timeout:15000}).toEqual(expect.arrayContaining(['planning','resources']));
  expect((await readWorkspaceDashboard(f.workspace)).etag).toBe(initial.etag);
  await preferences(page,'Modules');await expect(page.getByRole('switch',{name:'Enable Inventory',exact:true})).toBeChecked();await expect(page.locator('#desk-save-state')).toHaveText('');
  expect(errors).toEqual([]);
 }finally{release();ResearchCatalogue.prototype.verifyRecordHistory=verify;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('module choices can be reversed with their toggles while the preferences writer is occupied',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pending-cancel-ui-')),f=await encryptedFixture(directory,sampleNotebook()),initial=await readWorkspaceDashboard(f.workspace),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});let holder;
 try{
  await page.goto(app.url);await preferences(page,'Modules');holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await projectDomainLock(holder,'Observanda/workspace-settings/'+holder.id+'/dashboard');
  await page.getByRole('switch',{name:'Enable Inventory',exact:true}).check();await expect(page.locator('#desk-save-state')).toContainText(/Saved|Saving/);
  await expect(page.getByRole('button',{name:'Discard pending changes',exact:true})).toBeHidden();
  await page.getByRole('switch',{name:'Enable Inventory',exact:true}).uncheck();
  await holder.run('ROLLBACK');await expect(page.locator('#desk-save-state')).toHaveText('');expect((await readWorkspaceDashboard(f.workspace)).settings).toEqual(initial.settings);
 }finally{await holder?.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('retained module settings survive a service restart before their writer becomes available',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pending-restart-ui-')),f=await encryptedFixture(directory,sampleNotebook());let app,holder;
 try{
  app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
  await page.goto(app.url);await preferences(page,'Modules');holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await projectDomainLock(holder,'Observanda/workspace-settings/'+holder.id+'/dashboard');
  await page.getByRole('switch',{name:'Enable Inventory',exact:true}).check();await expect(page.locator('#desk-save-state')).toContainText(/Saved|Saving/);
  await expect.poll(()=>page.evaluate(async()=>(await(await fetch('/api/dashboard/pending')).json()).pending?.settings.enabledModules??[])).toContain('resources');
  await app.close();app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
  await page.goto(app.url);await preferences(page,'Modules');await expect(page.getByRole('switch',{name:'Enable Inventory',exact:true})).toBeChecked();
  await expect(page.locator('#desk-save-state')).toContainText(/Saved|Saving/);
  await holder.run('ROLLBACK');await expect(page.locator('#desk-save-state')).toHaveText('');
  expect((await readWorkspaceDashboard(f.workspace)).settings.enabledModules).toContain('resources');
  await page.reload();await expect(page.getByRole('switch',{name:'Enable Inventory',exact:true})).toBeChecked();
 }finally{await holder?.close();await app?.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('another window sees and reverses retained module changes through ordinary toggles',async({page,context})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-pending-windows-ui-')),f=await encryptedFixture(directory,sampleNotebook()),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});let holder;
 try{
  await page.goto(app.url);await preferences(page,'Modules');holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await projectDomainLock(holder,'Observanda/workspace-settings/'+holder.id+'/dashboard');
  await page.getByRole('switch',{name:'Enable Inventory',exact:true}).check();await expect(page.locator('#desk-save-state')).toContainText(/Saved|Saving/);
  const other=await context.newPage();await other.goto(app.url);await preferences(other,'Modules');await expect(other.getByRole('switch',{name:'Enable Inventory',exact:true})).toBeChecked();
  await other.getByRole('switch',{name:'Enable Planning',exact:true}).check();await expect(other.locator('#desk-save-state')).toContainText(/Saved|Saving/);
  await expect(page.getByRole('switch',{name:'Enable Planning',exact:true})).toBeChecked();
  await expect(other.getByRole('button',{name:'Discard pending changes',exact:true})).toBeHidden();
  await other.getByRole('switch',{name:'Enable Inventory',exact:true}).uncheck();await expect(page.getByRole('switch',{name:'Enable Inventory',exact:true})).not.toBeChecked();
  await other.getByRole('switch',{name:'Enable Planning',exact:true}).uncheck();await holder.run('ROLLBACK');
  await expect(other.getByRole('switch',{name:'Enable Inventory',exact:true})).not.toBeChecked();
  await expect(page.getByRole('switch',{name:'Enable Inventory',exact:true})).not.toBeChecked();await expect(page.getByRole('switch',{name:'Enable Planning',exact:true})).not.toBeChecked();await expect(page.locator('#desk-save-state')).toHaveText('');
  await holder.run('ROLLBACK');expect((await readWorkspaceDashboard(f.workspace)).settings.enabledModules).not.toContain('resources');
 }finally{await holder?.close();await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});


test('module choices save while the research writer is held and remain after reload',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-independent-settings-ui-')),f=await encryptedFixture(directory,sampleNotebook());let app,holder;
 try{
  app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});await page.goto(app.url);await preferences(page,'Modules');
  const book=(await f.workspace.read()).book,target={workspaceId:book.id,recordId:book.entries[0].id,sectionId:null},base=await new RecordWriting(f.workspace).read(target);
  holder=await openCatalogue(f.workspace.root);await holder.run('BEGIN');await holder.lock();
  await page.evaluate(async command=>{const storage=await fetch('/api/storage').then(response=>response.json());window.researchSave=fetch('/api/research/records/writing/save',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId,'X-Observanda-Wait':'1'},body:JSON.stringify(command)}).then(async response=>({status:response.status,body:await response.json()}));},{...target,expectedRevision:base.revision,value:{body:'Concurrent research save'}});
  await expect.poll(()=>page.evaluate(async()=>(await fetch('/api/activity').then(response=>response.json())).operations.some(item=>item.kind==='/api/research/records/writing/save'&&item.state==='queued'))).toBe(true);
  await page.getByRole('switch',{name:'Enable Inventory',exact:true}).check();
  await expect.poll(async()=>(await readWorkspaceDashboard(f.workspace)).settings.enabledModules).toContain('resources');
  await holder.run('ROLLBACK');expect((await page.evaluate(()=>window.researchSave)).status).toBe(200);
  await page.reload();await preferences(page,'Modules');await expect(page.getByRole('switch',{name:'Enable Inventory',exact:true})).toBeChecked();
  await expect(page.locator('#desk-save-state')).toHaveText('');
  const activity=await page.evaluate(()=>fetch('/api/activity').then(response=>response.json()));expect(activity.operations.filter(item=>['running','queued'].includes(item.state)&&item.kind==='/api/dashboard')).toEqual([]);
 }finally{await holder?.close();await app?.close();clearVault(f.vault);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));expect(path.basename(directory).startsWith('observanda-independent-settings-ui-')).toBe(true);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
