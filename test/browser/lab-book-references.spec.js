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
import {LabBookDirectory} from '../../src/lab-book-directory.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

test('links open the owning book and its retained revisions after authentication and reload',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-links-ui-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[],errors=[];let app;
 try{
  const model=createNotebook('workspace'),f=await encryptedFixture(directory,model);keys.push(f.vault);const registry=new ProjectRegistry(f.workspace,model.id),addresses=new LabBookDirectory(registry);
  const metadata=createNotebook('Field Project 1'),id=randomUUID();metadata.projects=[{id,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
  const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);const project=await initializeProjectLocation(path.join(f.workspace.root,metadata.title),id,metadata,access,vault);await registry.attach(project,{expected:'new'});
  async function make(title,password,relations=[]){
   const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>addresses.register(id,entry)}).create({id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId:id,title}}),key=await verifyAccess(await readAccess(created.book.root),'',password,{deviceStore:f.deviceStore});keys.push(key);
   const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:storage.labBookId,title:title+' observation',body:title+' original',relations};
   await new ResearchRecords(storage,new MediaStore(storage)).save({workspaceId:created.book.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
   return {...created.book,storage,record:(await storage.read()).book.entries[0]};
  }
  const b=await make('Book B','Independent book password'),target={workspaceId:b.namespaceId,kind:'record',id:b.record.id};
  const a=await make('Book A','',[
   {id:randomUUID(),type:'Builds on',label:'Book B current',target},
   {id:randomUUID(),type:'Builds on',label:'Book B retained',target:{...target,revision:recordRevision(b.record)}}
  ]);
  await new ResearchRecords(b.storage,new MediaStore(b.storage)).save({workspaceId:b.namespaceId,changes:[{id:b.record.id,expectedRevision:recordRevision(b.record),record:{...b.record,body:'A later observation'}}]});
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  const url=book=>app.origin+'/#/owners/'+id+'/books/'+book.labBookId+'/records/'+book.record.id+'/read';
  await page.goto(url(a));await expect(page.locator('main h1')).toHaveText('Book A observation');await page.getByRole('button',{name:'Book B current',exact:true}).click();
  const unlock=page.locator('#project-unlock-form');await expect(unlock.getByRole('heading',{name:'Unlock lab book'})).toBeVisible();await unlock.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();
  await expect(page.locator('main h1')).toHaveText('Book B observation');expect(new URL(page.url()).hash).toContain('/books/'+b.labBookId+'/');await expect(page.locator('main')).toContainText('A later observation');
  await page.reload();await expect(page.locator('main h1')).toHaveText('Book B observation');
  await page.goto(url(a));await page.getByRole('button',{name:'Book B retained',exact:true}).click();await expect(page.locator('.retained-record-reader')).toContainText('Book B original');
  expect(errors).toEqual([]);await page.screenshot({path:test.info().outputPath('book-reference.png'),fullPage:true});
 }finally{await page.close();await app?.close();await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-book-links-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
