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
import {ResearchRecords} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

// This is the browser/API-contract boundary. The destination reader is real;
// transfer receipts are controlled here. Durable copying/retirement is qualified
// by the transfer owner's native workflow, not by these simulated responses.
test('record transfer UI keeps its source through owner access, cancellation and recovered completion',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-transfer-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],errors=[],calls=[];let app;
 try{
  const book=sampleNotebook(),source=book.entries[0],f=await encryptedFixture(directory,book);keys.push(f.vault);
  const metadata=createNotebook('Destination project','');metadata.projects=[{...sampleNotebook().projects[0],title:metadata.title}];const projectId=metadata.projects[0].id;
  const access=await createWorkspaceAccess('','Project password',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,metadata.title),projectId,metadata,access,vault),registry=new ProjectRegistry(f.workspace,book.id);await registry.attach(project,{expected:'new'});
  const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(projectId,entry)}).create({id:randomUUID(),username:'',password:'Book password',book:{id:randomUUID(),projectId,title:'Destination observations',configuration:{profiles:[],sections:[]}}}),key=await verifyAccess(await readAccess(created.book.root),'','Book password',{deviceStore:f.deviceStore});keys.push(key);
  const destination=new LabBookStorage(created.book.root,created.book.labBookId,key),destinationRecord={...structuredClone(source),notebookId:destination.labBookId};
  await new ResearchRecords(destination,new MediaStore(destination)).save({workspaceId:created.book.namespaceId,changes:[{id:source.id,expectedRevision:null,record:destinationRecord}]});
  const original=await f.workspace.catalogue(async store=>store.member(await store.snapshot(),source.id)),saved=await destination.catalogue(async store=>store.member(await store.snapshot(),source.id));
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));
  let receipt=null,needsBookAccess=true,loseCompletion=true,failCleanup=true;
  await page.route('**/api/research/records/transfer/*',async route=>{
   const request=route.request(),operation=new URL(request.url()).pathname.split('/').at(-1),command=request.postDataJSON();calls.push({operation,command});
   const reply=value=>route.fulfill({status:200,contentType:operation==='status'?'application/json':'application/x-ndjson',body:operation==='status'?JSON.stringify(value):JSON.stringify({result:value})+'\n'});
   expect(command.workspaceId).toBe(book.id);expect(command.recordId).toBe(source.id);
   if(operation==='status')return reply(receipt);
   if(operation==='start'){
    expect(command).toEqual({id:expect.any(String),workspaceId:book.id,recordId:source.id,sourceNotebookId:source.notebookId,expectedStorageRevision:original.revision,targetProjectId:projectId,targetLabBookId:destination.labBookId,targetWorkspaceId:created.book.namespaceId,targetNotebookId:destination.labBookId});
    if(needsBookAccess)return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({code:'ACCESS_LOCKED',message:'Destination book is locked.',projectId,labBookId:destination.labBookId,labBookName:'Destination observations'})});
    receipt={id:command.id,phase:'verified',canResume:true,canCancel:true,targetOwner:{projectId,labBookId:destination.labBookId,workspaceId:created.book.namespaceId},targetNotebookId:destination.labBookId};return reply(receipt);
   }
   expect(command).toEqual({workspaceId:book.id,recordId:source.id,id:receipt.id});
   if(operation==='cancel'){receipt={...receipt,phase:'cancelled',canResume:true,canCancel:false,progress:{reclamation:{version:1,state:'pending'}}};return reply(receipt);}
   if(operation==='resume'&&receipt.phase==='cancelled'){if(failCleanup){failCleanup=false;return route.fulfill({status:503,json:{code:'IO',message:'Synthetic interrupted cancellation cleanup'}});}receipt={...receipt,canResume:false,progress:{reclamation:{version:1,state:'complete'}}};return reply(receipt);}
   expect(operation).toBe('resume');receipt={...receipt,phase:'complete',canResume:false,canCancel:false,result:{recordId:source.id,notebookId:destination.labBookId,workspaceId:created.book.namespaceId,projectId,labBookId:destination.labBookId,storageRevision:saved.revision}};
   if(loseCompletion){loseCompletion=false;return route.abort('failed');}return reply(receipt);
  });
  const sourceRoute=app.origin+'/#/records/'+source.id+'/read',dialog=page.getByRole('dialog',{name:'Move record',exact:true}),picker=page.locator('#dialog'),unlock=page.locator('#project-unlock-form');
  const open=()=>page.locator('.record-toolbar').getByRole('button',{name:'Move record',exact:true}).click();
  async function chooseBook(){
   await dialog.getByRole('button',{name:'Choose a lab book in a project',exact:true}).click();
   const choices=picker.getByLabel('Project',{exact:true});await expect(choices.locator('option[value="'+projectId+'"]')).toHaveCount(1);await choices.selectOption(projectId);
  }
  await page.goto(app.url);await page.goto(sourceRoute);await expect(page.locator('.record-reader h1')).toHaveText(source.title);
  await open();await chooseBook();await picker.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toBeVisible();expect(calls.filter(call=>call.operation!=='status')).toEqual([]);expect(page.url()).toBe(sourceRoute);
  await chooseBook();await picker.getByRole('button',{name:'Unlock to load lab books',exact:true}).click();await unlock.getByLabel('Project password',{exact:true}).fill('Project password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();
  await picker.getByRole('button',{name:'Destination observations',exact:true}).click();await expect(dialog).toContainText('Destination project / Destination observations');expect(page.url()).toBe(sourceRoute);
  await dialog.getByRole('button',{name:'Move record',exact:true}).click();await expect(unlock.getByLabel('Lab book password',{exact:true})).toBeVisible();await unlock.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toBeVisible();expect(page.url()).toBe(sourceRoute);
  const firstCommand=calls.find(call=>call.operation==='start').command;
  await dialog.getByRole('button',{name:'Retry this move',exact:true}).click();await unlock.getByLabel('Lab book password',{exact:true}).fill('Book password');needsBookAccess=false;await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(dialog.getByRole('button',{name:'Resume record move',exact:true})).toBeEnabled();expect(calls.filter(call=>call.operation==='start').every(call=>JSON.stringify(call.command)===JSON.stringify(firstCommand))).toBe(true);
  await dialog.getByRole('button',{name:'Cancel record move',exact:true}).click();await expect(dialog.getByRole('status').filter({hasText:'Finishing cancellation'})).toBeVisible();await expect(dialog.getByRole('button',{name:'Finish cancellation',exact:true})).toBeEnabled();await expect(dialog.getByRole('button',{name:'Choose a lab book in a project',exact:true})).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Resume record move',exact:true})).toHaveCount(0);expect(page.url()).toBe(sourceRoute);
  const admittedStarts=calls.filter(call=>call.operation==='start').length,cancelledId=receipt.id;
  await dialog.getByRole('button',{name:'Finish cancellation',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveText('Synthetic interrupted cancellation cleanup');await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.goto(app.origin+'/#/records/'+book.entries[1].id+'/read');await expect(page.locator('.record-reader h1')).toHaveText(book.entries[1].title);await page.goto(sourceRoute);await page.reload();await expect(page.locator('.record-reader h1')).toHaveText(source.title);await open();await expect(dialog.getByRole('button',{name:'Finish cancellation',exact:true})).toBeEnabled();expect(calls.at(-1)).toEqual({operation:'status',command:{workspaceId:book.id,recordId:source.id}});
  await dialog.getByRole('button',{name:'Finish cancellation',exact:true}).click();await expect(dialog).toContainText('The move was cancelled. The source record remains available.');expect(page.url()).toBe(sourceRoute);expect(calls.filter(call=>call.operation==='resume')).toEqual(Array.from({length:2},()=>({operation:'resume',command:{workspaceId:book.id,recordId:source.id,id:cancelledId}})));expect(calls.filter(call=>call.operation==='start')).toHaveLength(admittedStarts);await expect(dialog.getByRole('button',{name:'Finish cancellation',exact:true})).toHaveCount(0);
  await chooseBook();await picker.getByRole('button',{name:'Destination observations',exact:true}).click();await dialog.getByRole('button',{name:'Move record',exact:true}).click();await expect(dialog.getByRole('button',{name:'Resume record move',exact:true})).toBeEnabled();expect(receipt.id).not.toBe(firstCommand.id);
  const recovering=receipt.id;await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await expect(page.locator('.record-reader h1')).toHaveText(source.title);await open();await expect(dialog.getByRole('button',{name:'Resume record move',exact:true})).toBeEnabled();expect(calls.at(-1)).toEqual({operation:'status',command:{workspaceId:book.id,recordId:source.id}});
  await dialog.getByRole('button',{name:'Resume record move',exact:true}).click();await expect(dialog.getByRole('alert')).not.toBeEmpty();expect(page.url()).toBe(sourceRoute);expect(calls.at(-1)).toEqual({operation:'resume',command:{workspaceId:book.id,recordId:source.id,id:recovering}});
  await dialog.getByRole('button',{name:'Check this move again',exact:true}).click();await expect(dialog.getByRole('button',{name:'Open moved record',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Open moved record',exact:true}).click();
  await expect(page).toHaveURL(app.origin+'/#/owners/'+projectId+'/books/'+destination.labBookId+'/records/'+source.id+'/read');await expect(page.locator('.record-reader h1')).toHaveText(source.title);await page.reload();await expect(page.locator('.record-reader h1')).toHaveText(source.title);
  expect(await f.workspace.catalogue(async store=>(await store.member(await store.snapshot(),source.id)).revision)).toBe(original.revision);expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-record-transfer-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
