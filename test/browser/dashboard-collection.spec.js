import {createPanel,defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
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

test('dashboard reads, selects and opens dedicated project and book data without changing owners',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-dashboard-owners-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],errors=[],requests=[];let app;
 try{
  const root=sampleNotebook(),f=await encryptedFixture(directory,root);keys.push(f.vault);const book=sampleNotebook(),id=book.projects[0].id;book.title=book.projects[0].title='Observation Project';const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,book.title),id,book,access,vault),registry=new ProjectRegistry(f.workspace,root.id);await registry.attach(project,{expected:'new'});
  const section={id:randomUUID(),profileId:null,key:'field-template',label:'Field template',description:'',fields:[],enabled:true};
  const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(id,entry)}).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:id,title:'Field Observations',configuration:{profiles:[],sections:[section]}}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book password',{deviceStore:f.deviceStore});keys.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),metadata=(await storage.outline()).metadata,record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId,title:'Independent book observation',updatedAt:'2026-10-16T12:00:00.000Z',template:templateFrom(section)};
  const media=new MediaStore(storage),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="teal"/></svg>'),'image');record.attachments=[{...asset,caption:'Field image',alt:'A teal square',transcript:'',share:false}];
  const records=[record,...Array.from({length:7},(_,i)=>({...record,id:randomUUID(),attachments:[],title:'Independent observation '+i,updatedAt:new Date(Date.UTC(2026,9,16,12,i+1)).toISOString()}))];
  await new ResearchRecords(storage,media).save({workspaceId:metadata.id,changes:records.map(value=>({id:value.id,expectedRevision:null,record:value}))});
  const options={scopeMode:'selected',projectIds:[id],includeDescendants:true,includeWorkspace:false},settings=defaultDashboard();
  settings.views[0].panels=[{...createPanel('records','recent'),count:2,options},{...createPanel('notebooks','books'),count:10,options},{...createPanel('projects','projects'),count:10,options},{...createPanel('media','media'),source:{provider:'media',key:metadata.id+'/'+record.id+':'+asset.id},options}];
  await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);

  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/dashboard-collection/'))requests.push(r.url());});await page.goto(app.url);
  const card=name=>page.locator('[data-desk-card="'+name+'"]'),recent=card('recent');
  await expect(recent.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await expect(page.locator('#dialog')).not.toBeVisible();
  await recent.getByRole('button',{name:'Retry',exact:true}).click();const unlock=page.locator('#project-unlock-form');await expect(unlock).toBeVisible();await unlock.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(unlock).not.toBeVisible();await expect(recent.locator('.desk-item')).toHaveCount(2);
  const titles=await recent.locator('.desk-item').allTextContents();await recent.locator('[data-action="dashboard-page-next"]').click();await expect.poll(()=>recent.locator('.desk-item').allTextContents()).not.toEqual(titles);await recent.locator('[data-action="dashboard-page-previous"]').click();await expect.poll(()=>recent.locator('.desk-item').allTextContents()).toEqual(titles);
  const openedTitle=await recent.locator('.desk-item [data-action="research-open-owned"]').first().textContent();await recent.getByRole('button',{name:openedTitle,exact:true}).click();await expect(page).toHaveURL(new RegExp('/owners/'+id+'/books/'+storage.labBookId+'/'));await expect(page.getByRole('heading',{name:openedTitle,exact:true})).toBeVisible();await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.locator('.desk-desktop')).toBeVisible();
  for(const name of ['books','media']){const retry=card(name).getByRole('button',{name:'Retry',exact:true});if(await retry.isVisible())await retry.click();}
  await expect(card('books').getByRole('button',{name:'Field Observations',exact:true})).toBeVisible();await expect(card('projects').getByRole('button',{name:'Field Observations',exact:true})).toBeVisible();
  await expect(card('media').locator('img')).toHaveAttribute('src',new RegExp('/api/projects/'+id+'/lab-books/'+storage.labBookId+'/media/'));await expect.poll(()=>card('media').locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  await recent.locator('[data-action="dashboard-inspector"]').click();const inspector=page.locator('.desk-inspector');await expect(inspector.getByLabel('Search projects',{exact:true})).toBeVisible();await expect(inspector.getByRole('checkbox',{name:'Observation Project',exact:true})).toBeChecked();
  await inspector.getByLabel('Lab books',{exact:true}).selectOption('selected');await expect(inspector.getByLabel('Search lab books',{exact:true})).toBeVisible();await inspector.getByLabel('Search lab books',{exact:true}).fill('Field');await expect(inspector.getByRole('checkbox',{name:'Field Observations / Observation Project',exact:true})).toBeVisible();
  await inspector.getByRole('checkbox',{name:'Field Observations / Observation Project',exact:true}).check();await expect(recent).toContainText('of 8');await expect(inspector.getByLabel('Search projects',{exact:true})).toBeVisible();await expect(inspector.getByLabel('Record type',{exact:true})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('dashboard-dedicated-owners.png'),fullPage:true});
  await card('books').getByRole('button',{name:'Field Observations',exact:true}).click();await expect(page).toHaveURL(new RegExp('/owners/'+id+'/books/'+storage.labBookId+'/'));expect(requests.some(url=>url.endsWith('/choices'))).toBe(true);expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-dashboard-owners-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
