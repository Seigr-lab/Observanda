import {WebsiteSites} from '../../src/website-sites.js';
import {navigate} from './preferences-helper.js';
import {LabBookDirectory} from '../../src/lab-book-directory.js';
import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
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
import {LabBookCreation} from '../../src/lab-book-creation.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';

test('website directory unlocks a dedicated book on request and keeps its website owner through reload',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-website-directory-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],errors=[];let app;
 try{
  const root=sampleNotebook(),f=await encryptedFixture(directory,root);keys.push(f.vault);const book=sampleNotebook(),id=book.projects[0].id;book.title=book.projects[0].title='Observation Project';const access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,book.title),id,book,access,vault),registry=new ProjectRegistry(f.workspace,root.id);await registry.attach(project,{expected:'new'});
  const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(id,entry)}).create({id:randomUUID(),username:'',password:'Independent book password',book:{id:randomUUID(),projectId:id,title:'Field Observations',configuration:{profiles:[],sections:[]}}}),key=await verifyAccess(await readAccess(created.book.root),'','Independent book password',{deviceStore:f.deviceStore});keys.push(key);
  const storage=new LabBookStorage(created.book.root,created.book.labBookId,key),saved=await storage.outline(),site=await new WebsiteSites(storage).change({workspaceId:saved.metadata.id,etag:saved.etag,operation:'create',name:'Field journal',projectId:id});
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await navigate(page,'Website editor');await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();
  const listing=page.locator('[data-website-directory]');await expect(listing.getByRole('button',{name:'Retry websites',exact:true})).toBeVisible();await expect(page.locator('#project-unlock-form')).not.toBeVisible();await listing.getByRole('button',{name:'Retry websites',exact:true}).click();const unlock=page.locator('#project-unlock-form');await expect(unlock).toBeVisible();await unlock.getByRole('button',{name:'Cancel',exact:true}).click();await expect(listing.getByRole('button',{name:'Retry websites',exact:true})).toBeVisible();
  await listing.getByRole('button',{name:'Retry websites',exact:true}).click();await unlock.getByLabel('Lab book password',{exact:true}).fill('Independent book password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(listing.getByRole('heading',{name:'Field journal',exact:true})).toBeVisible();await listing.getByLabel('Search websites',{exact:true}).fill('Field journal');await expect(listing.locator('section')).toHaveCount(1);
  await listing.getByRole('button',{name:'Website editor',exact:true}).click();await expect(page).toHaveURL(new RegExp('/owners/'+id+'/books/'+storage.labBookId+'/websites/'+site.id+'/'));await expect(page.locator('.website-site-context')).toContainText('Field journal');await page.reload();await expect(page.locator('.website-site-context')).toContainText('Field journal');
  await page.locator('.website-site-context').getByRole('button',{name:'Rename website',exact:true}).click();await page.getByLabel('Website name',{exact:true}).fill('Field journal renamed');await page.getByRole('button',{name:'Save name',exact:true}).click();await expect(page.locator('.website-site-context')).toContainText('Field journal renamed');
  expect((await storage.outline()).metadata.websites[0].name).toBe('Field journal renamed');expect((await project.outline()).metadata.websites??[]).toEqual([]);expect((await f.workspace.outline()).metadata.websites??[]).toEqual([]);
  await expect(page.locator('#dialog')).not.toBeVisible();await navigate(page,'Website editor');await expect(page).not.toHaveURL(/owners/);await expect(page.locator('.website-site-context')).toContainText('Workspace website');await page.locator('.website-site-context').getByRole('button',{name:'Websites',exact:true}).click();await expect(listing.getByRole('heading',{name:'Field journal renamed',exact:true})).toBeVisible();await expect(listing.getByLabel('Search websites',{exact:true})).toHaveValue('');await page.screenshot({path:test.info().outputPath('website-directory.png'),fullPage:false});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('website-directory-narrow.png'),fullPage:false});expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-website-directory-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
