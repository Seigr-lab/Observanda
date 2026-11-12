
import {test,expect} from '@playwright/test';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {LabBookRegistry} from '../../src/lab-book-registry.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {navigate,preferences} from './preferences-helper.js';
import {revealInEditor} from './record-editor-helper.js';
import {researchReference} from '../../src/web/research-reference.js';

test('people define their structure and every lab uses the same notebook and record tools',async({page})=>{
 test.setTimeout(900000);page.setDefaultTimeout(12000);
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-unified-structure-'));
 const book=sampleNotebook();
 book.title='Structure';book.description='';book.projects=[];book.notebooks=[];book.entries=[];book.website.navigation=[];book.branding=[];book.website.layouts=[];
 // Projects and lab books are created in an encrypted workspace, each with its own store.
 const owner=new WorkspaceDatabases({directory:path.join(dir,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 const f=await encryptedFixture(dir,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(dir,'preferences.json')});
 const registry=new ProjectRegistry(f.workspace,book.id),open=async root=>verifyAccess(await readAccess(root),'','',{deviceStore:f.deviceStore});
 // Every lab book of every project, read from its own store.
 const readBooks=async()=>{
  const books=[];
  for(const entry of (await registry.read()).value.projects){
   const vault=await open(entry.root);
   try{const labBooks=new LabBookRegistry(new ProjectStorage(entry.root,entry.projectId,vault));for(const item of (await labBooks.read()).value.books){const location=labBooks.location(item),key=await open(location.root);try{books.push((await new LabBookStorage(location.root,location.labBookId,key).read()).book);}finally{clearVault(key);}}}
   finally{clearVault(vault);}
  }
  return {notebooks:books.flatMap(b=>b.notebooks.map(n=>({...n,storeId:b.id}))),entries:books.flatMap(b=>b.entries)};
 };
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const main=page.locator('main'),dialog=page.locator('#dialog');
 const click=(scope,name)=>scope.getByRole('button',{name,exact:true}).click();
 // A project card opens from its name.
 const location=async name=>{await navigate(page,'Projects');await main.locator('.project-card').getByRole('button',{name,exact:true}).click();await expect(main.getByRole('heading',{name,level:1,exact:true})).toBeVisible({timeout:30000});};
 const addLocation=async(name,kind='Wing')=>{
  await main.getByRole('button',{name:/^New (sub)?project$/}).click();await dialog.getByLabel('Name',{exact:true}).fill(name);if(kind==='Project')await dialog.getByLabel('Project type',{exact:true}).selectOption('none');else{await dialog.getByLabel('Project type',{exact:true}).selectOption('custom');await dialog.getByLabel('Custom project type',{exact:true}).fill(kind);}
  // A project gets its own encrypted store, which takes longer than an ordinary save.
  await click(dialog,'Create project');await expect(dialog).not.toBeVisible({timeout:60000});
 };
 const addNotebook=async(name,profiles)=>{
  await click(main,'New lab book');await dialog.getByLabel('Lab book name',{exact:true}).fill(name);
  if(profiles.length)await dialog.getByLabel('Lab-book template',{exact:true}).selectOption({label:profiles[0]});
  await click(dialog,'Save lab book');await expect(dialog).not.toBeVisible({timeout:60000});
  if(profiles.length>1){
   // Saving a new lab book opens it; its settings are on the lab book page.
   await expect(main.getByRole('heading',{name,exact:true})).toBeVisible();await click(main,'Lab book settings');
   for(const label of profiles.slice(1)){await dialog.getByLabel('Lab-book type to add',{exact:true}).selectOption({label});await click(dialog,'Add lab-book type');await expect(dialog.getByRole('checkbox',{name:label,exact:true})).toBeChecked({timeout:30000});}
   await click(dialog,'Save lab book');await expect(dialog).not.toBeVisible({timeout:60000});
  }
 };
 try{
  await page.setViewportSize({width:1834,height:960});await page.goto(app.url);
  // Sample analysis is a module; lab book types are turned on in Templates.
  await navigate(page,'Preferences');
  for(const [section,ids] of [['Modules',['laboratory']],['Templates',['laboratory-computer-it','laboratory-arts-creative','laboratory-environmental-agricultural','laboratory-research-development']]]){
   await preferences(page,section);
   for(const id of ids){await page.locator('[data-desk-module="'+id+'"]').check();await page.waitForFunction(()=>!document.querySelector('#desk-save-state')?.textContent);}
  }
  await expect(page.locator('#main-navigation [data-module-nav="laboratory"]')).toHaveCount(0);
  for(const [wing,notebook,profiles] of [
   ['Field Lab','IT investigations',['Computer / IT']],
   ['Nature Archive','Music practice',['Arts & creative practice']],
   ['Insect reserve','Biodiversity observations',['Environmental & agricultural']],
   ['Sound Studio','VST development',['Computer / IT','Research & development']]
  ]){
   await navigate(page,'Projects');await addLocation(wing);await addNotebook(notebook,profiles);
  }
  let saved=await readBooks();expect(saved.notebooks).toHaveLength(4);expect(saved.entries).toHaveLength(0);
  const arts=saved.notebooks.find(n=>n.title==='Music practice'),it=saved.notebooks.find(n=>n.title==='IT investigations');
  expect(it.configuration.profiles.map(p=>p.id)).toEqual(['computer-it']);
  await navigate(page,'Projects');
  await page.evaluate(()=>{document.querySelectorAll('.tree-project').forEach(n=>n.open=true);window.keptNodes=[...document.querySelectorAll('.tree-project')];});
  if(await page.getByRole('button',{name:'Dismiss',exact:true}).isVisible())await click(page,'Dismiss');
  await page.screenshot({path:path.join(dir,'structure.png')});
  await location('Nature Archive');await addLocation('EP One','Release');await addNotebook('Recording sessions',['Arts & creative practice']);
  // Saving the new lab book opens it.
  await expect(main.getByRole('heading',{name:'Recording sessions',exact:true})).toBeVisible();
  await click(main,'New record');
  await click(dialog,'Create rehearsals & recordings');
  // A new record is entered one value at a time and then saved into the lab book.
  const initial=page.locator('[data-configuration-record-host]');await expect(initial.locator('[data-record-value]')).toBeVisible({timeout:30000});await initial.locator('[data-record-value]').fill('First session');
  await initial.getByLabel('Choose what to edit',{exact:true}).selectOption('custom');// The record's fields open on their first field, the session date, with its own date input.
  await expect(initial.getByLabel('Value',{exact:true})).toHaveValue('template:sessionDate');
  await initial.locator('input[type="date"][data-record-value]').fill('2026-09-28');
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('.record-editing h1')).toHaveText('First session',{timeout:60000});
  // The saved record offers figures, contributors and research links in its editing areas.
  await expect(await revealInEditor(page,page.getByRole('button',{name:'Add figure',exact:true}),'Evidence and results')).toBeVisible();
  await expect(await revealInEditor(page,page.getByRole('button',{name:'Add contributor',exact:true}),'Record details')).toBeVisible();
  await (await revealInEditor(page,page.getByRole('button',{name:'Add research link',exact:true}),'Evidence and results')).click();
  // A lab book of another project has its own store, so its reference is pasted as the app copies it, rather than found in this lab book.
  const link=page.getByRole('dialog',{name:'Edit Research link',exact:true});await link.getByLabel('Link label',{exact:true}).fill('IT investigations');
  await link.getByLabel('Observanda reference',{exact:true}).fill(researchReference({workspaceId:it.storeId,kind:'notebook',id:it.id}));
  await link.getByRole('button',{name:'Save changes',exact:true}).click();await expect(link).not.toBeVisible({timeout:30000});
  saved=await readBooks();const record=saved.entries.find(e=>e.title==='First session');
  expect(record.template.profileId).toBe('arts-creative');expect(record.figures).toEqual([]);
  expect(record.template.values.sessionDate).toBe('2026-09-28');expect(record.relations[0].target.id).toBe(it.id);
  expect(await page.evaluate(()=>keptNodes.every(n=>n.isConnected&&n.open))).toBe(true);
  await page.reload();await expect(page.locator('.record-editing h1')).toHaveText('First session',{timeout:30000});
  await (await revealInEditor(page,main.getByRole('button',{name:'IT investigations',exact:true}),'Evidence and results')).click();
  // The linked lab book belongs to another project, which opens its own store first.
  await expect(main.getByRole('heading',{name:'IT investigations',exact:true})).toBeVisible({timeout:30000});
  await page.goBack();await expect(page.locator('.record-editing h1')).toHaveText('First session',{timeout:30000});
  await click(main,'Back to records');await click(main,'Lab book settings');
  await dialog.getByLabel('Lab book name',{exact:true}).fill('Unsaved name');
  await click(dialog,'Cancel');await click(page.locator('#leave-dialog'),'Discard changes');
  await expect(dialog).not.toBeVisible();await expect(main.getByRole('heading',{name:'Recording sessions',exact:true})).toBeVisible();
  // Records of a project's own lab books are listed by their Observanda reference, so each opens from its own store.
  // Recent records of the project and its subprojects load from their own stores.
  await location('Nature Archive');await expect(main.getByRole('link',{name:'First session',exact:true})).toBeVisible({timeout:30000});
  // The subproject is listed as a project card; its name also appears beside its record.
  await expect(main.locator('.project-card').getByRole('button',{name:'EP One',exact:true})).toBeVisible();
  await click(main,'All records here');
  await page.getByLabel('Filter by record type',{exact:true}).selectOption('note');
  await expect(main.getByRole('link',{name:'First session',exact:true})).toHaveCount(0,{timeout:30000});
  await page.getByLabel('Filter by record type',{exact:true}).selectOption('template:'+record.template.id);
  await expect(main.getByRole('link',{name:'First session',exact:true})).toBeVisible({timeout:30000});
  // A new record starts in a lab book of the current project; a subproject's lab books are one project choice away.
  await click(main,'New record');await expect(dialog.getByLabel('Project',{exact:true}).locator('option:checked')).toHaveText('Nature Archive');
  await expect(dialog.getByRole('button',{name:/Music practice/})).toBeVisible({timeout:30000});
  await dialog.getByLabel('Project',{exact:true}).selectOption({label:'Nature Archive / EP One'});
  await expect(dialog.getByRole('button',{name:/Recording sessions/})).toBeVisible({timeout:30000});
  await click(dialog,'Cancel');
  // Another project's recent records finish loading without this record.
  await location('Field Lab');await expect(main.locator('#project-recent-records [role="status"]')).toHaveCount(0,{timeout:30000});await expect(main.getByRole('link',{name:'First session',exact:true})).toHaveCount(0);
  // The dashboard collects recent records from every project and lab book store, opening each one.
  await navigate(page,'Dashboard');await expect(page.locator('.desk-card').getByRole('button',{name:'First session',exact:true})).toBeVisible({timeout:90000});
  // Preferences lists the lab books that use a lab-book type across project and lab book stores and edits the chosen one in its store.
  await navigate(page,'Preferences');await preferences(page,'Templates');
  await page.locator('[data-module-preference="laboratory-arts-creative"]').getByRole('button',{name:/Record types/}).click();
  const settings=page.locator('[data-module-settings-slot]');
  await expect(settings.getByLabel('Lab book',{exact:true}).locator('option:checked')).toHaveText('Nature Archive / Music practice',{timeout:60000});
  await expect(settings.getByLabel('Lab book',{exact:true}).locator('option')).toContainText(['EP One / Recording sessions']);
  await settings.locator('[data-command="section-select"]').filter({hasText:'Rehearsals & recordings'}).click({timeout:30000});
  await settings.getByLabel('Record type name',{exact:true}).fill('Sound ideas');
  await click(settings,'Save changes');await expect(settings.locator('[data-type-settings-status]')).toHaveText('No unsaved changes',{timeout:90000});
  await expect(settings.locator('[data-command="section-select"]').filter({hasText:'Sound ideas'})).toBeVisible();
  // A subproject card opens from its name.
  await location('Nature Archive');await main.locator('.project-card').getByRole('button',{name:'EP One',exact:true}).click();await expect(main.getByRole('heading',{name:'EP One',level:1,exact:true})).toBeVisible({timeout:30000});
  await click(main,'Open lab book');await expect(main.getByRole('heading',{name:'Recording sessions',level:1,exact:true})).toBeVisible({timeout:30000});await click(main,'Lab book settings');
  // The lab book's record types load from its own store after the settings open.
  await dialog.getByRole('button',{name:/Rehearsals & recordings/}).click({timeout:30000});
  await page.screenshot({path:path.join(dir,'notebook-settings-desktop.png')});
  await dialog.getByLabel('Record type name',{exact:true}).fill('Recording session');
  await click(dialog,'Save lab book');await expect(dialog).not.toBeVisible({timeout:60000});
  await page.getByRole('button',{name:'First session',exact:true}).click();
  // A saved record keeps the record type it was saved with; the reader names it above its fields.
  await expect(page.locator('.record-reader h1')).toHaveText('First session',{timeout:30000});await expect(page.locator('.record-reader')).toContainText('Rehearsals & recordings');
  await click(main,'Back to records');await click(main,'New record');
  await expect(dialog.getByRole('button',{name:'Create recording session',exact:true})).toBeVisible();
  await click(dialog,'Cancel');
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await click(main,'Lab book settings');
  expect(await page.evaluate(()=>document.querySelector('#dialog').getBoundingClientRect().right<=innerWidth)).toBe(true);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await expect(dialog.getByRole('heading',{name:'Lab book settings',exact:true})).toBeVisible();
  await page.screenshot({path:path.join(dir,'notebook-settings-mobile.png')});
  // Record types and their fields are chosen from the editor's lists; the chosen field's label is edited below them.
  await dialog.locator('[data-command="section-select"]').filter({hasText:'Recording session'}).click();await expect(dialog.locator('[data-command="section-select"][aria-current="true"]')).toContainText('Recording session',{timeout:30000});
  await dialog.locator('[data-command="field-select"]').last().click();
  await dialog.getByLabel('Field label',{exact:true}).fill('Unsaved mobile label');
  await page.screenshot({path:path.join(dir,'notebook-fields-mobile.png')});
  await click(dialog,'Cancel');await click(page.locator('#leave-dialog'),'Discard changes');
  await page.setViewportSize({width:1834,height:960});
  await page.waitForFunction(()=>document.documentElement.dataset.contextNavigation==='open');
  await location('Nature Archive');
  if(await page.getByRole('button',{name:'Dismiss',exact:true}).isVisible())await click(page,'Dismiss');
  await page.screenshot({path:path.join(dir,'music-wing.png')});
  // Lab book settings opened from a project page leave that page showing its own project's records.
  await main.locator('.project-card').getByRole('button',{name:'EP One',exact:true}).click();await expect(main.getByRole('heading',{name:'EP One',level:1,exact:true})).toBeVisible({timeout:30000});
  await main.locator('.project-notebook').getByRole('button',{name:'Lab book settings',exact:true}).click();await expect(dialog.getByLabel('Lab book name',{exact:true})).toHaveValue('Recording sessions',{timeout:30000});
  await click(dialog,'Cancel');await expect(dialog).not.toBeVisible();
  await expect(main.locator('#project-recent-records').getByRole('link',{name:'First session',exact:true})).toBeVisible({timeout:30000});await expect(main.locator('#project-recent-records [role="alert"]')).toHaveCount(0);
  expect(errors).toEqual([]);
 }finally{await app.close();await owner.close();detach();await clearVault(f.vault);await rm(dir,{recursive:true,force:true});}
});
