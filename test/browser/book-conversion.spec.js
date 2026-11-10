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
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

test('an ordinary book of a project converts into its own lab book from its settings',async({page})=>{
 test.setTimeout(300000);page.setDefaultTimeout(30000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-conversion-ui-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[],errors=[];let app;
 try{
  const model=createNotebook('workspace'),f=await encryptedFixture(directory,model);keys.push(f.vault);
  const metadata=createNotebook('Field Project 1'),id=randomUUID();metadata.projects=[{id,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
  const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,metadata.title),id,metadata,access,vault);await new ProjectRegistry(f.workspace,model.id).attach(project,{expected:'new'});
  const bookId=randomUUID(),records=[1,2].map(n=>({...structuredClone(sampleNotebook().entries[0]),id:randomUUID(),notebookId:bookId,title:'Field note '+n}));
  await project.update(book=>{book.notebooks=[{...structuredClone(sampleNotebook().notebooks[0]),id:bookId,projectId:id,title:'Field notes'}];book.entries=records;return book;});
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  await page.goto(app.origin+'/#/owners/'+id+'/projects/'+id);await expect(page.locator('main h1')).toHaveText(metadata.title);
  await page.locator('#workspace-navigation [data-action=filter-notebook][data-id="'+bookId+'"]').click();await expect(page.locator('main h1')).toHaveText('Field notes');
  await page.getByRole('button',{name:'Lab book settings',exact:true}).click();
  await page.getByRole('button',{name:'Review conversion',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Convert into a lab book',exact:true});
  await expect(dialog).toBeVisible();await expect(dialog).toContainText('2 records will move.',{timeout:60000});
  await dialog.getByLabel('Lab book password',{exact:true}).fill('Converted field notes 789!');await dialog.getByLabel('Confirm lab book password',{exact:true}).fill('Converted field notes 789!');
  await dialog.getByRole('button',{name:'Start conversion',exact:true}).click();
  await expect(page.locator('#notice')).toContainText('The book was converted into a lab book.',{timeout:240000});
  expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await provider.close();detach();await Promise.all(keys.map(clearVault));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-conversion-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
