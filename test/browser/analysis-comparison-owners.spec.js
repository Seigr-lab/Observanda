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
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';

import {ResearchMaterials} from '../../src/research-materials.js';
async function fixture(page,{password='source-password'}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-comparison-owners-ui-')),runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),keys=[],errors=[],requests=[];
 let app;
 try{
  const root=sampleNotebook(),f=await encryptedFixture(directory,root);keys.push(f.vault);
  const settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules=[];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
  const model=sampleNotebook();model.title=model.projects[0].title='Reference project';model.entries[0].title='Project observation';
  const projectId=model.projects[0].id,access=await createWorkspaceAccess('','',f.deviceStore),vault=takeCreatedVault(access);keys.push(vault);
  const project=await initializeProjectLocation(path.join(f.workspace.root,model.title),projectId,model,access,vault),registry=new ProjectRegistry(f.workspace,root.id);await registry.attach(project,{expected:'new'});await new ProjectModuleCommands(project,model.id).initialize();
  const created=await new LabBookCreation(project,f.deviceStore,{publish:entry=>new LabBookDirectory(registry).register(projectId,entry)}).create({id:randomUUID(),username:'',password,book:{id:randomUUID(),projectId,title:'Reference book'}});
  const key=await verifyAccess(await readAccess(created.book.root),'',password,{deviceStore:f.deviceStore});keys.push(key);const book=new LabBookStorage(created.book.root,created.book.labBookId,key);
  const record={...structuredClone(model.entries[0]),notebookId:created.book.labBookId,title:'Book observation',body:'The selected book owns this observation.',relations:[]};await new ResearchRecords(book,new MediaStore(book)).save({workspaceId:created.book.namespaceId,changes:[{id:record.id,expectedRevision:null,record}]});
  const projectMaterials=new ResearchMaterials(project),bookMaterials=new ResearchMaterials(book);
  const column=(name,representation='text')=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'unknown',reference:'',resolution:'',uncertainty:''}});
  const retain=async(materials,recordId,title,value)=>{const bytes=Buffer.from('Value,State\n'+value+',correct'),upload=await materials.startImport({recordId,name:'observations.csv',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);return materials.dataset({recordId,title,artifact,columns:[column('Value','integer'),column('State')]});};
  const localDataset=await retain(projectMaterials,model.entries[0].id,'Project readings','10'),foreignDataset=await retain(bookMaterials,record.id,'Book readings','12'),bookBefore=await book.read();
  const options={root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')};app=await testServer(options);
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url());if(url.pathname.includes('/research/materials/'))requests.push({path:url.pathname,data:request.postDataJSON()});});
  return {...f,rootNamespace:root.id,directory,project,projectId,model,book,bookEntry:created.book,record,projectMaterials,bookMaterials,localDataset,foreignDataset,bookBefore,errors,requests,get app(){return app;},async restart(){await page.goto('about:blank');await app.close();app=await testServer(options);},async close(){await page.close();await app.close();await runtime.close();detach();keys.forEach(clearVault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-comparison-owners-ui-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}};
 }catch(error){await app?.close();await runtime.close();detach();keys.forEach(clearVault);await rm(directory,{recursive:true,force:true});throw error;}
}

async function chooseBook(page){const picker=page.locator('[data-retained-source-picker]');await picker.getByRole('button',{name:'Change location',exact:true}).click();await picker.locator('li').filter({hasText:'Reference project'}).getByRole('button',{name:'Lab books',exact:true}).click();await picker.getByRole('button',{name:'Choose Reference book',exact:true}).click();return picker;}

test('comparisons retain addressed sources across access cancellation, inspection and restart without source writes',async({page})=>{
 test.setTimeout(210000);page.setDefaultTimeout(15000);const f=await fixture(page),dialog=page.locator('#dialog');
 try{
  const recordURL='/#/owners/'+f.projectId+'/records/'+f.model.entries[0].id;await page.goto(f.app.url);await page.goto(f.app.origin+recordURL);await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.getByText('Analysis, collections & verification',{exact:true}).click();await dialog.getByRole('button',{name:'Compare retained datasets',exact:true}).click();
  await dialog.getByLabel('Analysis title',{exact:true}).fill('Cross-owner comparison');await dialog.getByLabel('Analysis tool / method',{exact:true}).fill('Retained observation comparison');await dialog.getByLabel('Tool version / source revision',{exact:true}).fill('1');await dialog.getByLabel('Unrecorded identities and why they are unavailable').fill('Synthetic fixture method.');await dialog.getByLabel('Uncertainty convention / unknown uncertainty').fill('Unknown instrument uncertainty.');await dialog.getByLabel('Sources, scope and limitations').fill('Two synthetic observations, no independence claim.');
  let source=dialog.locator('[data-analysis-source="0"]');await source.locator('[data-analysis-ref="dataset"]').getByRole('button',{name:'Choose retained revision'}).click();let picker=page.locator('[data-retained-source-picker]');await picker.getByRole('button',{name:'Project readings',exact:true}).click();await source.locator('[data-column="value"]').selectOption('0');await source.locator('[data-column="status"]').selectOption('1');
  await dialog.getByRole('button',{name:'Add dataset',exact:true}).click();source=dialog.locator('[data-analysis-source="1"]');await source.locator('[data-analysis-ref="dataset"]').getByRole('button',{name:'Choose retained revision'}).click();picker=await chooseBook(page);
  const unlock=page.locator('[data-project-access]');await expect(unlock).toBeVisible();await unlock.locator('[data-project-unlock-cancel]').click();await expect(unlock).toHaveCount(0);await expect(dialog.getByLabel('Analysis title',{exact:true})).toHaveValue('Cross-owner comparison');await expect(dialog.locator('[data-analysis-source="0"] [data-column="value"]')).toHaveValue('0');await expect(picker.getByRole('button',{name:'Unlock location',exact:true})).toBeVisible();
  await picker.getByRole('button',{name:'Unlock location',exact:true}).click();await unlock.locator('[name=password]').fill('source-password');await unlock.locator('[type=submit]').click();await expect(picker.getByRole('button',{name:'Book readings',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('comparison-source-desktop.png')});await page.setViewportSize({width:390,height:844});expect(await picker.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('comparison-source-phone.png')});await picker.getByRole('button',{name:'Book readings',exact:true}).click();await page.setViewportSize({width:1280,height:900});
  await source.locator('[data-column="value"]').selectOption('0');await source.locator('[data-column="status"]').selectOption('1');
  const groups=source.locator('details').filter({has:page.locator('[data-analysis-ref="run"]')});await groups.locator('summary').click();await source.locator('[data-analysis-ref="run"]').getByRole('button',{name:'Choose retained revision'}).click();picker=await chooseBook(page);await picker.getByRole('button',{name:'Book observation',exact:true}).click();
  const expected=dialog.locator('details[data-expected]');await expected.locator('summary').click();await expected.locator('[data-analysis-ref="dataset"]').getByRole('button',{name:'Choose retained revision'}).click();picker=await chooseBook(page);await picker.getByRole('button',{name:'Book readings',exact:true}).click();await expect(picker).toHaveCount(0);await expect(expected.locator('[data-ref-label]')).toHaveText('Book readings');await expected.locator('[data-analysis="expectedSource"]').fill('2');await expected.locator('[data-expected="value"]').fill('1');await expected.locator('[data-expected="key"]').fill('1');await expected.locator('[data-expected="actualKey"]').fill('1');await expected.locator('[data-analysis="rationale"]').fill('Compare the retained reference reading with itself to verify the declared exact fixture.');
  await dialog.getByRole('button',{name:'Retain comparison',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Cross-owner comparison',exact:true})).toBeVisible({timeout:30000});await expect(dialog.getByRole('button',{name:'Inspect source',exact:true})).toHaveCount(2);
  await dialog.getByRole('button',{name:'Inspect source',exact:true}).nth(1).click();await expect(dialog).toContainText('12 / 1');await dialog.getByRole('button',{name:'Back to source',exact:true}).click();await expect(dialog.getByRole('button',{name:'Revise comparison',exact:true})).toBeVisible();
  const saved=(await f.projectMaterials.list({recordId:f.model.entries[0].id,kind:'analysis'})).items[0],document=await f.projectMaterials.read(saved);expect(document.content.comparison.version).toBe(2);expect(document.content.comparison.expected.dataset.workspaceId).toBe(f.bookEntry.namespaceId);expect(document.content.comparison.expected.dataset.revision).toBe(f.foreignDataset.revision);expect(document.content.summary.verification.correct).toBe(1);expect(document.content.comparison.sources.map(source=>source.dataset.workspaceId)).toEqual([f.model.id,f.bookEntry.namespaceId]);expect(document.content.comparison.sources[1].run.workspaceId).toBe(f.bookEntry.namespaceId);expect(document.content.comparison.sources[1].run.revision).toMatch(/^[a-f0-9]{64}$/);expect((await f.bookMaterials.list({recordId:f.record.id,kind:'analysis'})).items).toHaveLength(0);expect((await f.book.read()).etag).toBe(f.bookBefore.etag);expect((await f.bookMaterials.current(f.foreignDataset.id)).revision).toBe(f.foreignDataset.revision);expect(f.requests.filter(request=>request.path.endsWith('/pin'))).toEqual([]);
  await f.restart();await page.goto(f.app.url);await page.goto(f.app.origin+recordURL);await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.locator('.material-list li').filter({hasText:'Cross-owner comparison'}).getByRole('button',{name:'Inspect',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Cross-owner comparison',exact:true})).toBeVisible({timeout:30000});await expect(dialog.getByRole('button',{name:'Check source status',exact:true})).toBeVisible();await expect(unlock).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Inspect source',exact:true})).toHaveCount(2);
  await dialog.getByRole('button',{name:'Check source status',exact:true}).click();await expect(unlock).toBeVisible();await unlock.locator('[data-project-unlock-cancel]').click();await expect(dialog.getByRole('heading',{name:'Cross-owner comparison',exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Check source status',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Check source status',exact:true}).click();await unlock.locator('[name=password]').fill('source-password');await unlock.locator('[type=submit]').click();await expect(dialog.getByRole('button',{name:'Check source status',exact:true})).toHaveCount(0);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
