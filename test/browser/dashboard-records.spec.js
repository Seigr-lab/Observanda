import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {RECORD_TYPES} from '../../src/web/record-types.js';
import {setRecordTitle} from './record-editing-helper.js';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {MediaStore} from '../../src/media.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {StructureCommands} from '../../src/structure-commands.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {defaultDashboard,createPanel} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {starterTemplate} from '../../src/web/project-templates.js';

async function fixture(page,{count=45,cards=null,prepare=async()=>{},decorate=()=>{}}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-dashboard-read-ui-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),notebookId:book.notebooks[i%book.notebooks.length].id,
  title:'Take '+i,updatedAt:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),tags:[i%2?'studio':'field'],share:false,body:'Original '+i,sections:[],figures:[],attachments:[],relations:[]}));
 book.entries[0].template={id:randomUUID(),profileId:null,label:'Retired material study',description:'Preserved on the original record',fields:[],values:{}};
 decorate(book);
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book),preferencesFile=path.join(directory,'preferences.json');
 await prepare(ws,vault,book);
 if(cards){const settings=defaultDashboard();settings.views[0].panels=cards;await writeWorkspaceDashboard(ws,settings,(await readWorkspaceDashboard(ws)).etag);}
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile}),requests=[],errors=[],bodies=[];
 const record=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return record.call(this,id,...args);};
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',r=>{if(r.url().includes('/api/workspace/read/')||r.url().includes('/dashboard-collection/'))requests.push({url:r.url(),data:r.postDataJSON()});});
 return {book,ws,app,requests,errors,bodies,async close(){ResearchCatalogue.prototype.record=record;await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}};
}
const card=(page,id)=>page.locator('[data-desk-card="'+id+'"]');

test('lab-book type and workspace-count cards stay on metadata and selected pages',async({page})=>{
 test.setTimeout(120000);
 const provider='laboratory-research-development-records',profile={...createPanel(provider,'profile'),moduleId:'laboratory-research-development',source:{provider,key:null}},info={...createPanel('workspace','info'),fields:['entries']};
 const f=await fixture(page,{count:650,decorate:book=>{
  book.notebooks[0].configuration=starterTemplate('research-development').configuration;
  book.entries.forEach((r,i)=>{r.template={id:randomUUID(),profileId:'research-development',label:'Study',description:'',fields:[],values:{}};});
 },prepare:async ws=>{const settings=defaultDashboard();settings.enabledModules.push('laboratory-research-development');settings.views[0].panels=[profile,info];await writeWorkspaceDashboard(ws,settings,(await readWorkspaceDashboard(ws)).etag);}});
 const original=ResearchCatalogue.prototype.read;
 try{
  ResearchCatalogue.prototype.read=()=>{throw Error('Full workspace for a lab-book type card');};
  await page.goto(f.app.url);await expect(card(page,'profile').locator('.desk-item')).toHaveCount(6);
  await expect(card(page,'info')).toContainText('650');await expect(card(page,'info')).toContainText('Record count');
  expect(f.requests.some(r=>r.url.endsWith('/page'))).toBe(false);expect(f.bodies.length).toBeLessThanOrEqual(6);
  const first=await card(page,'profile').locator('.desk-item').allTextContents();
  await card(page,'profile').locator('[data-action="dashboard-page-next"]').click();
  await expect.poll(()=>card(page,'profile').locator('.desk-item').allTextContents()).not.toEqual(first);
  expect(f.bodies.length).toBeLessThanOrEqual(12);expect(f.errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.read=original;await f.close();}
});

for(const count of [42,420])test('general and module preferences save metadata without loading '+count+' record bodies',async({page})=>{
 test.setTimeout(120000);
 const f=await fixture(page,{count,cards:[],decorate:book=>{book.notebooks[0].configuration=starterTemplate('research-development').configuration;}});
 try{
  await page.goto(f.app.url);await expect(page.locator('.desk-desktop')).toBeVisible();await page.evaluate(()=>location.hash='#/preferences/general');const main=page.locator('#main');
  await expect(main.getByLabel('Workspace name',{exact:true})).toBeVisible();
  await main.getByLabel('Workspace name',{exact:true}).fill('Research collective');
  await main.getByRole('button',{name:'Save workspace',exact:true}).click();await expect(main.locator('[data-workspace-status]')).toHaveText('Saved');
  await main.getByLabel('Workspace name',{exact:true}).fill('Discarded name');await main.getByRole('button',{name:'Discard changes',exact:true}).click();await expect(main.getByLabel('Workspace name',{exact:true})).toHaveValue('Research collective');
  await main.getByRole('button',{name:'Modules',exact:true}).click();
  const inventory=main.getByRole('switch',{name:'Enable Inventory',exact:true});if(!await inventory.isChecked())await inventory.check();
  await main.locator('[data-module-settings-id="resources"]').click();const tools=main.locator('[data-module-settings-slot="resources"]');
  await tools.locator('[data-tool-project="'+f.book.projects[0].id+'"]').check();await tools.getByRole('button',{name:'Save changes',exact:true}).click();await expect(tools.locator('[role="status"]')).toHaveText('Saved');
  await main.getByRole('button',{name:'Templates',exact:true}).click();
  const research=main.getByRole('switch',{name:'Enable Research & development',exact:true});if(!await research.isChecked())await research.check();
  await main.locator('[data-module-settings-id="laboratory-research-development"]').click();const types=main.locator('[data-module-settings-slot="laboratory-research-development"]');
  await types.getByLabel('Record type name',{exact:true}).fill('Research questions');
  await page.route('**/api/workspace/structure',route=>route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic settings interruption'}}),{times:1});
  await types.getByRole('button',{name:'Save changes',exact:true}).click();await expect(types.locator('[data-type-status]')).toHaveText('Synthetic settings interruption');await expect(types.getByLabel('Record type name',{exact:true})).toHaveValue('Research questions');
  await types.getByRole('button',{name:'Save changes',exact:true}).click();await expect(types.locator('[data-type-status]')).toHaveText('No unsaved changes');
  await page.reload();await main.locator('[data-module-settings-id="laboratory-research-development"]').click();await expect(types.getByLabel('Record type name',{exact:true})).toHaveValue('Research questions');
  await main.getByRole('button',{name:'General',exact:true}).click();await expect(main.getByLabel('Workspace name',{exact:true})).toHaveValue('Research collective');await page.goBack();await expect(main.getByRole('group',{name:'Lab-book templates',exact:true})).toBeVisible();
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.bodies).toHaveLength(0);expect(f.errors).toEqual([]);
  const saved=(await f.ws.read()).book;expect(saved.entries).toEqual(f.book.entries);expect(saved.projects[0].tools).toContain('resources');expect(saved.notebooks[0].configuration.sections[0].label).toBe('Research questions');
 }finally{await f.close();}
});

test('project pages keep accurate lab-book counts and scoped recent records without assembling the workspace',async({page})=>{
 test.setTimeout(90000);
 const f=await fixture(page,{count:420,cards:[],decorate:book=>{
  const parent=book.projects[0],child={...structuredClone(parent),id:randomUUID(),parentId:parent.id,title:'Field visits'},other={...structuredClone(parent),id:randomUUID(),title:'Studio'};
  book.projects.push(child,other);book.notebooks.push(...[child,other].map(p=>({...structuredClone(book.notebooks[0]),id:randomUUID(),projectId:p.id,title:p.title+' records'})));
  book.entries.forEach((record,i)=>{record.notebookId=book.notebooks[i%3].id;});
 }});let fail=true;
 try{
  await page.route('**/api/workspace/read/dashboard',route=>{if(fail){fail=false;return route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic project interruption'}});}return route.continue();});
  await page.goto(f.app.url);await page.evaluate(()=>location.hash='#/projects');
  await expect(page.locator('.project-card')).toHaveCount(2);for(const node of await page.locator('.project-card').all())await expect(node).toContainText('140 records');
  expect(f.bodies).toHaveLength(0);
  await page.locator('.project-card').filter({has:page.getByRole('button',{name:f.book.projects[0].title,exact:true})}).getByRole('button',{name:'Open',exact:true}).click();
  await expect(page.locator('#project-recent-records')).toContainText('Synthetic project interruption');await page.getByRole('button',{name:'Retry recent records',exact:true}).click();
  await expect(page.locator('#project-recent-records tbody tr')).toHaveCount(10);
  await expect(page.locator('.project-notebook')).toContainText('140 records');
  await expect(page.locator('#project-recent-records').getByRole('button',{name:'Take 418',exact:true})).toBeVisible();
  await expect(page.locator('#project-recent-records').getByRole('button',{name:'Take 419',exact:true})).toHaveCount(0);
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.bodies).toHaveLength(10);
  await page.locator('.project-card').getByRole('button',{name:'Open',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Field visits',exact:true})).toBeVisible();await expect(page.locator('#project-recent-records tbody tr')).toHaveCount(10);
  await expect(page.locator('#project-recent-records').getByRole('button',{name:'Take 418',exact:true})).toBeVisible();
  await expect(page.locator('#project-recent-records').getByRole('button',{name:'Take 417',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'All records here',exact:true}).click();await expect(page.locator('#record-count')).toHaveText('140');
  const before=f.bodies.length;await page.goBack();await expect(page.locator('#project-recent-records tbody tr')).toHaveCount(10);expect(f.bodies.length-before).toBe(10);
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('figure and media cards render retained content without loading the entire workspace',async({page})=>{
 test.setTimeout(60000);
 const f=await fixture(page,{count:12,cards:[createPanel('figures','plots'),createPanel('media','photos')],prepare:async(ws,vault,book)=>{
  const asset=await new MediaStore(ws.root,vault).import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="teal"/></svg>'),'image');
  const record=book.entries.at(-1),figure={...sampleNotebook().entries[0].figures[0],title:'Retained measurements'};
  await new ResearchRecords(ws,new MediaStore(ws.root,vault)).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,figures:[figure],attachments:[{...asset,caption:'Field image',alt:'A teal square',transcript:'',share:false}]}}]},{compact:true});
 }});
 try{
  await page.goto(f.app.url);
  await expect(card(page,'plots').getByRole('button',{name:'Retained measurements',exact:true})).toBeVisible();
  await expect(card(page,'plots').locator('.desk-figure svg')).toBeVisible();
  const image=card(page,'photos').getByRole('img',{name:'A teal square'});await expect(image).toBeVisible();await expect.poll(()=>image.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.bodies).toHaveLength(0);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('dashboard opens without loading every record, shows real lab-book counts, and opens saved editing in sections',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page,{count:420});
 try{
  await page.goto(f.app.url);const recent=card(page,'recent');
  await expect(recent.locator('.desk-item')).toHaveCount(6);
  await expect(recent.getByRole('button',{name:'Take 419',exact:true})).toBeVisible();
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toEqual([]);expect(f.bodies).toHaveLength(6);
  for(const n of f.book.notebooks){
   const node=page.locator('#workspace-navigation [data-action="filter-notebook"][data-id="'+n.id+'"]');
   await expect(node).toContainText(String(f.book.entries.filter(e=>e.notebookId===n.id).length));
  }
  await recent.getByRole('button',{name:'Next items',exact:true}).click();await expect(recent.getByRole('button',{name:'Take 413',exact:true})).toBeVisible();await expect(recent.locator('.desk-item')).toHaveCount(6);
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toEqual([]);expect(f.bodies).toHaveLength(12);
  await recent.getByRole('button',{name:'Previous items',exact:true}).click();await expect(recent.getByRole('button',{name:'Take 419',exact:true})).toBeVisible();
  await page.evaluate(()=>{window.dashboardNavigation=document.querySelector('#main-navigation');document.querySelector('.tree-project').open=true;});
  const bodiesBeforeOpen=f.bodies.length;
  await recent.getByRole('button',{name:'Take 419',exact:true}).click();
  await expect(page.locator('.record-reader h1')).toHaveText('Take 419');
  expect(await page.evaluate(()=>window.dashboardNavigation===document.querySelector('#main-navigation')&&document.querySelector('.tree-project').open)).toBe(true);
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toEqual([]);
  expect(f.requests.filter(r=>r.url.endsWith('/selection'))).toEqual([]);
  expect(f.bodies.slice(bodiesBeforeOpen)).toEqual([]);
  await setRecordTitle(page,'Reviewed take');const saved=(await f.ws.read()).book;
  expect(saved.entries).toHaveLength(420);expect(saved.entries.at(-1).title).toBe('Reviewed take');expect(saved.entries.slice(0,-1)).toEqual(f.book.entries.slice(0,-1));
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('record cards load independent filters, recover errors in place, and keep changed filters after reload',async({page})=>{
 test.setTimeout(90000);const field=createPanel('records','field'),studio=createPanel('records','studio');
 field.config.title='Field takes';field.options.tag='field';studio.config.title='Studio takes';studio.options.tag='studio';
 const f=await fixture(page,{cards:[field,studio]});let fail=true;
 try{
  await page.route('**/api/projects/dashboard-collection/records',route=>{
   if(fail&&route.request().postDataJSON().options.tag==='field'){fail=false;return route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic card interruption'}});}
   return route.continue();
  });
  await page.goto(f.app.url);await expect(card(page,'field')).toContainText('Synthetic card interruption');
  await expect(card(page,'studio').getByRole('button',{name:'Take 43',exact:true})).toBeVisible();
  await card(page,'field').getByRole('button',{name:'Retry',exact:true}).click();
  await expect(card(page,'field').getByRole('button',{name:'Take 44',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Settings for Field takes',exact:true}).click();
  const types=page.locator('.desk-inspector').getByLabel('Record type',{exact:true});
  await expect(types.locator('option').filter({hasText:'Retired material study'})).toHaveCount(1);
  await types.selectOption({label:'Retired material study'});
  await expect(card(page,'field').getByRole('button',{name:'Take 0',exact:true})).toBeVisible();
  await expect(card(page,'field').locator('.desk-item')).toHaveCount(1);
  await types.selectOption('all');
  await page.locator('.desk-inspector').getByLabel('Tag',{exact:true}).fill('studio');
  await expect(card(page,'field').getByRole('button',{name:'Take 43',exact:true})).toBeVisible();
  await expect(card(page,'field').getByRole('button',{name:'Take 44',exact:true})).toHaveCount(0);
  await page.locator('.desk-inspector').getByRole('button',{name:'Close card settings',exact:true}).click();
  await expect.poll(async()=>{const r=await page.request.get(f.app.origin+'/api/dashboard');return (await r.json()).settings.views[0].panels[0].options.tag;}).toBe('studio');
  await page.reload();await expect(card(page,'field').getByRole('button',{name:'Take 43',exact:true})).toBeVisible();
  await expect(card(page,'studio').getByRole('button',{name:'Take 43',exact:true})).toBeVisible();
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('arriving card data preserves a focused numeric field and its selected text',async({page})=>{
 const f=await fixture(page,{cards:[createPanel('records','takes')]});let release;
 try{
  await page.goto(f.app.url);await expect(card(page,'takes').locator('.desk-item')).toHaveCount(6);
  let received;const pending=new Promise(resolve=>received=resolve),held=new Promise(resolve=>release=resolve);
  await page.route('**/api/projects/dashboard-collection/records',async route=>{
   if(route.request().postDataJSON().limit===12){const response=await route.fetch();received();await held;await route.fulfill({response});}
   else await route.continue();
  });
  await card(page,'takes').getByRole('button',{name:/^Settings for /}).click();
  const count=page.locator('.desk-inspector').getByLabel('Items per page',{exact:true});
  await count.fill('12');await pending;await count.press('ControlOrMeta+A');const focused=await count.elementHandle();
  release();await expect(card(page,'takes').locator('.desk-item')).toHaveCount(12);
  expect(await focused.evaluate(el=>el.isConnected&&el===document.activeElement)).toBe(true);
  await count.press('9');await expect(count).toHaveValue('9');
  await expect(card(page,'takes').locator('.desk-item')).toHaveCount(9);
  await expect.poll(async()=>{const response=await page.request.get(f.app.origin+'/api/dashboard');return (await response.json()).settings.views[0].panels[0].count;}).toBe(9);
  await page.reload();await expect(card(page,'takes').locator('.desk-item')).toHaveCount(9);expect(f.errors).toEqual([]);
 }finally{release?.();await f.close();}
});

test('contributor cards read only their requested items without assembling research',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page,{cards:[createPanel('contributors','credits')]});
 try{
  await page.goto(f.app.url);await expect(card(page,'credits').locator('.desk-item')).toHaveCount(6);
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.bodies.length).toBeLessThanOrEqual(7);
  await expect(card(page,'credits')).not.toContainText('No items');expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('locking the metadata dashboard keeps device-access controls usable without loading protected records',async({page})=>{
 test.setTimeout(60000);const f=await fixture(page);
 try{
  await page.goto(f.app.url);await expect(card(page,'recent').locator('.desk-item')).toHaveCount(6);
  await page.getByRole('button',{name:'Lock workspace',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible();
  await page.locator('[data-action="security-identity"]').click();
  await expect(page.getByLabel('Public access request',{exact:true})).toBeVisible();
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toEqual([]);
  await page.getByRole('dialog').locator('[data-action="close-dialog"]').click();
  await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  await expect(card(page,'recent').locator('.desk-item')).toHaveCount(6);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('record lists query summaries, retain historical type choices, and open selected editing without full bodies',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page,{count:420,cards:[],decorate:book=>{book.entries[0].template.profileId='computer-it';}});
 try{
  await page.goto(f.app.url);await page.evaluate(()=>location.hash='#/records');await expect(page.locator('#record-count')).toHaveText('420');
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.bodies).toHaveLength(0);
  await page.getByText('Filters',{exact:true}).click();await page.getByLabel('Lab type',{exact:true}).selectOption('computer-it');await expect(page.locator('#record-count')).toHaveText('1');
  await page.getByLabel('Lab type',{exact:true}).selectOption('all');await expect(page.locator('#record-count')).toHaveText('420');
  await page.getByLabel('Filter by record type',{exact:true}).selectOption({label:'Retired material study'});await expect(page.locator('#record-count')).toHaveText('1');
  await page.getByRole('button',{name:'Take 0',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Take 0');
  await setRecordTitle(page,'Reviewed material study');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(page.getByRole('button',{name:'Reviewed material study',exact:true})).toBeVisible();
  f.requests.length=0;f.bodies.length=0;await page.reload();await expect(page.getByRole('button',{name:'Reviewed material study',exact:true})).toBeVisible();
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.bodies).toHaveLength(0);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('card paging replaces its visible items, retains keyboard focus and retries a lost page response',async({page},testInfo)=>{
 test.setTimeout(90000);const f=await fixture(page,{count:45,cards:[createPanel('contributors','credits')]});let fail=true;
 try{
  await page.route('**/api/projects/dashboard-collection/records',route=>{if(fail&&route.request().postDataJSON().cursor){fail=false;return route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic page interruption'}});}return route.continue();});
  await page.goto(f.app.url);const credits=card(page,'credits');await expect(credits.locator('.desk-item')).toHaveCount(6);await expect(credits).toContainText('Items 1–6 of 45');
  await credits.getByRole('button',{name:'Next items',exact:true}).focus();await page.keyboard.press('Enter');await expect(credits).toContainText('Synthetic page interruption');
  await credits.getByRole('button',{name:'Retry',exact:true}).click();await expect(credits).toContainText('Items 7–12 of 45');await expect(credits.locator('.desk-item')).toHaveCount(6);await expect(credits.getByRole('button',{name:'Next items',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(credits).toContainText('Items 13–18 of 45');
  fail=true;await credits.getByRole('button',{name:'Previous items',exact:true}).click();await expect(credits).toContainText('Synthetic page interruption');
  await credits.getByRole('button',{name:'Retry',exact:true}).click();await expect(credits).toContainText('Items 7–12 of 45');await expect(credits.getByRole('button',{name:'Previous items',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(credits).toContainText('Items 1–6 of 45');await expect(credits.getByRole('button',{name:'Previous items',exact:true})).toBeDisabled();await expect(credits.getByRole('button',{name:'Next items',exact:true})).toBeFocused();
  for(let first=7;first<=43;first+=6){await page.keyboard.press('Enter');await expect(credits).toContainText(`Items ${first}–${Math.min(first+5,45)} of 45`);}
  await expect(credits.locator('.desk-item')).toHaveCount(3);await expect(credits.getByRole('button',{name:'Next items',exact:true})).toBeDisabled();await expect(credits.getByRole('button',{name:'Previous items',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(credits).toContainText('Items 37–42 of 45');await expect(credits.locator('.desk-item')).toHaveCount(6);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');await credits.locator('.desk-card-pages').scrollIntoViewIfNeeded();expect(await credits.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:testInfo.outputPath('research-card-phone.png')});
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('record-type choices are on demand, bounded, searchable, scoped and retained across errors and reload',async({page},testInfo)=>{
 test.setTimeout(90000);
 const panel=createPanel('records','types'),f=await fixture(page,{count:65,cards:[panel],decorate:book=>{
  book.notebooks.push({...structuredClone(book.notebooks[0]),id:randomUUID(),title:'Other records'});
  book.entries.forEach((record,i)=>{record.notebookId=book.notebooks[i%2].id;record.template={id:randomUUID(),profileId:null,label:'Type '+String(i).padStart(2,'0'),description:'',fields:[],values:{}};});
  panel.options.recordType='template:'+book.entries[64].template.id;
 }});
 let fail=true,release,started;
 try{
  await page.route('**/api/projects/dashboard-collection/types',async route=>{
   if(fail){fail=false;return route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic type interruption'}});}
   if(route.request().postDataJSON().search==='delayed'){
    started?.();await new Promise(resolve=>{release=resolve;});
    try{await route.continue();}catch{}return;
   }
   return route.continue();
  });
  await page.goto(f.app.url);await expect(card(page,'types').getByRole('button',{name:'Take 64',exact:true})).toBeVisible();
  expect(f.requests.filter(r=>r.url.endsWith('/types'))).toHaveLength(0);
  const bodies=f.bodies.length;
  await page.getByRole('button',{name:'Settings for Recent records',exact:true}).click();
  const inspector=page.locator('.desk-inspector'),select=inspector.getByLabel('Record type',{exact:true}),status=inspector.locator('.desk-choice-status');
  await expect(status).toContainText('Choices could not be loaded');
  await expect(select).toHaveValue(panel.options.recordType);
  await inspector.getByRole('button',{name:'Retry choices',exact:true}).click();
  const total=65+RECORD_TYPES.length;
  await expect(status).toHaveText(`1–25 of ${total}`);await expect(select.locator('option:checked')).toHaveText('Type 64');
  await expect(inspector.getByLabel('Search record types',{exact:true})).toBeFocused();
  expect(await select.locator('option').count()).toBeLessThanOrEqual(27);
  await inspector.getByRole('button',{name:'Next choices',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(status).toHaveText(`26–50 of ${total}`);await expect(inspector.getByRole('button',{name:'Next choices',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(status).toHaveText(`51–75 of ${total}`);
  await page.keyboard.press('Enter');await expect(status).toHaveText(`76–${total} of ${total}`);
  await expect(inspector.getByRole('button',{name:'Previous choices',exact:true})).toBeFocused();
  await page.keyboard.press('Enter');await expect(status).toHaveText(`51–75 of ${total}`);
  expect(f.bodies.length).toBe(bodies);
  await inspector.getByLabel('Search record types',{exact:true}).fill('Type 44');await expect(status).toHaveText('1–1 of 1');
  await expect(select.locator('option:checked')).toHaveText('Type 64');
  await select.selectOption({label:'Type 44'});await expect(card(page,'types').getByRole('button',{name:'Take 44',exact:true})).toBeVisible();
  await inspector.getByLabel('Lab books',{exact:true}).selectOption('selected');
  await inspector.locator('[data-desk-option="notebookIds"][value="'+f.book.notebooks[1].id+'"]').check();
  await expect(select.locator('option:checked')).toHaveText('Unavailable in this scope');
  await expect(card(page,'types')).toContainText('No items match this card.');
  await inspector.getByLabel('Lab books',{exact:true}).selectOption('all');
  await expect(select.locator('option:checked')).toHaveText('Type 44');
  await expect.poll(async()=>{const response=await page.request.get(f.app.origin+'/api/dashboard');return (await response.json()).settings.views[0].panels[0].options.recordType;}).toBe('template:'+f.book.entries[44].template.id);
  await page.reload();await expect(card(page,'types').getByRole('button',{name:'Take 44',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Settings for Recent records',exact:true}).click();await expect(select.locator('option:checked')).toHaveText('Type 44');
  await page.setViewportSize({width:390,height:844});
  await select.scrollIntoViewIfNeeded();
  expect(await inspector.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('record-types-phone.png')});
  const waiting=new Promise(resolve=>{started=resolve;});
  await inspector.getByLabel('Search record types',{exact:true}).fill('delayed');await waiting;
  const aborted=page.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith('/dashboard-collection/types')});
  await inspector.getByRole('button',{name:'Close card settings',exact:true}).click();await aborted;release();release=null;
  await expect(inspector).toHaveCount(0);
  expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.errors).toEqual([]);
 }finally{release?.();await f.close();}
});

test('record type finder pages without accumulating options and saved views resolve retained type labels',async({page},testInfo)=>{
 test.setTimeout(90000);const f=await fixture(page,{count:65,cards:[],decorate:book=>{
  book.entries.forEach((record,i)=>{record.template={id:randomUUID(),profileId:null,label:'Type '+String(i).padStart(2,'0'),description:'',fields:[],values:{}};});
 }});
 let fail=false,release,started;
 try{
  await page.route('**/api/workspace/read/record-types',async route=>{
   const command=route.request().postDataJSON();
   if(fail){fail=false;return route.fulfill({status:503,json:{code:'DATABASE_UNAVAILABLE',message:'Synthetic discovery interruption'}});}
   if(command.search==='delayed'){started?.();await new Promise(resolve=>{release=resolve;});try{await route.continue();}catch{}return;}
   return route.continue();
  });
  await page.goto(f.app.url);await page.evaluate(()=>location.hash='#/records');await expect(page.locator('#record-count')).toHaveText('65');
  const select=page.getByLabel('Filter by record type',{exact:true});
  await expect(select.locator('option')).toHaveCount(26);
  await page.getByRole('button',{name:'Find record type',exact:true}).click();
  const total=65+RECORD_TYPES.length,dialog=page.getByRole('dialog',{name:'Choose a record type filter',exact:true}),modal=page.locator('#dialog');await expect(dialog.getByRole('status')).toHaveText(`1–25 of ${total}`);
  await dialog.getByRole('button',{name:'Next types',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog.getByRole('status')).toHaveText(`26–50 of ${total}`);await expect(dialog.getByRole('button',{name:'Next types',exact:true})).toBeFocused();
  await dialog.getByRole('button',{name:'Previous types',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(`1–25 of ${total}`);
  fail=true;await dialog.getByRole('button',{name:'Next types',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('could not be loaded');
  await dialog.getByRole('button',{name:'Retry record types',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(`26–50 of ${total}`);
  await dialog.getByRole('button',{name:'Next types',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(`51–75 of ${total}`);
  await expect(dialog.locator('.record-type-options button')).toHaveCount(25);
  await dialog.getByRole('button',{name:'Next types',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText(`76–${total} of ${total}`);
  await expect(dialog.locator('.record-type-options button')).toHaveCount(total-75);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath('record-type-finder-phone.png')});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.getByRole('button',{name:'Type 64',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('#record-count')).toHaveText('1');await expect(select.locator('option:checked')).toHaveText('Type 64');
  expect(await select.locator('option').count()).toBeLessThanOrEqual(27);expect(f.bodies).toHaveLength(0);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Saved views',exact:true}).click();await modal.getByRole('button',{name:'Save current view',exact:true}).click();
  await expect(modal.locator('[data-view-record-type]')).toHaveText('Type 64');
  await modal.getByLabel('View name',{exact:true}).fill('Last type');await modal.getByRole('button',{name:'Save view',exact:true}).click();await modal.getByRole('button',{name:'Close',exact:true}).click();
  await page.reload();await expect(page.locator('#record-count')).toHaveText('1');await expect(select.locator('option:checked')).toHaveText('Type 64');
  await page.getByRole('button',{name:'Find record type',exact:true}).click();await dialog.getByLabel('Search record types',{exact:true}).fill('Type 40');
  await expect(dialog.locator('.record-type-options button')).toHaveCount(1);await expect(dialog.getByRole('button',{name:'Type 40',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(select).toHaveValue('template:'+f.book.entries[64].template.id);
  await expect(page.getByRole('button',{name:'Find record type',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Find record type',exact:true}).click();
  const waiting=new Promise(resolve=>{started=resolve;});await dialog.getByLabel('Search record types',{exact:true}).fill('delayed');await waiting;
  const aborted=page.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith('/record-types')});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await aborted;release();release=null;
  expect(f.bodies).toHaveLength(0);
  // A refresh can advance the list's snapshot while the outline is unchanged.
  const original=f.book.entries[64],notebook=f.book.notebooks.find(n=>n.id===original.notebookId),{values,...schema}=original.template;void values;
  const configuration=structuredClone(notebook.configuration??{profiles:[],sections:[]});
  configuration.sections.push({...schema,key:'renamed-type',label:'Revised type label',enabled:true});
  await new StructureCommands(f.ws).execute('structure',{etag:await f.ws.catalogue(s=>s.head()),change:{kind:'notebook',value:{...notebook,configuration}},response:'outline'});
  const created={...original,id:randomUUID(),title:'New record after template rename',template:{...original.template,label:'Revised type label'}};
  await new ResearchRecords(f.ws,{}).save({workspaceId:f.book.id,changes:[{id:created.id,expectedRevision:null,record:created}]},{compact:true});
  f.bodies.length=0;
  await page.getByRole('button',{name:'Refresh records',exact:true}).click();
  await expect(select.locator('option:checked')).toHaveText('Revised type label');
  await page.getByRole('button',{name:'Saved views',exact:true}).click();await modal.getByRole('button',{name:'Edit',exact:true}).click();
  await expect(modal.locator('[data-view-record-type]')).toHaveText(['Revised type label','Revised type label']);
  await modal.getByRole('button',{name:'Back to saved views',exact:true}).click();await modal.getByRole('button',{name:'Close',exact:true}).click();
  expect(f.bodies).toHaveLength(0);expect(f.requests.filter(r=>r.url.endsWith('/page'))).toHaveLength(0);expect(f.errors).toEqual([]);
 }finally{release?.();await f.close();}
});
