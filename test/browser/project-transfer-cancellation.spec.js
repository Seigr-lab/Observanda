import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,mkdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation,ProjectStorage} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectCopies} from '../../src/project-copy.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
test('cancel a paused project copy from its page and start another after reloading',async({page})=>{
 test.setTimeout(180000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-cancel-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),keys=[],transfer=ProjectCopies.prototype.transfer;let app,interrupted=false;const errors=[];
 try{
  const rootBook=sampleNotebook(),f=await encryptedFixture(path.join(directory,'workspace'),rootBook);keys.push(f.vault);const book=sampleNotebook(),id=book.projects[0].id,grant=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(grant);keys.push(vault);
  book.title=book.projects[0].title;
  const source=await initializeProjectLocation(path.join(directory,book.projects[0].title),id,book,grant,vault),registry=new ProjectRegistry(f.workspace,rootBook.id);await registry.attach(source,{expected:'new'});
  ProjectCopies.prototype.transfer=function(storage,value,options){return transfer.call(this,storage,value,{...options,checkpoint:async stage=>{if(stage==='files'&&!interrupted){interrupted=true;throw Error('Test interruption');}}});};
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();await page.goto(app.origin+'/#/owners/'+id+'/projects/'+id);
  const storage=page.locator('[data-project-storage="'+id+'"]'),paused=path.join(directory,'Paused copy',book.title);await expect(storage).toContainText(source.root);
  async function copy(destination){await mkdir(path.dirname(destination),{recursive:true});await storage.getByRole('button',{name:'Copy project',exact:true}).click();await page.locator('#project-storage-path').fill(path.dirname(destination));await page.locator('#project-storage-form').getByRole('button',{name:'Copy project',exact:true}).click();}
  await copy(paused);const cancel=storage.getByRole('button',{name:'Cancel transfer and keep files',exact:true});await expect(cancel).toBeVisible({timeout:60000});await cancel.click();await expect(storage).toContainText('Transfer cancelled. Destination files kept at '+paused);await page.reload();await expect(storage).toContainText('Transfer cancelled. Destination files kept at '+paused);await expect(storage.getByRole('button',{name:'Resume transfer',exact:true})).toHaveCount(0);assert.ok(await stat(path.join(paused,'workspace.observanda')));
  const fresh=path.join(directory,'New copy',book.title);await copy(fresh);await expect(storage).toContainText('Copied to '+fresh,{timeout:60000});assert.deepEqual((await new ProjectStorage(fresh,id,vault).read()).book,book);assert.deepEqual((await source.read()).book,book);assert.equal((await registry.locate(id)).root,source.root);expect(errors).toEqual([]);
 }finally{ProjectCopies.prototype.transfer=transfer;await page.close();await app?.close();await owner.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-cancel-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
