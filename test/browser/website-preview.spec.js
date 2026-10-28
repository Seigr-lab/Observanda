import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {task} from './composer-helper.js';
import {openPageSettings,chooseWebsitePage} from './composer-helper.js';

let app,root,book,vault,fixture;
test.beforeEach(async()=>{
 test.setTimeout(120000);
 root=await mkdtemp(path.join(os.tmpdir(),'observanda-page-preview-'));book=upgradeNotebook(sampleNotebook());
 book.website.home.sections=[];
 const template=book.entries[0];
 book.entries=Array.from({length:393},(_,i)=>({...structuredClone(template),id:randomUUID(),title:'Synthetic record '+i,body:'Original evidence '+i,share:i%2===0,attachments:[],relations:[]}));
 // The first odd record permits sharing at its source, but this website has
 // not selected it. Other odd records remain private at the source itself.
 book.entries[1].share=true;
 fixture=await encryptedFixture(root,book);vault=fixture.vault;
 const sites=new WebsiteSites(fixture.workspace),site=await sites.read(null);
 await sites.save(null,{workspaceId:book.id,baseEtag:site.etag,websitePin:site.websitePin,metadata:{},projects:[],changes:[],removed:[],selection:{...site.site.selection,records:[...site.site.selection.records.filter(row=>row.id!==book.entries[1].id),{id:book.entries[1].id,share:false,attachments:[]}]}});
 app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
});
test.afterEach(async()=>{await app?.close();if(vault){clearVault(vault);vault=null;}await rm(root,{recursive:true,force:true});});
const targetPath=id=>'entries/'+id+'.html';

test('indexed website previews send only unsaved edits and survive save and reopen',async({page},testInfo)=>{
 test.setTimeout(150000);await app.close();
 const f=fixture;
 // The complete saved corpus exceeds the legacy transport ceiling. Ordinary
 // website editing still requests only its selected page and changed values.
 const records=new ResearchRecords(f.workspace,{});
 for(let start=16;start<56;start+=10){
  const changed=book.entries.slice(start,start+10).map(record=>({...record,body:'Retained corpus observations. '.repeat(2000)}));
  const result=await records.save({workspaceId:book.id,changes:changed.map(record=>({id:record.id,expectedRevision:recordRevision(book.entries.find(r=>r.id===record.id)),record}))},{recordIds:changed.map(record=>record.id)});
  for(const record of result.book.entries)book.entries[book.entries.findIndex(r=>r.id===record.id)]=record;
 }
 expect((await f.workspace.catalogue(store=>store.snapshot())).bytes).toBeGreaterThan(2*1024*1024);
 app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(root,'encrypted-preferences.json'),port:0});
 await page.goto(app.url);
 const first=page.waitForResponse(r=>r.url().endsWith('/api/design-preview')&&r.ok());await navigate(page,'Website editor');
 const initial=await first,command=initial.request().postDataJSON();expect(command.book).toBeUndefined();expect(command.websitePin).toBeDefined();expect(command.draft).toBeUndefined();
 const savedEtag=command.websitePin.researchSnapshotId;
 const read=ResearchCatalogue.prototype.record,loaded=[];
 ResearchCatalogue.prototype.record=async function(id,...args){loaded.push(id);return read.call(this,id,...args);};
 try{
  const selected=page.waitForResponse(r=>r.url().endsWith('/api/design-preview')&&r.ok()&&r.request().postDataJSON().designTarget==='entry:'+book.entries[8].id);
  await chooseWebsitePage(page,targetPath(book.entries[8].id));await selected;
  await expect(page.frameLocator('#website-draft-preview').getByText(book.entries[8].body,{exact:true})).toBeVisible();
  expect(loaded).toEqual([book.entries[8].id]);loaded.length=0;
  const home=page.waitForResponse(r=>r.url().endsWith('/api/design-preview')&&r.ok()&&r.request().postDataJSON().designTarget==='home');
  await page.getByLabel('Page',{exact:true}).selectOption('index.html');await home;
  await expect(page.frameLocator('#website-draft-preview').locator('body')).toHaveAttribute('data-page','home');
  expect(loaded).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;}
 await task(page,'Site');
 const updated=page.waitForResponse(r=>r.url().endsWith('/api/design-preview')&&r.ok()&&r.request().postDataJSON().websiteDraft);
 await page.getByLabel('Website title',{exact:true}).fill('Seigr field notes');
 const response=await updated,request=response.request().postDataJSON();expect(request.websitePin.researchSnapshotId).toBe(savedEtag);expect(request.websiteDraft).toBeDefined();expect(JSON.stringify(request)).not.toContain('Original evidence');expect(JSON.stringify(request).length).toBeLessThan(8000);
 await expect(page.frameLocator('#website-draft-preview').locator('.site-name')).toHaveText('Seigr field notes');
 await task(page,'Content');
 const changed=page.waitForResponse(r=>r.url().endsWith('/api/design-preview')&&r.ok()&&r.request().postDataJSON().websiteDraft);
 await page.locator('[data-publish-entry="'+book.entries[1].id+'"]').check();
 const selection=(await changed).request().postDataJSON();expect(selection.websiteDraft).toBeDefined();expect(selection.draft).toBeUndefined();expect(JSON.stringify(selection)).not.toContain('Original evidence');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
 const saved=await new WebsiteSites(f.workspace).read(null);expect(saved.book.website.title).toBe('Seigr field notes');expect(saved.site.selection.records.find(record=>record.id===book.entries[1].id).share).toBe(true);expect((await f.workspace.outline()).etag).toBe(savedEtag);
 await page.reload();await expect(page.frameLocator('#website-draft-preview').locator('.site-name')).toHaveText('Seigr field notes');
 await task(page,'Page');await page.screenshot({path:testInfo.outputPath('indexed-canvas.png')});
});

test('canvas requests one page at a time and complete reviewed export still excludes private records',async({page})=>{
 test.setTimeout(180000);
 await page.goto(app.url);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/design-preview')&&r.ok());
 await navigate(page,'Website editor');const home=await (await response).json();
 expect(home.pages).toEqual([{title:'Home',path:'index.html'}]);
 const absent=await page.request.get(app.origin+home.baseUrl+targetPath(book.entries[0].id));expect(absent.status()).toBe(404);
 const selected=book.entries[1],next=page.waitForResponse(r=>r.url().endsWith('/api/design-preview')&&r.ok());
 await chooseWebsitePage(page,targetPath(selected.id));
 const record=await (await next).json();expect(record.pages).toEqual([{title:selected.title,path:targetPath(selected.id)}]);
 await expect(page.frameLocator('#website-draft-preview').getByText(selected.body,{exact:true})).toBeVisible();
 expect(await (await page.request.get(app.origin+record.baseUrl+'publication.json')).json()).toMatchObject({entries:[selected.id]});
 const exportResponse=await page.request.post(app.origin+'/api/export',{headers:{Origin:app.origin},data:{id:record.baseUrl.split('/')[2]}});expect(exportResponse.ok()).toBe(false);
 await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await page.getByLabel('Display heading',{exact:true}).fill('Inspection notes');
 await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Inspection notes',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
 await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();
  const prepareBegan=performance.now();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:60000});console.log(JSON.stringify({selectedRecords:197,prepareMs:performance.now()-prepareBegan}));const href=await page.getByRole('link',{name:'Open full preview',exact:true}).getAttribute('href'),edition=await (await page.request.get(new URL('publication.json',new URL(href,app.origin)).href)).json();expect(edition.entries).toHaveLength(197);expect(edition.entries).not.toContain(selected.id);
 expect((await fixture.workspace.read()).book.entries).toEqual(book.entries);
});

test('superseded canvas loads are cancelled and a failed refresh retains its draft for retry',async({page})=>{
 test.setTimeout(120000);await page.goto(app.url);await navigate(page,'Website editor');await expect(page.frameLocator('#website-draft-preview').locator('body')).toHaveAttribute('data-page','home');
 let held,release;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>held=resolve),aborted=[];
 page.on('requestfailed',request=>{if(request.url().endsWith('/api/design-preview'))aborted.push(request.postDataJSON().designTarget);});
 await page.route('**/api/design-preview',async route=>{
  const command=route.request().postDataJSON();
  if(command.designTarget==='entry:'+book.entries[0].id){held();await gate;await route.abort().catch(()=>{});}
  else await route.continue();
 });
 await chooseWebsitePage(page,targetPath(book.entries[0].id));await entered;
 await chooseWebsitePage(page,targetPath(book.entries[2].id));
 await expect(page.frameLocator('#website-draft-preview').locator('body')).toHaveAttribute('data-page','entry:'+book.entries[2].id);
 release();await expect.poll(()=>aborted).toContain('entry:'+book.entries[0].id);await page.unroute('**/api/design-preview');
 let reject=true;await page.route('**/api/design-preview',route=>{if(reject){reject=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic interruption'})});}return route.continue();});
 await openPageSettings(page);await page.getByText('Page header',{exact:true}).click();await page.getByLabel('Display heading',{exact:true}).fill('Retained draft');
 await expect(page.locator('#website-preview-status')).toHaveText('Synthetic interruption');
 await expect(page.getByLabel('Display heading',{exact:true})).toHaveValue('Retained draft');await page.getByRole('button',{name:'Retry preview',exact:true}).click();
 await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Retained draft',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
 await page.reload();await expect(page.frameLocator('#website-draft-preview').getByRole('heading',{name:'Retained draft',exact:true})).toBeVisible();
});
