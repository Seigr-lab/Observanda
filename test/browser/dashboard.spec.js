import {randomUUID} from 'node:crypto';
import {test,expect} from '@playwright/test';
import {mkdtemp,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {readPreferences,saveDashboard,dashboardSnapshot} from '../../src/preferences.js';
import {sampleNotebook} from '../../src/sample.js';
import {navigate,preferences} from './preferences-helper.js';
let app,root,file;
test.beforeEach(async({page})=>{const parent=await mkdtemp(path.join(os.tmpdir(),'observanda-dashboard-ui-'));root=path.join(parent,'book');file=path.join(parent,'preferences.json');await new Workspace(root).create(sampleNotebook());app=await startServer({root,preferencesFile:file,port:0});await page.goto(app.url);});
test.afterEach(async()=>app.close());
const panels=page=>page.locator('#dashboard-preview .dashboard-panel');
const controls=page=>page.locator('.dashboard-inspector');
const config=(page,name)=>page.getByRole('navigation',{name:'Dashboard configuration'}).getByRole('button',{name,exact:true}).click();
const panelTab=(page,name)=>page.getByRole('navigation',{name:'Panel tools'}).getByRole('button',{name,exact:true}).click();
async function choose(page,index=0,tab='Layout'){await config(page,'Panels');await panels(page).nth(index).getByRole('button',{name:'Configure',exact:true}).click();await panelTab(page,tab);return controls(page);}
async function add(page,name){await config(page,'Tools');await page.getByRole('button',{name:'Add '+name+' panel',exact:true}).click();}
async function enable(page,id){await config(page,'Tools');await page.locator('[data-dashboard-enable="'+id+'"]').check();}

const saved=async()=>JSON.parse(await readFile(file,'utf8').catch(()=>'{"dashboard":{"views":[{}]}}')).dashboard;

test('dashboard opens real work and preferences use dedicated routes with independent save and discard',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();await expect(page.locator('.topbar [data-action=save]')).toHaveCount(0);
 await page.getByRole('region',{name:'Recent records'}).getByRole('button',{name:/Watching a seed unfold/}).click();await expect(page.getByLabel('Record title')).toHaveValue('Watching a seed unfold');
 const before=await readFile(path.join(root,'observanda.json'),'utf8');await preferences(page,'Tools & dashboard');await expect(page).toHaveURL(/#\/preferences\/dashboard$/);
 await config(page,'Settings');await page.getByLabel('Dashboard name',{exact:true}).fill('Audio fieldwork');await navigate(page,'Dashboard');
 const guard=page.getByRole('dialog',{name:'Unsaved changes'});await expect(guard).toContainText('Dashboard preferences');await guard.getByRole('button',{name:'Stay here'}).click();await expect(page.getByLabel('Dashboard name',{exact:true})).toHaveValue('Audio fieldwork');
 await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(page.locator('#dashboard-save-status')).toHaveText('Saved on this computer');expect((await saved()).views[0].name).toBe('Audio fieldwork');expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(before);
 await config(page,'Settings');await page.getByLabel('Dashboard name',{exact:true}).fill('Mistake');await navigate(page,'Dashboard');await guard.getByRole('button',{name:'Discard changes'}).click();await expect(page.locator('.dashboard-heading')).toContainText('Audio fieldwork');
 await page.reload();await preferences(page,'Tools & dashboard');await config(page,'Settings');await expect(page.getByLabel('Dashboard name',{exact:true})).toHaveValue('Audio fieldwork');expect(errors).toEqual([]);
});

test('named dashboards, real panel previews and default selection survive restart; disabling retains layout',async({page})=>{
 await preferences(page,'Tools & dashboard');await config(page,'Settings');await page.getByRole('button',{name:'New dashboard',exact:true}).click();await config(page,'Settings');await page.getByLabel('Dashboard name',{exact:true}).fill('Kitchen journal');await page.getByLabel('Default dashboard',{exact:true}).check();
 await add(page,'Recent records');await add(page,'Media collection');await expect(panels(page)).toHaveCount(2);
 await choose(page,0);await controls(page).getByLabel('Width',{exact:true}).selectOption('full');await panelTab(page,'Content');await controls(page).getByLabel('Items',{exact:true}).fill('3');
 await config(page,'Tools');await page.locator('[data-dashboard-enable="media"]').uncheck();await config(page,'Panels');await expect(page.locator('#dashboard-preview .dashboard-panel')).toHaveCount(1);
 await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(page.locator('#dashboard-save-status')).toHaveText('Saved on this computer');const settings=await saved();expect(settings.views.find(v=>v.id===settings.defaultId).name).toBe('Kitchen journal');
 await app.close();app=await startServer({root,preferencesFile:file,port:0});await page.goto(app.url);await expect(page.locator('[data-dashboard-view]')).toHaveValue(settings.defaultId);await expect(page.locator('.dashboard-panel')).toHaveCount(1);
 await preferences(page,'Tools & dashboard');await enable(page,'media');await config(page,'Panels');await expect(panels(page)).toHaveCount(2);await expect(page.locator('#dashboard-preview .dashboard-panel')).toHaveCount(2);
});

test('panel order supports real mouse dragging, keyboard cancellation and explicit placement',async({page})=>{
 await preferences(page,'Tools & dashboard');const first=panels(page).first(),second=panels(page).nth(1);await first.locator('[data-reorder-handle]').evaluate(el=>el.scrollIntoView({block:'center'}));
 const from=await first.locator('[data-reorder-handle]').boundingBox(),to=await second.boundingBox();await page.mouse.move(from.x+15,from.y+15);await page.mouse.down();await page.mouse.move(to.x+70,to.y+40,{steps:8});await page.mouse.up();await expect(panels(page).first()).toContainText('Projects & notebooks');
 const handle=panels(page).first().locator('[data-reorder-handle]');await handle.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');await expect(panels(page).first()).toContainText('Projects & notebooks');
 await page.keyboard.press('Space');await page.keyboard.press('ArrowDown');await page.keyboard.press('Space');await expect(panels(page).first()).toContainText('Recent records');
 await choose(page,0);await page.getByRole('button',{name:'Move panel 1 down',exact:true}).click();await expect(panels(page).first()).toContainText('Projects & notebooks');await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(page.locator('#dashboard-save-status')).toHaveText('Saved on this computer');await page.reload();await expect(panels(page).first()).toContainText('Projects & notebooks');
});

test('save errors and concurrent tabs retain the draft; discard fetches the latest saved settings',async({page,context})=>{
 await preferences(page,'Tools & dashboard');await config(page,'Settings');await page.getByLabel('Dashboard name',{exact:true}).fill('My retained draft');await page.route('**/api/dashboard',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Temporary disk failure'})}):route.continue());
 await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(page.locator('#notice')).toContainText('Temporary disk failure');await expect(page.getByLabel('Dashboard name',{exact:true})).toHaveValue('My retained draft');await page.unroute('**/api/dashboard');
 const other=await context.newPage();await other.goto(app.origin);await preferences(other,'Tools & dashboard');await config(other,'Settings');await other.getByLabel('Dashboard name',{exact:true}).fill('Saved in another tab');await other.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(other.locator('#dashboard-save-status')).toHaveText('Saved on this computer');
 await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(page.locator('#notice')).toContainText('another tab');await expect(page.getByLabel('Dashboard name',{exact:true})).toHaveValue('My retained draft');await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(page.getByLabel('Dashboard name',{exact:true})).toHaveValue('Saved in another tab');await other.close();
});

test('edits during an in-flight dashboard save remain dirty and laboratory failures stay within their panel',async({page})=>{
 await preferences(page,'Tools & dashboard');await config(page,'Settings');await page.getByLabel('Dashboard name',{exact:true}).fill('Submitted');let release;const wait=new Promise(resolve=>release=resolve);await page.route('**/api/dashboard',async route=>{if(route.request().method()==='POST')await wait;await route.continue();});
 await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await config(page,'Settings');await page.getByLabel('Dashboard name',{exact:true}).fill('Newer edit');release();await expect(page.locator('#dashboard-save-status')).toHaveText('Unsaved dashboard changes');await expect.poll(async()=>(await saved()).views[0].name).toBe('Submitted');await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect.poll(async()=>(await saved()).views[0].name).toBe('Newer edit');
 await page.route('**/api/laboratory',route=>route.fulfill({status:503,contentType:'application/json',body:'{"code":"IO"}'}));await enable(page,'laboratory');await add(page,'Laboratory');await expect(page.locator('[data-dashboard-body="laboratory"]')).toContainText('could not be loaded');await expect(page.locator('#dashboard-preview')).toContainText('Watching a seed unfold');await page.unroute('**/api/laboratory');await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await navigate(page,'Dashboard');await page.getByRole('button',{name:'Retry',exact:true}).click();await expect(page.locator('[data-dashboard-body="laboratory"]')).toContainText('Awaiting review');
});

test('dashboard and preferences fit narrow screens and large text, without settings in the home header',async({page})=>{
 await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();await page.screenshot({path:'.local/screenshots/dashboard-desktop.png',fullPage:true});await preferences(page,'Tools & dashboard');await page.screenshot({path:'.local/screenshots/dashboard-preferences.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.local/screenshots/dashboard-preferences-mobile.png',fullPage:true});
 await navigate(page,'Dashboard');await expect(page.locator('.topbar')).not.toContainText('Save');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});


test('touch dragging changes panel order and touch cancellation leaves the draft order intact',async({page})=>{
 await preferences(page,'Tools & dashboard');const cdp=await page.context().newCDPSession(page);
 async function touchMove(cancel){
  const handle=panels(page).first().locator('[data-reorder-handle]');await handle.evaluate(el=>el.scrollIntoView({block:'center'}));
  const from=await handle.boundingBox(),to=await panels(page).nth(1).boundingBox();
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x+15,y:from.y+15}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:to.x+70,y:to.y+40}]});
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
 }
 await touchMove(false);await expect(panels(page).first()).toContainText('Projects & notebooks');
 await touchMove(true);await expect(panels(page).first()).toContainText('Projects & notebooks');await cdp.detach();
});


test('section navigation keeps the workspace header and page origin stable without repeated section labels',async({page})=>{
 await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();const header=page.locator('.topbar'),main=page.locator('main');
 const geometry=async()=>({height:(await header.boundingBox()).height,y:(await main.boundingBox()).y});const baseline=await geometry();
 for(const name of ['Projects','Publishing']){await page.locator('.sidebar').getByRole('button',{name,exact:true}).click();await expect(page.locator('main').getByRole('heading',{name,exact:true})).toBeVisible();await expect(header).not.toContainText(name);expect(await geometry()).toEqual(baseline);}
 await navigate(page,'Preferences');await expect(header).not.toContainText('Preferences');expect(await geometry()).toEqual(baseline);
 await page.screenshot({path:'.local/screenshots/workspace-header-preferences.png',fullPage:true});await preferences(page,'Tools & dashboard');await enable(page,'laboratory');await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await navigate(page,'Laboratory');await expect(page.locator('main h1')).toHaveText('Laboratory');await page.screenshot({path:'.local/screenshots/workspace-header-laboratory.png',fullPage:true});
});

test('two record panels keep independent saved filters, previews and creation context without modifying research',async({page})=>{
 const workspace=new Workspace(root),before=await workspace.read(),b=before.book,projectId=randomUUID(),notebookId=randomUUID();b.projects.push({id:projectId,title:'Kitchen',description:'Recipes',share:false,logoId:null});b.notebooks.push({id:notebookId,projectId,title:'Recipe trials'});
 b.entries.push({...structuredClone(b.entries[0]),id:randomUUID(),notebookId,title:'Soup trial',type:'note',status:'draft',tags:['recipe'],sections:[]});b.entries[0].status='completed';b.entries[0].tags=['garden'];await workspace.save(b,before.etag);await page.reload();const original=await readFile(path.join(root,'observanda.json'),'utf8');
 await preferences(page,'Tools & dashboard');const first=await choose(page,0,'Content');await first.getByLabel('Panel title',{exact:true}).fill('Garden observations');await first.getByLabel('Project',{exact:true}).selectOption(b.projects[0].id);await first.getByLabel('Lab book',{exact:true}).selectOption(b.notebooks[0].id);await panelTab(page,'Filters');await first.getByLabel('Record type',{exact:true}).selectOption('observation');await first.getByLabel('Status',{exact:true}).selectOption('completed');await first.getByLabel('Tag',{exact:true}).selectOption('garden');
 await add(page,'Recent records');const second=await choose(page,-1,'Content');await second.getByLabel('Panel title',{exact:true}).fill('Kitchen trials');await second.getByLabel('Project',{exact:true}).selectOption(projectId);await second.getByLabel('Lab book',{exact:true}).selectOption(notebookId);
 await expect(page.locator('#dashboard-preview').getByRole('region',{name:'Garden observations',exact:true})).toContainText('Watching a seed unfold');await expect(page.locator('#dashboard-preview').getByRole('region',{name:'Garden observations',exact:true})).not.toContainText('Soup trial');await expect(page.locator('#dashboard-preview').getByRole('region',{name:'Kitchen trials',exact:true})).toContainText('Soup trial');
 await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(page.locator('#dashboard-save-status')).toHaveText('Saved on this computer');await navigate(page,'Dashboard');await page.reload();const kitchen=page.getByRole('region',{name:'Kitchen trials',exact:true});await expect(kitchen).toContainText('Soup trial');await expect(kitchen).not.toContainText('Watching a seed unfold');expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(original);
 await kitchen.getByRole('button',{name:'New record',exact:true}).click();await expect(page.getByLabel('Save in notebook',{exact:true})).toHaveValue(notebookId);await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await preferences(page,'Tools & dashboard');await choose(page,-1,'Content');await controls(page).getByLabel('Project',{exact:true}).selectOption('');await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(controls(page).getByLabel('Project',{exact:true})).toHaveValue(projectId);
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'.local/screenshots/panel-filters-mobile.png',fullPage:true});
});

test('tool search finds purpose and category, preserves layout drafts, and does not save when searching',async({page})=>{
 await preferences(page,'Tools & dashboard');await config(page,'Settings');await page.getByLabel('Dashboard name',{exact:true}).fill('Unsaved arrangement');await config(page,'Tools');const find=page.getByLabel('Find a tool',{exact:true});await find.fill('audio');await expect(page.getByRole('button',{name:'Add Media collection panel',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Add Laboratory panel',exact:true})).toBeHidden();await find.fill('no-such-tool');await expect(page.getByText('No tools match this search.',{exact:true})).toBeVisible();await find.fill('publishing');await expect(page.getByRole('button',{name:'Add Website panel',exact:true})).toBeVisible();await config(page,'Settings');await expect(page.getByLabel('Dashboard name',{exact:true})).toHaveValue('Unsaved arrangement');await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(page.getByLabel('Dashboard name',{exact:true})).toHaveValue('My work');await config(page,'Tools');await find.fill('');await expect(page.locator('[data-tool-option]:visible')).toHaveCount(5);
});


test('a panel from another workspace stays unavailable until explicitly reassigned, including matching project IDs',async({page})=>{
 const b=(await new Workspace(root).read()).book,original=await readFile(path.join(root,'observanda.json'),'utf8');
 const settings=(await readPreferences(file)).dashboard,etag=dashboardSnapshot(settings).etag;
 Object.assign(settings.views[0].panels[0].config,{workspaceId:randomUUID(),projectId:b.projects[0].id,notebookId:b.notebooks[0].id});
 await saveDashboard(file,settings,etag);await page.reload();const recent=page.getByRole('region',{name:'Recent records',exact:true});
 await expect(recent).toContainText('This panel belongs to another workspace.');await expect(recent).not.toContainText('Watching a seed unfold');await expect(recent.getByRole('button',{name:'New record',exact:true})).toHaveCount(0);
 await preferences(page,'Tools & dashboard');const first=await choose(page,0,'Content');await expect(first.getByLabel('Project',{exact:true})).toHaveValue('unavailable');await expect(first.getByLabel('Lab book',{exact:true})).toBeDisabled();
 await first.getByLabel('Project',{exact:true}).selectOption(b.projects[0].id);await expect(first.getByLabel('Lab book',{exact:true})).toBeEnabled();await expect(first.getByLabel('Lab book',{exact:true})).toHaveValue('');
 await expect(page.locator('#dashboard-preview').getByRole('region',{name:'Recent records',exact:true})).toContainText('Watching a seed unfold');
 await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(page.locator('#dashboard-save-status')).toHaveText('Saved on this computer');
 expect((await saved()).views[0].panels[0].config).toMatchObject({workspaceId:b.id,projectId:b.projects[0].id,notebookId:null});expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(original);
});


test('dashboard canvas supports spatial dragging and keyboard or pointer resizing with independent persistence',async({page})=>{
 const original=await readFile(path.join(root,'observanda.json'),'utf8');await preferences(page,'Tools & dashboard');const canvas=page.locator('#dashboard-preview');
 const originalWidth=(await canvas.getByRole('region',{name:'Recent records',exact:true}).boundingBox()).width;let resize=canvas.getByRole('button',{name:'Resize Recent records',exact:true});await resize.focus();await page.keyboard.press('ArrowLeft');await expect(controls(page).getByLabel('Width',{exact:true})).toHaveValue('half');expect((await canvas.getByRole('region',{name:'Recent records',exact:true}).boundingBox()).width).toBeLessThan(originalWidth);await page.keyboard.press('ArrowDown');expect(Number(await controls(page).getByLabel('Minimum height',{exact:true}).inputValue())).toBeGreaterThanOrEqual(240);
 resize=canvas.getByRole('button',{name:'Resize Recent records',exact:true});await resize.scrollIntoViewIfNeeded();let box=await resize.boundingBox();await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+180,box.y+120,{steps:8});await page.mouse.up();expect(Number(await controls(page).getByLabel('Minimum height',{exact:true}).inputValue())).toBeGreaterThanOrEqual(340);
 const beforeCancel=await controls(page).getByLabel('Minimum height',{exact:true}).inputValue();resize=canvas.getByRole('button',{name:'Resize Recent records',exact:true});await resize.scrollIntoViewIfNeeded();box=await resize.boundingBox();await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+60,box.y+70,{steps:4});await page.keyboard.press('Escape');await page.mouse.up();await expect(controls(page).getByLabel('Minimum height',{exact:true})).toHaveValue(beforeCancel);
 const handle=canvas.getByRole('button',{name:'Move Recent records on canvas',exact:true});await handle.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowRight');await page.keyboard.press('Space');await expect(panels(page).first()).toContainText('Projects & notebooks');
 await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(page.locator('#dashboard-save-status')).toHaveText('Saved on this computer');await page.reload();await choose(page,-1);await expect(controls(page).getByLabel('Minimum height',{exact:true})).toHaveValue(beforeCancel);await page.screenshot({path:'.local/screenshots/dashboard-spatial-layout.png'});expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(original);
 await canvas.getByRole('button',{name:'Resize Recent records',exact:true}).focus();await page.keyboard.press('Home');await expect(controls(page).getByLabel('Minimum height',{exact:true})).toHaveValue('0');await page.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(controls(page).getByLabel('Minimum height',{exact:true})).toHaveValue(beforeCancel);
});


test('duplicating a dashboard preserves independent panel configuration',async({page})=>{
 await preferences(page,'Tools & dashboard');await config(page,'Settings');await page.getByRole('button',{name:'Duplicate dashboard',exact:true}).click();await expect(page.getByLabel('Dashboard name',{exact:true})).toHaveValue('My work copy');await config(page,'Settings');await page.getByLabel('Dashboard name',{exact:true}).fill('A second view');await choose(page,0);await controls(page).getByLabel('Width',{exact:true}).selectOption('half');await page.getByRole('button',{name:'Save dashboard',exact:true}).click();await expect(page.locator('#dashboard-save-status')).toHaveText('Saved on this computer');const value=await saved();expect(value.views).toHaveLength(2);expect(value.views[0].panels[0].width).toBe('wide');expect(value.views[1].panels[0].width).toBe('half');expect(value.views[1].panels[0].id).not.toBe(value.views[0].panels[0].id);
});
