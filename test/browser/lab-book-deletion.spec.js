import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {saveDashboard,dashboardSnapshot} from '../../src/preferences.js';

async function setup(page){
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-lab-book-deletion-'));
 const ws=new Workspace(path.join(dir,'workspace')),book=sampleNotebook();
 book.projects[0].tools=['resources'];
 book.notebooks.push({id:randomUUID(),projectId:book.projects[0].id,title:'Inventory'});
 await ws.create(book);
 const preferencesFile=path.join(dir,'preferences.json'),settings=defaultDashboard();settings.enabledModules.push('resources');
 await saveDashboard(preferencesFile,settings,dashboardSnapshot(defaultDashboard()).etag);
 const app=await startServer({root:ws.root,port:0,preferencesFile});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(app.url);
 await expect(page.locator('main h1')).toBeVisible();
 const projectURL=new URL('/#/projects/'+book.projects[0].id,app.url).href;
 await page.goto(projectURL);
 await expect(page.locator('main h1')).toHaveText(book.projects[0].title);
 return {dir,ws,book,app,errors,projectURL};
}
const click=(scope,name)=>scope.getByRole('button',{name,exact:true}).click();
const card=(page,name)=>page.locator('.project-notebook').filter({has:page.getByRole('button',{name,exact:true})});
const savedBooks=async ws=>(await ws.read()).book.notebooks;

test('empty lab books can be deleted without losing drafts on cancel or disturbing project tools',async({page})=>{
 test.setTimeout(60000);page.setDefaultTimeout(10000);
 const {dir,ws,book,app,errors}=await setup(page),dialog=page.locator('#dialog');
 try{
  await expect(page).toHaveTitle('Observanda');
  await page.evaluate(()=>{document.querySelectorAll('.tree-project').forEach(n=>n.open=true);window.keptProjects=[...document.querySelectorAll('.tree-project')];});
  await click(card(page,'Inventory'),'Lab book settings');
  await dialog.getByLabel('Lab book name',{exact:true}).fill('Unsaved name');
  await click(dialog,'Delete lab book');
  await expect(dialog).toContainText('This lab book is empty.');
  await expect(dialog.locator('strong')).toHaveText('Inventory');
  await click(dialog,'Cancel');
  await expect(dialog.getByLabel('Lab book name',{exact:true})).toHaveValue('Unsaved name');
  expect((await savedBooks(ws)).find(n=>n.id===book.notebooks[1].id).title).toBe('Inventory');
  await dialog.getByLabel('Lab book name',{exact:true}).fill('Inventory');
  await page.screenshot({path:path.join(dir,'settings-desktop.png')});
  await click(dialog,'Delete lab book');
  await page.screenshot({path:path.join(dir,'delete-empty-desktop.png')});
  await click(dialog,'Delete lab book');await expect(dialog).not.toBeVisible();
  await expect(card(page,'Inventory')).toHaveCount(0);
  expect((await savedBooks(ws)).map(n=>n.id)).toEqual([book.notebooks[0].id]);
  expect(await page.evaluate(()=>keptProjects.every(n=>n.isConnected&&n.open))).toBe(true);
  await expect(page.locator('#main-navigation .location-tool-link[data-module-id="resources"]')).toHaveCount(1);
  await page.reload();await expect(card(page,'Inventory')).toHaveCount(0);
  await click(page.locator('main'),'New lab book');await expect(dialog.getByRole('button',{name:'Delete lab book',exact:true})).toHaveCount(0);
  await click(dialog,'Cancel');
  expect(errors).toEqual([]);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});

test('populated lab books require a records decision, support moves, and can be deleted on mobile',async({page})=>{
 test.setTimeout(60000);page.setDefaultTimeout(10000);
 const {dir,ws,book,app,errors}=await setup(page),dialog=page.locator('#dialog'),source=book.notebooks[0],destination=book.notebooks[1];
 try{
  await click(card(page,source.title),'Lab book settings');await click(dialog,'Delete lab book');
  const disposition=dialog.getByLabel('What should happen to its records?',{exact:true});
  await expect(disposition).toHaveValue('');
  await click(dialog,'Delete lab book');await expect(dialog).toBeVisible();
  expect(await savedBooks(ws)).toHaveLength(2);
  await disposition.selectOption('move');
  await dialog.getByLabel('Destination lab book',{exact:true}).selectOption(destination.id);
  await page.screenshot({path:path.join(dir,'move-records-desktop.png')});
  await click(dialog,'Move records and delete lab book');await expect(dialog).not.toBeVisible();
  let current=(await ws.read()).book;
  expect(current.notebooks.map(n=>n.id)).toEqual([destination.id]);
  expect(current.entries.map(e=>e.id)).toEqual(book.entries.map(e=>e.id));
  expect(current.entries.every(e=>e.notebookId===destination.id)).toBe(true);
  await page.reload();await expect(card(page,destination.title)).toContainText('3 records');
  await page.setViewportSize({width:390,height:844});
  await click(card(page,destination.title),'Lab book settings');
  await expect(dialog.getByRole('button',{name:'Delete lab book',exact:true})).toBeVisible();
  expect(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
  await page.screenshot({path:path.join(dir,'settings-mobile.png')});
  await click(dialog,'Delete lab book');
  await expect(dialog.locator('option[value="move"]')).toHaveCount(0);
  await dialog.getByLabel('What should happen to its records?',{exact:true}).selectOption('delete');
  await expect(dialog).toContainText('all its records');
  expect(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth+1)).toBe(true);
  await page.screenshot({path:path.join(dir,'delete-records-mobile.png')});
  await click(dialog,'Cancel');await click(dialog,'Cancel');await expect(dialog).not.toBeVisible();
  expect((await ws.read()).book.entries).toHaveLength(3);
  await click(card(page,destination.title),'Lab book settings');await click(dialog,'Delete lab book');
  await dialog.getByLabel('What should happen to its records?',{exact:true}).selectOption('delete');
  await click(dialog,'Delete lab book');await expect(dialog).not.toBeVisible();
  await expect(page.locator('main')).toContainText('No records in this view');
  current=(await ws.read()).book;expect(current.notebooks).toEqual([]);expect(current.entries).toEqual([]);
  await expect(page.locator('main').getByRole('button',{name:'New lab book',exact:true})).toBeVisible();
  await page.reload();await expect(page.locator('.project-notebook')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
 }finally{await app.close();await rm(dir,{recursive:true,force:true});}
});
