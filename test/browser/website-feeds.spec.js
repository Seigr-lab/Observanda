import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {navigate} from './preferences-helper.js';
import {editorTab,openBlock,task,chooseWebsitePage} from './composer-helper.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {defaultFeed} from '../../src/web/website-feed-model.js';
import {MediaStore} from '../../src/media.js';
import {ResearchRecords,recordRevision} from '../../src/research.js';

test('authors set independent feed counts, try their controls on the canvas and reopen the settings',async({page})=>{
 test.setTimeout(60000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-feed-authoring-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:23},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Reading '+i,share:true,sections:[],figures:[],attachments:[],relations:[]}));
 book.website.home.sections=['first-feed','second-feed'].map(id=>({id,kind:'records',title:id,show:true,layout:'grid'}));
 await new Workspace(root).create(book);const app=await startServer({root,preferencesFile:path.join(root,'preferences.json'),port:0});
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await editorTab(page,'Homepage');
  const canvas=page.frameLocator('#website-draft-preview'),first=canvas.locator('[data-section-id="first-feed"]'),second=canvas.locator('[data-section-id="second-feed"]');
  for(const [index,count] of [[0,3],[1,7]]){
   await openBlock(page,index);await page.getByLabel('Paginate this feed',{exact:true}).check();
   await page.getByLabel('Items per feed view',{exact:true}).fill(String(count));
   await page.getByLabel('Let visitors change the order',{exact:true}).check();
   await page.getByLabel('Let visitors search and filter',{exact:true}).check();
  }
  await expect(first.locator('[data-feed-item]')).toHaveCount(3);await expect(second.locator('[data-feed-item]')).toHaveCount(7);
  const initial=await first.locator('[data-feed-item]').first().getAttribute('data-feed-id'),other=await second.locator('[data-feed-item]').evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId));
  await first.getByRole('link',{name:'Next entries',exact:true}).click();await expect(first.locator('[data-feed-item]').first()).not.toHaveAttribute('data-feed-id',initial);
  expect(await second.locator('[data-feed-item]').evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId))).toEqual(other);
  await expect(page.getByLabel('Items per feed view',{exact:true})).toHaveValue('7');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const saved=(await new Workspace(root).read()).book;expect(saved.website.home.sections.map(s=>s.feed.pageSize)).toEqual([3,7]);
  await page.reload();await editorTab(page,'Homepage');await openBlock(page,0);await expect(page.getByLabel('Items per feed view',{exact:true})).toHaveValue('3');
  await page.getByLabel('Show previous and next controls',{exact:true}).uncheck();await expect(first.locator('[data-feed-next]')).toHaveCount(0);await expect(second.locator('[data-feed-next]')).toHaveCount(1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(first.locator('[data-feed-next]')).toHaveCount(1);
  await page.getByLabel('Paginate this feed',{exact:true}).uncheck();await expect(first.locator('.publication-card')).toHaveCount(23);await expect(second.locator('[data-feed-item]')).toHaveCount(7);
 }finally{await app.close();}
});

test('indexed canvas feeds keep independent reading states through design changes, failures and directory navigation',async({page},info)=>{
 test.setTimeout(120000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-indexed-feed-canvas-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:75},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Observation '+String(i).padStart(3,'0'),body:'Reading evidence '+i,occurredOn:'2026-10-09',share:true,sections:[],figures:[],attachments:[],relations:[]}));
 book.entries.push({...structuredClone(book.entries[0]),id:randomUUID(),title:'Withheld observation',share:false});
 book.website.home.sections=['first-feed','second-feed'].map((id,i)=>({id,kind:'records',title:id,show:true,layout:'grid',feed:{...defaultFeed('records'),pageSize:i?7:3,visitorFilters:true,visitorOrder:true,visitorView:true}}));
 const f=await encryptedFixture(root,book),media=new MediaStore(f.workspace.root,f.vault),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>'),'image');
 await new ResearchRecords(f.workspace,media).save({workspaceId:book.id,changes:book.entries.map(record=>({id:record.id,expectedRevision:recordRevision(record),record:{...record,attachments:[{...asset,caption:'Retained cover',alt:'Retained cover',transcript:'',share:true}]}}))},{compact:true});
 const app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0}),errors=[],commands=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/design-preview'&&request.method()==='POST')commands.push(request.postDataJSON());});
 try{
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();
  await navigate(page,'Website editor');await editorTab(page,'Homepage');
  const frame=page.frameLocator('#website-draft-preview'),first=frame.locator('[data-section-id="first-feed"]'),second=frame.locator('[data-section-id="second-feed"]'),items=root=>root.locator('[data-feed-item]'),ids=root=>items(root).evaluateAll(nodes=>nodes.map(n=>n.dataset.feedId));
  await expect(items(first)).toHaveCount(3);await expect(items(second)).toHaveCount(7);const initial=await ids(first),other=await ids(second),saved=await page.locator('#save-status').textContent();
  await expect(first.getByLabel('Search this feed',{exact:true})).toBeVisible();
  await first.getByLabel('Search this feed',{exact:true}).fill('Withheld observation');await first.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(items(first)).toHaveCount(0);
  await first.getByRole('button',{name:'Clear filters',exact:true}).click();await expect.poll(()=>ids(first)).toEqual(initial);
  const cover=await first.getByAltText('Retained cover').first().getAttribute('src'),initialFrame=await first.evaluate(node=>node.ownerDocument.URL);expect(cover).toContain('/api/media/'+asset.id+'?context=');
  await first.getByRole('link',{name:'Next entries',exact:true}).click();await expect.poll(()=>ids(first)).not.toEqual(initial);const window=await ids(first);expect(await ids(second)).toEqual(other);await expect(page.locator('#save-status')).toHaveText(saved);
  await task(page,'Site');await page.getByLabel('Website title',{exact:true}).fill('Independent field feeds');await expect(frame.locator('.site-name')).toHaveText('Independent field feeds');expect(await ids(first)).toEqual(window);expect(await ids(second)).toEqual(other);
  await second.getByLabel('Search this feed',{exact:true}).fill('Observation 060');await second.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(items(second)).toHaveCount(1);await expect(items(second)).toContainText('Observation 060');expect(await ids(first)).toEqual(window);
  const filtered=commands.at(-1).collections.find(value=>value.key==='section:second-feed');expect(new URLSearchParams(filtered.query).get('feedSearch')).toBe('Observation 060');
  await page.getByLabel('Website title',{exact:true}).fill('Continued field feeds');await expect(frame.locator('.site-name')).toHaveText('Continued field feeds');expect(commands.at(-1).collections.find(value=>value.key==='section:second-feed')).toEqual(filtered);await expect(items(second)).toHaveCount(1);expect(await ids(first)).toEqual(window);
  await page.route('**/api/design-preview',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Interrupted feed request'})}),{times:1});
  await first.getByRole('link',{name:'Next entries',exact:true}).click();await expect(first.getByRole('button',{name:'Retry',exact:true})).toBeVisible();expect(await ids(first)).toEqual(window);
  await first.getByRole('button',{name:'Retry',exact:true}).click();await expect.poll(()=>ids(first)).not.toEqual(window);await expect(items(second)).toHaveCount(1);
  const beforeRejected=await ids(first);
  await page.route(/\/preview\/[a-f0-9]{64}\/index\.html(?:\?|$)/,async route=>{
   const response=await route.fetch(),html=await response.text();expect(html).toContain('data-feed-next');
   await route.fulfill({response,body:html.replace(/<a data-feed-next\b[^>]*>[\s\S]*?<\/a>/,'')});
  },{times:1});
  await first.getByRole('link',{name:'Next entries',exact:true}).click();await expect(first.getByRole('button',{name:'Retry',exact:true})).toBeVisible();expect(await ids(first)).toEqual(beforeRejected);
  await page.getByLabel('Website title',{exact:true}).fill('Preserved reading after incomplete response');await expect(frame.locator('.site-name')).toHaveText('Preserved reading after incomplete response');
  expect(await ids(first)).toEqual(beforeRejected);await expect(items(second)).toHaveCount(1);
  await first.getByRole('link',{name:'Next entries',exact:true}).click();await expect.poll(()=>ids(first)).not.toEqual(beforeRejected);
  await second.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(items(second)).toHaveCount(7);
  await second.getByLabel('Order',{exact:true}).selectOption('oldest');await expect(items(second).first()).toHaveAttribute('data-feed-id',book.entries.filter(record=>record.share).sort((a,b)=>a.id.localeCompare(b.id,'en')).at(-1).id);
  for(let i=0;i<6;i++){const before=await ids(first);await first.getByRole('link',{name:'Next entries',exact:true}).click();await expect.poll(()=>ids(first)).not.toEqual(before);}
  expect((await page.request.get(initialFrame)).status()).toBe(404);expect((await page.request.get(cover)).ok()).toBe(true);
  const wrongContext=new URL(cover);wrongContext.searchParams.set('context','other-workspace');expect((await page.request.get(wrongContext.href)).status()).toBe(409);
  await expect.poll(()=>second.getByAltText('Retained cover').first().evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await chooseWebsitePage(page,'notebooks/'+book.notebooks[0].id+'.html');const cards=frame.locator('main > .publication-cards > .publication-card');await expect(cards).toHaveCount(24);const before=await cards.first().getAttribute('data-record-id');
  const next=frame.locator('[data-collection-next]');await next.focus();await next.press('Enter');await expect(cards.first()).not.toHaveAttribute('data-record-id',before);await expect(next).toBeFocused();
  const previousFirst=await cards.first().getAttribute('data-record-id');await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await next.press('Enter');await expect(cards.first()).not.toHaveAttribute('data-record-id',previousFirst);await expect(cards).toHaveCount(24);await expect(next).toBeFocused();
  await expect.poll(()=>page.evaluate(()=>{
   const overflow=[...document.querySelectorAll('body *')].filter(node=>node.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(node=>({tag:node.tagName,class:node.className,id:node.id,width:Math.round(node.getBoundingClientRect().width),right:Math.round(node.getBoundingClientRect().right)}));
   return document.documentElement.scrollWidth<=innerWidth+1?null:{width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflow};
  })).toBeNull();
  await page.screenshot({path:info.outputPath('continued-canvas-directory.png')});expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true});}
});
