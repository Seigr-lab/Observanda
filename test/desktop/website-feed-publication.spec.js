import {test,expect,chromium} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {sampleNotebook} from '../../src/sample.js';
import {websiteDesktopFixture} from './installed-website-app.js';
import {createWebsiteWorkspace,selectEntry,disableWebsiteResearch} from './website-workspace-fixture.js';
import {selectLine} from './website-authoring-journey.js';

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
  await submitLabChanges(page,source,next);
  await fixture.close(app);app=null;
  const sentinels=await disableWebsiteResearch(fixture.directory,[path.join(fixture.directory,name),...source.roots]);
  app=await fixture.start(undefined,{website:true});page=await app.firstWindow();
  const unexpected=[];
  const checkURL=url=>{const pathname=new URL(url).pathname;if(pathname.startsWith('/api/')&&!pathname.startsWith('/api/website-files/')&&!['/api/session','/api/access/status','/api/language','/api/interface'].includes(pathname))unexpected.push(pathname);};
  app.context().on('request',r=>checkURL(r.url()));
  await expect(canvas().locator('[data-website-feed]')).toContainText('Released instrument observations',{timeout:60000});
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
  await publish();await expect(page.getByLabel('Destination folder',{exact:true})).toHaveValue(output);
  await confirm();
  browser=await chromium.launch();const reader=await browser.newPage({javaScriptEnabled:false});
  await reader.goto(pathToFileURL(path.join(output,'index.html')).href);
  await expect(reader.getByText(note,{exact:true})).toBeVisible();
  await expect(reader.locator('body')).toHaveCSS('color','rgb(25, 51, 55)');
  await expect(reader.locator('.website-feed-item').first()).toHaveCSS('background-color','rgb(255, 255, 255)');
  if(process.env.OBSERVANDA_FEED_SCREENSHOTS==='1')await reader.screenshot({path:path.resolve('.local/website-library-proof/09-published-feed.png')});
  const html=[await reader.content()];
  await reader.locator('[data-website-feed] a[rel=next]').click();html.push(await reader.content());
  expect(html.join(' ')).toMatch(/Corrected reading: 526 nm/);expect(html.join(' ')).toMatch(/Second assay approved/);
  expect(html.join(' ')).not.toMatch(/never-export-this-canary|internal-serial-canary|withdraw-this-result/);
  await reader.locator('[data-website-feed] a[rel=prev]').click();await expect(reader.getByRole('heading',{name:'Fluorescence atlas',exact:true})).toBeVisible();
  for(const database of sentinels)expect((await stat(database)).isFile()).toBe(true);
  expect(unexpected).toEqual([]);
 }finally{await browser?.close();await fixture.dispose(app);}
});
