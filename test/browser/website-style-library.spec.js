import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteStyleBook} from '../../src/website-style-book.js';
import {componentOperation} from '../../src/website-component-storage.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

async function servePublication(folder){
 const inventory=JSON.parse(await readFile(path.join(folder,'publication.json'),'utf8'));
 const files=new Set(inventory.files.map(f=>'/'+f.path));
 const types={'.ttf':'font/ttf','.css':'text/css','.html':'text/html'};
 const server=createServer(async(req,res)=>{
  if(!files.has(req.url)){res.writeHead(404).end();return;}
  try{res.setHeader('Content-Type',types[path.extname(req.url)]??'application/octet-stream');res.end(await readFile(path.join(folder,req.url.slice(1))));}
  catch{res.writeHead(500).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}
async function renderedFonts(page,selector){
 const cdp=await page.context().newCDPSession(page);
 try{
  await cdp.send('DOM.enable');await cdp.send('CSS.enable');
  const {root}=await cdp.send('DOM.getDocument'),{nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector});
  const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId});return fonts.filter(f=>f.glyphCount>0);
 }finally{await cdp.detach();}
}
test('author reusable typography, inspect a local override, publish a licensed font and verify the actual fallback after withdrawal with research offline',async({page,browser})=>{
 test.setTimeout(120000);
 page.setDefaultTimeout(12000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-styles-ui-')),folder=path.join(root,'published'),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app,reader,web;
 try{
  await mkdir(folder);fixture=await encryptedFixture(root,createNotebook('Field observations'));
  const store=new WebsiteFileStore(fixture.workspace),site=randomUUID();
  const html='<html lang="en"><head><title>Monitoring</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Monitor</h1><p>Run <em>duration</em> in seconds</p><p>Second reading</p></main></body></html>';
  await store.importFiles(site,{name:'Monitoring',files:new Map([['index.html',html],['style.css','body{font:15px sans-serif}']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/offline';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'prefs.json'),port:0});
  const clientErrors=[];page.on('pageerror',reason=>clientErrors.push(reason.stack??reason.message));
  const routes=[];page.on('request',r=>routes.push(new URL(r.url()).pathname));
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const button=name=>page.getByRole('button',{name,exact:true}),canvas=page.frameLocator('#website-files-canvas'),p=canvas.locator('p').first(),last=canvas.locator('p').last();
  const d=page.locator('dialog[data-style-library]'),inside=name=>d.getByRole('button',{name,exact:true}),field=k=>d.locator('[data-style-property="'+k+'"]');
  const open=async()=>{await button('Style library').click();await expect(d.getByRole('searchbox')).toBeEnabled();};
  const close=()=>inside('Close').click(),name=d.locator('[data-style-name]'),scope=d.getByRole('combobox',{name:'Apply to',exact:true});
  await expect(p).toBeVisible();await open();await d.locator('summary').filter({hasText:'Website fonts and redistribution rights'}).click();
  const bytes=await readFile(new URL('../../src/fonts/atkinson.ttf',import.meta.url));
  await d.locator('input[type=file]').setInputFiles({name:'field-face.ttf',mimeType:'font/ttf',buffer:bytes});
  await d.getByLabel('Public licence or attribution notice').fill('Redistribution notice for this fixture.');
  await d.getByLabel('I have permission').check();await inside('Save font and rights').click();
  await expect(d.locator('p[role=status]')).toContainText('Style library saved.');
  await inside('New style').click();await name.fill('Field report body');
  const option=field('font-family').locator('option[value^=custom-]');const font=await option.getAttribute('value');
  await field('font-family').selectOption(font);await field('font-size').fill('21');
  await d.getByLabel('Interaction or output').selectOption('print');await field('font-size').fill('12');
  await inside('Save style').click();await expect(inside('Assign style')).toBeEnabled();
  await scope.selectOption('site');await inside('Assign style').click();await expect(d.locator('p[role=status]')).toContainText('Style assignment saved.');await close();
  await expect(last).toHaveCSS('font-size','21px');
  await expect.poll(()=>last.evaluate(async(el)=>{const f=await el.ownerDocument.fonts.load('18px '+getComputedStyle(el).fontFamily.split(',')[0]);return f.filter(f=>f.status==='loaded').length;})).toBe(1);
  await p.click();
  const appearance=page.locator('[data-website-visual-inspector]');
  await expect(appearance.locator('[data-visual-scope]')).toHaveValue('section');
  await appearance.locator('[data-visual-property="font-size"]').fill('26');await appearance.getByRole('button',{name:'Apply styles',exact:true}).click();await expect(p).toHaveClass(/ow-visual-/);await expect(p).toHaveCSS('font-size','26px');
  await button('Save website').click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await p.click();await open();
  await d.locator('summary').filter({hasText:'Why does'}).click();await d.getByLabel('Inspect property').selectOption('font-size');await expect(d.locator('output')).toContainText('26px');
  await expect(d.locator('output')).toContainText('ow-visual-');
  await field('font-size').fill('23');await inside('Save style').click();await close();
  await expect(last).toHaveCSS('font-size','23px');await expect(p).toHaveCSS('font-size','26px');
  await p.click();await appearance.getByRole('button',{name:'Reset visual styles'}).click();await expect(p).toHaveCSS('font-size','23px');
  await button('Save website').click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await p.click();await open();await d.locator('summary').filter({hasText:'Why does'}).click();
  await d.getByLabel('Inspect property').selectOption('font-size');await expect(d.locator('output')).toContainText('23px · Field report body · Website');await close();
  const publish=async()=>{
   await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
   await button('Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();await button('Write reviewed files').click();
   await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  };
  await publish();web=await servePublication(folder);reader=await browser.newPage();await reader.goto(web.origin+'/index.html');
  await expect(reader.locator('p').last()).toHaveCSS('font-size','23px');
  await reader.evaluate(()=>document.fonts.ready);
  expect((await renderedFonts(reader,'p:last-child')).some(f=>f.isCustomFont&&f.familyName.includes('Atkinson'))).toBe(true);
  await reader.emulateMedia({media:'print'});await expect(reader.locator('p').last()).toHaveCSS('font-size','12px');
  await reader.emulateMedia({media:'screen'});
  await page.reload();await expect(p).toBeVisible();await open();await d.locator('summary').filter({hasText:'Website fonts and redistribution rights'}).click();
  await d.locator('details').filter({hasText:'Website fonts and redistribution rights'}).getByRole('combobox',{name:'Font family',exact:true}).selectOption(font);
  await d.getByLabel('I have permission').uncheck();await inside('Save font and rights').click();await expect(d.locator('p[role=status]')).toContainText('Style library saved.');await close();
  await publish();await web.close();web=await servePublication(folder);await reader.goto(web.origin+'/index.html');await reader.evaluate(()=>document.fonts.ready);
  const fallback=await renderedFonts(reader,'p:last-child');expect(fallback.length).toBeGreaterThan(0);expect(fallback.some(f=>f.isCustomFont)).toBe(false);
  expect((await readFile(path.join(folder,'publication.json'),'utf8')).includes(font)).toBe(false);
  expect(routes.filter(url=>url.includes('/research/'))).toEqual([]);
  expect(clientErrors).toEqual([]);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  await reader?.close();await web?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:10});}
 }
});

test('assign interaction styles to a control and a marked phrase, clear only part of the phrase and read the saved output',async({page,browser})=>{
 test.setTimeout(90000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-style-selection-')),folder=path.join(root,'output'),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app,reader,web;
 try{
  await mkdir(folder);fixture=await encryptedFixture(root,createNotebook('Assay'));
  const site=randomUUID(),store=new WebsiteFileStore(fixture.workspace);
  const html='<html lang="en"><head><title>Assay</title></head><body><main><p>Run <em>duration</em> in seconds</p><button type="button" id="method">Method</button></main></body></html>';
  await store.importFiles(site,{name:'Assay',files:new Map([['index.html',html],['style.css','']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/offline';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'prefs.json'),port:0});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const button=name=>page.getByRole('button',{name,exact:true}),canvas=page.frameLocator('#website-files-canvas'),p=canvas.locator('p'),method=canvas.locator('#method');
  const d=page.locator('dialog[data-style-library]'),inside=name=>d.getByRole('button',{name,exact:true}),scope=d.getByRole('combobox',{name:'Apply to',exact:true});
  const open=()=>button('Style library').click(),closed=()=>expect(d).toHaveCount(0);
  await expect(method).toBeVisible();await method.click();await open();
  await inside('New style').click();await d.locator('[data-style-name]').fill('Method states');
  await d.getByLabel('Style category').selectOption('color');
  for(const [state,color] of [['normal','#113355'],['hover','#227755'],['focus-visible','#993311'],['active','#774488'],['disabled','#666666']]){
   await d.getByLabel('Interaction or output').selectOption(state);await d.locator('[data-style-property="color"]').fill(color);
  }
  await inside('Save style').click();await scope.selectOption('element');await inside('Assign style').click();
  await expect(d.locator('p[role=status]')).toContainText('Style assignment saved.');await inside('Close').click();await closed();
  async function selectRange(start,end){
   await p.click();
   await p.evaluate((el,[start,end])=>{
    const doc=el.ownerDocument,walker=doc.createTreeWalker(el,4),nodes=[];
    for(let n=walker.nextNode();n;n=walker.nextNode())nodes.push(n);
    const point=at=>{for(const node of nodes){if(at<=node.length)return [node,at];at-=node.length;}throw Error('Missing text');};
    const range=doc.createRange();range.setStart(...point(start));range.setEnd(...point(end));
    const selected=doc.getSelection();selected.removeAllRanges();selected.addRange(range);
   },[start,end]);
   await expect(page.locator('[data-visual-scope] option[value="selection"]')).toBeEnabled();
  }
  await selectRange(1,11);await open();await scope.selectOption('text');await inside('Assign style').click();await closed();
  await expect(p.locator('span[class*="ow-token-"]')).toHaveText(['un ','duratio']);
  await expect(p.locator('em')).toHaveText('duration');
  await selectRange(2,3);await open();await d.locator('summary').filter({hasText:'Why does'}).click();
  await d.getByLabel('Inspect property').selectOption('color');await expect(d.locator('output')).toContainText('Method states · Selected text');
  await inside('Close').click();await closed();
  await selectRange(7,9);await open();await scope.selectOption('text');
  await inside('Clear this assignment').click();await closed();
  await expect(p.locator('span[class*="ow-token-"]')).toHaveText(['un ','dur','io']);
  await expect(p).toHaveText('Run duration in seconds');
  await button('Publish to folder').click();await page.getByLabel('Destination folder',{exact:true}).fill(folder);
  await button('Review file changes').click();await page.locator('[data-website-file-folder-confirm]').check();await button('Write reviewed files').click();
  await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible();
  web=await servePublication(folder);reader=await browser.newPage();await reader.goto(web.origin+'/index.html');
  const control=reader.locator('#method');
  await expect(control).toHaveCSS('color','rgb(17, 51, 85)');
  await control.hover();await expect(control).toHaveCSS('color','rgb(34, 119, 85)');
  await reader.mouse.down();await expect(control).toHaveCSS('color','rgb(119, 68, 136)');await reader.mouse.up();
  await reader.mouse.move(600,400);await reader.locator('body').click({position:{x:2,y:2}});
  await reader.keyboard.press('Tab');await expect(control).toBeFocused();await expect(control).toHaveCSS('color','rgb(153, 51, 17)');
  await control.evaluate(el=>{el.disabled=true;});await expect(control).toHaveCSS('color','rgb(102, 102, 102)');
  await expect(reader.locator('p em span')).toHaveText(['dur','io']);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  await reader?.close();await web?.close();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:10});}
 }
});

test('the ordinary inspector identifies the site, containing folder, page and linked component across navigation',async({page})=>{
 test.setTimeout(60000);
 const root=await mkdtemp(path.join(os.tmpdir(),'website-style-scopes-')),database=process.env.OBSERVANDA_DATABASE_URL;
 let fixture,app,releaseSheets;
 try{
  fixture=await encryptedFixture(root,createNotebook('Measurements'));const site=randomUUID(),store=new WebsiteFileStore(fixture.workspace);
  const address='analysis/result.html',html='<html><head><title>Report</title></head><body><main><h1>Report</h1><section><p>Observations</p></section></main></body></html>';
  let current=await store.importFiles(site,{name:'Measurements',files:new Map([['index.html',html],[address,html],['style.css','']])});
  const call=async options=>(current=await websiteStyleBook(store,site,{expectedRevision:current.site.revision,path:address,...options}));
  current=await componentOperation(store,'create',site,{path:address,expectedRevision:current.site.revision,name:'Method block',blockPath:'0/1'});
  const {items:[main]}=await componentOperation(store,'list',site,{path:address,expectedRevision:current.site.revision});
  for(const [scope,name,group,key,value] of [
   ['site','Report type','typography','font-size','19px'],['folder','Analysis ink','color','color','#112244'],
   ['page','Report width','layout','max-width','690px'],['component','Method inset','spacing','padding-inline','18px']
  ]){
   const tokenId=(await call({action:'create',name,group,rules:{normal:{[key]:value}}})).modifiedStyleId;
   await call({action:'assign',tokenId,group,scope,component:main.id});
  }
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/offline';
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'prefs.json'),port:0});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const d=page.locator('dialog[data-style-library]'),canvas=page.frameLocator('#website-files-canvas');
  const inspect=async checks=>{
   await page.getByRole('button',{name:'Style library',exact:true}).click();
   await d.locator('summary').filter({hasText:'Why does'}).click();
   for(const [key,scope] of checks){await d.getByLabel('Inspect property').selectOption(key);await expect(d.locator('output')).toContainText(scope);}
   await d.getByRole('button',{name:'Close',exact:true}).click();
  };
  await canvas.getByText('Observations',{exact:true}).click();await inspect([['font-size','Report type · Website']]);
  await canvas.locator('body').evaluate(el=>{
   const doc=el.ownerDocument,win=doc.defaultView,style=doc.createElement('style');style.dataset.observandaEditor='css';
   style.textContent=Array.from({length:2048},(_,i)=>'.unrelated-layout-'+i+' { '+(i%2?'font-size: 9px':'margin: 2px')+' }').join('\n');doc.head.append(style);
   win.unrelatedSelectorLookups=0;
   const closest=win.Element.prototype.closest;win.Element.prototype.closest=function(selector){
    if(selector.startsWith('.unrelated-layout-'))win.unrelatedSelectorLookups++;return closest.call(this,selector);
   };
  });
  await inspect([['font-size','Report type · Website']]);
  expect(await canvas.locator('body').evaluate(el=>el.ownerDocument.defaultView.unrelatedSelectorLookups)).toBe(0);
  const waiting=new Promise(resolve=>{releaseSheets=resolve;});let pendingRequests=0;
  // Browser routing cannot intercept a request already owned by the
  // authenticated service worker. Delay the ordinary HTTP response instead.
  const serve=app.server.listeners('request').at(-1);app.server.removeListener('request',serve);
  app.server.on('request',async(req,res)=>{
   if(req.url.includes('/website-styles/')){pendingRequests++;await waiting;}
   return serve.call(app.server,req,res);
  });
  await page.locator('[data-website-file-page]').selectOption(address);
  await canvas.locator('[data-website-instance]').click();
  await expect.poll(()=>pendingRequests).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Style library',exact:true}).click();
  await d.locator('summary').filter({hasText:'Why does'}).click();
  await d.getByLabel('Inspect property').selectOption('font-size');await expect(d.locator('output')).toContainText('Browser default');
  releaseSheets();await expect(d.locator('output')).toContainText('19px · Report type · Website');
  await d.getByRole('button',{name:'Close',exact:true}).click();
  await expect(canvas.locator('body')).toHaveCSS('font-size','19px');
  await expect(canvas.locator('[data-website-instance]')).toHaveCSS('padding-inline','18px');
  await canvas.locator('[data-website-instance]').click();
  await inspect([['font-size','Report type · Website'],['color','Analysis ink · Folder'],['padding-inline','Method inset · Reusable component']]);
  await page.reload();await page.locator('[data-website-file-page]').selectOption(address);
  await expect(canvas.locator('body')).toHaveCSS('max-width','690px');await inspect([['max-width','Report width · Page']]);
 }finally{
  if(database===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=database;
  releaseSheets?.();try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{await rm(root,{recursive:true,force:true,maxRetries:10});}
 }
});
