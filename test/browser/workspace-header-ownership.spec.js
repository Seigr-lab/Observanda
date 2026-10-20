import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {createNotebook} from '../../src/model.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectCreation} from '../../src/project-creation.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {catalogueBinding} from '../../src/postgres-activation.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {editWorkspace} from './preferences-helper.js';

test('copying workspace details creates a dedicated project at the selected parent without growing the workspace header',async({page})=>{
 test.setTimeout(180000);
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-header-route-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),vaults=[],errors=[],requests=[];let app;
 try{
  const f=await encryptedFixture(path.join(directory,'fixture'),createNotebook('workspace','Source introduction copied exactly.'));vaults.push(f.vault);const before=await f.workspace.outline(),registry=new ProjectRegistry(f.workspace,before.metadata.id),creation=new ProjectCreation(registry,f.deviceStore);
  const parentProject={id:randomUUID(),title:'Existing parent',description:'Separate owner',parentId:null,share:false,logoId:null};
  const registered=await creation.create({id:randomUUID(),project:parentProject,username:'',password:''});
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')requests.push(new URL(request.url()).pathname);});
  await page.goto(app.url);await editWorkspace(page);await page.getByText('Workspace reference and organization',{exact:true}).click();await page.getByRole('button',{name:'Copy workspace details to a project',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByRole('button',{name:'Create a new project',exact:true}).click();
  await expect(dialog.getByLabel('Name',{exact:true})).toHaveValue(before.metadata.title);await expect(dialog.getByLabel('Description',{exact:true})).toHaveValue(before.metadata.description);
  await dialog.getByLabel('Name',{exact:true}).fill('Copied observations');await dialog.getByLabel('Description',{exact:true}).fill('Source introduction, deliberately edited before creation.');await dialog.locator('[name="parentId"]').selectOption(parentProject.id);
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:90000});await expect(page.locator('main h1')).toHaveText('Copied observations');
  const entries=(await registry.read()).value.projects;expect(entries).toHaveLength(2);const entry=entries.find(value=>value.projectId!==parentProject.id);expect(entry.parentId).toBe(parentProject.id);expect(entry.root).toBe(path.join(registered.project.root,'Copied observations'));expect((await catalogueBinding(entry.root)).placement).toBe('project');
  const key=await verifyAccess(await readAccess(entry.root),'','',{deviceStore:f.deviceStore});vaults.push(key);const storage=new ProjectStorage(entry.root,entry.projectId,key),owned=await storage.outline();
  expect(owned.metadata.projects).toHaveLength(1);expect(owned.metadata.projects[0]).toMatchObject({id:entry.projectId,title:'Copied observations',description:'Source introduction, deliberately edited before creation.',parentId:null});expect(owned.metadata.notebooks).toEqual([]);expect(owned.metadata.id).not.toBe(before.metadata.id);expect(entry.vaultId).not.toBe(f.vault.id);
  expect(await f.workspace.outline()).toEqual(before);expect(requests.filter(route=>route==='/api/projects/create')).toHaveLength(1);expect(requests.filter(route=>route.startsWith('/api/workspace/reorganize'))).toEqual([]);expect(errors).toEqual([]);
  const full=await f.workspace.read(),post=(route,data)=>page.request.post(app.origin+route,{headers:{Origin:app.origin},data}),inline={id:randomUUID(),title:'Inline bypass',description:'',share:false,logoId:null};
  for(const route of ['/api/notebook/save','/api/workspace/structure','/api/workspace/reorganize/preview','/api/workspace/reorganize']){
   const data=route==='/api/notebook/save'?{etag:full.etag,book:{...full.book,projects:[inline]}}:route==='/api/workspace/structure'?{etag:full.etag,change:{kind:'project',value:inline}}:{etag:full.etag,reviewed:true,change:{workspaceTitle:full.book.title,workspaceDescription:'',projectId:'new',copyLogos:false}};
   const response=await post(route,data);expect(response.status()).toBe(422);expect((await response.json()).code).toBe('INVALID');
  }
  const proposed={...full.book,notebooks:[{id:randomUUID(),projectId:entry.projectId,title:'Unowned book'}]};expect((await post('/api/notebook/save',{etag:full.etag,book:proposed})).status()).toBe(422);expect(await f.workspace.outline()).toEqual(before);
  const updated=await post('/api/notebook/save',{etag:full.etag,book:{...full.book,description:'Existing workspace metadata remains editable.'}});expect(updated.status()).toBe(200);expect((await f.workspace.outline()).metadata.description).toBe('Existing workspace metadata remains editable.');expect((await post('/api/notebook/save',full)).status()).toBe(409);
 }finally{await page.close();await app?.close();await runtime.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-header-route-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
