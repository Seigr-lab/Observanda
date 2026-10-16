import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {writeWorkspaceDashboard,readWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {workspaceModules} from '../../src/modules/index.js';
import {ModuleDrafts} from '../../src/modules/drafts.js';
import {navigate} from './preferences-helper.js';
import {setTimeout as delay} from 'node:timers/promises';

async function fixture(page,count){
 page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-outline-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Specimen '+String(i).padStart(3,'0'),body:'PRIVATE_ORIGINAL_'+i,share:false,relations:[],attachments:[],figures:[],sections:[]}));
 const f=await encryptedFixture(directory,book),settings=defaultDashboard();settings.views[0].panels=[];settings.enabledModules.push('scientific-calculator','stoichiometry','spreadsheet','chemical-import','resources','planning');
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),bodies=[],requests=[],errors=[],original=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=function(id,...args){bodies.push(id);return original.call(this,id,...args);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,data:r.postData()});});
 return {...f,app,book,bodies,requests,errors,async close(){ResearchCatalogue.prototype.record=original;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}

test('recovery pages preserve unfinished calculations, retry failed navigation and restore only the chosen checkpoint',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,42),main=page.locator('main'),drafts=new ModuleDrafts(f.workspace),ids=[],original=ResearchCatalogue.prototype.objectValue,loaded=[];
 try{
  for(let i=0;i<25;i++){
   const id=randomUUID();ids.push(id);await drafts.write({workspaceId:f.book.id,moduleId:'scientific-calculator',id,etag:null,drafts:[{id:randomUUID(),type:'calculation',expectedRevision:null,base:null,data:{name:'Recovered calculation '+i,links:[],engine:1,mode:'expression',angle:'rad',expression:'sqrt(4)',digits:'',fromBase:10,toBase:6}}]});
  }
  ResearchCatalogue.prototype.objectValue=function(id,...args){if(ids.some(item=>id==='metadata:.observanda/module-drafts/'+item+'.json'))loaded.push(id);return original.call(this,id,...args);};
  const lists=[];page.on('response',async response=>{if(new URL(response.url()).pathname==='/api/modules/drafts/list'&&response.ok())lists.push(await response.json());});
  await page.goto(f.app.url);await navigate(page,'Scientific calculator');await expect(main.locator('[data-recovery-item]')).toHaveCount(10);expect(loaded).toEqual([]);
  await main.getByRole('button',{name:'New calculation',exact:true}).click();await main.getByLabel('Name',{exact:true}).fill('My unfinished calculation');await main.getByLabel('Expressions (one per line)').fill('sqrt(9)');
  await main.getByRole('button',{name:'Next checkpoints',exact:true}).focus();await page.keyboard.press('Enter');await expect(main.locator('.module-recovery')).toContainText('Recovered calculation 14');await expect(main.getByRole('button',{name:'Next checkpoints',exact:true})).toBeFocused();
  await page.route('**/api/modules/drafts/list',route=>route.fulfill({status:503,json:{message:'Synthetic recovery interruption'}}),{times:1});
  await main.getByRole('button',{name:'Next checkpoints',exact:true}).click();await expect(main.getByRole('alert')).toContainText('Synthetic recovery interruption');await expect(main.locator('[data-recovery-item]')).toHaveCount(10);
  await main.getByRole('button',{name:'Retry recovery list',exact:true}).click();await expect(main.locator('[data-recovery-item]')).toHaveCount(5);await expect(main.getByRole('button',{name:'Next checkpoints',exact:true})).toBeDisabled();
  await expect(main.getByLabel('Name',{exact:true})).toHaveValue('My unfinished calculation');expect(loaded).toEqual([]);
  await main.getByRole('button',{name:'Previous checkpoints',exact:true}).click();await expect(main.locator('[data-recovery-item]')).toHaveCount(10);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  const selected=await main.locator('[data-recovery-item]').first().getAttribute('data-recovery-item');await main.getByRole('button',{name:'Restore draft',exact:true}).first().focus();await page.keyboard.press('Enter');
  await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Recovered calculation 14');await expect(main.locator('[data-recovery-item="'+selected+'"]')).toHaveCount(0);
  expect(loaded.length).toBeGreaterThan(0);expect(new Set(loaded)).toEqual(new Set(['metadata:.observanda/module-drafts/'+selected+'.json']));
  await main.locator('[data-recovery-item]').filter({hasText:'My unfinished calculation'}).getByRole('button',{name:'Restore draft',exact:true}).click();await expect(main.getByLabel('Expressions (one per line)')).toHaveValue('sqrt(9)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect(lists.length).toBeGreaterThan(3);expect(lists.every(p=>p.drafts.length<=10&&!JSON.stringify(p).includes('sqrt(4)'))).toBe(true);expect(f.errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.objectValue=original;await f.close();}
});
test('leaving an unfinished item keeps it open on a lost checkpoint reply and retries without duplicate drafts',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,42),main=page.locator('main');let lost=true,writes=0;
 try{
  await page.goto(f.app.url);await navigate(page,'Scientific calculator');await main.getByRole('button',{name:'New calculation',exact:true}).click();
  await page.route('**/api/modules/drafts/write',async route=>{
   const response=await route.fetch();expect(response.ok(),response.ok()?'':await response.text()).toBe(true);writes++;
   if(lost)await route.fulfill({status:503,json:{message:'Synthetic lost checkpoint reply'}});else await route.fulfill({response});
  });
  await main.getByLabel('Name',{exact:true}).fill('Unfinished protected calculation');await main.getByLabel('Expressions (one per line)').fill('sqrt(81)');
  await main.getByRole('button',{name:'Back to calculations',exact:true}).click();
  await expect(main.getByRole('alert')).toContainText('Your edits are still open');await expect(main.getByLabel('Expressions (one per line)')).toHaveValue('sqrt(81)');
  lost=false;await main.getByRole('button',{name:'Back to calculations',exact:true}).click();
  await expect(main.locator('[data-recovery-item]')).toHaveCount(1);await expect(main.locator('[data-module-form]')).toHaveCount(0);
  await page.reload();await expect(main.locator('[data-recovery-item]')).toHaveCount(1);
  await main.getByRole('button',{name:'Restore draft',exact:true}).click();await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Unfinished protected calculation');await expect(main.getByLabel('Expressions (one per line)')).toHaveValue('sqrt(81)');
  expect(writes).toBeGreaterThan(1);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('module history pages open one original, retain drafts and recover failed navigation',async({page})=>{
 test.setTimeout(120000);const f=await fixture(page,42),main=page.locator('main'),id=randomUUID(),modules=workspaceModules(f.workspace);
 const save=async revision=>{
  const command={workspaceId:f.book.id,commandId:randomUUID(),action:'calculation.save',payload:{id,expectedRevision:revision||null,data:{name:'Calculation revision '+(revision+1),links:[],engine:1,mode:'expression',angle:'rad',expression:'sqrt(4)',digits:'',fromBase:10,toBase:6}}};
  // This second writer can overlap the browser's automatic draft checkpoint.
  // Retry only lock contention, retaining the same idempotency key.
  for(let attempt=0;;attempt++)try{return await modules.execute(command);}catch(error){if(error.code!=='LOCKED'||attempt===9)throw error;await delay(100);}
 };
 try{
  for(let i=0;i<45;i++)await save(i);
  const lists=[];page.on('response',async response=>{const url=new URL(response.url());if(url.pathname==='/api/modules/history'&&!url.searchParams.has('revision')&&response.ok())lists.push(await response.json());});
  await page.goto(f.app.url);await navigate(page,'Scientific calculator');await main.getByRole('button',{name:'Open calculation',exact:true}).click();
  await main.getByLabel('Name',{exact:true}).fill('Unfinished local name');await main.getByRole('button',{name:'History',exact:true}).click();
  await expect(main.getByRole('button',{name:/^Open revision /})).toHaveCount(20);await expect(main.getByRole('button',{name:'Open revision 45',exact:true})).toBeVisible();
  await main.getByRole('button',{name:'Open revision 45',exact:true}).click();await expect(main.locator('.module-history pre')).toContainText('Calculation revision 45');
  await expect(main.locator('.module-history pre')).not.toContainText('Unfinished local name');await main.getByRole('button',{name:'Close revision',exact:true}).click();await expect(main.locator('.module-history pre')).toHaveCount(0);
  await main.getByRole('button',{name:'Next history page',exact:true}).click();await expect(main.getByRole('button',{name:'Open revision 25',exact:true})).toBeVisible();
  await page.route('**/api/modules/history?*',route=>route.fulfill({status:503,json:{message:'Synthetic history interruption'}}),{times:1});
  await main.getByRole('button',{name:'Next history page',exact:true}).click();await expect(main.getByRole('alert')).toContainText('Synthetic history interruption');
  await main.getByRole('button',{name:'Retry history',exact:true}).click();await expect(main.getByRole('button',{name:/^Open revision /})).toHaveCount(5);await expect(main.getByRole('button',{name:'Next history page',exact:true})).toBeDisabled();
  await save(45);await main.getByRole('button',{name:'Previous history page',exact:true}).click();await expect(main.getByText('New revisions are available. Refresh history to see them.',{exact:true})).toBeVisible();
  await main.getByRole('button',{name:'Refresh history',exact:true}).click();await expect(main.getByRole('button',{name:'Open revision 46',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');await main.getByRole('button',{name:'Open revision 46',exact:true}).focus();await page.keyboard.press('Enter');await expect(main.locator('.module-history pre')).toContainText('Calculation revision 46');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await main.getByRole('button',{name:'Details',exact:true}).click();await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Unfinished local name');
  expect(lists.length).toBeGreaterThan(3);expect(lists.every(p=>p.items.length<=20&&!JSON.stringify(p).includes('sqrt(4)'))).toBe(true);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
for(const count of [42,420])test('tools, linked inventory and planning retain no '+count+'-record corpus',async({page})=>{
 test.setTimeout(150000);const f=await fixture(page,count),main=page.locator('main'),dialog=page.locator('#dialog');
 try{
  await page.goto(f.app.url);await navigate(page,'Scientific calculator');await main.getByRole('button',{name:'New calculation',exact:true}).click();
  await main.getByLabel('Name',{exact:true}).fill('Retained calculation');await main.getByLabel('Expressions (one per line)').fill('sqrt(4)');await expect(main.locator('.tool-answer output')).toHaveText('2');
  await page.route('**/api/research/records/query',route=>route.fulfill({status:503,json:{message:'Synthetic search interruption'}}),{times:1});
  await main.getByRole('button',{name:'Link research',exact:true}).click();await expect(dialog.getByRole('alert')).toHaveText('Synthetic search interruption');
  await dialog.getByRole('button',{name:'Refresh results',exact:true}).click();await expect(dialog.locator('.research-link-targets li')).toHaveCount(25);
  await dialog.getByRole('button',{name:'Next results',exact:true}).click();await expect(dialog.locator('[data-target-status]')).toContainText('26');
  await dialog.getByLabel('Find in this workspace').fill('Specimen 030');await expect(dialog.locator('.research-link-targets li')).toHaveCount(1);
  await dialog.locator('[data-action="research-target-choose"]').focus();await page.keyboard.press('Enter');await expect(dialog).not.toBeVisible();
  await expect(main.locator('.module-link')).toContainText('Specimen 030');await expect(main.getByLabel('Expressions (one per line)')).toHaveValue('sqrt(4)');
  await page.route('**/api/modules/command*',route=>route.fulfill({status:503,json:{message:'Synthetic save interruption'}}),{times:1});
  await main.getByRole('button',{name:'Save calculation',exact:true}).click();await expect(main.getByRole('alert')).toContainText('Synthetic save interruption');
  await expect(main.locator('.module-link')).toContainText('Specimen 030');await main.getByRole('button',{name:'Save calculation',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  await page.route('**/api/workspace/read/labels',route=>route.fulfill({status:503,json:{message:'Synthetic title interruption'}}),{times:1});
  await page.reload();await expect(main.getByRole('alert')).toContainText('Synthetic title interruption');await main.getByRole('button',{name:'Retry record titles',exact:true}).click();await expect(main.locator('.module-link')).toContainText('Specimen 030');
  const saved=(await workspaceModules(f.workspace).read()).entities.find(e=>e.type==='calculation');expect(saved.data.links).toEqual([{workspaceId:f.book.id,type:'record',id:f.book.entries[30].id}]);
  for(const [name,create,label,value,save] of [['Spreadsheet','New spreadsheet','Name','Measurement table','Save spreadsheet'],['Chemical structures','New chemical import','Name','Editable structure','Save chemical import']]){
   await navigate(page,name);await main.getByRole('button',{name:create,exact:true}).click();await main.getByLabel(label,{exact:true}).fill(value);
   if(name==='Spreadsheet')await main.getByLabel('Cell A1',{exact:true}).fill('9007199254740993');else await main.getByLabel('Chemical source').fill('CCO');
   await main.getByRole('button',{name:save,exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  }
  await navigate(page,'Inventory');await main.getByRole('button',{name:'New item',exact:true}).click();await main.getByLabel('Item name',{exact:true}).fill('Bench instrument');
  await main.getByRole('button',{name:'Link research',exact:true}).click();await dialog.getByLabel('Look for').selectOption('notebook');await dialog.locator('[data-action="research-target-choose"]').first().click();
  await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.getByRole('heading',{name:'Placement',exact:true})).toBeVisible();
  await navigate(page,'Calendar & planning');await main.getByRole('button',{name:'Tasks',exact:true}).click();await main.getByRole('button',{name:'New task',exact:true}).click();await main.getByLabel('Task title',{exact:true}).fill('Inspect prototype');
  await main.getByRole('button',{name:'Link research',exact:true}).click();await dialog.getByLabel('Find in this workspace').fill('Specimen 031');await expect(dialog.locator('.research-link-targets li')).toHaveCount(1);await dialog.locator('[data-action="research-target-choose"]').click();
  await main.getByRole('button',{name:'Save task',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');await page.reload();await expect(main.locator('.module-link')).toContainText('Specimen 031');
  await main.getByRole('button',{name:'Link research',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');await expect(dialog.locator('.research-link-targets li')).toHaveCount(25);await page.screenshot({path:test.info().outputPath('module-research-phone.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.keyboard.press('Escape');
  expect(f.bodies).toEqual([]);expect(f.requests.filter(r=>r.path==='/api/workspace/read/page')).toEqual([]);expect(f.errors).toEqual([]);
  const sources=(await f.workspace.read()).book.entries;expect(sources).toEqual(f.book.entries);
 }finally{await f.close();}
});

test('module link searches discard late replies and retain an unfinished item on cancel',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page,42),main=page.locator('main'),dialog=page.locator('#dialog');
 try{
  await page.goto(f.app.url);await navigate(page,'Scientific calculator');await main.getByRole('button',{name:'New calculation',exact:true}).click();await main.getByLabel('Name',{exact:true}).fill('Unfinished calculation');
  let release,arrived;const held=new Promise(r=>release=r),received=new Promise(r=>arrived=r);
  await page.route('**/api/research/records/query',async route=>{const response=await route.fetch();arrived();await held;await route.fulfill({response}).catch(()=>{});},{times:1});
  await main.getByRole('button',{name:'Link research',exact:true}).click();await received;await dialog.getByLabel('Find in this workspace').fill('Specimen 041');await expect(dialog.locator('.research-link-targets li')).toHaveCount(1);release();await expect(dialog.locator('.research-link-targets li')).toHaveCount(1);await expect(dialog.locator('.research-link-targets')).toContainText('Specimen 041');
  await page.keyboard.press('Escape');await expect(main.getByLabel('Name',{exact:true})).toHaveValue('Unfinished calculation');expect(f.bodies).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('BOM research selection accepts a newly saved record without reading its original',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page,42),main=page.locator('main'),dialog=page.locator('#dialog');
 try{
  await page.goto(f.app.url);await navigate(page,'Inventory');await main.getByRole('button',{name:'Bills of materials',exact:true}).click();await main.getByRole('button',{name:'New BOM',exact:true}).click();
  await main.getByLabel('BOM title',{exact:true}).fill('Pinned component plan');
  const record={...structuredClone(f.book.entries[0]),id:randomUUID(),title:'New prototype'};
  const creation=await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:null,record}]},{compact:true,recordIds:[record.id]}),created=creation.book.entries.find(r=>r.id===record.id);f.bodies.length=0;
  await main.getByRole('button',{name:'Prototype / run record',exact:true}).click();await expect(dialog.getByLabel('Look for')).toBeHidden();
  await dialog.getByLabel('Find in this workspace').fill('New prototype');await expect(dialog.locator('.research-link-targets li')).toHaveCount(1);await dialog.locator('[data-action="research-target-choose"]').click();
  await expect(main.getByRole('button',{name:'Prototype / run record',exact:true})).toContainText(record.title);await expect(main.getByRole('button',{name:'Prototype / run record',exact:true})).toBeFocused();expect(f.bodies).toEqual([]);
  await main.getByRole('button',{name:'Add component',exact:true}).click();await main.getByLabel('Value / description',{exact:true}).fill('Optional capacitor');await main.getByLabel('Do not populate (DNP)',{exact:true}).check();
  await main.getByRole('button',{name:'Save BOM',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  const saved=(await workspaceModules(f.workspace).read()).entities.find(e=>e.type==='bom');expect(saved.data.recordId).toBe(record.id);expect(saved.data.recordRevision).toBe(recordRevision(created));expect(f.bodies).toEqual([]);
  await page.reload();await expect(main.getByRole('button',{name:'Prototype / run record',exact:true})).toContainText(record.title);expect(f.bodies).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('invalid and missing record labels retain saved module links and allow recovery',async({page})=>{
 test.setTimeout(90000);const f=await fixture(page,42),main=page.locator('main'),id=randomUUID(),record=f.book.entries[0],data={name:'Linked calculation',links:[{workspaceId:f.book.id,type:'record',id:record.id}],engine:1,mode:'expression',angle:'rad',expression:'2+2',digits:'',fromBase:10,toBase:6};
 try{
  await workspaceModules(f.workspace).execute({workspaceId:f.book.id,commandId:randomUUID(),action:'calculation.save',payload:{id,expectedRevision:null,data}});
  await page.route('**/api/workspace/read/labels',async route=>{const payload=route.request().postDataJSON();await route.fulfill({json:{workspaceId:payload.workspaceId,etag:payload.etag,records:[null],missing:[]}});},{times:1});
  await page.goto(f.app.url);await navigate(page,'Scientific calculator');await main.getByRole('button',{name:'Open calculation',exact:true}).click();
  await expect(main.getByRole('alert')).toContainText('The record labels were incomplete');await main.getByRole('button',{name:'Retry record titles',exact:true}).click();await expect(main.locator('.module-link')).toContainText(record.title);
  expect(f.bodies).toEqual([]);
  await new ResearchRecords(f.workspace,{}).remove({workspaceId:f.book.id,recordId:record.id,expectedRevision:recordRevision(record)});f.bodies.length=0;
  await page.reload();await expect(main.locator('.module-link')).toContainText('Record unavailable');await expect(main.locator('.module-link button')).toBeDisabled();
  await main.getByLabel('Name',{exact:true}).fill('Reference preserved');await main.getByRole('button',{name:'Save calculation',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  expect((await workspaceModules(f.workspace).read()).entities.find(e=>e.id===id).data.links).toEqual(data.links);expect(f.bodies).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
