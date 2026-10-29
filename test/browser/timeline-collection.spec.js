import {workspaceModules} from '../../src/modules/index.js';
import {navigate} from './preferences-helper.js';
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

test('timeline selects and reopens independent books with explicit access and durable source identities',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-timeline-owners-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],errors=[],requests=[];let app;
 try{
  const root=sampleNotebook(),f=await encryptedFixture(directory,root);keys.push(f.vault);const book=sampleNotebook(),id=book.projects[0].id;book.title=book.projects[0].title='Observation Project';const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,book.title),id,book,access,vault),registry=new ProjectRegistry(f.workspace,root.id);await registry.attach(project,{expected:'new'});
  const section={id:randomUUID(),profileId:null,key:'field-template',label:'Field template',description:'',fields:[],enabled:true};
  const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(id,entry)}).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:id,title:'Field Observations',configuration:{profiles:[],sections:[section]}}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book password',{deviceStore:f.deviceStore});keys.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),metadata=(await storage.outline()).metadata,record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId,title:'Independent book observation',updatedAt:'2026-10-16T12:00:00.000Z',template:templateFrom(section)};
  const media=new MediaStore(storage),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="teal"/></svg>'),'image');record.attachments=[{...asset,caption:'Field image',alt:'A teal square',transcript:'',share:false}];
  const records=[record,...Array.from({length:54},(_,i)=>({...record,id:randomUUID(),attachments:[],title:'Independent observation '+i,updatedAt:new Date(Date.UTC(2026,9,16,12,i+1)).toISOString()}))];
  await new ResearchRecords(storage,media).save({workspaceId:metadata.id,changes:records.map(value=>({id:value.id,expectedRevision:null,record:value}))});

  const settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules.push('timeline');await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await navigate(page,'Timeline');
  const main=page.locator('main'),results=main.locator('[data-timeline-results]');await main.getByRole('button',{name:'New timeline',exact:true}).click();await main.getByLabel('Name',{exact:true}).fill('Owned observations chronology');
  await expect(results.getByRole('button',{name:'Retry records',exact:true})).toBeVisible();await expect(page.locator('#project-unlock-form')).not.toBeVisible();await results.getByRole('button',{name:'Retry records',exact:true}).click();
  const unlock=page.locator('#project-unlock-form');await expect(unlock).toBeVisible();await unlock.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(results.locator('.tool-branch li')).toHaveCount(50);
  if(!await main.getByText('Sources and display',{exact:true}).evaluate(node=>node.parentElement.open))await main.getByText('Sources and display',{exact:true}).click();const books=main.locator('[data-timeline-choices="books"]');if(await books.getByRole('button',{name:'Retry sources',exact:true}).isVisible())await books.getByRole('button',{name:'Retry sources',exact:true}).click();
  await books.getByLabel('Search lab books',{exact:true}).fill('Field Observations');await expect(books.getByRole('checkbox',{name:'Field Observations / Observation Project',exact:true})).toBeVisible();await books.getByRole('checkbox',{name:'Field Observations / Observation Project',exact:true}).check();await expect(results.locator('[data-timeline-status]')).toContainText('55 matching records');
  await results.getByRole('button',{name:'Next records',exact:true}).click();await expect(results.locator('.tool-branch li')).toHaveCount(5);await results.getByRole('button',{name:'Previous records',exact:true}).click();await expect(results.locator('.tool-branch li')).toHaveCount(50);
  await main.getByRole('button',{name:'Save timeline',exact:true}).click();await expect(main.locator('.module-subtabs [aria-current=page]')).toHaveText('Timeline');await page.reload();await expect(results.locator('[data-timeline-status]')).toContainText('55 matching records');
  const saved=(await workspaceModules(f.workspace).current()).entities.find(entity=>entity.type==='timeline-view');expect(saved.data.books).toEqual([metadata.id+'/'+storage.labBookId]);
  const title=await results.locator('.tool-branch li button').first().textContent();await results.getByRole('button',{name:title,exact:true}).click();await expect(page).toHaveURL(new RegExp('/owners/'+id+'/books/'+storage.labBookId+'/'));await expect(page.getByRole('heading',{name:title,exact:true})).toBeVisible();
  await page.goBack();await expect(results.locator('[data-timeline-status]')).toContainText('55 matching records');await page.screenshot({path:test.info().outputPath('timeline-dedicated-owners.png'),fullPage:true});expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-timeline-owners-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
