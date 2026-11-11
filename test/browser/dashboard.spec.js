import {randomUUID} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {readPreferences,saveDashboard,dashboardSnapshot} from '../../src/preferences.js';
import {sampleNotebook} from '../../src/sample.js';
import {navigate,preferences} from './preferences-helper.js';

// The dashboard is the card desktop (src/web/dashboard-desktop.js, dashboard-ui.js).
// Layout edits save automatically; a plain workspace keeps them in the preferences
// file beside the workspace, never in its research.
let app,parent,root,file;
test.beforeEach(async({page})=>{
 parent=await mkdtemp(path.join(os.tmpdir(),'observanda-dashboard-ui-'));root=path.join(parent,'workspace');file=path.join(parent,'preferences.json');
 await new Workspace(root).create({...sampleNotebook(),title:'workspace'});
 app=await startServer({root,preferencesFile:file,port:0,headless:true});await page.goto(app.url);
 await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();await page.locator('.desk-desktop[data-placed]').waitFor();
});
test.afterEach(async()=>{await app.close();await rm(parent,{recursive:true,force:true});});

const research=()=>readFile(path.join(root,'observanda.json'),'utf8');
const saved=async()=>(await readPreferences(file)).dashboard;
const cards=page=>page.locator('.desk-desktop .desk-card');
const card=(page,name)=>page.locator('.desk-desktop').getByRole('region',{name,exact:true});
const status=page=>page.locator('#desk-save-state');
const inspector=page=>page.locator('.desk-inspector');
async function settled(page){await expect(status(page)).toHaveText('');}
async function views(page){
 const name=page.getByLabel('View name',{exact:true});
 if(!await name.isVisible())await page.getByRole('button',{name:'Views',exact:true}).click();
 await expect(name).toBeVisible();return name;
}
async function customize(page){
 const details=page.locator('details[data-disclosure="dashboard-customization"]');
 if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
}
async function library(page){
 await customize(page);const open=page.getByRole('button',{name:'+ Add cards',exact:true});
 if(await open.getAttribute('aria-expanded')!=='true')await open.click();
 const region=page.getByRole('region',{name:'Data library',exact:true});await expect(region).toBeVisible();return region;
}
async function addCard(page,label,category='collections'){
 const region=await library(page);await region.getByLabel('Show',{exact:true}).selectOption(category);
 await region.locator('.desk-library-item').filter({has:page.locator('strong').getByText(label,{exact:true})}).locator('[data-action="dashboard-add"]').click();
 await expect(region).toHaveCount(0);
}
async function settings(page,title,tab='Content'){
 // The settings button toggles; it is pressed only when this card's settings are not already open.
 const open=page.getByRole('button',{name:'Settings for '+title,exact:true});
 if(await open.getAttribute('aria-expanded')!=='true')await open.click();
 await expect(inspector(page)).toBeVisible();await expect(inspector(page).locator('h2')).toHaveText(title);
 await inspector(page).getByRole('button',{name:tab,exact:true}).click();await expect(inspector(page).getByRole('button',{name:tab,exact:true})).toHaveAttribute('aria-pressed','true');
 return inspector(page);
}
const fits=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

test('dashboard opens real work; view settings save on this computer, survive leaving and reload, and never touch research',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.locator('.topbar [data-action=save]')).toHaveCount(0);
 const before=await research();
 await card(page,'Recent records').getByRole('button',{name:'Watching a seed unfold',exact:true}).click();
 await expect(page.getByLabel('Record title',{exact:true})).toHaveValue('Watching a seed unfold');
 await navigate(page,'Dashboard');
 await (await views(page)).fill('Audio fieldwork');
 // Leaving straight away flushes the pending automatic save.
 await navigate(page,'Preferences');await expect.poll(async()=>(await saved()).views[0].name).toBe('Audio fieldwork');
 expect(await research()).toBe(before);
 await page.reload();await expect(page.locator('.preferences-heading')).toBeVisible();await navigate(page,'Dashboard');
 await expect(await views(page)).toHaveValue('Audio fieldwork');await settled(page);expect(errors).toEqual([]);
});

test('named views and the default view survive restart; a closed card keeps its settings until restored',async({page})=>{
 await views(page);await page.getByRole('button',{name:'New view',exact:true}).click();
 await (await views(page)).fill('Kitchen journal');await page.getByLabel('Default view',{exact:true}).check();
 await expect(cards(page)).toHaveCount(0);
 await addCard(page,'Recent records');await addCard(page,'Media collection');await expect(cards(page)).toHaveCount(2);
 const layout=await settings(page,'Recent records','Layout');await layout.getByRole('slider',{name:'Card width',exact:true}).press('End');
 const content=await settings(page,'Recent records','Content');await content.getByLabel('Items per page',{exact:true}).fill('3');
 await page.getByRole('button',{name:'Close card settings',exact:true}).click();
 await page.getByRole('button',{name:'Close Media collection',exact:true}).click();await expect(cards(page)).toHaveCount(1);
 await settled(page);
 const value=await saved(),view=value.views.find(v=>v.id===value.defaultId),media=view.panels.find(p=>p.source?.provider==='media');
 expect(view.name).toBe('Kitchen journal');expect(media.hidden).toBe(true);
 expect(view.panels.find(p=>p.source?.provider==='records')).toMatchObject({width:12,count:3,hidden:false});
 await app.close();app=await startServer({root,preferencesFile:file,port:0,headless:true});await page.goto(app.url);
 await expect(page.locator('[data-desk-view]')).toHaveValue(value.defaultId);await expect(cards(page)).toHaveCount(1);
 await customize(page);await page.getByRole('button',{name:'Restore cards',exact:true}).click();
 const region=page.getByRole('region',{name:'Data library',exact:true});await expect(region.getByLabel('Show',{exact:true})).toHaveValue('closed');
 await region.locator('.desk-library-item').filter({has:page.locator('strong').getByText('Media collection',{exact:true})}).locator('[data-action="dashboard-add"]').click();
 await expect(cards(page)).toHaveCount(2);await settled(page);
 const restored=(await saved()).views.find(v=>v.id===value.defaultId).panels;
 expect(restored.find(p=>p.id===media.id)).toMatchObject({hidden:false,width:media.width,count:media.count});
});

test('card order supports real mouse dragging, keyboard cancellation and explicit keyboard placement',async({page})=>{
 const headings=()=>cards(page).locator('h2').allTextContents();
 expect(await headings()).toEqual(['Recent records','Projects']);
 const handle=page.getByRole('button',{name:'Move Recent records',exact:true});await handle.scrollIntoViewIfNeeded();
 const from=await handle.boundingBox(),to=await card(page,'Projects').boundingBox();
 await page.mouse.move(from.x+15,from.y+15);await page.mouse.down();await page.mouse.move(to.x+to.width/2,to.y+to.height*0.8,{steps:8});await page.mouse.up();
 await expect.poll(headings).toEqual(['Projects','Recent records']);
 const projects=page.getByRole('button',{name:'Move Projects',exact:true});
 await projects.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
 await expect(page.locator('#desk-move-status')).toHaveText('Move cancelled.');expect(await headings()).toEqual(['Projects','Recent records']);
 await projects.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
 await expect.poll(headings).toEqual(['Recent records','Projects']);
 await expect(page.getByRole('button',{name:'Move Projects',exact:true})).toBeFocused();
 await page.keyboard.press('Space');for(let i=0;i<12;i++)await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
 await settled(page);const panels=(await saved()).views[0].panels;
 expect(panels.map(p=>p.id)).toEqual(['recent','collections']);expect(panels[1].column).toBe(0);
 await page.reload();await page.locator('.desk-desktop[data-placed]').waitFor();expect(await headings()).toEqual(['Recent records','Projects']);
});

test('save errors and another window retain the draft; discarding loads the latest saved layout',async({page,context})=>{
 await (await views(page)).fill('First saved name');await settled(page);
 await page.context().route('**/api/dashboard',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Temporary disk failure'})}):route.continue());
 await (await views(page)).fill('My retained draft');
 await expect(status(page)).toHaveText('The settings could not be saved. Your pending changes are retained.');
 await expect(page.getByLabel('View name',{exact:true})).toHaveValue('My retained draft');expect((await saved()).views[0].name).toBe('First saved name');
 await page.context().unroute('**/api/dashboard');
 const other=await context.newPage();await other.goto(app.url);await expect(other.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
 await (await views(other)).fill('Saved in another window');await settled(other);expect((await saved()).views[0].name).toBe('Saved in another window');
 await page.locator('#desk-save-recovery').getByRole('button',{name:'Retry',exact:true}).click();
 await expect(status(page)).toHaveText('The saved settings changed in another session. Your pending changes are retained for review.');
 await expect(page.getByLabel('View name',{exact:true})).toHaveValue('My retained draft');expect((await saved()).views[0].name).toBe('Saved in another window');
 await page.getByRole('button',{name:'Discard pending changes',exact:true}).click();
 await expect(await views(page)).toHaveValue('Saved in another window');await settled(page);await other.close();
});

test('edits during an in-flight save are saved afterwards and a failing card stays within its card',async({page})=>{
 const names=[];let release;const wait=new Promise(resolve=>release=resolve);
 await page.context().route('**/api/dashboard',async route=>{if(route.request().method()==='POST'){names.push(JSON.parse(route.request().postData()).settings.views[0].name);if(names.length===1)await wait;}await route.continue();});
 await (await views(page)).fill('Submitted');await expect.poll(()=>names.length).toBe(1);
 await page.getByLabel('View name',{exact:true}).fill('Newer edit');await expect(status(page)).toHaveText('Saving…');release();
 await expect.poll(async()=>(await saved()).views[0].name).toBe('Newer edit');await settled(page);
 expect(names).toEqual(['Submitted','Newer edit']);await expect(page.getByLabel('View name',{exact:true})).toHaveValue('Newer edit');
 await page.context().unroute('**/api/dashboard');
 await navigate(page,'Preferences');await preferences(page,'Modules');await page.locator('[data-desk-module="laboratory"]').check();
 await expect.poll(async()=>(await saved()).enabledModules).toContain('laboratory');
 await navigate(page,'Dashboard');await addCard(page,'Sample analysis overview');
 const laboratory=card(page,'Sample analysis overview');await expect(laboratory).toContainText('Awaiting review');
 await expect.poll(async()=>(await saved()).views[0].panels.some(p=>p.source?.provider==='laboratory')).toBe(true);
 await page.context().route('**/api/laboratory/read/query',route=>route.fulfill({status:503,contentType:'application/json',body:'{"code":"IO"}'}));
 await page.reload();await expect(laboratory.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await expect(laboratory).not.toContainText('Awaiting review');
 await expect(card(page,'Recent records')).toContainText('Watching a seed unfold');await expect(card(page,'Projects')).toContainText('Patterns in the everyday');
 await page.context().unroute('**/api/laboratory/read/query');await laboratory.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(laboratory).toContainText('Awaiting review');
});

test('dashboard and preferences fit narrow screens and large text, without settings in the home header',async({page})=>{
 await page.screenshot({path:'.local/screenshots/dashboard-desktop.png',fullPage:true});
 await navigate(page,'Preferences');await preferences(page,'Modules');await page.screenshot({path:'.local/screenshots/dashboard-preferences.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');expect(await fits(page)).toBe(true);
 await page.screenshot({path:'.local/screenshots/dashboard-preferences-mobile.png',fullPage:true});
 await navigate(page,'Dashboard');await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();await expect(page.locator('.topbar')).not.toContainText('Save');expect(await fits(page)).toBe(true);
 await page.getByRole('button',{name:'Settings for Recent records',exact:true}).click();await expect(inspector(page)).toBeVisible();expect(await fits(page)).toBe(true);
});

test('touch dragging changes card order and touch cancellation leaves the order intact',async({page})=>{
 const headings=()=>cards(page).locator('h2').allTextContents(),cdp=await page.context().newCDPSession(page);
 async function touchMove(cancel){
  const handle=cards(page).first().locator('[data-desk-move]');await handle.scrollIntoViewIfNeeded();
  const from=await handle.boundingBox(),to=await cards(page).nth(1).boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x+15,y:from.y+15}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+40,y:from.y+30}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:to.x+to.width/2,y:to.y+to.height*0.8}]});
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
 }
 await touchMove(false);await expect.poll(headings).toEqual(['Projects','Recent records']);
 await touchMove(true);await expect(page.locator('#desk-move-status')).toHaveText('Move cancelled.');expect(await headings()).toEqual(['Projects','Recent records']);
 await settled(page);expect((await saved()).views[0].panels.map(p=>p.id)).toEqual(['collections','recent']);await cdp.detach();
});

test('section navigation keeps the workspace header and page origin stable without repeated section labels',async({page})=>{
 const header=page.locator('.topbar'),main=page.locator('main');
 const geometry=async()=>({height:(await header.boundingBox()).height,y:(await main.boundingBox()).y});const baseline=await geometry();
 for(const [name,heading] of [['Projects','Projects'],['Find work','All records'],['Tools','Tools']]){
  await navigate(page,name);await expect(main.getByRole('heading',{name:heading,exact:true})).toBeVisible();await expect(header).not.toContainText(heading);expect(await geometry()).toEqual(baseline);
 }
 await navigate(page,'Preferences');await expect(page.locator('.preferences-heading')).toBeVisible();await expect(header).not.toContainText('Preferences');expect(await geometry()).toEqual(baseline);
 await page.screenshot({path:'.local/screenshots/workspace-header-preferences.png',fullPage:true});
 await navigate(page,'Dashboard');await expect(header).not.toContainText('Dashboard');expect(await geometry()).toEqual(baseline);
});

test('two record cards keep independent saved filters, previews and creation context without modifying research',async({page})=>{
 const workspace=new Workspace(root),before=await workspace.read(),b=before.book,projectId=randomUUID(),notebookId=randomUUID();
 b.projects.push({id:projectId,title:'Kitchen',description:'Recipes',share:false,logoId:null});b.notebooks.push({id:notebookId,projectId,title:'Recipe trials'});
 b.entries.push({...structuredClone(b.entries[0]),id:randomUUID(),notebookId,title:'Soup trial',type:'note',status:'draft',tags:['recipe'],sections:[]});b.entries[0].status='completed';b.entries[0].tags=['garden'];
 await workspace.save(b,before.etag);await page.reload();await page.locator('.desk-desktop[data-placed]').waitFor();const original=await research();
 const first=await settings(page,'Recent records','Display');await first.getByLabel('Card title',{exact:true}).fill('Garden observations');
 await first.getByRole('button',{name:'Content',exact:true}).click();
 await first.getByLabel('Data from',{exact:true}).selectOption('selected');await first.getByRole('checkbox',{name:b.projects[0].title,exact:true}).check();
 await first.getByLabel('Lab books',{exact:true}).selectOption('selected');await first.getByRole('checkbox',{name:new RegExp('^'+b.notebooks[0].title+' / ')}).check();
 await first.getByLabel('Status',{exact:true}).selectOption('completed');await first.getByLabel('Tag',{exact:true}).fill('garden');
 await page.getByRole('button',{name:'Close card settings',exact:true}).click();
 await addCard(page,'Recent records');
 const second=await settings(page,'Recent records','Display');await second.getByLabel('Card title',{exact:true}).fill('Kitchen trials');
 await second.getByRole('button',{name:'Content',exact:true}).click();
 await second.getByLabel('Data from',{exact:true}).selectOption('selected');await second.getByRole('checkbox',{name:'Kitchen',exact:true}).check();
 await second.getByLabel('Lab books',{exact:true}).selectOption('selected');await second.getByRole('checkbox',{name:/^Recipe trials \/ /}).check();
 await page.getByRole('button',{name:'Close card settings',exact:true}).click();
 const garden=card(page,'Garden observations'),kitchen=card(page,'Kitchen trials');
 await expect(garden).toContainText('Watching a seed unfold');await expect(garden).not.toContainText('Soup trial');await expect(garden).not.toContainText('Listening to the room');
 await expect(kitchen).toContainText('Soup trial');await expect(kitchen).not.toContainText('Watching a seed unfold');
 await settled(page);await page.reload();await page.locator('.desk-desktop[data-placed]').waitFor();
 await expect(kitchen).toContainText('Soup trial');await expect(kitchen).not.toContainText('Watching a seed unfold');await expect(garden).toContainText('Watching a seed unfold');
 expect(await research()).toBe(original);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');expect(await fits(page)).toBe(true);
 await page.screenshot({path:'.local/screenshots/panel-filters-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='');
 // A card scoped to one lab book creates its new records there. Product gap: the records card's
 // "New record" action carries no lab book (src/web/research-data.js:72), so chooseEntry
 // (src/web/app.js:1099, 1275) opens the general destination chooser instead.
 await kitchen.getByRole('button',{name:'New record',exact:true}).click();
 await expect(page.locator('#dialog')).toContainText('New record in Recipe trials');await expect(page.locator('#entry-notebook')).toHaveValue(notebookId);
 await page.locator('#dialog').getByRole('button',{name:'Cancel',exact:true}).click();expect(await research()).toBe(original);
});

test('card search finds names and categories, keeps the layout draft, and never saves while searching',async({page})=>{
 const writes=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/api/dashboard'))writes.push(request.url());});
 const region=await library(page),find=region.getByRole('searchbox',{name:'Find data to display',exact:true});
 const row=label=>region.locator('.desk-library-item').filter({has:page.locator('strong').getByText(label,{exact:true})});
 await find.fill('media');await expect(row('Media collection')).toBeVisible();await expect(row('Recent records')).toHaveCount(0);
 await find.fill('no-such-card');await expect(region.getByText('No matching data. Try a different search or category.',{exact:true})).toBeVisible();
 await find.fill('');await region.getByLabel('Show',{exact:true}).selectOption('collections');await expect(row('Media collection')).toBeVisible();await expect(row('Recent records')).toBeVisible();
 await region.getByLabel('Show',{exact:true}).selectOption('closed');await expect(region.getByText('No matching data. Try a different search or category.',{exact:true})).toBeVisible();
 await expect(cards(page)).toHaveCount(2);expect(writes).toEqual([]);await expect(status(page)).toHaveText('');
});

test('card search also finds a card by its purpose',async({page})=>{
 // Product gap: discovery matches only the card name and its group (src/web/data-discovery.js:3),
 // so a recording search does not find the media card that holds audio and video.
 const region=await library(page);await region.getByRole('searchbox',{name:'Find data to display',exact:true}).fill('audio');
 await expect(region.locator('.desk-library-item').filter({has:page.locator('strong').getByText('Media collection',{exact:true})})).toBeVisible();
});

test('a card from another workspace stays unavailable until explicitly reassigned, including matching project IDs',async({page})=>{
 const b=(await new Workspace(root).read()).book,original=await research();
 const settingsValue=(await readPreferences(file)).dashboard,etag=dashboardSnapshot(settingsValue).etag;
 Object.assign(settingsValue.views[0].panels[0].config,{workspaceId:randomUUID(),projectId:b.projects[0].id,notebookId:b.notebooks[0].id});
 await saveDashboard(file,settingsValue,etag);await page.reload();const recent=card(page,'Recent records');
 await expect(recent).toContainText('Open the workspace this card belongs to to display its data.');await expect(recent).not.toContainText('Watching a seed unfold');await expect(recent.getByRole('button',{name:'New record',exact:true})).toHaveCount(0);
 const content=await settings(page,'Recent records','Content');const project=content.getByRole('checkbox',{name:b.projects[0].title,exact:true});
 // Matching project IDs alone do not make the card belong here: the user chooses the project again.
 await expect(project).toBeChecked();await project.uncheck();await project.check();
 await expect(recent).toContainText('Watching a seed unfold');await settled(page);
 expect((await saved()).views[0].panels[0].config.workspaceId).toBe(b.id);expect((await saved()).views[0].panels[0].options.projectIds).toEqual([b.projects[0].id]);
 expect(await research()).toBe(original);
});

test('cards resize with the keyboard or pointer, cancel a resize with Escape, move between columns, and persist independently of research',async({page})=>{
 const original=await research(),recent=card(page,'Recent records'),panel=async()=>(await saved()).views[0].panels.find(p=>p.id==='recent');
 const width=(await recent.boundingBox()).width,resize=page.getByRole('button',{name:'Resize Recent records',exact:true});
 await resize.focus();await page.keyboard.press('ArrowLeft');await expect.poll(async()=>(await recent.boundingBox()).width).toBeLessThan(width);
 await expect(page.getByRole('button',{name:'Resize Recent records',exact:true})).toBeFocused();await page.keyboard.press('ArrowDown');await settled(page);
 const keyed=await panel();expect(keyed.width).toBe(7);expect(keyed.height).toBeGreaterThan(0);
 let box=await page.getByRole('button',{name:'Resize Recent records',exact:true}).boundingBox();
 await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+12,box.y+132,{steps:8});await page.mouse.up();await settled(page);
 const dragged=await panel();expect(dragged.height).toBeGreaterThan(keyed.height+80);
 box=await page.getByRole('button',{name:'Resize Recent records',exact:true}).boundingBox();
 await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+60,box.y+90,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();
 await expect(page.locator('#desk-move-status')).toHaveText('Move cancelled.');await settled(page);expect(await panel()).toEqual(dragged);
 const move=page.getByRole('button',{name:'Move Recent records',exact:true});await move.focus();await page.keyboard.press('Space');for(let i=0;i<12;i++)await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
 await settled(page);expect((await panel()).column).toBe(1);
 await page.reload();await page.locator('.desk-desktop[data-placed]').waitFor();
 expect(await panel()).toMatchObject({width:7,height:dragged.height,column:1});await expect(recent).toHaveAttribute('data-height',String(dragged.height));await expect(recent).toHaveAttribute('data-column','1');
 await page.screenshot({path:'.local/screenshots/dashboard-spatial-layout.png'});expect(await research()).toBe(original);
 await page.getByRole('button',{name:'Resize Recent records',exact:true}).focus();await page.keyboard.press('Home');await settled(page);expect((await panel()).height).toBe(0);
});

test('duplicating a view preserves independent card configuration',async({page})=>{
 await views(page);await page.getByRole('button',{name:'Duplicate view',exact:true}).click();
 await expect(await views(page)).toHaveValue('Dashboard copy');await page.getByLabel('View name',{exact:true}).fill('A second view');
 const layout=await settings(page,'Recent records','Layout'),slider=layout.getByRole('slider',{name:'Card width',exact:true});
 await slider.press('Home');for(let i=0;i<3;i++)await slider.press('ArrowRight');await expect(slider).toHaveValue('6');
 await settled(page);const value=await saved();
 expect(value.views).toHaveLength(2);expect(value.views[1].name).toBe('A second view');expect(value.views[0].panels[0].width).toBe('wide');expect(value.views[1].panels[0].width).toBe(6);expect(value.views[1].panels[0].id).not.toBe(value.views[0].panels[0].id);
});
