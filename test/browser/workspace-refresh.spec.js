import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {openRecordDetail} from './record-editing-helper.js';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {Workspace} from '../../src/storage.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectCreation} from '../../src/project-creation.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {LabBookDirectory} from '../../src/lab-book-directory.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {MediaStore} from '../../src/media.js';
import {readAccess,verifyAccess} from '../../src/access.js';

// New lab books belong to a project with its own store. The independent writer
// creates that project before the app opens, then adds a lab book and its record
// outside the browser with the same commands the app runs.
async function fixture(page){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-refresh-'));
 const runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],errors=[];let app;
 const cleanup=async()=>{try{await app?.close();}finally{await runtime.close();detach();await Promise.all(keys.map(clearVault));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
 try{
  const f=await encryptedFixture(directory,upgradeNotebook(sampleNotebook()));keys.push(f.vault);
  const writer=new Workspace(f.workspace.root,f.vault),initial=await writer.read(),registry=new ProjectRegistry(writer,initial.book.id),projectId=randomUUID(),projectTitle='Field Project';
  const {project:entry}=await new ProjectCreation(registry,f.deviceStore).create({id:randomUUID(),username:'',password:'',project:{id:projectId,title:projectTitle,description:'',parentId:null,share:false,logoId:null}});
  const projectKey=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:f.deviceStore});keys.push(projectKey);
  const project=new ProjectStorage(entry.root,projectId,projectKey);
  app=await startServer({root:writer.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  return {...f,writer,initial,app,errors,projectId,projectTitle,
   async createBook(){
    const notebook={id:randomUUID(),projectId,title:'External Help'};
    const created=await new LabBookCreation(project,f.deviceStore,{publish:value=>new LabBookDirectory(registry).register(projectId,value)}).create({id:randomUUID(),username:'',password:'',book:notebook});
    const key=await verifyAccess(await readAccess(created.book.root),'','',{deviceStore:f.deviceStore});keys.push(key);
    const storage=new LabBookStorage(created.book.root,notebook.id,key),metadata=(await storage.outline()).metadata;
    const record={...structuredClone(sampleNotebook().entries[0]),id:randomUUID(),notebookId:notebook.id,title:'External article',sections:[],attachments:[],figures:[],relations:[],share:false};
    await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});return {notebook,record};},
   // An edit made elsewhere to the open project's own store (its description) changes what the project page shows.
   async touchProject(){const current=await project.read();const book=structuredClone(current.book);book.projects[0].description='Updated in another window';await project.save(book,current.etag);},
   async rename(record,title){const current=(await writer.read()).book.entries.find(r=>r.id===record.id);await new ResearchRecords(writer,{}).save({workspaceId:initial.book.id,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,title}}]});},
   async close(){await cleanup();expect(errors).toEqual([]);}
  };
 }catch(error){await cleanup().catch(()=>{});throw error;}
}
const logo=page=>page.getByRole('link',{name:'Observanda — refresh saved workspace',exact:true});
const openProject=async(page,f)=>{await page.locator('#workspace-navigation [data-action=open-project][data-id="'+f.projectId+'"]').click();await expect(page.locator('main h1')).toHaveText(f.projectTitle);};
// A project with its own store lists its lab books by name, from its directory.
const directoryBook=(page,title)=>page.locator('[data-lab-book-directory] .project-notebook').filter({hasText:title});

test('new lab books and records from an independent writer appear automatically without a reload',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);let documentLoads=0;
 page.on('request',r=>{if(r.resourceType()==='document')documentLoads++;});
 try{
  await openProject(page,f);const route=page.url();
  await page.context().route('**/api/notebook',route=>route.abort());
  await page.context().route('**/api/workspace/read/page',route=>route.abort());
  await page.context().route('**/api/projects/'+f.projectId+'/workspace/read/page',route=>route.abort());
  const {notebook}=await f.createBook();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(directoryBook(page,'External Help')).toBeVisible({timeout:15000});
  expect(page.url()).toBe(route);expect(documentLoads).toBe(0);
  await directoryBook(page,'External Help').locator('[data-action=filter-notebook][data-id="'+notebook.id+'"]').first().click();
  await expect(page.locator('main h1')).toHaveText('External Help');
  await expect(page.getByText('External article',{exact:true}).first()).toBeVisible();
 }finally{await f.close();}
});

test('logo refresh stays on the project and retries a failed revision check',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);let fail=true;
 try{
  await openProject(page,f);const route=page.url();
  await page.context().route('**/workspace/read/version',async request=>fail?request.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic interruption'}}):request.continue());
  await f.createBook();await logo(page).click();
  await expect(page.locator('[data-workspace-refresh-status]')).toContainText('Could not check');
  expect(page.url()).toBe(route);fail=false;
  await logo(page).focus();await page.keyboard.press('Enter');
  await expect(directoryBook(page,'External Help')).toBeVisible();expect(page.url()).toBe(route);
  await logo(page).click();await expect(page.locator('#notice')).toContainText('up to date');
 }finally{await f.close();}
});

test('external changes do not replace a draft and ordinary saving still detects a conflict',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page),record=f.initial.book.entries[0];
 try{
  await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  const dialog=await openRecordDetail(page);await dialog.getByLabel('Record title',{exact:true}).fill('My unsaved title');
  await f.rename(record,'External saved title');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-workspace-refresh-status]')).toContainText('New saved changes');
  await expect(dialog.getByLabel('Record title',{exact:true})).toHaveValue('My unsaved title');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();
  await expect(dialog.locator('.record-writing-conflict')).toContainText('External saved title');
  expect((await f.writer.read()).book.entries.find(r=>r.id===record.id).title).toBe('External saved title');
 }finally{await f.close();}
});

test('typing during a refresh keeps the draft; later clean record refresh loads the saved revision',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page),record=f.initial.book.entries[0];let release;
 const gate=new Promise(resolve=>{release=resolve;});
 try{
  await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await expect(page.locator('.record-editing h1')).toHaveText(record.title);
  let held=false;
  await page.context().route('**/api/workspace/read/start',async route=>{const response=await route.fetch();held=true;await gate;await route.fulfill({response}).catch(()=>{});});
  await f.rename(record,'Saved while open');const refresh=logo(page).click();
  await expect.poll(()=>held).toBe(true);
  const dialog=await openRecordDetail(page);await dialog.getByLabel('Record title',{exact:true}).fill('Typing during refresh');release();await refresh;
  await expect(dialog.getByLabel('Record title',{exact:true})).toHaveValue('Typing during refresh');
  await expect(page.locator('[data-workspace-refresh-status]')).toContainText('New saved changes');
  await dialog.getByRole('button',{name:'Discard this edit',exact:true}).click();await dialog.getByRole('button',{name:'Discard this edit and its checkpoint?',exact:true}).click();await expect(dialog).not.toBeVisible();await logo(page).click();
  await expect(page.locator('.record-editing h1')).toHaveText('Saved while open');
 }finally{release();await f.close();}
});

test('locking during a refresh cancels adoption and a form dialog is preserved',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page);let release;
 try{
  await openProject(page,f);await page.getByRole('button',{name:'New lab book',exact:true}).click();
  await page.getByLabel('Lab book name',{exact:true}).fill('Unfinished form');await f.touchProject();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('[data-workspace-refresh-status]')).toContainText('New saved changes');
  await expect(page.getByLabel('Lab book name',{exact:true})).toHaveValue('Unfinished form');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  const guard=page.getByRole('dialog',{name:'Unsaved changes',exact:true});await guard.getByRole('button',{name:'Discard changes',exact:true}).click();
  let held=false;const gate=new Promise(resolve=>{release=resolve;});
  await page.context().route('**/workspace/read/start',async route=>{const response=await route.fetch();held=true;await gate;await route.fulfill({response}).catch(()=>{});});
  await logo(page).click();await expect.poll(()=>held).toBe(true);
  await page.getByRole('button',{name:'Lock workspace',exact:true}).click();release();
  await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await expect(page.locator('.project-notebook')).toHaveCount(0);
 }finally{release?.();await f.close();}
});
