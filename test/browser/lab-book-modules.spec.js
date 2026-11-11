import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {LabBookRegistry} from '../../src/lab-book-registry.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {laboratoryProfiles} from '../../src/web/laboratory/catalog.js';
import {navigate,preferences} from './preferences-helper.js';

test('workspace projects and lab books remain usable with every optional type disabled',async({page})=>{
 test.setTimeout(600000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-hierarchy-ui-')),book=sampleNotebook();
 book.title='Creative collective';book.projects=[];book.notebooks=[];book.entries=[];book.website.navigation=[];book.branding=[];book.website.layouts=[];
 // Projects and lab books are created in an encrypted workspace, each with its own store.
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const registry=new ProjectRegistry(f.workspace,book.id),open=async root=>verifyAccess(await readAccess(root),'','',{deviceStore:f.deviceStore});
 const projects=async()=>(await registry.read()).value.projects;
 // Every lab book of every project, read from its own store.
 const readBooks=async()=>{
  const books=[];
  for(const entry of await projects()){
   const vault=await open(entry.root);
   try{const labBooks=new LabBookRegistry(new ProjectStorage(entry.root,entry.projectId,vault));for(const item of (await labBooks.read()).value.books){const location=labBooks.location(item),key=await open(location.root);try{books.push((await new LabBookStorage(location.root,location.labBookId,key).read()).book);}finally{clearVault(key);}}}
   finally{clearVault(vault);}
  }
  return {notebooks:books.flatMap(b=>b.notebooks),entries:books.flatMap(b=>b.entries)};
 };
 const main=page.locator('main'),dialog=page.locator('#dialog'),nav=page.locator('#main-navigation'),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const modules=async()=>{await navigate(page,'Preferences');await preferences(page,'Templates');};
 const project=async()=>{await nav.getByRole('button',{name:'Open project Music studio',exact:true}).click();await expect(main.getByRole('heading',{name:'Music studio',level:1,exact:true})).toBeVisible({timeout:30000});};
 const openBook=async title=>{await project();await main.locator('.project-notebook').filter({has:page.getByRole('button',{name:title,exact:true})}).getByRole('button',{name:'Open lab book',exact:true}).click();await expect(main.getByRole('heading',{name:title,level:1,exact:true})).toBeVisible({timeout:30000});};
 const createBook=async(title,type)=>{
  await main.getByRole('button',{name:'New lab book',exact:true}).click();await dialog.getByLabel('Lab book name',{exact:true}).fill(title);
  await expect(dialog.getByLabel('Project',{exact:true})).toHaveValue((await projects())[0].projectId);
  if(type)await dialog.getByLabel('Lab-book template',{exact:true}).selectOption({label:type});
  // A lab book gets its own encrypted store, which takes longer than an ordinary save.
  await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});
 };
 // A free-form note opens the writing editor; a record of a lab-book record type is entered one value at a time.
 // Either is then saved into the lab book.
 const record=async(type,title)=>{
  await main.getByRole('button',{name:'New record',exact:true}).click();await dialog.getByRole('button',{name:type,exact:true}).click();
  if(type==='Create free-form note')await page.getByLabel('Record title',{exact:true}).fill(title,{timeout:30000});
  else{const initial=page.locator('[data-configuration-record-host]');await expect(initial.locator('[data-record-value]')).toBeVisible({timeout:30000});await initial.locator('[data-record-value]').fill(title);}
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('.record-editing h1')).toHaveText(title,{timeout:60000});
 };
 try{
  await page.goto(app.url);await modules();
  for(const name of ['Enable Lab books','Enable Laboratory','Enable Projects'])await expect(main.getByRole('switch',{name,exact:true})).toHaveCount(0);
  const types=main.getByRole('group',{name:'Lab-book templates',exact:true});await expect(types.getByRole('switch')).toHaveCount(laboratoryProfiles.length);
  const labels=await types.getByRole('switch').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));expect(labels).toEqual([...labels].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'})));
  for(const toggle of await main.getByRole('switch').all())await toggle.uncheck();
  for(const toggle of await main.getByRole('switch').all())await expect(toggle).not.toBeChecked();
  await navigate(page,'Projects');await main.getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('Music studio');
  // A project gets its own encrypted store, which takes longer than an ordinary save.
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});
  await project();await createBook('Studio journal');await openBook('Studio journal');await record('Create free-form note','An idea for a song');
  await page.reload();await expect(page.locator('.record-editing h1')).toHaveText('An idea for a song',{timeout:30000});
  await modules();await types.getByRole('switch',{name:'Enable Arts & creative practice',exact:true}).check();
  await project();await createBook('Rehearsal sessions','Arts & creative practice');await openBook('Rehearsal sessions');await record('Create rehearsals & recordings','First rehearsal');
  const saved=await readBooks(),rehearsal=saved.entries.find(e=>e.title==='First rehearsal'),projectId=(await projects())[0].projectId;
  expect(rehearsal.notebookId).toBe(saved.notebooks.find(n=>n.title==='Rehearsal sessions').id);expect(rehearsal.template.profileId).toBe('arts-creative');expect(saved.notebooks.every(n=>n.projectId===projectId)).toBe(true);
  await modules();await types.getByRole('switch',{name:'Enable Arts & creative practice',exact:true}).uncheck();
  // A record opened from its lab book's list opens for reading, even with its lab-book type turned off.
  await openBook('Rehearsal sessions');await main.getByRole('button',{name:'First rehearsal',exact:true}).click({timeout:30000});await expect(page.locator('.record-reader h1')).toHaveText('First rehearsal',{timeout:30000});
  await openBook('Studio journal');await record('Create free-form note','A second idea');
  await project();await main.getByRole('button',{name:'New lab book',exact:true}).click();await expect(dialog.getByRole('option',{name:'Arts & creative practice',exact:true})).toHaveCount(0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await modules();const persisted=page.waitForResponse(response=>response.url().endsWith('/api/dashboard/pending')&&response.request().method()==='POST'&&response.ok());await types.getByRole('switch',{name:'Enable Arts & creative practice',exact:true}).focus();await page.keyboard.press('Space');await expect(types.getByRole('switch',{name:'Enable Arts & creative practice',exact:true})).toBeChecked();
  expect((await (await persisted).json()).accepted.settings.enabledModules).toContain('laboratory-arts-creative');await page.reload();await expect(main.getByRole('switch',{name:'Enable Arts & creative practice',exact:true})).toBeChecked({timeout:30000});
  await main.getByText('Lab-book templates',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('lab-book-types-desktop.png')});
  await page.setViewportSize({width:390,height:844});await main.getByText('Lab-book templates',{exact:true}).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('lab-book-types-narrow.png')});
  // Each lab book keeps its records in its own store, so they are compared without an order across lab books.
  expect((await readBooks()).entries.map(e=>e.title).sort()).toEqual(['A second idea','An idea for a song','First rehearsal']);expect(errors).toEqual([]);
 }finally{await app.close();await owner.close();detach();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
