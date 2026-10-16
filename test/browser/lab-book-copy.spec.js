import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,stat} from 'node:fs/promises';
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
import {LabBookCopies} from '../../src/lab-book-copy.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {ResearchRecords} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

test('selected book copy and export retain progress and recovery through navigation and reload',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(20000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-selected-book-ui-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[],errors=[];let app,release,entered,interrupted=false;
 const original=LabBookCopies.prototype.run,gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 try{
  const model=createNotebook('workspace'),f=await encryptedFixture(directory,model);keys.push(f.vault);
  const metadata=createNotebook('Field Project 1'),id=randomUUID();metadata.projects=[{id,title:metadata.title,parentId:null,description:'',share:false,logoId:null}];
  const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);const project=await initializeProjectLocation(path.join(f.workspace.root,metadata.title),id,metadata,access,vault);await new ProjectRegistry(f.workspace,model.id).attach(project,{expected:'new'});
  const created=await new LabBookCreation(project,f.deviceStore).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:id,title:'Observations 1'}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book password',{deviceStore:f.deviceStore});keys.push(key);
  const source=new LabBookStorage(created.book.root,created.book.labBookId,key),outline=await source.outline(),record={...sampleNotebook().entries[0],id:randomUUID(),notebookId:source.labBookId,title:'Retained observation'};await new ResearchRecords(source,new MediaStore(source)).save({workspaceId:outline.metadata.id,changes:[{id:record.id,expectedRevision:null,record}]});
  const copies=path.join(directory,'Copies'),exports=path.join(directory,'Backups');await mkdir(copies);await mkdir(exports);
  LabBookCopies.prototype.run=function(storage,options){const kind=this.kind;return original.call(this,storage,{...options,checkpoint:async stage=>{if(kind==='copy'&&stage==='verified'){entered();await gate;}if(kind==='export'&&stage==='files'&&!interrupted){interrupted=true;throw Error('Interrupted disposable export');}}});};
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  await page.goto(app.origin+'/#/owners/'+id+'/projects/'+id);await expect(page.locator('main h1')).toHaveText(metadata.title);
  await page.locator('#workspace-navigation [data-action=filter-notebook][data-id="'+source.labBookId+'"]').click();const unlock=page.locator('#project-unlock-form');await expect(unlock.getByRole('heading',{name:'Unlock lab book'})).toBeVisible();await unlock.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(page.locator('main h1')).toHaveText(created.book.directory);const view=page.url();
  const storage=page.locator('[data-lab-book-storage]');await storage.locator('summary').click();await expect(storage).toContainText(source.root);
  async function transfer(label,parent){await storage.getByRole('button',{name:label,exact:true}).click();await page.getByLabel('Destination parent folder',{exact:true}).fill(parent);await page.locator('#lab-book-storage-form').getByRole('button',{name:label,exact:true}).click();}
  await transfer('Copy lab book',copies);await ready;await expect(page.locator('[data-owned-activity]')).toContainText('Copying lab book');
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue('workspace');await page.goto(view);await expect(page.locator('main h1')).toHaveText(created.book.directory);await page.reload();await expect(page.locator('[data-owned-activity]')).toContainText('Copying lab book');await storage.locator('summary').click();await expect(storage).toContainText('Transferring lab book');release();await expect(storage).toHaveAttribute('open','');await expect(storage).toContainText('Copied to',{timeout:60000});await expect(storage.getByRole('button',{name:'Copy lab book',exact:true})).toBeEnabled();
  const copy=await new LabBookCopies(project,source.labBookId).status();expect(copy.phase).toBe('complete');expect(copy.destination).toBe(path.join(copies,created.book.directory));
  await transfer('Export lab-book backup',exports);await expect(storage.getByRole('button',{name:'Resume transfer',exact:true})).toBeVisible();await page.reload();await expect(page.locator('main h1')).toHaveText(created.book.directory);await storage.locator('summary').click();await expect(storage.getByRole('button',{name:'Resume transfer',exact:true})).toBeVisible();await storage.getByRole('button',{name:'Resume transfer',exact:true}).click();await expect(storage).toContainText('Backup exported to',{timeout:60000});expect((await new LabBookCopies(project,source.labBookId,'export').status()).phase).toBe('complete');await assert.rejects(stat(path.join(exports,metadata.title)),{code:'ENOENT'});
  await expect(page.locator('[data-owned-activity] [data-error]')).toHaveCount(0);await expect(page.locator('main')).toContainText(record.title);expect(errors).toEqual([]);await page.screenshot({path:test.info().outputPath('selected-book-transfers.png'),fullPage:true});
 }finally{release();LabBookCopies.prototype.run=original;await page.close();await app?.close();await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-selected-book-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
