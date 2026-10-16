import {LabBookCreation} from '../../src/lab-book-creation.js';
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,access,stat,mkdir} from 'node:fs/promises';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectArchives} from '../../src/project-archives.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {CATALOGUE_ARCHIVE,catalogueBinding} from '../../src/postgres-activation.js';

test('export one project backup and follow its progress in the project page through navigation and reload',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-archive-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),keys=[];let app,release,entered;
 const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),transfer=ProjectArchives.prototype.transfer,errors=[];
 try{
  const rootBook=sampleNotebook();rootBook.title='workspace';const f=await encryptedFixture(path.join(directory,'workspace'),rootBook);keys.push(f.vault);
  const book=sampleNotebook(),id=book.projects[0].id;book.projects[0].title='Selected backup project';const grant=await createWorkspaceAccess('','Project backup password',f.deviceStore),vault=takeCreatedVault(grant);keys.push(vault);
  book.title=book.projects[0].title;
  const source=await initializeProjectLocation(path.join(directory,book.projects[0].title),id,book,grant,vault),registry=new ProjectRegistry(f.workspace,rootBook.id);await registry.attach(source,{expected:'new'});
  const destinationParent=path.join(directory,'Project backups');await mkdir(destinationParent);const destination=path.join(destinationParent,book.title);
  const nested=await new LabBookCreation(source,f.deviceStore).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:id,title:'Experiment book 1'}});
  ProjectArchives.prototype.transfer=function(storage,value,options){return transfer.call(this,storage,value,{...options,checkpoint:async stage=>{if(stage==='database'){entered();await gate;}}});};
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  await page.goto(app.origin+'/#/owners/'+id+'/projects/'+id);const unlock=page.locator('#project-unlock-form');await expect(unlock).toBeVisible();await unlock.getByLabel('Project password',{exact:true}).fill('Project backup password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();const storage=page.locator('[data-project-storage="'+id+'"]');await expect(storage).toContainText(source.root);
  async function exportProject(){await storage.getByRole('button',{name:'Export project backup',exact:true}).click();await page.getByLabel('Destination parent folder',{exact:true}).fill(destinationParent);await page.locator('#project-storage-form').getByRole('button',{name:'Export project backup',exact:true}).click();}
  await exportProject();await expect(unlock.getByRole('heading',{name:'Unlock lab book'})).toBeVisible();await expect(unlock).toContainText('Experiment book 1');await unlock.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(storage.getByRole('button',{name:'Export project backup',exact:true})).toBeEnabled();await expect(storage.getByRole('button',{name:'Resume transfer',exact:true})).toHaveCount(0);await assert.rejects(access(destination),{code:'ENOENT'});
  expect(await page.evaluate(async()=>(await(await fetch('/api/activity')).json()).operations.filter(item=>item.kind.endsWith('/storage/export')))).toEqual([]);
  await exportProject();await expect(unlock.getByRole('heading',{name:'Unlock lab book'})).toBeVisible();await unlock.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await ready;
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue(rootBook.title);
  await page.goBack();await page.reload();await expect(storage).toContainText('Transferring project');await expect(storage.getByRole('button',{name:'Export project backup',exact:true})).toBeDisabled();await expect(page.locator('[data-owned-activity]')).toContainText('Exporting project backup');release();
  await expect(storage).toContainText('Backup exported to '+destination,{timeout:60000});await expect(storage.getByRole('button',{name:'Export project backup',exact:true})).toBeEnabled();await expect(storage).toContainText(source.root);
  assert.ok((await stat(path.join(destination,nested.book.directory,CATALOGUE_ARCHIVE))).size>0);assert.equal(await catalogueBinding(path.join(destination,nested.book.directory)),null);
  assert.ok((await stat(path.join(destination,CATALOGUE_ARCHIVE))).size>0);assert.equal(await catalogueBinding(destination),null);await assert.rejects(access(path.join(destination,'.observanda/postgresql')),{code:'ENOENT'});await access(source.root);assert.equal((await registry.locate(id)).root,source.root);
  await page.screenshot({path:test.info().outputPath('project-backup.png'),fullPage:true});expect(errors).toEqual([]);
 }finally{release();ProjectArchives.prototype.transfer=transfer;await page.close();await app?.close();await owner.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-project-archive-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
