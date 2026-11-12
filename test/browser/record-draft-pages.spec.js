import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {ResearchDraftTransfer} from '../../src/research-draft-transfer.js';
import {writeRecordCheckpoint} from '../../src/web/record-draft-transfer.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {recordRevision} from '../../src/research.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {sourceAssets} from './built-assets-helper.js';
import {navigate} from './preferences-helper.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {saveWebsiteRecovery} from '../../src/website-recovery.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {ScientificEditDrafts} from '../../src/scientific-edit-drafts.js';
import {PdfDocuments} from '../../src/pdf-documents.js';
import {pdfLayoutPreset} from '../../src/web/pdf-layout-model.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
async function fixture(page,count=24,options={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-draft-list-ui-')),book=upgradeNotebook(sampleNotebook()),source=book.entries[2];
 book.entries=Array.from({length:64},(_,i)=>({...structuredClone(source),id:randomUUID(),title:'Saved observation '+i,body:'Private original '+i,sections:[],figures:[],attachments:[],relations:[]}));
 const f=await encryptedFixture(directory,book),drafts=new ResearchDrafts(f.workspace),commands=[];
 for(let i=0;i<count;i++){
  const base=book.entries[0],command={id:randomUUID(),workspaceId:book.id,expectedRevision:null,changes:[{base,expectedRevision:recordRevision(base),record:{...base,title:'Unfinished observation '+String(i).padStart(2,'0'),body:'Unfinished original. '.repeat(2000)}}]};
  const result=await drafts.write(command);commands.push({...command,expectedRevision:result.revision});
 }
 const settings=defaultDashboard();settings.views[0].panels=[];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json'),...options}),records=[],draftBodies=[],requests=[],errors=[];
 const record=ResearchCatalogue.prototype.record,objectValue=ResearchCatalogue.prototype.objectValue;
 ResearchCatalogue.prototype.record=function(id,...args){records.push(id);return record.call(this,id,...args);};
 ResearchCatalogue.prototype.objectValue=function(id,expected){if(id.startsWith('metadata:.observanda/drafts/')&&expected)draftBodies.push(id);return objectValue.call(this,id,expected);};
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))requests.push(r.url());});
 return {...f,book,commands,drafts,app,records,draftBodies,requests,errors,async close(){ResearchCatalogue.prototype.record=record;ResearchCatalogue.prototype.objectValue=objectValue;await app.close();await clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}
test('Tools opens acknowledged record drafts and shows the exact saved version without reading the original',async({page})=>{
 const f=await fixture(page,1,{browserAssets:await sourceAssets()});
 try{
  await page.goto(f.app.url);await navigate(page,'Tools');
  const card=page.locator('[data-tool-card="recovery"]');
  await page.getByRole('searchbox').fill('unfinished');await expect(card).toBeVisible();
  await card.getByRole('button',{name:'Open',exact:true}).click();
  const center=page.getByRole('dialog',{name:'Recover unfinished work',exact:true});
  await expect(center).toBeVisible();expect(f.requests.filter(url=>url.includes('/website-files/recovery/')||url.includes('scientific-draft-browse'))).toEqual([]);
  await center.getByRole('button',{name:'Record drafts',exact:true}).click();
  const draft=page.getByRole('dialog',{name:'Recoverable record drafts'}).locator('.record-draft-row');
  await expect(draft).toContainText('Unfinished observation 00');await draft.getByText('Recovery details',{exact:true}).click();
  await expect(draft).toContainText(recordRevision(f.book.entries[0]));expect(f.records).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('Tools opens the chosen recovery copy in the file-backed website editor',async({page})=>{
 const f=await fixture(page,0,{browserAssets:await sourceAssets()});
 try{
  const store=new WebsiteFileStore(f.workspace),siteId=randomUUID(),saved=await store.create({id:siteId,name:'Field archive'});
  const text='Unfinished measurements for this page';
  const draft=await saveWebsiteRecovery(store,siteId,{id:randomUUID(),path:saved.path,baseRevision:saved.site.revision,
   operationId:randomUUID(),html:saved.html.replace('</main>','<p>'+text+'</p></main>'),css:saved.css});
  await page.goto(f.app.url);await navigate(page,'Tools');
  await page.locator('[data-tool-card="recovery"]').getByRole('button',{name:'Open',exact:true}).click();
  const center=page.getByRole('dialog',{name:'Recover unfinished work',exact:true});
  await center.getByRole('button',{name:'Website pages',exact:true}).click();
  await expect(center).toContainText('Field archive');await expect(center).not.toContainText(text);
  await center.getByRole('button',{name:'Review draft',exact:true}).click();
  const offer=page.locator('[data-draft-id="'+draft.id+'"]');await expect(offer).toBeFocused();
  const canvas=page.frameLocator('#website-files-canvas').locator('main');await expect(canvas).not.toContainText(text);
  await offer.locator('[data-action="website-files-recovery-restore"]').click();
  await expect(canvas).toContainText(text);
  expect((await store.open(siteId)).html).not.toContain(text);
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('Tools reopens the selected scientific form without submitting its pending operation',async({page})=>{
 const f=await fixture(page,1,{browserAssets:await sourceAssets()});
 try{
  const drafts=new ScientificEditDrafts(new ResearchMaterials(f.workspace));
  const scope={workspaceId:f.book.id,recordId:f.book.entries[1].id},source='pending/field-intake';
  const ack=await drafts.write({...scope,id:randomUUID(),expectedRevision:null,base:null,kind:'local-intake',value:{source,proposal:null}});
  await page.goto(f.app.url);await navigate(page,'Tools');
  const button=page.locator('[data-tool-card="recovery"]').getByRole('button',{name:'Open',exact:true});
  await button.click();
  const center=page.getByRole('dialog',{name:'Recover unfinished work',exact:true});
  const browse=center.getByRole('button',{name:'Scientific edits',exact:true});
  await browse.click();await expect(browse).toBeFocused();await expect(browse).toHaveAttribute('aria-pressed','true');
  await expect(center).toContainText('Local source configuration');await expect(center).not.toContainText(source);
  await page.keyboard.press('Escape');await expect(button).toBeFocused();
  await button.press('Enter');await center.getByRole('button',{name:'Scientific edits',exact:true}).click();
  await center.getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(page.locator('#dialog #continuing-source')).toHaveValue(source);
  const retained=await drafts.read({...scope,id:ack.id,expectedRevision:ack.revision});
  expect(retained.value).toEqual({source,proposal:null});expect(f.errors).toEqual([]);
  expect(f.requests.some(url=>url.includes('scientific-draft-discard')||url.endsWith('/intake-start'))).toBe(false);
 }finally{await f.close();}
});
test('Tools compares a pending PDF setting and applies it only when the author chooses Save',async({page})=>{
 const f=await fixture(page,0,{browserAssets:await sourceAssets()});
 try{
  const documents=new PdfDocuments(f.workspace,f.book.id),id=randomUUID();
  const header={version:1,id,name:'Survey report',language:'en',direction:'ltr',layout:pdfLayoutPreset()};
  const first=await documents.change({id,commandId:randomUUID(),expectedRevision:null,operation:{type:'create',header,
   section:{id:randomUUID(),title:'Field findings',content:'Owned manuscript',layout:null,start:null}}});
  const command={id,commandId:randomUUID(),expectedRevision:first.revision,operation:{type:'header',header:{...header,name:'Microscopy report'}}};
  await documents.settingsDraft('prepare',command);
  await page.goto(f.app.url);await navigate(page,'Tools');
  await page.locator('[data-tool-card="recovery"]').getByRole('button',{name:'Open',exact:true}).click();
  const center=page.getByRole('dialog',{name:'Recover unfinished work',exact:true});
  await center.getByRole('button',{name:'PDF document settings',exact:true}).click();
  await expect(center).toContainText('Survey report');await expect(center).not.toContainText('Microscopy report');
  await center.getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(center.getByRole('cell',{name:'Microscopy report',exact:true})).toBeVisible();
  expect((await documents.read('open',{id})).revision).toBe(first.revision);
  await center.getByRole('button',{name:'Save recovered settings',exact:true}).click();
  await expect(page.locator('[data-pdf-editor]').getByRole('heading',{name:'Microscopy report',exact:true})).toBeVisible();
  expect((await documents.read('open',{id})).header.name).toBe('Microscopy report');
  expect(await documents.settingsDraft('list',{})).toEqual({items:[],next:null});
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('draft discovery pages, retries and recovers one selected original without a full workspace load',async({page},testInfo)=>{
 const f=await fixture(page);test.setTimeout(90000);
 try{
  await page.goto(f.app.url);await expect(page.getByRole('button',{name:'Review drafts',exact:true})).toBeVisible();
  expect(f.records).toEqual([]);expect(f.draftBodies).toEqual([]);
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}),rows=dialog.locator('.record-draft-row');
  await expect(rows).toHaveCount(10);await expect(rows.first()).toContainText('Unfinished observation 23');expect(f.draftBodies).toEqual([]);
  await page.context().route('**/api/research/drafts/list',route=>route.fulfill({status:503,json:{code:'IO',message:'Synthetic discovery failure'}}));
  await dialog.getByRole('button',{name:'Next drafts',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(dialog.getByRole('alert').first()).toContainText('could not be loaded');
  await page.context().unroute('**/api/research/drafts/list');await dialog.getByRole('button',{name:'Retry drafts',exact:true}).click();
  await expect(rows).toHaveCount(10);await expect(rows.first()).toContainText('Unfinished observation 13');
  await dialog.getByRole('button',{name:'Next drafts',exact:true}).click();await expect(rows).toHaveCount(4);await expect(rows.first()).toContainText('Unfinished observation 03');
  await dialog.getByRole('button',{name:'Previous drafts',exact:true}).click();await expect(rows.first()).toContainText('Unfinished observation 13');await expect(dialog.getByRole('button',{name:'Previous drafts',exact:true})).toBeFocused();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:testInfo.outputPath('draft-recovery-phone.png')});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeInViewport();
  await expect(dialog.getByRole('button',{name:'Next drafts',exact:true})).toBeInViewport();
  await rows.first().getByRole('button',{name:'Review draft',exact:true}).click();
  await page.locator('.record-draft-preview [data-preview-recover]').click();
  const review=page.locator('.record-draft-review');await expect(review.locator('[role=status]')).toContainText('0 of 0');
  expect(f.records).toEqual([]);expect(new Set(f.draftBodies)).toEqual(new Set(['metadata:.observanda/drafts/'+f.commands[13].id+'.json']));
  await review.getByRole('button',{name:'Save recovered record',exact:true}).click();
  await expect(review).toHaveCount(0,{timeout:30000});await expect(page.locator('.record-reader > h1')).toHaveText('Unfinished observation 13');
  expect(await f.drafts.read(f.commands[13].id)).toBe(null);
  expect(f.records).toEqual([]);expect(f.requests.some(url=>url.endsWith('/workspace/read/page'))).toBe(false);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
test('closing discovery cancels late pages; stale discard requires a refresh and explicit confirmation',async({page})=>{
 const f=await fixture(page,2);let release=null;
 try{
  await page.goto(f.app.url);await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}),rows=dialog.locator('.record-draft-row');
  await expect(rows).toHaveCount(2);
  let started;const waiting=new Promise(resolve=>{started=resolve;});
  await page.context().route('**/api/research/drafts/list',async route=>{started();await new Promise(resolve=>{release=resolve;});try{await route.continue();}catch{}});
  await dialog.getByRole('button',{name:'Refresh drafts',exact:true}).click();await waiting;
  const aborted=page.waitForEvent('requestfailed',{predicate:r=>r.url().endsWith('/drafts/list')});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await aborted;release();release=null;
  await expect(page.getByRole('button',{name:'Review drafts',exact:true})).toBeFocused();
  await page.context().unroute('**/api/research/drafts/list');await page.getByRole('button',{name:'Review drafts',exact:true}).click();await expect(rows).toHaveCount(2);
  const command=f.commands[1];await f.drafts.write({...command,changes:command.changes.map(c=>({...c,record:{...c.record,title:'Changed in the other editor'}}))});
  await rows.first().getByRole('button',{name:'Discard draft',exact:true}).click();await rows.first().getByRole('button',{name:'Confirm discard',exact:true}).click();
  await expect(dialog.locator('[data-draft-error]')).toContainText('changed');
  await dialog.getByRole('button',{name:'Refresh drafts',exact:true}).click();await expect(rows.first()).toContainText('Changed in the other editor');
  await rows.first().getByRole('button',{name:'Discard draft',exact:true}).click();await rows.first().getByRole('button',{name:'Confirm discard',exact:true}).click();
  await expect(rows).toHaveCount(1);expect(await f.drafts.read(command.id)).toBe(null);expect(f.records).toEqual([]);expect(f.errors).toEqual([]);
 }finally{release?.();await f.close();}
});
test('a failed recovery save retains its source draft and review for retry',async({page})=>{
 const f=await fixture(page,1);
 try{
  await page.goto(f.app.url);await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await page.locator('.record-draft-preview [data-preview-recover]').click();const review=page.locator('.record-draft-review');
  await page.context().route('**/api/research/drafts/review/apply',route=>route.fulfill({status:503,json:{code:'IO',message:'Synthetic unavailable storage'}}));
  await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review.locator('[role=alert]')).toContainText('Synthetic unavailable storage');
  expect(await f.drafts.read(f.commands[0].id)).not.toBe(null);
  await page.context().unroute('**/api/research/drafts/review/apply');await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review).toHaveCount(0,{timeout:30000});await expect(page.locator('.record-reader > h1')).toHaveText('Unfinished observation 00');
  expect(await f.drafts.read(f.commands[0].id)).toBe(null);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('failed checkpoint cleanup rolls back recovery and keeps the reviewed draft available',async({page})=>{
 const f=await fixture(page,1),remove=ResearchDrafts.prototype.removeLocked;
 try{
  await page.goto(f.app.url);await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await page.locator('.record-draft-preview [data-preview-recover]').click();const review=page.locator('.record-draft-review');
  ResearchDrafts.prototype.removeLocked=async function(command){await remove.call(this,command);throw Error('Synthetic cleanup failure');};
  await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review.locator('[role=alert]')).not.toBeEmpty();ResearchDrafts.prototype.removeLocked=remove;
  expect(await f.drafts.read(f.commands[0].id)).not.toBe(null);expect((await f.workspace.read()).book.entries[0].title).toBe('Saved observation 0');
  await review.getByRole('button',{name:'Close review',exact:true}).click();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Recoverable record drafts',exact:true});
  await expect(dialog.locator('.record-draft-row')).toHaveCount(1);
  await expect(dialog).toContainText('Unfinished observation 00');
  await dialog.getByRole('button',{name:'Review draft',exact:true}).click();await page.locator('[data-preview-recover]').click();await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review).toHaveCount(0,{timeout:30000});
  expect((await f.workspace.read()).book.entries[0].title).toBe('Unfinished observation 00');expect(await f.drafts.read(f.commands[0].id)).toBe(null);
  expect(f.errors).toEqual([]);
 }finally{ResearchDrafts.prototype.removeLocked=remove;await f.close();}
});

test('large checkpoint review pages saved sections, retries a failed window and closes without loading a record',async({page},testInfo)=>{
 test.setTimeout(120000);const f=await fixture(page,0);
 try{
  const base=f.book.entries[0],record={...base,title:'Long field notebook draft',sections:Array.from({length:40},(_,i)=>({id:randomUUID(),title:'Saved section '+i,body:'Retained field notes. '.repeat(2700)}))};
  const command={id:randomUUID(),workspaceId:f.book.id,expectedRevision:null,changes:[{record,baseRevision:recordRevision(base),expectedRevision:recordRevision(base)}]},transfer=new ResearchDraftTransfer(f.workspace);
  await writeRecordCheckpoint(async(route,data)=>route.includes('/transfer/')?transfer[route.split('/').at(-1)](data):f.drafts.write(data),command);
  await page.goto(f.app.url);await page.getByRole('button',{name:'Review drafts',exact:true}).click();
  await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  const preview=page.getByRole('dialog',{name:'Long field notebook draft',exact:true});
  await expect(preview.getByRole('heading',{name:'Saved section 0',exact:true})).toBeVisible();
  await expect(preview.locator('.record-draft-preview-content>section')).toHaveCount(4);
  await page.context().route('**/api/research/drafts/content',route=>route.fulfill({status:503,json:{code:'IO',message:'Synthetic section read failure'}}));
  await preview.getByRole('button',{name:'Next sections',exact:true}).click();await expect(preview.getByRole('alert')).toContainText('Synthetic section read failure');
  await page.context().unroute('**/api/research/drafts/content');await preview.getByRole('button',{name:'Retry saved sections',exact:true}).click();
  await expect(preview.getByRole('heading',{name:'Saved section 4',exact:true})).toBeVisible();await expect(preview).toContainText('Sections 5–8 of 40');
  await preview.getByLabel('Go to section',{exact:true}).fill('39');await preview.getByRole('button',{name:'Go',exact:true}).click();
  await expect(preview.getByRole('heading',{name:'Saved section 38',exact:true})).toBeVisible();await expect(preview.locator('.record-draft-preview-content>section')).toHaveCount(2);
  await page.setViewportSize({width:390,height:844});
  await expect(preview.getByRole('button',{name:'Back to drafts',exact:true})).toBeInViewport();
  expect(await preview.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('paged-draft-review.png')});
  await preview.getByRole('button',{name:'Back to drafts',exact:true}).click();
  await expect(preview).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Recoverable record drafts',exact:true})).toBeVisible();
  expect(f.records).toEqual([]);expect(f.requests.some(url=>url.endsWith('/transfer/readBase')||url.endsWith('/transfer/readPart'))).toBe(false);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});
