import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {createNotebook} from '../../src/model.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectImports} from '../../src/project-import.js';
import {LabBookImports} from '../../src/lab-book-import.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('cancel project and book imports in their own sections and recover cancellation after reload',async({page})=>{
 test.setTimeout(300000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-import-cancel-ui-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[],originals=[];let app;
 try{
  const metadata=createNotebook('Workspace'),f=await encryptedFixture(path.join(directory,'workspace'),metadata);keys.push(f.vault);const registry=new ProjectRegistry(f.workspace,metadata.id);
  async function project(parent,title){const data=createNotebook(title),id=randomUUID();data.projects=[{id,title,parentId:null,description:'',share:false,logoId:null}];const grant=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(grant);keys.push(vault);return initializeProjectLocation(path.join(parent,title),id,data,grant,vault);}
  const source=await project(directory,'Independent Project'),parent=await project(f.workspace.root,'Receiving Project');await registry.attach(parent,{expected:(await registry.read()).revision});
  const book=await new LabBookCreation(source,f.deviceStore).create({id:randomUUID(),username:'',password:'',book:{id:randomUUID(),projectId:source.projectId,title:'Observations'}});
  for(const Type of [ProjectImports,LabBookImports])for(const [method,stage] of [['run','copied'],['cancel','cancel-frozen']]){const original=Type.prototype[method];originals.push(()=>Type.prototype[method]=original);let interrupted=false;Type.prototype[method]=function(command,options){return original.call(this,command,{...options,checkpoint:point=>{if(point===stage&&!interrupted){interrupted=true;throw Error('Interrupted disposable '+method);}}});};}
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await page.locator('#workspace-navigation [data-action=projects]').click();
  const section=page.locator('[data-project-opening]'),form=page.locator('#project-opening-form');await page.locator('main .page-heading').getByRole('button',{name:'Import project',exact:true}).click();await form.getByLabel('Project folder',{exact:true}).fill(source.root);await form.getByRole('button',{name:'Import project',exact:true}).click();
  await expect(section.getByRole('button',{name:'Cancel import',exact:true})).toBeVisible({timeout:120000});await section.getByRole('button',{name:'Cancel import',exact:true}).click();await expect(form.getByRole('heading')).toHaveText('Discard the unfinished copy of Independent Project?');await expect(page.locator('#dialog')).not.toBeVisible();await form.getByRole('button',{name:'Discard unfinished copy',exact:true}).click();await expect(section.getByRole('button',{name:'Finish cancellation',exact:true})).toBeVisible({timeout:60000});await page.reload();await section.getByRole('button',{name:'Finish cancellation',exact:true}).click();await expect(section.locator('[data-import-complete]')).toHaveText('Import cancelled.',{timeout:60000});await expect(form).toHaveCount(0);await access(source.root);await assert.rejects(access(path.join(f.workspace.root,'Independent Project')),{code:'ENOENT'});expect((await registry.read()).value.projects).toHaveLength(1);
  await page.goto(app.origin+'/#/owners/'+parent.projectId+'/projects/'+parent.projectId);const bookSection=page.locator('[data-book-import]'),bookForm=page.locator('[data-book-import-form]');await bookSection.getByRole('button',{name:'Import lab book',exact:true}).click();await bookForm.getByLabel('Lab-book folder',{exact:true}).fill(book.book.root);await bookForm.getByRole('button',{name:'Import lab book',exact:true}).click();await expect(bookSection.getByRole('button',{name:'Cancel import',exact:true})).toBeVisible({timeout:90000});await bookSection.getByRole('button',{name:'Cancel import',exact:true}).click();await bookForm.getByRole('button',{name:'Discard unfinished copy',exact:true}).click();await expect(bookSection.getByRole('button',{name:'Finish cancellation',exact:true})).toBeVisible({timeout:60000});await page.reload();await bookSection.getByRole('button',{name:'Finish cancellation',exact:true}).click();await expect(bookSection.locator('[data-import-complete]')).toHaveText('Import cancelled.',{timeout:60000});await expect(bookForm).toHaveCount(0);await access(book.book.root);await assert.rejects(access(path.join(parent.root,'Observations')),{code:'ENOENT'});await expect(bookSection.locator('[data-imports] article')).toHaveCount(0);await expect(page.locator('[data-owned-activity] .operation-progress')).toHaveCount(0);expect(errors).toEqual([]);await page.screenshot({path:test.info().outputPath('import-cancelled.png')});
 }finally{originals.forEach(restore=>restore());await page.close();await app?.close();await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-import-cancel-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
