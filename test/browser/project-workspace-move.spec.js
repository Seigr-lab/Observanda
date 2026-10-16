import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {createNotebook} from '../../src/model.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {initializeProjectLocation} from '../../src/project-storage.js';
import {initializeLocation} from '../../src/locations.js';
import {Workspace} from '../../src/storage.js';
import {WorkspaceDirectory} from '../../src/workspace-directory.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectWorkspaceMoves} from '../../src/project-workspace-move.js';
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

for(const {copied,interrupted} of [{copied:false},{copied:true},{copied:true,interrupted:true}])test('move a project into an independently protected workspace with navigation and reload'+(copied?' across filesystems':'')+(interrupted?' and resume after interruption':''),async({page})=>{
 test.setTimeout(300000);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'observanda-workspace-move-ui-')),provider=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(provider),keys=[],errors=[];let server,release,entered,interrupt=interrupted;
 const originalRename=fs.rename,originalFinish=ProjectWorkspaceMoves.prototype.finish,gate=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve);
 try{
  const metadata=sampleNotebook();metadata.title='workspace';const f=await encryptedFixture(path.join(directory,'source'),metadata);keys.push(f.vault);
  const book=sampleNotebook();book.title=book.projects[0].title='Field Project 1';const id=book.projects[0].id,access=await createWorkspaceAccess('','',f.deviceStore),key=takeCreatedVault(access);keys.push(key);
  const source=await initializeProjectLocation(path.join(f.workspace.root,book.title),id,book,access,key),registry=new ProjectRegistry(f.workspace,metadata.id);await registry.attach(source,{expected:'new'});
  const created=await new LabBookCreation(source,f.deviceStore).create({id:randomUUID(),username:'',password:'Book access 456!',book:{id:randomUUID(),projectId:id,title:'Observations 1'}}),bookKey=await verifyAccess(await readAccess(created.book.root),'','Book access 456!',{deviceStore:f.deviceStore});keys.push(bookKey);const before=await new LabBookStorage(created.book.root,created.book.labBookId,bookKey).read();
  const targetMetadata=createNotebook('Receiving Workspace 2'),targetRoot=path.join(directory,targetMetadata.title),targetAccess=await createWorkspaceAccess('','Workspace access 789!',f.deviceStore),targetKey=takeCreatedVault(targetAccess);keys.push(targetKey);await initializeLocation(targetRoot,targetMetadata,targetAccess,targetKey);
  const targetRegistry=new ProjectRegistry(new Workspace(targetRoot,targetKey),targetMetadata.id),preferences=path.join(directory,'preferences.json'),destination=path.join(targetRoot,book.title);await new WorkspaceDirectory(preferences+'.workspace-directory.json').using(targetRoot,{},async()=>{});
  if(copied){fs.rename=async(from,to)=>{if(from===source.root&&to===destination)throw Object.assign(Error('Different filesystem'),{code:'EXDEV'});return originalRename(from,to);};syncBuiltinESMExports();}
  ProjectWorkspaceMoves.prototype.finish=function(value,vault,options){return originalFinish.call(this,value,vault,{...options,checkpoint:async stage=>{if(stage==='stopped'){entered();await gate;}if(stage==='departed'&&interrupt){interrupt=false;throw Error('Interrupted workspace handoff');}}});};
  server=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:preferences});page.on('pageerror',error=>errors.push(error.message));await page.goto(server.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  await page.goto(server.origin+'/#/owners/'+id+'/projects/'+id);const storage=page.locator('[data-project-storage="'+id+'"]');await expect(storage).toContainText(source.root);await storage.getByRole('button',{name:'Move project',exact:true}).click();
  const form=page.locator('#project-placement-form');await expect(form.getByLabel('Destination workspace',{exact:true}).locator('option')).toHaveCount(2);await form.getByLabel('Destination workspace',{exact:true}).selectOption(targetRoot);await form.getByLabel('Destination workspace password',{exact:true}).fill('Workspace access 789!');await form.getByRole('button',{name:'Unlock workspace',exact:true}).click();await expect(form.getByLabel('Move into',{exact:true})).toHaveValue('');await expect(form.getByRole('button',{name:'Move project',exact:true})).toBeEnabled();await form.getByRole('button',{name:'Move project',exact:true}).click();
  const unlock=page.locator('#project-unlock-form');await expect(unlock.getByRole('heading',{name:'Unlock lab book'})).toBeVisible();await unlock.getByLabel('Lab book password',{exact:true}).fill('Book access 456!');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await ready;
  await page.getByRole('button',{name:'Preferences',exact:true}).click();await expect(page.getByLabel('Workspace name',{exact:true})).toHaveValue(metadata.title);await page.goto(server.origin+'/#/projects');const pending=page.locator('[data-project-workspace-moves]');await expect(pending).toContainText('Moving project');await page.reload();await expect(pending).toContainText('Moving project');await expect(pending.locator('[data-owned-progress]')).toBeVisible();release();
  if(interrupted){
   await expect(pending.getByRole('button',{name:'Resume transfer',exact:true})).toBeVisible({timeout:120000});await page.reload();
   await pending.getByRole('button',{name:'Resume transfer',exact:true}).click();await pending.getByLabel('Destination workspace password',{exact:true}).fill('Workspace access 789!');await pending.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  }
  await expect(pending.getByRole('button',{name:'Open destination workspace',exact:true})).toBeVisible({timeout:120000});expect((await new ProjectWorkspaceMoves(registry,targetRegistry,id).read()).released).toBe(true);await assert.rejects(fs.stat(source.root),{code:'ENOENT'});expect((await targetRegistry.locate(id)).root).toBe(destination);expect(await new LabBookStorage(path.join(destination,path.basename(created.book.root)),created.book.labBookId,bookKey).read()).toEqual(before);
  await expect(page.getByRole('button',{name:'Activity',exact:true})).toBeVisible();await expect(page.locator('[data-owned-progress]')).toHaveCount(0);await page.screenshot({path:test.info().outputPath('moved-to-workspace.png'),fullPage:true});expect(errors).toEqual([]);
 }finally{release();fs.rename=originalRename;syncBuiltinESMExports();ProjectWorkspaceMoves.prototype.finish=originalFinish;await page.close();await server?.close();await provider.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-workspace-move-ui-'));await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
