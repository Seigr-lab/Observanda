import {test,expect,chromium} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,readdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sampleNotebook} from '../../src/sample.js';
import {websiteDesktopFixture} from './installed-website-app.js';
import {createWebsiteWorkspace,selectEntry,disableWebsiteResearch} from './website-workspace-fixture.js';
import {selectLine} from './website-authoring-journey.js';
import {createFigure} from '../../src/web/figure-model.js';
import {defaultPublicationPrivacy} from '../../src/web/record-publication-privacy.js';

async function addInstrumentPlates(page){
 const add=page.locator('[data-action="website-files-new-page"]'),tools=add.locator('xpath=ancestor::details[1]');
 if(!await add.isVisible())await tools.locator('summary').click();
 await add.click();await page.getByLabel('Page title',{exact:true}).fill('Instrument plates');
 await page.getByLabel('Page file name',{exact:true}).fill('atlas/plates.html');
 await page.locator('[data-website-files-form] button[type=submit]').click();
 await page.locator('[data-website-file-block]').selectOption('feed');await page.getByRole('button',{name:'Insert element',exact:true}).click();
 const dialog=page.locator('dialog[data-website-feed-dialog]');
 await dialog.locator('[data-feed-heading]').fill('Public instrument traces');
 await dialog.getByRole('radio',{name:'Matching search'}).check();
 await dialog.locator('[data-feed-criterion="filter"]').selectOption('media');
 await dialog.getByRole('radio',{name:'Custom design'}).check();
 await dialog.getByText('Arrange fields',{exact:true}).click();
 await dialog.locator('[data-feed-field="content"]').uncheck();await dialog.locator('[data-feed-field="figures"]').check();
 await dialog.getByLabel('Layout of figures within each entry').selectOption('grid');
 await dialog.locator('[data-feed-apply]').click();
 await expect(dialog).toHaveCount(0);
}

async function submitLabChanges(page,source,next){
 await page.evaluate(async({source,next})=>{
  const {prefix,context,workspaceId,recordId,sections}=source;
  const call=async(route,data)=>{
   const res=await fetch(prefix+'/research/records/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Workspace':context},body:JSON.stringify({workspaceId,...data})});
   const body=await res.json();if(!res.ok)throw Error(route+' '+body.code);return body;
  };
  const section=async(sectionId,patch)=>{
   const target={recordId,sectionId},prior=await call('writing/read',target);
   await call('writing/save',{...target,value:{...prior.value,...patch},expectedRevision:prior.revision});
  };
  await section(sections[1],{share:true});await section(sections[0],{share:false});
  // Change permitted writing again without a visibility transition.
  await section(sections[1],{body:'Corrected reading: 526 nm.'});
  await call('save',{changes:[{id:next.id,expectedRevision:null,record:next}]});
  const target={recordId:next.id,field:'share'},previous=await call('values/read',target);
  await call('values/save',{...target,expectedRevision:previous.revision,value:{value:true}});
 },{source,next});
}

test('an authored feed republishes new lab grants, changed writing and section withdrawals to its remembered folder offline',async()=>{
 test.skip(!process.env.OBSERVANDA_DESKTOP_EXECUTABLE&&process.env.OBSERVANDA_QUALIFY_SOURCE_WEBSITE!=='1','Requires desktop qualification.');
 test.setTimeout(240000);
 const fixture=await websiteDesktopFixture(),output=path.join(fixture.directory,'published'),name='Feed laboratory';
 let app,browser;
 try{
  await mkdir(output);app=await fixture.start();let page=await app.firstWindow();
  await createWebsiteWorkspace(page,fixture.directory,name);
  const source=await selectEntry(page);
  await page.locator('#main-navigation').getByRole('button',{name:'Website editor',exact:true}).click();
  await page.getByRole('button',{name:'New website',exact:true}).click();
  await page.getByLabel('Website name',{exact:true}).fill('Fluorescence atlas');
  await page.locator('form[data-website-files-form] button[type=submit]').click();
  const canvas=()=>page.frameLocator('#website-files-canvas');
  await expect(canvas().getByRole('heading',{name:'Fluorescence atlas',exact:true})).toBeVisible();
  await page.locator('[data-website-file-block]').selectOption('feed');
  await page.getByRole('button',{name:'Insert element',exact:true}).click();
  const editor=page.locator('dialog[data-website-feed-dialog]');
  await expect(editor.getByRole('radio',{name:'All eligible entries'})).toBeChecked();
  await editor.locator('[data-feed-heading]').fill('Released instrument observations');
  await editor.locator('[data-feed-page-size]').fill('1');
  if(process.env.OBSERVANDA_FEED_SCREENSHOTS==='1')await page.screenshot({path:path.resolve('.local/website-library-proof/08-automatic-feed.png')});
  await editor.locator('[data-feed-apply]').click();await expect(editor).toHaveCount(0);
  await expect(canvas().locator('[data-website-feed]')).toContainText('withdraw-this-result');

  const publish=()=>page.getByRole('button',{name:'Publish update',exact:true}).click();
  const confirm=async()=>{
   await page.locator('[data-website-file-folder-confirm]').check();
   await page.getByRole('button',{name:'Write reviewed files',exact:true}).click();
   await expect(page.getByText('Edition written and verified.',{exact:true})).toBeVisible({timeout:60000});
  };
  await publish();await page.getByRole('button',{name:'Publish to folder',exact:true}).click();
  await page.getByLabel('Destination folder',{exact:true}).fill(output);
  await page.getByRole('button',{name:'Review file changes',exact:true}).click();await confirm();
  const first=await readFile(path.join(output,'index.html'),'utf8');
  expect(first).toContain('withdraw-this-result');expect(first).not.toMatch(/never-export-this-canary|release-this-result/);
  const next={...sampleNotebook().entries[2],id:randomUUID(),notebookId:source.labBookId,title:'Downstream fluorescence',body:'Second assay approved.',share:false,
   sections:[{id:randomUUID(),title:'Operator notes',body:'internal-serial-canary',share:false}]};
  next.figures=['Baseline emission','Calibrated emission','Internal calibration canary'].map((title,i)=>{
   const plot=createFigure();plot.title=title;plot.series[0].points=[{x:0,y:8+i,error:null},{x:1,y:15+i,error:null},{x:2,y:12+i,error:null}];return plot;
  });
  next.publication=defaultPublicationPrivacy();next.publication.website.hiddenFigures=[next.figures[2].id];
  await submitLabChanges(page,source,next);
  await fixture.close(app);app=null;
  const sentinels=await disableWebsiteResearch(fixture.directory,[path.join(fixture.directory,name),...source.roots]);
  app=await fixture.start(undefined,{website:true});page=await app.firstWindow();
  const unexpected=[];
  const checkURL=url=>{const pathname=new URL(url).pathname;if(pathname.startsWith('/api/')&&!pathname.startsWith('/api/website-files/')&&!['/api/session','/api/access/status','/api/language','/api/interface'].includes(pathname))unexpected.push(pathname);};
  app.context().on('request',r=>checkURL(r.url()));
  await expect(canvas().locator('[data-website-feed]')).toContainText('Released instrument observations',{timeout:60000});
  await page.evaluate(()=>{
   const fetch=window.fetch.bind(window);window.feedProgress={};
   window.fetch=async(...args)=>{
    const response=await fetch(...args),op=new URL(response.url).pathname.replace('/api/website-files/','');
    if(['feed/save','folder/plan','folder/apply'].includes(op)){
     const type=response.headers.get('content-type');
     window.feedProgress[op]=response.clone().text().then(text=>({type,events:text.trim().split('\n').map(line=>JSON.parse(line))}));
    }
    return response;
   };
  });
  for(const url of await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name)))checkURL(url);
  await page.locator('[data-website-file-block]').selectOption('paragraph');
  await page.getByRole('button',{name:'Insert element',exact:true}).click();
  const introduction=canvas().locator('main > p').last(),note='Readings are listed by assay. Each page shows one released observation.';
  await selectLine(page,introduction);await page.keyboard.type(note);await expect(introduction).toHaveText(note);
  await page.getByRole('button',{name:'Save website',exact:true}).click();
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();
  const preview=page.frameLocator('#website-files-preview'),block=preview.locator('[data-website-feed]');
  await expect(preview.getByText(note,{exact:true})).toBeVisible();
  await expect(block.locator('[role=listitem]')).toHaveCount(1);
  const firstPreview=await block.innerText();await block.locator('a[rel=next]').click();
  await expect(block.locator('a[rel=prev]')).toBeVisible();
  expect(firstPreview+' '+await block.innerText()).toMatch(/Corrected reading: 526 nm/);
  expect(firstPreview+' '+await block.innerText()).toMatch(/Second assay approved/);
  await page.getByRole('button',{name:'Return to editing',exact:true}).click();
  await expect(canvas().locator('[data-website-feed]')).toBeVisible();
  await addInstrumentPlates(page);
  await publish();await expect(page.getByLabel('Destination folder',{exact:true})).toHaveValue(output);
  await confirm();
  browser=await chromium.launch();const reader=await browser.newPage({javaScriptEnabled:false});
  await reader.goto(pathToFileURL(path.join(output,'index.html')).href);
  await expect(reader.getByText(note,{exact:true})).toBeVisible();
  await expect(reader.locator('body')).toHaveCSS('color','rgb(25, 51, 55)');
  await expect(reader.locator('.website-feed-item').first()).toHaveCSS('background-color','rgb(255, 255, 255)');
  if(process.env.OBSERVANDA_FEED_SCREENSHOTS==='1')await reader.screenshot({path:path.resolve('.local/website-library-proof/09-published-feed.png')});
  const html=[await reader.content()];
  await reader.locator('[data-website-feed] a[rel=next]').click();
  await expect(reader.locator('[data-website-feed] a[rel=prev]')).toBeVisible();
  await expect(reader.locator('[data-website-feed] [role=listitem]')).toHaveCount(1);
  html.push(await reader.content());
  expect(html.join(' ')).toMatch(/Corrected reading: 526 nm/);expect(html.join(' ')).toMatch(/Second assay approved/);
  expect(html.join(' ')).not.toMatch(/never-export-this-canary|internal-serial-canary|withdraw-this-result/);
  await reader.locator('[data-website-feed] a[rel=prev]').click();await expect(reader.getByRole('heading',{name:'Fluorescence atlas',exact:true})).toBeVisible();
  await reader.goto(pathToFileURL(path.join(output,'atlas','plates.html')).href);
  const plate=reader.locator('[data-website-feed-source]').filter({hasText:'Downstream fluorescence'});
  await expect(reader.locator('[data-website-feed-source]')).toHaveCount(1);
  await expect(plate).toContainText('Calibrated emission');await expect(plate).toContainText('Baseline emission');
  const plots=plate.locator('img');await expect(plots).toHaveCount(2);
  await expect.poll(()=>plots.evaluateAll(images=>images.every(img=>img.complete&&img.naturalWidth>0))).toBe(true);
  await expect(plate.locator('[data-feed-field="figures"]')).toHaveCSS('display','grid');
  const boxes=await plots.evaluateAll(images=>images.map(img=>img.getBoundingClientRect().left));expect(boxes[1]).toBeGreaterThan(boxes[0]);
  expect(await reader.content()).not.toMatch(/Second assay approved|Internal calibration canary|internal-serial-canary/);
  // A private SVG or stale HTML file is public even without a link to it.
  const names=await readdir(output,{recursive:true});
  for(const file of names.filter(name=>/\.(?:html|css|json|svg|csv|vtt|js)$/i.test(name))){
   expect(await readFile(path.join(output,file),'utf8'),file).not.toMatch(/never-export-this-canary|internal-serial-canary|Internal calibration canary|withdraw-this-result/);
  }
  if(process.env.OBSERVANDA_FEED_SCREENSHOTS==='1')await reader.screenshot({path:path.resolve('.local/website-library-proof/10-published-plates.png'),fullPage:true});
  for(const database of sentinels)expect((await stat(database)).isFile()).toBe(true);
  expect(unexpected).toEqual([]);
  for(const [op,stage] of [['feed/save','feedRender'],['folder/plan','folderCompare'],['folder/apply','folderWrite']]){
   const {type,events}=await page.evaluate(op=>window.feedProgress[op],op);expect(type).toContain('application/x-ndjson');
   expect(events.some(event=>event.progress?.stage===stage&&event.progress.completed>0)).toBe(true);
   expect(events.at(-1).result).toBeTruthy();
  }
 }finally{await browser?.close();await fixture.dispose(app);}
});
