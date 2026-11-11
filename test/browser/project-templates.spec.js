import {WorkspaceDatabases} from '../../src/workspace-databases.js';
import {installDatabaseProvider} from '../../src/workspace-database-context.js';
import {ProjectRegistry} from '../../src/project-registry.js';
import {ProjectStorage} from '../../src/project-storage.js';
import {LabBookRegistry} from '../../src/lab-book-registry.js';
import {LabBookStorage} from '../../src/lab-book-storage.js';
import {readAccess,verifyAccess} from '../../src/access.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {navigate,preferences} from './preferences-helper.js';
import {randomUUID} from 'node:crypto';
import {laboratoryProfiles} from '../../src/web/laboratory/catalog.js';

test.beforeEach(async({page})=>page.setDefaultTimeout(15000));

async function fixture(configure=()=>{},password=''){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-types-ui-')),book=sampleNotebook();
 book.title='workspace';book.projects=[];book.notebooks=[];book.entries=[];book.website.navigation=[];book.branding=[];book.website.layouts=[];
 configure(book);
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const registry=new ProjectRegistry(f.workspace,book.id);
 // A project opens with this device's access, or with the project password when it has one.
 const openProject=async root=>{const access=await readAccess(root);try{return await verifyAccess(access,'','',{deviceStore:f.deviceStore});}catch(error){if(error.code!=='DEVICE_UNKNOWN'||!password)throw error;return verifyAccess(access,'',password,{deviceStore:f.deviceStore});}};
 const readProject=async(choose=0)=>{const projects=(await registry.read()).value.projects,entry=typeof choose==='number'?projects[choose]:projects.find(choose),vault=await openProject(entry.root);try{return await new ProjectStorage(entry.root,entry.projectId,vault).read();}finally{clearVault(vault);}};
 const readLabBooks=async(index=0)=>{
  const entry=(await registry.read()).value.projects[index],vault=await verifyAccess(await readAccess(entry.root),'',index===0?password:'',{deviceStore:f.deviceStore});
  try{
   const books=new LabBookRegistry(new ProjectStorage(entry.root,entry.projectId,vault)),result=[];
   for(const item of (await books.read()).value.books){const location=books.location(item),key=await verifyAccess(await readAccess(location.root),'','',{deviceStore:f.deviceStore});try{result.push((await new LabBookStorage(location.root,location.labBookId,key).read()).book);}finally{clearVault(key);}}
   return result;
  }finally{clearVault(vault);}
 };
 return {...f,app,directory,registry,readProject,readLabBooks,close:async()=>{await app.close();await owner.close();detach();await clearVault(f.vault);if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-project-types-ui-'))throw Error('Invalid fixture');await rm(directory,{recursive:true,force:true});}};
}
// Lab books of a project with its own store are created through that project.
const rejectSave=(page)=>page.context().route(/\/api\/(?:projects(?:\/[a-f0-9-]+\/(?:workspace\/structure|settings\/save|lab-books\/create)|\/create)|workspace\/structure)$/,route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({code:'INVALID',message:'Synthetic rejected save'})}),{times:1});
const noTemplateEditor=async dialog=>{
 for(const label of ['Template name','Record type name','Field label','Purpose / guidance'])await expect(dialog.getByLabel(label,{exact:true})).toHaveCount(0);
 for(const label of ['Use template','Customize template','Add record type','Add field','Save and create lab book'])await expect(dialog.getByRole('button',{name:label,exact:true})).toHaveCount(0);
};
const discard=async page=>{await page.locator('#dialog').getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();};

test('project creation selects a complete template; only the dedicated editor changes its definitions',async({page})=>{
 test.setTimeout(180000);const f=await fixture(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const main=page.locator('main'),dialog=page.locator('#dialog');
 const saveProject=()=>dialog.getByRole('button',{name:'Create project',exact:true}).click();
 const openTemplate=()=>main.getByRole('button',{name:'Lab-book template',exact:true}).click();
 try{
  await page.goto(f.app.url);await navigate(page,'Preferences');await preferences(page,'Templates');await main.getByRole('switch',{name:'Enable Research & development',exact:true}).check();
  await navigate(page,'Projects');await main.getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('Field Lab');
  await expect(dialog.locator('[data-project-type] option')).toHaveText(['No type selected','Research & development','Custom type']);
  await dialog.getByLabel('Project type',{exact:true}).selectOption('profile:research-development');
  await expect(dialog.getByLabel('Default lab-book template',{exact:true})).toHaveValue('profile:research-development');
  const researchTypes=['Questions & hypotheses','Protocols & methods','Experiments & prototypes','Findings & decisions','Materials & reagents','Equipment register'];
  await expect(dialog.locator('.project-template-summary strong')).toHaveText(researchTypes);await noTemplateEditor(dialog);
  await page.screenshot({path:test.info().outputPath('project-creation-desktop.png')});await saveProject();await expect(dialog).not.toBeVisible({timeout:60000});
  const initial=(await f.readProject()).book,project=initial.projects[0];expect(initial.notebooks).toHaveLength(0);expect(project.labBookTemplate.configuration.sections.map(s=>s.label)).toEqual(researchTypes);expect(project.tools).toEqual([]);
  await page.reload();await main.getByRole('button',{name:'Settings',exact:true}).click();await noTemplateEditor(dialog);await expect(dialog.locator('.project-template-summary strong')).toHaveText(researchTypes,{timeout:30000});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).not.toBeVisible();
  await main.getByRole('button',{name:'New lab book',exact:true}).click();await dialog.getByLabel('Lab book name',{exact:true}).fill('First investigation');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});
  const before=(await f.readProject()).book,beforeBooks=await f.readLabBooks();expect(beforeBooks).toHaveLength(1);
  await main.getByRole('navigation',{name:'Project hierarchy',exact:true}).getByRole('button',{name:project.title,exact:true}).click();
  await openTemplate();await expect(dialog.getByRole('heading',{name:'Lab-book template',exact:true})).toBeVisible();await expect(dialog.getByLabel('Name',{exact:true})).toHaveCount(0);
  // The template editor lists record types and the selected type's fields; each is chosen from its list with the keyboard.
  const types=dialog.getByRole('complementary',{name:'Record types',exact:true}),typeChoices=types.locator('[data-command="section-select"]');await expect(typeChoices).toHaveText(researchTypes,{timeout:30000});
  for(const section of project.labBookTemplate.configuration.sections){
   const choice=typeChoices.filter({hasText:section.label});await choice.focus();await page.keyboard.press('Enter');await expect(choice).toHaveAttribute('aria-current','true',{timeout:30000});
   // The editor reloads the chosen type; focus stays on it for the next keyboard choice.
   await expect(dialog.locator('[data-configuration-editor] fieldset[aria-busy="true"]')).toHaveCount(0,{timeout:30000});await expect(choice).toBeFocused();
   await expect(dialog.getByLabel('Record type name',{exact:true})).toHaveValue(section.label);await expect(dialog.locator('[data-command="field-select"]')).toHaveText(section.fields.map(field=>field.label));
  }
  // Leaving discards the template editor's unsaved selection state on the server before the dialog closes.
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible({timeout:30000});
  await openTemplate();await dialog.getByLabel('Record type name',{exact:true}).fill('Unwanted edit');await discard(page);expect((await f.readProject()).book.projects[0]).toEqual(project);
  await openTemplate();await dialog.getByLabel('Record type name',{exact:true}).fill('Research questions');await dialog.getByRole('button',{name:'Add field',exact:true}).click();await dialog.getByLabel('Field label',{exact:true}).last().fill('Investigation area');
  await page.screenshot({path:test.info().outputPath('template-editor-desktop.png')});
  await rejectSave(page);await dialog.getByRole('button',{name:'Save template',exact:true}).click();await expect(dialog.locator('[data-project-error]')).toContainText('Synthetic rejected save');await expect(dialog.getByLabel('Field label',{exact:true}).last()).toHaveValue('Investigation area');expect((await f.readProject()).book.projects[0]).toEqual(project);
  await dialog.getByRole('button',{name:'Save template',exact:true}).click();await expect(dialog).not.toBeVisible();
  const updated=(await f.readProject()).book;expect(await f.readLabBooks()).toEqual(beforeBooks);expect(updated.notebooks).toEqual(before.notebooks);expect(updated.entries).toEqual(before.entries);expect({...updated.projects[0],labBookTemplate:project.labBookTemplate}).toEqual(project);
  expect(updated.projects[0].labBookTemplate.configuration.sections[0].label).toBe('Research questions');
  await main.getByRole('button',{name:'New lab book',exact:true}).click();await expect(dialog.getByLabel('Lab-book template',{exact:true})).toHaveValue('default');await noTemplateEditor(dialog);
  await dialog.getByLabel('Lab book name',{exact:true}).fill('Second investigation');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});
  const second=(await f.readLabBooks()).flatMap(book=>book.notebooks).find(n=>n.title==='Second investigation');expect(second.configuration.sections[0].label).toBe('Research questions');expect(second.configuration.sections[0].fields.at(-1).label).toBe('Investigation area');expect(errors).toEqual([]);
 }finally{await f.close();}
});

test('custom templates are authored separately, reusable in creation, and independently editable on narrow screens',async({page})=>{
 test.setTimeout(180000);const f=await fixture(()=>{},'Project secret'),main=page.locator('main'),dialog=page.locator('#dialog'),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(f.app.url);await navigate(page,'Projects');await main.getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('Sound fieldwork');await dialog.locator('[name=projectPassword]').fill('Project secret');
  await expect(dialog.locator('[data-project-type] option')).toHaveText(['No type selected','Custom type']);await dialog.getByLabel('Project type',{exact:true}).selectOption('custom');await dialog.getByLabel('Custom project type',{exact:true}).fill('Sound ecology');await noTemplateEditor(dialog);
  await page.setViewportSize({width:390,height:844});await expect(dialog.getByRole('button',{name:'Create project',exact:true})).toBeInViewport();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:test.info().outputPath('project-creation-narrow.png')});await rejectSave(page);await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog.locator('[data-project-error]')).toBeVisible();await expect(dialog.getByLabel('Custom project type',{exact:true})).toHaveValue('Sound ecology');expect((await f.workspace.read()).book.projects).toHaveLength(0);
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});
  await main.getByRole('button',{name:'Lab-book template',exact:true}).click();await expect(dialog.getByLabel('Template name',{exact:true})).toHaveValue('');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.locator('#leave-dialog')).not.toBeVisible();expect((await f.readProject()).book.projects[0].labBookTemplate).toBeUndefined();
  await main.getByRole('button',{name:'Lab-book template',exact:true}).click();await dialog.getByLabel('Template name',{exact:true}).fill('Listening practice');await dialog.getByRole('button',{name:'Add record type',exact:true}).click();await dialog.getByLabel('Record type name',{exact:true}).fill('Field recording');await dialog.getByRole('button',{name:'Add field',exact:true}).click();await dialog.getByLabel('Field label',{exact:true}).fill('Duration');await dialog.getByLabel('Value type',{exact:true}).selectOption('number');await dialog.getByLabel('Unit (optional)',{exact:true}).fill('seconds');
  await expect(dialog.getByRole('button',{name:'Save template',exact:true})).toBeInViewport();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('template-editor-narrow.png')});
  await dialog.getByRole('button',{name:'Save template',exact:true}).click();await expect(dialog).not.toBeVisible();await page.reload();
  await main.getByRole('button',{name:'Settings',exact:true}).click();await expect(dialog.getByLabel('Custom project type',{exact:true})).toHaveValue('Sound ecology');await expect(dialog.getByLabel('Default lab-book template',{exact:true}).locator('option:checked')).toHaveText('Saved default: Listening practice');await noTemplateEditor(dialog);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const original=(await f.readProject()).book.projects[0];
  await page.evaluate(async id=>{const storage=await(await fetch('/api/storage')).json();const response=await fetch('/api/projects/'+id+'/access/lock',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},body:'{}'});if(!response.ok)throw Error('Could not lock fixture project');},original.id);
  await page.setViewportSize({width:1440,height:1000});await expect(page.locator('html')).toHaveAttribute('data-context-navigation','open');await navigate(page,'Projects');await main.getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('Another studio');
  // The default template is among the optional project details.
  await dialog.getByText('Optional project details and template',{exact:true}).click();await dialog.getByLabel('Default lab-book template',{exact:true}).selectOption('project:'+original.id);await expect(page.locator('#project-unlock-form')).toBeVisible();await page.locator('#project-unlock-form [name=password]').fill('Project secret');await page.locator('#project-unlock-form [type=submit]').click();await expect(page.locator('#structure-project-form')).toBeVisible();await noTemplateEditor(dialog);await expect(dialog.locator('.project-template-summary strong')).toHaveText(['Field recording']);
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});await main.getByRole('button',{name:'Lab-book template',exact:true}).click();await dialog.getByLabel('Record type name',{exact:true}).fill('Studio take');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#leave-dialog').getByRole('button',{name:'Save and continue',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=(await f.readProject(entry=>entry.projectId!==original.id)).book;expect((await f.readProject(entry=>entry.projectId===original.id)).book.projects[0]).toEqual(original);expect(saved.projects[0].labBookTemplate.configuration.sections[0].label).toBe('Studio take');expect(saved.projects[0].labBookTemplate.configuration.sections[0].id).not.toBe(original.labBookTemplate.configuration.sections[0].id);expect(errors).toEqual([]);
 }finally{await f.close();}
});


test('new lab books select all enabled templates from one dropdown and keep independent defaults',async({page})=>{
 test.setTimeout(300000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await fixture(),main=page.locator('main'),dialog=page.locator('#dialog');
 const picker=()=>dialog.getByLabel('Lab-book template',{exact:true}),save=async()=>{await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});};
 // A saved lab book opens itself; new lab books are created from its project's page.
 const open=async()=>{const back=main.getByRole('navigation',{name:'Project hierarchy',exact:true}).getByRole('button',{name:'Research studio',exact:true});if(await back.isVisible())await back.click();await main.getByRole('button',{name:'New lab book',exact:true}).click();};
 // Projects and their templates are created through the app, each project with its own store.
 const projectCount=async()=>(await f.registry.read()).value.projects.length;
 const projectBy=async title=>{for(let index=0;index<await projectCount();index++){const book=(await f.readProject(index)).book;if(book.projects[0].title===title)return book.projects[0];}throw Error('Missing project '+title);};
 const books=async()=>{const all=[];for(let index=0;index<await projectCount();index++)all.push(...(await f.readLabBooks(index)).flatMap(book=>book.notebooks));return all;};
 const createProject=async(title,type)=>{
  await navigate(page,'Projects');await main.getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill(title);
  if(type)await dialog.getByLabel('Project type',{exact:true}).selectOption(type);else{await dialog.getByLabel('Project type',{exact:true}).selectOption('custom');await dialog.getByLabel('Custom project type',{exact:true}).fill('Studio');}
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});
 };
 const saveTemplate=async()=>{await dialog.getByRole('button',{name:'Save template',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});};
 try{
  await page.goto(f.app.url);await navigate(page,'Preferences');await preferences(page,'Templates');
  for(const p of laboratoryProfiles)await main.getByRole('switch',{name:'Enable '+p.label,exact:true}).check();
  await createProject('Research studio','profile:research-development');
  await main.getByRole('button',{name:'Lab-book template',exact:true}).click();await dialog.getByLabel('Template name',{exact:true}).fill('Research practice');await dialog.getByLabel('Record type name',{exact:true}).fill('Our research questions');await saveTemplate();
  await createProject('Sound studio');
  await main.getByRole('button',{name:'Lab-book template',exact:true}).click();await dialog.getByLabel('Template name',{exact:true}).fill('Listening practice');await dialog.getByRole('button',{name:'Add record type',exact:true}).click();await dialog.getByLabel('Record type name',{exact:true}).fill('Sound notes');await saveTemplate();
  const first=await projectBy('Research studio'),second=await projectBy('Sound studio'),research=first.labBookTemplate,custom=second.labBookTemplate;
  expect(research.configuration.sections[0].label).toBe('Our research questions');expect(custom.configuration.sections.map(s=>s.label)).toEqual(['Sound notes']);
  await navigate(page,'Projects');await main.locator('.project-card').getByRole('button',{name:'Research studio',exact:true}).click();await expect(main.getByRole('heading',{name:'Research studio',level:1,exact:true})).toBeVisible({timeout:30000});
  await open();await expect(picker().locator('option:checked')).toHaveText('Research practice (project default)');await noTemplateEditor(dialog);
  // A new lab book offers its website and PDF visibility; lab-book types come only from the template picker.
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);for(const name of ['Allow PDF publication from this lab book','Allow web publishing from this lab book'])await expect(dialog.getByRole('checkbox',{name,exact:true})).toHaveCount(1);
  await expect(picker().locator('optgroup[label="Enabled lab-book types"] option')).toHaveText(laboratoryProfiles.map(p=>p.label));
  // Other projects' templates come from the project directory, refreshed after a template is saved.
  await expect(picker().locator('optgroup[label="Saved project templates"] option')).toHaveText(['Listening practice / Sound studio'],{timeout:30000});
  await dialog.getByLabel('Lab book name',{exact:true}).fill('First investigation');await page.screenshot({path:test.info().outputPath('lab-book-creation-desktop.png')});await save();
  let saved=await books();const investigation=saved.find(n=>n.title==='First investigation');expect(investigation.configuration.sections[0].label).toBe('Our research questions');expect(investigation.configuration.sections[0].id).not.toBe(research.configuration.sections[0].id);
  await open();await dialog.getByLabel('Lab book name',{exact:true}).fill('Explicit IT choice');
  // The picker is enabled once the saved templates it offers have been read.
  await expect(picker()).toBeEnabled({timeout:30000});await expect(picker().locator('option:checked')).toHaveText('Research practice (project default)');
  await picker().focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await expect(picker()).toHaveValue('blank');await expect(picker()).toBeFocused();
  await picker().selectOption('profile:arts-creative');await picker().selectOption('profile:computer-it');await expect(picker()).toHaveValue('profile:computer-it');
  await save();saved=await books();const it=saved.find(n=>n.title==='Explicit IT choice');expect(it.configuration.profiles.map(p=>p.id)).toEqual(['computer-it']);expect(it.configuration.sections.every(s=>s.profileId==='computer-it')).toBe(true);
  await open();await picker().selectOption('project:'+second.id);await dialog.getByLabel('Lab book name',{exact:true}).fill('Custom copy');
  await page.setViewportSize({width:390,height:844});await expect(dialog.getByRole('button',{name:'Save lab book',exact:true})).toBeInViewport();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('lab-book-creation-narrow.png')});
  const before=(await books()).length;
  await rejectSave(page);await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog.locator('[data-notebook-error]')).toHaveText('Synthetic rejected save');await expect(dialog.locator('[data-notebook-error]')).toBeFocused();await expect(picker()).toHaveValue('project:'+second.id);expect(await books()).toHaveLength(before);await save();
  await page.reload();saved=await books();const copy=saved.find(n=>n.title==='Custom copy');expect(copy.configuration.sections[0].label).toBe('Sound notes');expect(copy.configuration.sections[0].id).not.toBe(custom.configuration.sections[0].id);
  await open();await picker().selectOption('blank');await dialog.getByLabel('Lab book name',{exact:true}).fill('Blank journal');await save();saved=await books();expect(saved.find(n=>n.title==='Blank journal').configuration).toEqual({profiles:[],sections:[]});
  await open();await picker().selectOption('profile:computer-it');await dialog.getByLabel('Lab book name',{exact:true}).fill('Discarded book');await discard(page);expect(await books()).toHaveLength(before+2);
  expect((await projectBy('Research studio')).labBookTemplate).toEqual(research);expect((await projectBy('Sound studio')).labBookTemplate).toEqual(custom);expect(errors).toEqual([]);
 }finally{await f.close();}
});
