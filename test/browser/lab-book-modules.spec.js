import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {laboratoryProfiles} from '../../src/web/laboratory/catalog.js';
import {navigate,preferences} from './preferences-helper.js';

test('workspace projects and lab books remain usable with every optional type disabled',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-hierarchy-ui-')),book=sampleNotebook();
 book.title='Creative collective';book.projects=[];book.notebooks=[];book.entries=[];book.website.navigation=[];book.branding=[];book.website.layouts=[];
 const f=await encryptedFixture(directory,book),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const main=page.locator('main'),dialog=page.locator('#dialog'),nav=page.locator('#main-navigation'),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 const modules=async()=>{await navigate(page,'Preferences');await preferences(page,'Templates');};
 const project=()=>nav.getByRole('button',{name:'Open Project Music studio',exact:true}).click();
 const openBook=async title=>{await project();await main.locator('.project-notebook').filter({has:page.getByRole('button',{name:title,exact:true})}).getByRole('button',{name:'Open lab book',exact:true}).click();};
 const createBook=async(title,type)=>{
  await main.getByRole('button',{name:'New lab book',exact:true}).click();await dialog.getByLabel('Lab book name',{exact:true}).fill(title);
  await expect(dialog.getByLabel('Project',{exact:true})).toHaveValue((await f.workspace.read()).book.projects[0].id);
  if(type)await dialog.getByLabel('Lab-book template',{exact:true}).selectOption({label:type});
  await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();
 };
 const record=async(type,title)=>{
  await main.getByRole('button',{name:'New record',exact:true}).click();await dialog.getByRole('button',{name:type,exact:true}).click();
  await page.getByLabel('Record title',{exact:true}).fill(title);await page.locator('.section-save [data-action="save"]').click();await expect(page.locator('#save-status')).toHaveText('Saved');
 };
 try{
  await page.goto(app.url);await modules();
  for(const name of ['Enable Lab books','Enable Laboratory','Enable Projects'])await expect(main.getByRole('switch',{name,exact:true})).toHaveCount(0);
  const types=main.getByRole('group',{name:'Lab-book templates',exact:true});await expect(types.getByRole('switch')).toHaveCount(laboratoryProfiles.length);
  const labels=await types.getByRole('switch').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));expect(labels).toEqual([...labels].sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'})));
  for(const toggle of await main.getByRole('switch').all())await toggle.uncheck();
  for(const toggle of await main.getByRole('switch').all())await expect(toggle).not.toBeChecked();
  await navigate(page,'Projects');await main.getByRole('button',{name:'New project',exact:true}).click();await dialog.getByLabel('Name',{exact:true}).fill('Music studio');await dialog.getByRole('button',{name:'Save project',exact:true}).click();
  await expect(main.getByRole('heading',{name:'Music studio',exact:true})).toBeVisible();await createBook('Studio journal');await openBook('Studio journal');await record('Create free-form note','An idea for a song');
  await page.reload();await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('An idea for a song');
  await modules();await types.getByRole('switch',{name:'Enable Arts & creative practice',exact:true}).check();
  await project();await createBook('Rehearsal sessions','Arts & creative practice');await openBook('Rehearsal sessions');await record('Create rehearsals & recordings','First rehearsal');
  const saved=(await f.workspace.read()).book,rehearsal=saved.entries.find(e=>e.title==='First rehearsal');expect(rehearsal.notebookId).toBe(saved.notebooks.find(n=>n.title==='Rehearsal sessions').id);expect(rehearsal.template.profileId).toBe('arts-creative');expect(saved.notebooks.every(n=>n.projectId===saved.projects[0].id)).toBe(true);
  await modules();await types.getByRole('switch',{name:'Enable Arts & creative practice',exact:true}).uncheck();
  await openBook('Rehearsal sessions');await main.getByRole('button',{name:'First rehearsal',exact:true}).click();await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('First rehearsal');
  await openBook('Studio journal');await record('Create free-form note','A second idea');
  await project();await main.getByRole('button',{name:'New lab book',exact:true}).click();await expect(dialog.getByRole('option',{name:'Arts & creative practice',exact:true})).toHaveCount(0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await modules();const persisted=page.waitForResponse(response=>response.url().endsWith('/api/dashboard/pending')&&response.request().method()==='POST'&&response.ok());await types.getByRole('switch',{name:'Enable Arts & creative practice',exact:true}).focus();await page.keyboard.press('Space');await expect(types.getByRole('switch',{name:'Enable Arts & creative practice',exact:true})).toBeChecked();
  expect((await (await persisted).json()).accepted.settings.enabledModules).toContain('laboratory-arts-creative');await page.reload();await expect(main.getByRole('switch',{name:'Enable Arts & creative practice',exact:true})).toBeChecked();
  await main.getByText('Lab-book templates',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('lab-book-types-desktop.png')});
  await page.setViewportSize({width:390,height:844});await main.getByText('Lab-book templates',{exact:true}).scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('lab-book-types-narrow.png')});
  expect((await f.workspace.read()).book.entries.map(e=>e.title)).toEqual(['An idea for a song','First rehearsal','A second idea']);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
