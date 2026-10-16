import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,stat} from 'node:fs/promises';
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
import {ProjectRenames} from '../../src/project-rename.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {ResearchRecords} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

test('move protected nested books through cancellation, navigation and reload with requester access retained',async({page})=>{
 test.setTimeout(180000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-move-ui-')),owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),keys=[],errors=[];let app,release,entered,releaseCleanup,enteredCleanup;
 const gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),finish=ProjectRenames.prototype.finish,cleanupGate=new Promise(resolve=>releaseCleanup=resolve),cleanupReady=new Promise(resolve=>enteredCleanup=resolve);
 try{
  const rootBook=sampleNotebook();rootBook.title='workspace';const f=await encryptedFixture(path.join(directory,rootBook.title),rootBook);keys.push(f.vault);
  const book=sampleNotebook(),id=book.projects[0].id;book.title=book.projects[0].title='Experiment Project 1';const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const source=await initializeProjectLocation(path.join(f.workspace.root,book.title),id,book,access,vault),registry=new ProjectRegistry(f.workspace,rootBook.id);await registry.attach(source,{expected:'new'});
  const created=await new LabBookCreation(source,f.deviceStore).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:id,title:'Observations 1'}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book password',{deviceStore:f.deviceStore});keys.push(key);
  const nested=new LabBookStorage(created.book.root,created.book.labBookId,key),outline=await nested.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:nested.labBookId};await new ResearchRecords(nested,new MediaStore(nested)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
  const targetBook=sampleNotebook();targetBook.title=targetBook.projects[0].title='Collection';const targetAccess=await createWorkspaceAccess('','',f.deviceStore),targetKey=takeCreatedVault(targetAccess);keys.push(targetKey);
  const target=await initializeProjectLocation(path.join(f.workspace.root,targetBook.title),targetBook.projects[0].id,targetBook,targetAccess,targetKey);await registry.attach(target,{expected:(await registry.read()).revision});const destination=path.join(target.root,book.title);
  ProjectRenames.prototype.finish=function(value,key,options){return finish.call(this,value,key,{...options,checkpoint:async stage=>{if(stage==='stopped'){entered();await gate;}if(stage==='registered'){enteredCleanup();await cleanupGate;}}});};
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  await page.goto(app.origin+'/#/owners/'+id+'/projects/'+id);const storage=page.locator('[data-project-storage="'+id+'"]'),unlock=page.locator('#project-unlock-form');await expect(storage).toContainText(source.root);
  async function move(){await storage.getByRole('button',{name:'Move project',exact:true}).click();const placement=page.locator('#project-placement-form');await placement.getByLabel('Move into',{exact:true}).selectOption(target.projectId);await placement.getByRole('button',{name:'Move project',exact:true}).click();}
  await move();await expect(unlock.getByRole('heading',{name:'Unlock lab book'})).toBeVisible();await unlock.getByRole('button',{name:'Cancel',exact:true}).click();await expect(storage.getByRole('button',{name:'Move project',exact:true})).toBeEnabled();expect(await new ProjectRenames(registry,id).read()).toBeNull();await assert.rejects(stat(destination),{code:'ENOENT'});
  expect(await page.evaluate(async()=>(await(await fetch('/api/activity')).json()).operations.filter(item=>item.kind.endsWith('/storage/move')))).toEqual([]);
  await move();await expect(unlock.getByRole('heading',{name:'Unlock lab book'})).toBeVisible();await unlock.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(unlock).not.toBeVisible();await ready;
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue(rootBook.title);await page.goBack();await expect(page.locator('[data-owned-activity]')).toContainText('Moving project');await page.reload();await expect(page.locator('[data-owned-activity]')).toContainText('Moving project');release();await cleanupReady;await page.reload();await expect(page.locator('[data-owned-activity]')).toContainText('Moving project');releaseCleanup();
  await expect(storage).toContainText(destination,{timeout:60000});await expect(storage.getByRole('button',{name:'Move project',exact:true})).toBeEnabled();expect((await new ProjectRenames(registry,id).read()).phase).toBe('complete');await assert.rejects(stat(source.root),{code:'ENOENT'});
  const result=await page.evaluate(async({url,data})=>{const contextId=(await(await fetch('/api/storage')).json()).contextId;const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':contextId},body:JSON.stringify(data)});return {status:response.status,value:await response.json()};},{url:'/api/projects/'+id+'/lab-books/'+nested.labBookId+'/research/records/writing/read',data:{workspaceId:outline.metadata.id,recordId:record.id,sectionId:null}});expect(result.status).toBe(200);expect(result.value.value.body).toBe(record.body);
  await page.screenshot({path:test.info().outputPath('moved-project-books.png'),fullPage:true});expect(errors).toEqual([]);
 }finally{release();releaseCleanup();ProjectRenames.prototype.finish=finish;await page.close();await app?.close();await owner.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-move-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
