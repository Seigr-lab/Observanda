
import {test,expect} from '@playwright/test';
import os from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {navigate,preferences} from './preferences-helper.js';

test('people define their structure and every lab uses the same notebook and record tools',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(12000);
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-unified-structure-'));
 const ws=new Workspace(path.join(dir,'workspace')),book=sampleNotebook();
 book.title='Seigr';book.description='';book.projects=[];book.notebooks=[];book.entries=[];book.website.navigation=[];book.branding=[];book.website.layouts=[];
 await ws.create(book);
 const app=await startServer({root:ws.root,port:0,preferencesFile:path.join(dir,'preferences.json')});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const main=page.locator('main'),dialog=page.locator('#dialog');
 const click=(scope,name)=>scope.getByRole('button',{name,exact:true}).click();
 const location=async name=>{await navigate(page,'Projects');await main.locator('.project-card').filter({has:page.getByRole('button',{name,exact:true})}).getByRole('button',{name:'Open',exact:true}).click();};
 const addLocation=async(name,kind='Wing')=>{
  await main.getByRole('button',{name:/^New (sub)?project$/}).click();await dialog.getByLabel('Name',{exact:true}).fill(name);if(kind==='Project')await dialog.getByLabel('Project type',{exact:true}).selectOption('none');else{await dialog.getByLabel('Project type',{exact:true}).selectOption('custom');await dialog.getByLabel('Custom project type',{exact:true}).fill(kind);}
  await click(dialog,'Save project');await expect(dialog).not.toBeVisible();
 };
 const addNotebook=async(name,profiles)=>{
  await click(main,'New lab book');await dialog.getByLabel('Lab book name',{exact:true}).fill(name);
  if(profiles.length)await dialog.getByLabel('Lab-book template',{exact:true}).selectOption({label:profiles[0]});
  await click(dialog,'Save lab book');await expect(dialog).not.toBeVisible();
  if(profiles.length>1){
   await main.locator('.project-notebook').filter({has:page.getByRole('button',{name,exact:true})}).getByRole('button',{name:'Lab book settings',exact:true}).click();
   for(const label of profiles.slice(1))await dialog.getByLabel(label,{exact:true}).check();
   await click(dialog,'Save lab book');await expect(dialog).not.toBeVisible();
  }
 };
 try{
  await page.setViewportSize({width:1834,height:960});await page.goto(app.url);
  await navigate(page,'Preferences');await preferences(page,'Modules');
  for(const id of ['laboratory','laboratory-computer-it','laboratory-arts-creative','laboratory-environmental-agricultural','laboratory-research-development']){
   await page.locator('[data-desk-module="'+id+'"]').check();
   await page.waitForFunction(()=>!document.querySelector('#desk-save-state')?.textContent);
  }
  await expect(page.locator('#main-navigation [data-module-nav="laboratory"]')).toHaveCount(0);
  for(const [wing,notebook,profiles] of [
   ['Field Lab','IT investigations',['Computer / IT']],
   ['Nature Archive','Music practice',['Arts & creative practice']],
   ['Seigr insektsreservat','Biodiversity observations',['Environmental & agricultural']],
   ['Sound Studio','VST development',['Computer / IT','Research & development']]
  ]){
   await navigate(page,'Projects');await addLocation(wing);await addNotebook(notebook,profiles);
  }
  let saved=(await ws.read()).book;expect(saved.notebooks).toHaveLength(4);expect(saved.entries).toHaveLength(0);
  const arts=saved.notebooks.find(n=>n.title==='Music practice'),it=saved.notebooks.find(n=>n.title==='IT investigations');
  expect(it.configuration.profiles.map(p=>p.id)).toEqual(['computer-it']);
  await navigate(page,'Projects');
  await page.evaluate(()=>{document.querySelectorAll('.tree-project').forEach(n=>n.open=true);window.keptNodes=[...document.querySelectorAll('.tree-project')];});
  if(await page.getByRole('button',{name:'Dismiss',exact:true}).isVisible())await click(page,'Dismiss');
  await page.screenshot({path:path.join(dir,'structure.png')});
  await location('Nature Archive');await addLocation('EP One','Release');await addNotebook('Recording sessions',['Arts & creative practice']);
  await click(main,'Open lab book');await expect(main.getByRole('heading',{name:'Recording sessions',exact:true})).toBeVisible();
  await click(main,'New record');
  await click(dialog,'Create rehearsals & recordings');
  await page.getByLabel('Record title',{exact:true}).fill('First session');
  await page.getByLabel('Summary / context',{exact:true}).fill('An idea worth developing.');
  await expect(page.getByRole('button',{name:'Add figure',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Link research',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Add contributor',exact:true})).toBeVisible();
  await page.getByLabel('Session date',{exact:true}).fill('2026-09-28');
  await click(main,'Link research');
  await dialog.getByLabel('Look for',{exact:true}).selectOption('notebook');
  await dialog.getByLabel('Find in this workspace',{exact:true}).fill('IT investigations');
  await dialog.getByRole('button',{name:/IT investigations/}).click();
  await page.locator('.section-save [data-action="save"]').click();
  await expect(page.locator('#save-status')).toHaveText('Saved');
  saved=(await ws.read()).book;const record=saved.entries.find(e=>e.title==='First session');
  expect(record.template.profileId).toBe('arts-creative');expect(record.figures).toEqual([]);
  expect(record.template.values.sessionDate).toBe('2026-09-28');expect(record.relations[0].target.id).toBe(it.id);
  expect(await page.evaluate(()=>keptNodes.every(n=>n.isConnected&&n.open))).toBe(true);
  await page.reload();await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('First session');
  await click(main,'IT investigations');
  await expect(main.getByRole('heading',{name:'IT investigations',exact:true})).toBeVisible();
  await page.goBack();await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('First session');
  await click(main,'Back to records');await click(main,'Lab book settings');
  await dialog.getByLabel('Lab book name',{exact:true}).fill('Unsaved name');
  await click(dialog,'Cancel');await click(page.locator('#leave-dialog'),'Discard changes');
  await expect(dialog).not.toBeVisible();await expect(main.getByRole('heading',{name:'Recording sessions',exact:true})).toBeVisible();
  await location('Nature Archive');await expect(main.getByRole('button',{name:'First session',exact:true})).toBeVisible();
  await expect(main.getByRole('button',{name:'EP One',exact:true})).toBeVisible();
  await click(main,'All records here');
  await page.getByLabel('Filter by record type',{exact:true}).selectOption('note');
  await expect(main.getByRole('button',{name:'First session',exact:true})).toHaveCount(0);
  await page.getByLabel('Filter by record type',{exact:true}).selectOption('template:'+record.template.id);
  await expect(main.getByRole('button',{name:'First session',exact:true})).toBeVisible();
  await click(main,'New record');
  await expect(dialog.getByRole('button',{name:/Recording sessions/})).toBeVisible();
  await expect(dialog.getByRole('button',{name:/Music practice/})).toBeVisible();
  await click(dialog,'Cancel');
  await location('Field Lab');await expect(main.getByRole('button',{name:'First session',exact:true})).toHaveCount(0);
  await navigate(page,'Dashboard');await expect(page.locator('.desk-card').getByRole('button',{name:'First session',exact:true})).toBeVisible();
  await navigate(page,'Preferences');await preferences(page,'Modules');
  await page.locator('[data-module-preference="laboratory-arts-creative"]').getByRole('button',{name:/Record types/}).click();
  const settings=page.locator('[data-module-settings-slot]');
  await expect(settings).toContainText('Music practice');
  await settings.getByLabel('Record type name',{exact:true}).fill('Sound ideas');
  await click(settings,'Save changes');
  await expect(settings.locator('[data-type-status]')).toHaveText('No unsaved changes');
  await location('Nature Archive');await click(main,'Open lab book');await click(main,'New record');
  await expect(dialog.getByRole('button',{name:'Create sound ideas',exact:true})).toBeVisible();
  await click(dialog,'Cancel');
  await location('Nature Archive');await main.locator('.project-card').getByRole('button',{name:'Open',exact:true}).click();
  await click(main,'Open lab book');await click(main,'Lab book settings');
  await dialog.getByRole('button',{name:/Rehearsals & recordings/}).click();
  await page.screenshot({path:path.join(dir,'notebook-settings-desktop.png')});
  await dialog.getByLabel('Record type name',{exact:true}).fill('Recording session');
  await click(dialog,'Save lab book');await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'First session',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Rehearsals & recordings',exact:true})).toBeVisible();
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
  await dialog.getByLabel('Record type',{exact:true}).selectOption({label:'Recording session'});
  await dialog.getByLabel('Field label',{exact:true}).last().fill('Unsaved mobile label');
  await page.screenshot({path:path.join(dir,'notebook-fields-mobile.png')});
  await click(dialog,'Cancel');await click(page.locator('#leave-dialog'),'Discard changes');
  await page.setViewportSize({width:1834,height:960});
  await page.waitForFunction(()=>document.documentElement.dataset.contextNavigation==='open');
  await location('Nature Archive');
  if(await page.getByRole('button',{name:'Dismiss',exact:true}).isVisible())await click(page,'Dismiss');
  await page.screenshot({path:path.join(dir,'music-wing.png')});
  expect(errors).toEqual([]);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
