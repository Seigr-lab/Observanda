import {test,expect} from '@playwright/test';
import {workDirectory} from '../../scripts/work-directory.js';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {createNotebook} from '../../src/model.js';
import {workspaceModules} from '../../src/modules/index.js';
import {InventoryReader} from '../../src/modules/inventory-reader.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {startServer} from '../../src/server.js';
import {sessionRequest} from './session-fixture.js';

test('one inventory card compares chosen wings and items, retains exact quantities and saves every setting',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(12000);
 const directory=await mkdtemp(path.join(await workDirectory('test-work'),'dashboard-comparison-')),book=createNotebook('Seigr');
 const wing=name=>({id:randomUUID(),title:name,parentId:null,kind:'Wing',description:'',share:false,logoId:null,tools:['resources']});
 const a=wing('Field Lab'),b=wing('Sound Studio'),c=wing('Nature Archive');book.projects=[a,b,c];
 const {workspace:ws,deviceStore}=await encryptedFixture(directory,book),root=ws.root;const store=workspaceModules(ws);
 const cmd=(action,payload)=>store.execute({workspaceId:book.id,commandId:randomUUID(),action,payload});
 // A current workspace reads inventory through its reader, not as one module document.
 const reader=new InventoryReader(ws),revision=async id=>(await reader.stock({workspaceId:book.id,ids:[id]})).items[0].revision;
 const create=async(name,unit,quantity)=>{
  const id=randomUUID();await cmd('resource.create',{id,data:{projectId:null,placementId:null,name,code:'',kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit,capacity:1,status:'available',links:[]},openingStock:{quantity,projectId:null}});return id;
 };
 const opamps=await create('Op-amps','pieces','1000'),posters=await create('Posters','sheets','1000');
 for(const [to,quantity] of [[a.id,'100'],[b.id,'200']])await cmd('stock.transfer',{resourceId:opamps,expectedRevision:await revision(opamps),fromProjectId:null,toProjectId:to,quantity,reason:'Allocated',links:[]});
 await cmd('stock.reserve',{resourceId:opamps,expectedRevision:await revision(opamps),projectId:a.id,quantity:'20',reason:'Circuit work',links:[]});
 const settings=defaultDashboard(),preferencesFile=path.join(directory,'preferences.json');settings.enabledModules.push('resources');settings.views[0].panels=[];
 await writeWorkspaceDashboard(ws,settings,(await readWorkspaceDashboard(ws)).etag);
 const app=await startServer({root,port:0,preferencesFile,deviceStore}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const inspector=page.locator('.desk-inspector'),card=page.locator('.desk-card');
 const choice=(key,value)=>inspector.locator('[data-desk-option="'+key+'"][data-desk-choice="'+value+'"]');
 // Item choices on a current workspace are owner-qualified keys (src/module-dashboard-collection.js:27).
 const item=id=>book.id+'/'+id;
 // Cards are added from the data library inside the "Customize dashboard" disclosure.
 async function openLibrary(){
  const details=page.locator('details[data-disclosure="dashboard-customization"]');
  if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
  const open=page.getByRole('button',{name:'+ Add cards',exact:true});
  if(await open.getAttribute('aria-expanded')!=='true')await open.click();
  await expect(page.locator('.desk-library')).toBeVisible();
 }
 try{
  await page.setViewportSize({width:1834,height:1000});
  await page.goto(app.url);
  await openLibrary();
  await page.locator('.desk-library').getByLabel('Show',{exact:true}).selectOption('resources');
  await page.locator('.desk-library [data-action="dashboard-add"]').first().click();
  await expect(card).toHaveCount(1);
  await page.getByRole('button',{name:'Settings for Inventory',exact:true}).click();
  await expect(inspector.getByLabel('Location',{exact:true})).toHaveCount(0);
  await inspector.getByLabel('Presentation',{exact:true}).selectOption('comparison');
  await inspector.getByLabel('Data from',{exact:true}).selectOption('selected');
  await inspector.getByLabel('Include workspace-level data',{exact:true}).uncheck();
  await expect(card).toContainText('No items match this card');
  await choice('projectIds',a.id).check();await choice('projectIds',b.id).check();
  await inspector.getByLabel('Inventory items',{exact:true}).selectOption('selected');
  await choice('resourceIds',item(opamps)).check();
  await choice('comparisonMetrics','physical').check();
  await choice('comparisonMetrics','reserved').check();
  await inspector.getByRole('button',{name:'Layout',exact:true}).click();
  await inspector.getByLabel('Card width',{exact:true}).evaluate(el=>{el.value='12';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await inspector.getByRole('button',{name:'Display',exact:true}).click();
  await inspector.getByLabel('Card title',{exact:true}).fill('Op-amps across our wings');
  await inspector.getByLabel('Project axis label',{exact:true}).fill('Wing');
  await inspector.getByLabel('Quantity axis label',{exact:true}).fill('Op-amps (pieces)');
  await inspector.getByLabel('Available colour',{exact:true}).fill('#246688');
  await inspector.getByLabel('Chart text size',{exact:true}).fill('16');
  await inspector.getByRole('button',{name:'Close card settings',exact:true}).click();
  await card.locator('summary').filter({hasText:'Exact quantities'}).click();
  const table=card.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(3);
  await expect(table.getByRole('row').filter({hasText:'Field Lab'})).toHaveText(/Field Lab\s*100\s*20\s*80/);
  await expect(table.getByRole('row').filter({hasText:'Sound Studio'})).toHaveText(/Sound Studio\s*200\s*0\s*200/);
  await expect(card.locator('.figure-series-graphic')).toHaveCount(3);
  await expect(card.locator('.figure-bar')).toHaveCount(6);
  await expect(card.locator('.figure-series-graphic[data-series-name="Available"]')).toHaveAttribute('fill','#246688');
  await expect(card).not.toContainText('Posters');
  await expect.poll(async()=>((await readWorkspaceDashboard(ws)).settings.views[0].panels[0]?.options?.chartFontSize)).toBe(16);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(directory,'comparison-desktop.png')});
  await page.reload();await expect(card.getByRole('heading',{name:'Op-amps across our wings',exact:true})).toBeVisible();
  await expect(card.locator('.figure-bar')).toHaveCount(6);
  await page.getByRole('button',{name:'Settings for Op-amps across our wings',exact:true}).click();
  await expect(choice('projectIds',a.id)).toBeChecked();await expect(choice('projectIds',b.id)).toBeChecked();
  await expect(choice('projectIds',c.id)).not.toBeChecked();
  // Item choices list only items held in the card's chosen scope (src/web/modules/dashboard-collection.js:16,
  // src/module-dashboard-collection.js:35-36); Posters is held only centrally, so the chosen wings do not offer it.
  await expect(choice('resourceIds',item(opamps))).toBeChecked();await expect(choice('resourceIds',item(posters))).toHaveCount(0);
  // Empty and central-only scopes are deliberate selections, not a fallback to all projects.
  await choice('projectIds',a.id).uncheck();await choice('projectIds',b.id).uncheck();
  await expect(card).toContainText('No items match this card');
  await inspector.getByLabel('Include workspace-level data',{exact:true}).check();
  await expect(card.locator('.figure-bar')).toHaveCount(3);
  // Central stock offers Posters as a choice, still unchosen; the chosen item is kept.
  await expect(choice('resourceIds',item(posters))).not.toBeChecked();await expect(choice('resourceIds',item(opamps))).toBeChecked();
  await inspector.getByRole('button',{name:'Close card settings',exact:true}).click();
  await card.locator('summary').filter({hasText:'Exact quantities'}).click();
  await expect(table.getByRole('row').filter({hasText:path.basename(root)+' / Central stock'})).toHaveText(/700\s*0\s*700/);
  // Live data are refreshed after a stock change and returning to the dashboard.
  // The stock changes through the running app, as a user's change would; leaving for another page and
  // returning to the dashboard refreshes its live data (src/web/dashboard-ui.js:276), and the refresh keeps
  // the opened Exact quantities disclosure open (src/web/dashboard-ui.js:218-221).
  const contextRequest=page.waitForRequest(request=>Boolean(request.headers()['x-observanda-workspace']));
  await page.locator('#main-navigation').getByRole('button',{name:'Find work',exact:true}).click();await expect(page.locator('.desk-card')).toHaveCount(0);
  const moved=await sessionRequest(page,'post',app.url.replace(/[?#].*$/,'')+'api/modules/command',{data:{workspaceId:book.id,commandId:randomUUID(),action:'stock.move',payload:{resourceId:opamps,expectedRevision:await revision(opamps),projectId:null,delta:'-5',reason:'Used centrally',links:[]}},headers:{Origin:new URL(app.url).origin,'x-observanda-workspace':(await contextRequest).headers()['x-observanda-workspace']}});expect(moved.status()).toBe(200);
  await page.locator('#main-navigation').getByRole('button',{name:'Dashboard',exact:true}).click();
  await expect(card.locator('.figure-bar')).toHaveCount(3);
  await card.locator('summary').filter({hasText:'Exact quantities'}).click();
  await expect(table.getByRole('row').filter({hasText:path.basename(root)+' / Central stock'})).toHaveText(/695\s*0\s*695/);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Settings for Op-amps across our wings',exact:true}).click();
  await expect(inspector.getByLabel('Data from',{exact:true})).toHaveValue('selected');
  expect(await inspector.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(directory,'comparison-mobile-settings.png')});
  await inspector.getByRole('button',{name:'Close card settings',exact:true}).click();
  await expect.poll(()=>card.locator('.desk-inventory-plot').evaluate(n=>{const svg=n.querySelector('svg');return Math.abs(svg.viewBox.baseVal.width-n.clientWidth)<=1;})).toBe(true);
  await page.screenshot({path:path.join(directory,'comparison-mobile.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  // An individual item card can grow into a collection without re-creating it.
  await page.setViewportSize({width:1440,height:1000});
  await openLibrary();
  await page.locator('.desk-library').getByRole('combobox',{name:'Show',exact:true}).selectOption('resources');
  await page.locator('.desk-library [data-action="dashboard-add"]').filter({hasText:'Op-amps'}).click();
  await page.getByRole('button',{name:'Settings for Op-amps',exact:true}).click();
  await inspector.getByRole('button',{name:'Choose from the collection',exact:true}).click();
  await expect(page.getByRole('region',{name:'Inventory',exact:true}).locator('.desk-item')).toHaveCount(2);
  expect(errors).toEqual([]);
  expect((await reader.discover({workspaceId:book.id,type:'resource',limit:25})).total).toBe(2);
  expect((await ws.read()).book.entries).toHaveLength(0);
 }finally{await app.close();}
});
