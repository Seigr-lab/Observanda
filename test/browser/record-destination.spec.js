import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createNotebook} from '../../src/model.js';
import {sampleNotebook} from '../../src/sample.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {LabBookDirectory} from '../../src/lab-book-directory.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

test('record creation selects and unlocks its dedicated owner without creating drafts while choosing',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-destination-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],errors=[],saves=[];let app;
 try{
  const root=createNotebook('workspace',''),f=await encryptedFixture(directory,root);keys.push(f.vault);const metadata=createNotebook('Observation Project','');metadata.projects=[{...sampleNotebook().projects[0],title:metadata.title}];const id=metadata.projects[0].id;
  const access=await createWorkspaceAccess('','Project password',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,metadata.title),id,metadata,access,vault),registry=new ProjectRegistry(f.workspace,root.id);await registry.attach(project,{expected:'new'});
  const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(id,entry)}).create({id:randomUUID(),username:'',password:'Book password',book:{id:randomUUID(),projectId:id,title:'Field Observations',configuration:{profiles:[],sections:[]}}}),key=await verifyAccess(await readAccess(created.book.root),'','Book password',{deviceStore:f.deviceStore});keys.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key);
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(request.url().endsWith('/research/records/save'))saves.push(request.url());});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();await page.evaluate(()=>location.hash='#/records');
  const dialog=page.locator('#dialog'),projectChoice=dialog.getByLabel('Project',{exact:true}),unlock=page.locator('#project-unlock-form');
  async function choose(){await page.getByRole('button',{name:'New record',exact:true}).click();await expect(projectChoice.locator('option',{hasText:'Observation Project'})).toHaveCount(1);await projectChoice.selectOption(id);}
  await choose();await expect(dialog.getByRole('button',{name:'Unlock to load lab books',exact:true})).toBeVisible();await expect(unlock).not.toBeVisible();
  await dialog.getByRole('button',{name:'Unlock to load lab books',exact:true}).click();await unlock.getByRole('button',{name:'Cancel',exact:true}).click();await expect(projectChoice).toHaveValue(id);await expect(page.locator('#leave-dialog')).not.toBeVisible();
  await dialog.getByRole('button',{name:'Unlock to load lab books',exact:true}).click();await unlock.getByLabel('Project password',{exact:true}).fill('Project password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(dialog.getByRole('button',{name:'Field Observations',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Field Observations',exact:true}).click();await expect(unlock.getByLabel('Lab book password',{exact:true})).toBeVisible();await unlock.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).not.toBeVisible();expect(saves).toEqual([]);
  await choose();await dialog.getByRole('button',{name:'Field Observations',exact:true}).click();await unlock.getByLabel('Lab book password',{exact:true}).fill('Book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(dialog.getByRole('heading',{name:'New record in Field Observations',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('#leave-dialog')).not.toBeVisible();
  for(const owner of [f.workspace,project,storage])expect((await new ResearchDrafts(owner).list()).drafts).toEqual([]);
  await page.evaluate(projectId=>location.hash='#/owners/'+projectId+'/projects/'+projectId+'/records',id);await expect(page).toHaveURL(app.origin+'/#/owners/'+id+'/projects/'+id+'/records');await expect(page.getByRole('heading',{name:'Observation Project / All records',exact:true})).toBeVisible();await page.getByRole('button',{name:'New record',exact:true}).click();await expect(projectChoice).toHaveValue(id);await dialog.getByRole('button',{name:'Field Observations',exact:true}).click();await dialog.getByRole('button',{name:'Create free-form note',exact:true}).click();await page.getByLabel('Record title',{exact:true}).fill('Scoped field observation');
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');expect(saves).toEqual([app.origin+'/api/projects/'+id+'/lab-books/'+storage.labBookId+'/research/records/save']);
  expect((await storage.read()).book.entries.map(record=>record.title)).toEqual(['Scoped field observation']);expect((await project.read()).book.entries).toEqual([]);expect((await f.workspace.read()).book.entries).toEqual([]);
  await page.reload();await expect(page.getByRole('heading',{name:'Scoped field observation',exact:true})).toBeVisible();expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-record-destination-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
