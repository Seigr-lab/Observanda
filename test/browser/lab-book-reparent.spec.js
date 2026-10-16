import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {createNotebook} from '../../src/model.js';
import {sampleNotebook} from '../../src/sample.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {LabBookReparents} from '../../src/lab-book-reparent.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {ResearchRecords} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

test('move a protected book between project folders and resume an interrupted move in its project view',async({page})=>{
 test.setTimeout(240000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-move-ui-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[],errors=[];let app,release,entered,mode='hold';
 const original=LabBookReparents.prototype.run,gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 try{
  const model=createNotebook('workspace'),f=await encryptedFixture(directory,model);keys.push(f.vault);
  const registry=new ProjectRegistry(f.workspace,model.id);
  async function makeProject(title){const metadata=createNotebook(title),id=randomUUID();metadata.projects=[{id,title,parentId:null,description:'',share:false,logoId:null}];const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);const storage=await initializeProjectLocation(path.join(f.workspace.root,title),id,metadata,access,vault);await registry.attach(storage,{expected:(await registry.read()).revision});return storage;}
  const source=await makeProject('Source Project'),destination=await makeProject('Target Project'),created=await new LabBookCreation(source,f.deviceStore).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:source.projectId,title:'Observations 1'}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book password',{deviceStore:f.deviceStore});keys.push(key);
  const book=new LabBookStorage(created.book.root,created.book.labBookId,key),outline=await book.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:book.labBookId,title:'Retained observation'};await new ResearchRecords(book,new MediaStore(book)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
  LabBookReparents.prototype.run=function(...args){return original.call(this,...args.slice(0,3),{...args[3],checkpoint:async stage=>{if(mode==='hold'&&stage==='prepared'){entered();await gate;}if(mode==='interrupt'&&stage==='renamed'){mode='resume';throw Error('Interrupted disposable move');}}});};
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  const projectUrl=project=>app.origin+'/#/owners/'+project.projectId+'/projects/'+project.projectId,bookUrl=project=>app.origin+'/#/owners/'+project.projectId+'/books/'+book.labBookId+'/notebooks/'+book.labBookId;
  await page.goto(bookUrl(source));const unlock=page.locator('#project-unlock-form');await expect(unlock.getByRole('heading',{name:'Unlock lab book'})).toBeVisible();await unlock.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(page.locator('main h1')).toHaveText('Observations 1');
  const storage=page.locator('[data-lab-book-storage]');await storage.locator('summary').click();
  async function moveTo(target){await storage.getByRole('button',{name:'Move lab book',exact:true}).click();await expect(page.getByLabel('Destination project',{exact:true}).locator('option[value="'+target.projectId+'"]')).toHaveCount(1);await page.getByLabel('Destination project',{exact:true}).selectOption(target.projectId);await page.locator('#lab-book-storage-form').getByRole('button',{name:'Move lab book',exact:true}).click();}
  await moveTo(destination);await ready;await page.getByRole('button',{name:'Preferences',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('workspace');await page.goto(projectUrl(source));await expect(page.locator('[data-lab-book-moves]')).toContainText('Moving Observations 1 to Target Project');await page.reload();await expect(page.locator('[data-lab-book-moves]')).toContainText('Moving lab book');release();await expect(page.locator('[data-lab-book-moves]')).toBeHidden({timeout:60000});mode='interrupt';
  await page.goto(bookUrl(source));await expect(page.locator('main h1')).toHaveText('Observations 1');await expect.poll(()=>new URL(page.url()).hash).toContain('/owners/'+destination.projectId+'/books/');await expect(page.locator('main')).toContainText(record.title);await storage.locator('summary').click();await moveTo(source);await expect(storage.getByRole('button',{name:'Resume transfer',exact:true})).toBeVisible({timeout:60000});
  await page.goto(projectUrl(destination));await expect(page.getByRole('button',{name:'Finish moving lab book',exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'Finish moving lab book',exact:true}).click();await expect(page.locator('[data-lab-book-moves]')).toBeHidden({timeout:60000});
  await page.goto(bookUrl(source));await expect(page.locator('main h1')).toHaveText('Observations 1');await expect(page.locator('main')).toContainText(record.title);await storage.locator('summary').click();await expect(storage).toContainText(path.join(source.root,created.book.directory));expect(errors).toEqual([]);await page.screenshot({path:test.info().outputPath('book-move.png'),fullPage:true});
 }finally{release();LabBookReparents.prototype.run=original;await page.close();await app?.close();await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-move-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
