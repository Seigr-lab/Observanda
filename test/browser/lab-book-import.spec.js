import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rename,rm} from 'node:fs/promises';
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
import {LabBookImports} from '../../src/lab-book-import.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {copyLabBookLocation} from '../../src/lab-book-transfer.js';
import {ResearchRecords} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

test('import a protected book from its project section and resume after navigation and reload',async({page})=>{
 test.setTimeout(240000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-import-ui-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[],errors=[];let app,release,entered,mode='hold';
 const original=LabBookImports.prototype.run,gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 try{
  const model=createNotebook('workspace'),f=await encryptedFixture(directory,model);keys.push(f.vault);const registry=new ProjectRegistry(f.workspace,model.id);
  async function makeProject(parent,title){const metadata=createNotebook(title),id=randomUUID();metadata.projects=[{id,title,parentId:null,description:'',share:false,logoId:null}];const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);return initializeProjectLocation(path.join(parent,title),id,metadata,access,vault);}
  const external=await makeProject(directory,'External Project'),destination=await makeProject(f.workspace.root,'Target Project');await registry.attach(destination,{expected:(await registry.read()).revision});
  const created=await new LabBookCreation(external,f.deviceStore).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:external.projectId,title:'Observations 1'}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book password',{deviceStore:f.deviceStore});keys.push(key);
  const book=new LabBookStorage(created.book.root,created.book.labBookId,key),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:book.labBookId,title:'Imported observation'};await new ResearchRecords(book,new MediaStore(book)).save({workspaceId:created.book.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
  const backups=path.join(directory,'Backups');await mkdir(backups);const backup=path.join(backups,created.book.directory);await copyLabBookLocation(book,backup,{id:randomUUID(),portable:true});
  LabBookImports.prototype.run=function(command,options){return original.call(this,command,{...options,checkpoint:async stage=>{if(mode==='hold'&&stage==='copied'){entered();await gate;mode='interrupt';}if(mode==='interrupt'&&stage==='restored'){mode='resume';throw Error('Interrupted disposable import');}}});};
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  const projectUrl=app.origin+'/#/owners/'+destination.projectId+'/projects/'+destination.projectId,bookUrl=app.origin+'/#/owners/'+destination.projectId+'/books/'+book.labBookId+'/notebooks/'+book.labBookId;
  await page.goto(projectUrl);const section=page.locator('[data-book-import]'),form=page.locator('[data-book-import-form]');await section.getByRole('button',{name:'Import lab book',exact:true}).click();await form.getByLabel('Lab-book folder',{exact:true}).fill(backup);await form.getByLabel('Lab book password',{exact:true}).fill('Wrong password');await form.getByRole('button',{name:'Import lab book',exact:true}).click();await expect(section.locator('[data-import-error]')).toBeVisible();await expect(form.getByLabel('Lab-book folder',{exact:true})).toHaveValue(backup);await expect(page.locator('#project-unlock-form')).toHaveCount(0);
  await form.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await form.getByRole('button',{name:'Import lab book',exact:true}).click();await ready;
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('workspace');await page.goto(projectUrl);await expect(section.locator('[data-imports]')).toContainText('Importing Observations 1');await page.reload();await expect(section.locator('[data-imports]')).toContainText('Importing lab book');await rename(backup,path.join(backups,'Source unavailable'));release();
  await expect(section.getByRole('button',{name:'Finish importing lab book',exact:true})).toBeVisible({timeout:60000});await page.reload();await section.getByRole('button',{name:'Finish importing lab book',exact:true}).click();await form.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await form.getByRole('button',{name:'Finish importing lab book',exact:true}).click();await expect(section.locator('[data-import-complete]')).toBeVisible({timeout:60000});await expect(section.locator('[data-imports] article')).toHaveCount(0);
  await page.goto(bookUrl);await expect(page.locator('main h1')).toHaveText('Observations 1');await expect(page.locator('main')).toContainText(record.title);await page.reload();await expect(page.locator('main')).toContainText(record.title);expect(errors).toEqual([]);await page.screenshot({path:test.info().outputPath('book-import.png'),fullPage:true});
 }finally{release();LabBookImports.prototype.run=original;await page.close();await app?.close();await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-import-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
