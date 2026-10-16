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
import {LabBookDirectory} from '../../src/lab-book-directory.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {ResearchRecords} from '../../src/research.js';
import {MediaStore} from '../../src/media.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from '../../src/access.js';
import {clearVault} from '../../src/encryption.js';
import {ProjectModuleCommands} from '../../src/project-module-commands.js';
import {ProjectModuleDrafts} from '../../src/project-module-drafts.js';
import {ProjectModuleReader} from '../../src/project-module-reader.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

const calculation=name=>({name,links:[],engine:1,mode:'expression',angle:'rad',expression:'sqrt(16)',digits:'',fromBase:10,toBase:6});
async function fixture(page,{password=''}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-references-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],errors=[],requests=[];
 let app;
 try{
  const root=sampleNotebook(),f=await encryptedFixture(directory,root);keys.push(f.vault);
  const settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules=['scientific-calculator'];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
  const model=sampleNotebook();model.title=model.projects[0].title='Reference project';model.entries[0].title='Project observation';
  const projectId=model.projects[0].id,access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,model.title),projectId,model,access,vault),registry=new ProjectRegistry(f.workspace,root.id);await registry.attach(project,{expected:'new'});await new ProjectModuleCommands(project,model.id).initialize();
  const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(projectId,entry)}).create({id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId,title:'Reference book'}});
  const key=await verifyAccess(await readAccess(created.book.root),'',password,{deviceStore:f.deviceStore});keys.push(key);const book=new LabBookStorage(created.book.root,created.book.labBookId,key);
  const record={...structuredClone(model.entries[0]),notebookId:created.book.labBookId,title:'Book observation',body:'The selected book owns this observation.',relations:[]};await new ResearchRecords(book,new MediaStore(book)).save({workspaceId:created.book.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
  const targetCalculation=randomUUID(),commands=new ProjectModuleCommands(book,created.book.namespaceId);await commands.initialize();await commands.execute({workspaceId:created.book.namespaceId,commandId:randomUUID(),action:'calculation.save',payload:{id:targetCalculation,expectedRevision:null,data:calculation('Book calculation')}});
  const options={root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')};app=await testServer(options);
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url());if(url.pathname.includes('/modules/references/')||url.pathname.endsWith('/modules/command'))requests.push({path:url.pathname,data:request.postDataJSON()});});
  return {...f,rootNamespace:root.id,directory,project,projectId,model,book,bookEntry:created.book,record,targetCalculation,errors,requests,get app(){return app;},async restart(){await page.goto('about:blank');await app.close();app=await testServer(options);},async close(){await page.close();await app.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-module-references-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
 }catch(error){await app?.close();await runtime.close();detach();keys.forEach(clearVault);await rm(directory,{recursive:true,force:true});throw error;}
}
async function chooseBook(page){
 const picker=page.locator('[data-module-reference-picker]');await picker.getByRole('button',{name:'Choose another location',exact:true}).click();
 const project=picker.locator('li').filter({hasText:'Reference project'});await project.getByRole('button',{name:'Lab books',exact:true}).click();await picker.getByRole('button',{name:'Choose Reference book',exact:true}).click();return picker;
}

test('generic links retain owner-qualified labels, draft return, saved history and incoming connected work',async({page})=>{
 test.setTimeout(210000);page.setDefaultTimeout(15000);const f=await fixture(page),main=page.locator('main');let releaseReturn;
 try{
  await page.goto(f.app.url);const sourceRoute='/#/owners/'+f.projectId+'/modules/scientific-calculator/calculation';await page.goto(f.app.origin+sourceRoute);
  await main.getByRole('button',{name:'New calculation',exact:true}).click();await main.getByLabel('Name',{exact:true}).fill('Project calculation');await main.getByLabel('Expression 1',{exact:true}).fill('sqrt(25)');
  await main.getByRole('button',{name:'Link research',exact:true}).click();let picker=page.locator('[data-module-reference-picker]');await picker.getByRole('button',{name:'Project observation',exact:true}).click();
  await main.getByRole('button',{name:'Link research',exact:true}).click();picker=await chooseBook(page);await expect(picker.getByRole('button',{name:'Book observation',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('reference-picker-desktop.png')});await picker.getByRole('button',{name:'Book observation',exact:true}).click();
  await expect(main.locator('.module-link-list')).toContainText('Project observation');await expect(main.locator('.module-link-list')).toContainText('Book observation');
  await main.getByRole('button',{name:'Choose module item',exact:true}).click();picker=await chooseBook(page);await picker.getByRole('button',{name:'Book calculation',exact:true}).click();
  await main.getByRole('button',{name:'Save calculation',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  const reader=new ProjectModuleReader(f.project,f.model.id),saved=(await reader.list({workspaceId:f.model.id,type:'calculation'})).items[0],sourceURL=page.url();
  const links=[{workspaceId:f.model.id,type:'record',id:f.model.entries[0].id},{workspaceId:f.bookEntry.namespaceId,type:'record',id:f.record.id},{workspaceId:f.bookEntry.namespaceId,type:'calculation',id:f.targetCalculation}];
  expect((await reader.selected({workspaceId:f.model.id,id:saved.id})).entity.data.links).toEqual(links);
  await main.getByLabel('Name',{exact:true}).fill('Unfinished project calculation');await main.getByLabel('Expression 1',{exact:true}).fill('sqrt(36)');
  await main.locator('.module-link-list').getByRole('button',{name:'Book observation',exact:true}).click();await expect(main.locator('h1')).toHaveText('Book observation',{timeout:15000});await expect(main).toContainText('The selected book owns this observation.');
  await expect(main.locator('[data-module-links]')).toContainText('Project calculation');await page.screenshot({path:test.info().outputPath('connected-work-desktop.png'),fullPage:true});
  await main.locator('[data-action="back-to-records"]').click();await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Unfinished project calculation',{timeout:15000});await expect(main.getByLabel('Expression 1',{exact:true})).toHaveValue('sqrt(36)');expect(page.url()).toBe(sourceURL);
  await main.getByRole('button',{name:'Save calculation',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  await main.locator('.module-link-list').getByRole('button',{name:'Book observation',exact:true}).click();await expect(main.locator('h1')).toHaveText('Book observation',{timeout:15000});
  await main.locator('[data-module-links]').getByRole('button',{name:'Unfinished project calculation',exact:true}).click();await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Unfinished project calculation',{timeout:15000});expect(page.url()).toBe(sourceURL);
  await main.getByLabel('Name',{exact:true}).fill('Pending return draft');await main.locator('.module-link-list').getByRole('button',{name:'Book observation',exact:true}).click();await expect(main.locator('h1')).toHaveText('Book observation',{timeout:15000});
  let arrived;const started=new Promise(resolve=>arrived=resolve),held=new Promise(resolve=>releaseReturn=resolve),heldRoute='**/api/projects/'+f.projectId+'/workspace/read/start';
  await page.route(heldRoute,async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});},{times:1});
  await main.locator('[data-action="back-to-records"]').click();await started;await page.locator('[data-action="preferences"]').click();await expect(main.getByRole('heading',{name:'Preferences',exact:true})).toBeVisible({timeout:15000});const preferenceURL=page.url();releaseReturn();await page.unrouteAll({behavior:'wait'});
  await expect(main.getByRole('heading',{name:'Preferences',exact:true})).toBeVisible();expect(page.url()).toBe(preferenceURL);expect(new URL(preferenceURL).hash).toBe('#/preferences/general');
  expect((await reader.selected({workspaceId:f.model.id,id:saved.id})).entity.data.name).toBe('Unfinished project calculation');
  const checkpoints=new ProjectModuleDrafts(f.project,f.model.id),pending=(await checkpoints.list({workspaceId:f.model.id,moduleId:'scientific-calculator',limit:10})).drafts.find(value=>value.titles.includes('Pending return draft'));expect(pending).toBeTruthy();
  expect((await checkpoints.read({workspaceId:f.model.id,moduleId:'scientific-calculator',id:pending.id})).draft.drafts.find(value=>value.id===saved.id).data.name).toBe('Pending return draft');
  await page.goto(sourceURL);await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Unfinished project calculation',{timeout:15000});
  await main.locator('.module-link-list').getByRole('button',{name:'Book calculation',exact:true}).click();await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Book calculation',{timeout:15000});expect(new URL(page.url()).hash).toContain('/books/'+f.bookEntry.labBookId+'/');
  await f.restart();await page.goto(f.app.url);await page.goto(f.app.origin+new URL(sourceURL).hash);await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Unfinished project calculation');await expect(main.locator('.module-link-list')).toContainText('Book observation');
  await main.getByRole('button',{name:'History',exact:true}).click();await main.locator('[data-command="history-open"][data-revision="1"]').click();await expect(main.locator('.module-history')).toContainText('Project calculation');await expect(main.locator('.module-history')).toContainText(f.bookEntry.namespaceId);
  expect((await new ProjectModuleReader(f.workspace,f.rootNamespace).list({workspaceId:f.rootNamespace,type:'calculation'})).total).toBe(0);
  expect(f.requests.filter(request=>request.path.endsWith('/modules/command')).every(request=>request.data.workspaceId===f.model.id)).toBe(true);expect(f.errors).toEqual([]);
  await page.screenshot({path:test.info().outputPath('owned-reference-history.png'),fullPage:true});
 }catch(error){await test.info().attach('failed-view',{body:await page.locator('main').innerText(),contentType:'text/plain'});await page.screenshot({path:test.info().outputPath('failure.png'),fullPage:true});throw error;}finally{releaseReturn?.();await page.unrouteAll({behavior:'wait'});await f.close();}
});

test('cancelled target authorization retains the source draft and selection unlocks only the chosen book',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);const f=await fixture(page,{password:'Book test password'}),main=page.locator('main');
 try{
  await page.goto(f.app.url);await page.goto(f.app.origin+'/#/owners/'+f.projectId+'/modules/scientific-calculator/calculation');await main.getByRole('button',{name:'New calculation',exact:true}).click();await main.getByLabel('Name',{exact:true}).fill('Draft remains here');await main.getByLabel('Expression 1',{exact:true}).fill('sqrt(49)');
  await main.getByRole('button',{name:'Link research',exact:true}).click();const picker=await chooseBook(page);const unlock=page.locator('#project-unlock-form');await expect(unlock).toBeVisible();await unlock.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(picker).toBeVisible();await expect(picker.getByRole('button',{name:'Book observation',exact:true})).toHaveCount(0);await picker.getByRole('button',{name:'Cancel',exact:true}).click();await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Draft remains here');await expect(main.locator('.module-link')).toHaveCount(0);
  await main.getByRole('button',{name:'Link research',exact:true}).click();await chooseBook(page);await unlock.getByLabel('Lab book password',{exact:true}).fill('Book test password');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await picker.getByRole('button',{name:'Book observation',exact:true}).click();
  await expect(main.locator('.module-link-list')).toContainText('Book observation');await main.getByRole('button',{name:'Save calculation',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  await page.setViewportSize({width:390,height:844});await main.getByRole('button',{name:'Link research',exact:true}).click();await chooseBook(page);await expect(picker.getByRole('button',{name:'Book observation',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('reference-picker-phone.png')});await picker.getByRole('button',{name:'Cancel',exact:true}).click();
  const sourceURL=page.url();await f.restart();await page.goto(f.app.url);await page.goto(f.app.origin+new URL(sourceURL).hash);
  await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Draft remains here');await expect(main.locator('.module-link-list')).toContainText('Unlock linked item');await expect(page.locator('#project-unlock-form')).toHaveCount(0);
  await main.getByLabel('Name',{exact:true}).fill('Retained without target access');await main.getByRole('button',{name:'Save calculation',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  const reader=new ProjectModuleReader(f.project,f.model.id),saved=(await reader.list({workspaceId:f.model.id,type:'calculation'})).items[0];expect((await reader.selected({workspaceId:f.model.id,id:saved.id})).entity.data.links).toEqual([{workspaceId:f.bookEntry.namespaceId,type:'record',id:f.record.id}]);expect(f.errors).toEqual([]);
 }catch(error){await test.info().attach('failed-view',{body:await page.locator('main').innerText(),contentType:'text/plain'});await page.screenshot({path:test.info().outputPath('failure.png'),fullPage:true});throw error;}finally{await f.close();}
});
