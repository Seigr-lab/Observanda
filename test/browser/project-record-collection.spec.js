import {templateFrom} from '../../src/web/notebook-schema.js';
import {LabBookDirectory} from '../../src/lab-book-directory.js';
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {ResearchRecords} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
test('project overview and record list open records in their dedicated book',async({page})=>{
 test.setTimeout(180000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-collection-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],errors=[];let app;
 try{
  const root=sampleNotebook(),f=await encryptedFixture(directory,root);keys.push(f.vault);const book=sampleNotebook(),id=book.projects[0].id;book.title=book.projects[0].title='Observation Project';const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,book.title),id,book,access,vault),registry=new ProjectRegistry(f.workspace,root.id);await registry.attach(project,{expected:'new'});
  const section={id:randomUUID(),profileId:null,key:'field-template',label:'Field template',description:'',fields:[],enabled:true};
  const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(id,entry)}).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:id,title:'Field Observations',configuration:{profiles:[],sections:[section]}}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book password',{deviceStore:f.deviceStore});keys.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),metadata=(await storage.outline()).metadata,record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId,title:'Independent book observation',template:templateFrom(section)};await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',e=>errors.push(e.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  const projectUrl=app.origin+'/#/owners/'+id+'/projects/'+id;await page.goto(projectUrl);const recent=page.locator('#project-recent-records');await expect(recent.getByRole('button',{name:'Unlock to load records'})).toBeVisible();await expect(page.locator('#dialog')).not.toBeVisible();await recent.getByRole('button',{name:'Unlock to load records'}).click();const unlock=page.locator('#project-unlock-form');await expect(unlock).toBeVisible();await unlock.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(unlock).not.toBeVisible();
  await expect(recent.getByRole('link',{name:record.title,exact:true})).toBeVisible();await recent.getByRole('link',{name:record.title,exact:true}).click();await expect(page).toHaveURL(new RegExp('/owners/'+id+'/books/'+storage.labBookId+'/'));await expect(page.getByRole('heading',{name:record.title,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page).toHaveURL(projectUrl);await page.getByRole('button',{name:'All records here',exact:true}).click();await expect(page.locator('[data-record-list-status]')).toHaveText('Records 1-4 of 4');await expect(page.locator('#type-filter option').filter({hasText:'Field template'})).toHaveCount(1);const results=page.locator('#entry-results');await expect(results.getByRole('link',{name:record.title,exact:true})).toBeVisible();await page.getByRole('searchbox',{name:'Search records'}).fill('Independent book');await expect(page.locator('[data-record-list-status]')).toHaveText('Records 1-1 of 1');await results.getByRole('link',{name:record.title,exact:true}).click();await expect(page).toHaveURL(new RegExp('/owners/'+id+'/books/'+storage.labBookId+'/'));await expect(page.getByRole('heading',{name:record.title,exact:true})).toBeVisible();
  let waiting,release;const started=new Promise(resolve=>waiting=resolve),gate=new Promise(resolve=>release=resolve);let held=false;await page.route('**/api/projects/'+id+'/workspace/read/start',async route=>{if(held)return route.continue();held=true;const response=await route.fetch();waiting();await gate;try{await route.fulfill({response});}catch{}});await page.goto(projectUrl);await started;await expect(page).toHaveURL(projectUrl);await page.reload();release();await expect(recent.getByRole('link',{name:record.title,exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('project-record-collection.png'),fullPage:true});expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-record-collection-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
