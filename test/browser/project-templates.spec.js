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
import {starterTemplate} from '../../src/web/project-templates.js';
import {laboratoryProfiles} from '../../src/web/laboratory/catalog.js';

test.beforeEach(async({page})=>page.setDefaultTimeout(15000));

async function fixture(configure=()=>{},password=''){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-types-ui-')),book=sampleNotebook();
 book.title='workspace';book.projects=[];book.notebooks=[];book.entries=[];book.website.navigation=[];book.branding=[];book.website.layouts=[];
 configure(book);
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const registry=new ProjectRegistry(f.workspace,book.id);
 const readProject=async(index=0)=>{const entry=(await registry.read()).value.projects[index],vault=await verifyAccess(await readAccess(entry.root),'',index===0?password:'',{deviceStore:f.deviceStore});try{return await new ProjectStorage(entry.root,entry.projectId,vault).read();}finally{clearVault(vault);}};
 const readLabBooks=async(index=0)=>{
  const entry=(await registry.read()).value.projects[index],vault=await verifyAccess(await readAccess(entry.root),'',index===0?password:'',{deviceStore:f.deviceStore});
  try{
   const books=new LabBookRegistry(new ProjectStorage(entry.root,entry.projectId,vault)),result=[];
   for(const item of (await books.read()).value.books){const location=books.location(item),key=await verifyAccess(await readAccess(location.root),'','',{deviceStore:f.deviceStore});try{result.push((await new LabBookStorage(location.root,location.labBookId,key).read()).book);}finally{clearVault(key);}}
   return result;
  }finally{clearVault(vault);}
 };
 return {...f,app,directory,readProject,readLabBooks,close:async()=>{await app.close();await owner.close();detach();clearVault(f.vault);if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-project-types-ui-'))throw Error('Invalid fixture');await rm(directory,{recursive:true,force:true});}};
}
const rejectSave=(page)=>page.route(/\/api\/(?:projects(?:\/[a-f0-9-]+\/(?:workspace\/structure|settings\/save)|\/create)|workspace\/structure)$/,route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({code:'INVALID',message:'Synthetic rejected save'})}),{times:1});
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
  await expect(dialog.locator('.project-template-summary strong')).toHaveText(['Questions & hypotheses','Protocols & methods','Experiments & prototypes','Findings & decisions']);await noTemplateEditor(dialog);
  await page.screenshot({path:test.info().outputPath('project-creation-desktop.png')});await saveProject();await expect(dialog).not.toBeVisible({timeout:60000});
  const initial=(await f.readProject()).book,project=initial.projects[0];expect(initial.notebooks).toHaveLength(0);expect(project.labBookTemplate.configuration.sections).toHaveLength(4);expect(project.tools).toEqual([]);
  await page.reload();await main.getByRole('button',{name:'Settings',exact:true}).click();await noTemplateEditor(dialog);await expect(dialog.locator('.project-template-summary strong')).toHaveCount(4);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).not.toBeVisible();
  await main.getByRole('button',{name:'New lab book',exact:true}).click();await dialog.getByLabel('Lab book name',{exact:true}).fill('First investigation');await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});
  const before=(await f.readProject()).book,beforeBooks=await f.readLabBooks();expect(beforeBooks).toHaveLength(1);
  await main.getByRole('navigation',{name:'Project hierarchy',exact:true}).getByRole('button',{name:project.title,exact:true}).click();
  await openTemplate();await expect(dialog.getByRole('heading',{name:'Lab-book template',exact:true})).toBeVisible();await expect(dialog.getByLabel('Name',{exact:true})).toHaveCount(0);
  const types=dialog.getByRole('complementary',{name:'Record types',exact:true});await expect(types.locator('.lab-type-choice')).toHaveCount(4);
  for(const section of project.labBookTemplate.configuration.sections){
   await types.locator('.lab-type-choice').filter({has:page.getByText(section.label,{exact:true})}).focus();await page.keyboard.press('Enter');await expect(dialog.getByLabel('Record type name',{exact:true})).toBeFocused();
   await expect(dialog.getByLabel('Record type name',{exact:true})).toHaveValue(section.label);await expect(dialog.getByLabel('Field label',{exact:true})).toHaveCount(section.fields.length);
  }
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
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
  await page.setViewportSize({width:1440,height:1000});await expect(page.locator('html')).toHaveAttribute('data-context-navigation','open');await navigate(page,'Projects');await main.getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('Another studio'); await dialog.getByLabel('Default lab-book template',{exact:true}).selectOption('project:'+original.id);await expect(page.locator('#project-unlock-form')).toBeVisible();await page.locator('#project-unlock-form [name=password]').fill('Project secret');await page.locator('#project-unlock-form [type=submit]').click();await expect(page.locator('#structure-project-form')).toBeVisible();await noTemplateEditor(dialog);await expect(dialog.locator('.project-template-summary strong')).toHaveText(['Field recording']);
  await dialog.getByRole('button',{name:'Create project',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});await main.getByRole('button',{name:'Lab-book template',exact:true}).click();await dialog.getByLabel('Record type name',{exact:true}).fill('Studio take');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#leave-dialog').getByRole('button',{name:'Save and continue',exact:true}).click();await expect(dialog).not.toBeVisible();
  const saved=(await f.readProject(1)).book;expect((await f.readProject()).book.projects[0]).toEqual(original);expect(saved.projects[0].labBookTemplate.configuration.sections[0].label).toBe('Studio take');expect(saved.projects[0].labBookTemplate.configuration.sections[0].id).not.toBe(original.labBookTemplate.configuration.sections[0].id);expect(errors).toEqual([]);
 }finally{await f.close();}
});


test('new lab books select all enabled templates from one dropdown and keep independent defaults',async({page})=>{
 test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const research=starterTemplate('research-development');research.name='Research practice';research.configuration.sections[0].label='Our research questions';
 const custom=starterTemplate('arts-creative');custom.name='Listening practice';custom.configuration.profiles=[];custom.configuration.sections=custom.configuration.sections.slice(0,1);custom.configuration.sections[0].profileId=null;custom.configuration.sections[0].label='Sound notes';
 const project=(title,labBookTemplate)=>({id:randomUUID(),title,description:'',share:false,logoId:null,labBookTemplate});
 const first=project('Research studio',research),second=project('Sound studio',custom);
 const f=await fixture(book=>book.projects=[first,second]),main=page.locator('main'),dialog=page.locator('#dialog');
 const picker=()=>dialog.getByLabel('Lab-book template',{exact:true}),save=async()=>{await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog).not.toBeVisible({timeout:60000});};
 const open=()=>main.getByRole('button',{name:'New lab book',exact:true}).click();
 try{
  await page.goto(f.app.url);await navigate(page,'Preferences');await preferences(page,'Templates');
  for(const p of laboratoryProfiles)await main.getByRole('switch',{name:'Enable '+p.label,exact:true}).check();
  await navigate(page,'Projects');await main.locator('.project-card').filter({has:page.getByRole('button',{name:first.title,exact:true})}).getByRole('button',{name:'Open',exact:true}).click();
  await open();await expect(picker().locator('option:checked')).toHaveText('Research practice (project default)');await noTemplateEditor(dialog);await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(picker().locator('optgroup[label="Enabled lab-book types"] option')).toHaveText(laboratoryProfiles.map(p=>p.label));
  await expect(picker().locator('optgroup[label="Saved project templates"] option')).toHaveText(['Listening practice / Sound studio']);
  await dialog.getByLabel('Lab book name',{exact:true}).fill('First investigation');await page.screenshot({path:test.info().outputPath('lab-book-creation-desktop.png')});await save();
  let saved=(await f.workspace.read()).book;expect(saved.notebooks[0].configuration.sections[0].label).toBe('Our research questions');expect(saved.notebooks[0].configuration.sections[0].id).not.toBe(research.configuration.sections[0].id);
  await open();await dialog.getByLabel('Project',{exact:true}).selectOption(second.id);await expect(picker().locator('option:checked')).toHaveText('Listening practice (project default)');
  await dialog.getByLabel('Lab book name',{exact:true}).fill('Changed owner');await save();
  saved=(await f.workspace.read()).book;expect(saved.notebooks.at(-1).projectId).toBe(second.id);expect(saved.notebooks.at(-1).configuration.sections[0].label).toBe('Sound notes');
  await open();await dialog.getByLabel('Lab book name',{exact:true}).fill('Explicit IT choice');
  await picker().focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await expect(picker()).toHaveValue('blank');await expect(picker()).toBeFocused();
  await picker().selectOption('profile:arts-creative');await picker().selectOption('profile:computer-it');await dialog.getByLabel('Project',{exact:true}).selectOption(second.id);await expect(picker()).toHaveValue('profile:computer-it');
  await save();saved=(await f.workspace.read()).book;expect(saved.notebooks.at(-1).configuration.profiles.map(p=>p.id)).toEqual(['computer-it']);expect(saved.notebooks.at(-1).configuration.sections.every(s=>s.profileId==='computer-it')).toBe(true);
  await open();await picker().selectOption('project:'+second.id);await dialog.getByLabel('Lab book name',{exact:true}).fill('Custom copy');
  await page.setViewportSize({width:390,height:844});await expect(dialog.getByRole('button',{name:'Save lab book',exact:true})).toBeInViewport();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('lab-book-creation-narrow.png')});
  await rejectSave(page);await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await expect(dialog.locator('[data-notebook-error]')).toHaveText('Synthetic rejected save');await expect(dialog.locator('[data-notebook-error]')).toBeFocused();await expect(picker()).toHaveValue('project:'+second.id);expect((await f.workspace.read()).book.notebooks).toHaveLength(3);await save();
  await page.reload();saved=(await f.workspace.read()).book;const copy=saved.notebooks.find(n=>n.title==='Custom copy');expect(copy.configuration.sections[0].label).toBe('Sound notes');expect(copy.configuration.sections[0].id).not.toBe(custom.configuration.sections[0].id);
  await open();await picker().selectOption('blank');await dialog.getByLabel('Lab book name',{exact:true}).fill('Blank journal');await save();saved=(await f.workspace.read()).book;expect(saved.notebooks.at(-1).configuration).toEqual({profiles:[],sections:[]});
  await open();await picker().selectOption('profile:computer-it');await dialog.getByLabel('Lab book name',{exact:true}).fill('Discarded book');await discard(page);expect((await f.workspace.read()).book.notebooks).toHaveLength(5);
  expect((await f.workspace.read()).book.projects.map(p=>p.labBookTemplate)).toEqual([research,custom]);expect(errors).toEqual([]);
 }finally{await f.close();}
});
