import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {openRecordWriting} from './record-editing-helper.js';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {researchReference} from '../../src/web/research-reference.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {createFigure} from '../../src/web/figure-model.js';

async function fixture(page,{figures=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-book-reader-')),book=upgradeNotebook(sampleNotebook()),base=book.entries[2];
 book.entries=Array.from({length:7},(_,i)=>({...structuredClone(base),id:randomUUID(),title:'Reading '+i,body:'Complete observation '+i,sections:[],figures:[],attachments:[],relations:[],tags:['reading'],occurredOn:'2026-10-0'+(i+1)}));
 if(figures){
  const plot=createFigure();plot.x.min=0;plot.x.max=10;plot.y.min=0;plot.y.max=10;
  plot.series[0].points=[{x:-10,y:-10,error:null},{x:5,y:5,error:2},{x:20,y:20,error:null}];
  for(const record of book.entries)record.figures=[structuredClone(plot)];
 }
 const href=researchReference({workspaceId:book.id,kind:'record',id:book.entries[0].id}),sectionId=randomUUID();
 book.entries[6].body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Complete observation 6. '},{type:'text',text:'Earlier observation',marks:[{type:'link',attrs:{href,title:'Earlier observation',target:'_self',nofollow:false}}]},{type:'text',text:' External method',marks:[{type:'link',attrs:{href:'https://example.org/method',title:'Method',target:'_blank',nofollow:false}}]}]}]};
 book.entries[6].body.content[0].content.push({type:'text',text:' Jump to notes',marks:[{type:'link',attrs:{href:'#record-section-'+sectionId,title:'Notes',target:'_self',nofollow:false}}]});
 book.entries[6].sections=[{id:sectionId,title:'Notes in this record',body:'Preserved section content.'}];
 const f=await encryptedFixture(directory,book),before=await f.workspace.read(),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')}),errors=[],selections=[],fullReads=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{const url=new URL(r.url()).pathname;if(url==='/api/workspace/read/selection')selections.push(r.postDataJSON());if(['/api/notebook','/api/workspace/read/page'].includes(url))fullReads.push(url);if(url==='/api/research/records/save')writes.push(url);});
 await page.goto(app.url);await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[0].id);await expect(page.locator('.records-table tbody tr')).toHaveCount(7);
 return {...f,app,book,before,href,errors,selections,fullReads,writes,close:async()=>{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}};
}

test('read full lab-book pages, follow visible links, return to the book and explicitly enter editing',async({page},info)=>{
 const f=await fixture(page),entries=page.locator('[data-reading-record]');
 try{
  await page.getByRole('button',{name:'Read lab book',exact:true}).click();await expect(entries).toHaveCount(5);await expect(page).toHaveURL(/\/read$/);
  await expect(entries.first()).toContainText('Complete observation 6');await expect(entries.last()).toContainText('Complete observation 2');await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
  expect(f.selections.at(-1).ids).toHaveLength(5);expect(f.selections.at(-1).snapshotId).toBe(f.before.etag);
  const readingURL=page.url();await entries.first().locator('.prose').getByRole('link',{name:'Jump to notes',exact:true}).click();await expect(page).toHaveURL(readingURL);await expect(entries.first().locator('section').filter({has:page.getByRole('heading',{name:'Notes in this record',exact:true})})).toBeFocused();
  const link=entries.first().locator('.prose').getByRole('link',{name:'Earlier observation',exact:true});
  expect(await link.evaluate(a=>{const s=getComputedStyle(a);return s.color!==getComputedStyle(a.parentElement).color&&s.textDecorationLine.includes('underline');})).toBe(true);
  await entries.first().getByText('Links in this record',{exact:true}).click();await expect(entries.first().locator('.record-link-listing')).toContainText(f.href);
  await link.click();await expect(page.locator('.record-reader h1')).toHaveText('Reading 0');await expect(page.locator('[contenteditable=true]')).toHaveCount(0);
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(entries).toHaveCount(5);await expect(page.getByRole('button',{name:'Read lab book',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Next records',exact:true}).click();await expect(entries).toHaveCount(2);await expect(entries.first()).toContainText('Complete observation 1');
  await entries.first().getByRole('button',{name:'Evidence and record details',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Reading 1');
  await page.getByRole('button',{name:'Back to records',exact:true}).click();await expect(entries).toHaveCount(2);
  await page.getByRole('button',{name:'Previous records',exact:true}).click();await expect(entries).toHaveCount(5);
  await page.reload();await expect(entries).toHaveCount(5);
  await page.screenshot({path:info.outputPath('lab-book-reading-desktop.png')});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.setProperty('--app-font-size','32px'));expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await entries.first().scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('lab-book-reading-phone.png')});
  await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.documentElement.style.removeProperty('--app-font-size'));
  await entries.first().getByRole('button',{name:'Edit record',exact:true}).click();await expect(page.locator('.record-editing h1')).toHaveText('Reading 6');await openRecordWriting(page);
  const field=page.locator('.document-field').first(),editorLink=field.getByRole('link',{name:'Earlier observation',exact:true});
  await editorLink.click();const inspector=field.getByRole('group',{name:'Link destination',exact:true});await expect(inspector).toBeVisible();await expect(inspector).toContainText(f.href);
  const bounds=await inspector.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,content:el.closest('.document-field').querySelector('.document-content').getBoundingClientRect().top}));expect(bounds.bottom).toBeLessThanOrEqual(bounds.content);
  await inspector.getByRole('button',{name:'Open link',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText('Reading 0');
  expect((await f.workspace.read()).etag).toBe(f.before.etag);expect(f.writes).toEqual([]);expect(f.fullReads).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('book reading keeps copied figures clipped to their own axes after pagination and refresh',async({page},info)=>{
 const f=await fixture(page,{figures:true}),entries=page.locator('[data-reading-record]');
 const check=async()=>{
  const plots=await entries.locator('.figure-series-graphic').evaluateAll(nodes=>nodes.map(node=>{
   const reference=node.getAttribute('clip-path'),id=reference.match(/^url\(#(.+)\)$/)?.[1],target=id&&document.getElementById(id);
   return {reference,resolved:target?.tagName==='clipPath',local:node.closest('[data-reading-record]')===target?.closest('[data-reading-record]'),unique:id?[...document.querySelectorAll('[id]')].filter(el=>el.id===id).length:0};
  }));
  expect(plots.length).toBeGreaterThan(0);for(const plot of plots){expect(plot.resolved).toBe(true);expect(plot.local).toBe(true);expect(plot.unique).toBe(1);}
 };
 try{
  await page.getByRole('button',{name:'Read lab book',exact:true}).click();await expect(entries).toHaveCount(5);await check();
  await entries.first().locator('svg').screenshot({path:info.outputPath('book-figure-clipping.png')});
  await page.getByRole('button',{name:'Next records',exact:true}).click();await expect(entries).toHaveCount(2);await check();
  await page.reload();await expect(entries).toHaveCount(5);await check();
  await page.getByRole('button',{name:'Refresh records',exact:true}).click();await expect(entries).toHaveCount(5);await check();
  expect((await f.workspace.read()).etag).toBe(f.before.etag);expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('a failed reading page can retry and switching view discards a late selection response',async({page})=>{
 const f=await fixture(page);let release;
 try{
  await page.route('**/api/workspace/read/selection',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic page interruption'})}));
  await page.getByRole('button',{name:'Read lab book',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Synthetic page interruption');await expect(page.locator('[data-reading-record]')).toHaveCount(0);
  await page.unroute('**/api/workspace/read/selection');await page.getByRole('button',{name:'Refresh records',exact:true}).click();await expect(page.locator('[data-reading-record]')).toHaveCount(5);
  let entered;const ready=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>release=resolve);
  await page.route('**/api/workspace/read/selection',async route=>{const response=await route.fetch();entered();await waiting;await route.fulfill({response});});
  await page.getByRole('button',{name:'Next records',exact:true}).click();await ready;
  await page.getByRole('button',{name:'Record list',exact:true}).click();await expect(page.locator('.records-table tbody tr')).toHaveCount(7);release();
  await page.unrouteAll({behavior:'wait'});await expect(page.locator('[data-reading-record]')).toHaveCount(0);await expect(page.getByRole('button',{name:'Record list',exact:true})).toHaveAttribute('aria-pressed','true');
  expect((await f.workspace.read()).etag).toBe(f.before.etag);expect(f.errors).toEqual([]);
 }finally{release?.();await f.close();}
});
