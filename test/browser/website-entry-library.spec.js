import {test,expect} from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteLibraryFacets,validateWebsiteLibraryRows} from '../../src/website-file-library.js';
import {websiteSourceUsage,changeWebsitePlacement,websitesUsingSource} from '../../src/website-file-placements.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {seedWebsitePickerCorpus} from '../helpers/website-picker-corpus.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('browse eligible books, insert a reviewed group, locate repeated placements, remove one and fence a revoked choice',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'website-entry-library-'));
 try{
  await mkdir(path.join(directory,'.observanda'));const vault=new Workspace(directory,{id:randomUUID(),key:randomBytes(32)});
  vault.storageKind=vault.catalogue=()=>{throw Error('Unexpected research read');};
  const store=new WebsiteFileStore(vault),corpus=await seedWebsitePickerCorpus(store,{count:24});
  const first=await store.create({name:'Survey atlas'}),id=first.site.id;
  await store.save(id,{path:'notes.html',title:'Field notes',expectedRevision:first.site.revision,html:'<!doctype html><html><head><title>Field notes</title></head><body><main><h1>Field notes</h1></main></body></html>',css:first.css});
  const otherSite=await store.create({name:'Regional archive'}),source=corpus.examples.find(e=>e.notebookId===corpus.books[0].id);
  let otherPage=otherSite;for(let n=0;n<2;n++)otherPage=await store.insertSource(otherSite.site.id,{sourceId:source.id,sourceRevision:source.revision,expectedRevision:otherPage.site.revision});
  let siteScans=0;
  const fileAPI=async(route,data={})=>{
   switch(route.replace('/api/website-files/','')){
    case 'session':return {workspaceId:vault.id,title:'Ecology',defaultSiteId:id,sites:(await store.list()).items};
    case 'open':return store.open(data.siteId,data);
    case 'version':return {revision:await store.siteVersion(data.siteId)};
    case 'preparation':return {preparation:{library:{state:'locked'}}};
    case 'library/search':return store.searchLibrary(data);
    case 'library/facets':return store.scope(scope=>websiteLibraryFacets(store,scope,data));
    case 'library/validate':return store.scope(()=>validateWebsiteLibraryRows(store,data));
    case 'library/preview':return store.previewSource(data);
    case 'library/placements':return websiteSourceUsage(store,data.siteId,data);
    case 'library/sites':siteScans++;return websitesUsingSource(store,data);
    case 'library/remove-placement':return changeWebsitePlacement(store,data.siteId,'remove',data);
    case 'insert-sources':return store.insertSources(data.siteId,data);
    case 'insert-source':return store.insertSource(data.siteId,data);
    default:throw Error('Unexpected route '+route);
   }
  };
  await page.exposeFunction('filesAPI',(route,data)=>fileAPI(route,data).catch(error=>{
   if(!error.code)throw error;
   return {errorCode:error.code,message:error.message};
  }));
  await page.setViewportSize({width:1280,height:800});await mountFilesEditor(page);const browse=page.getByRole('button',{name:'Browse available content',exact:true}),d=page.getByRole('dialog');
  await browse.press('Enter');await expect(d.getByText('24 entries available for websites')).toBeVisible();await expect(d.getByLabel('Search titles or record references')).toBeFocused();await expect(d.locator('.website-picker-results li')).toHaveCount(12);
  await d.locator('[data-picker-facet="book"] summary').click();
  const input=d.getByLabel('Find a lab book by name');await input.fill('Field observations');await input.press('Enter');
  const books=d.locator('[data-action="website-files-picker-choose-book"]');await expect(books).toHaveCount(3);await expect(books.first()).toBeVisible();
  await books.filter({hasText:'Coastal ecology'}).click();await expect(d.locator('.website-picker-results li')).toHaveCount(4);
  await d.locator('[data-picker-facet="project"] summary').click();await d.locator('[data-action="website-files-picker-clear-project"]').click();
  async function duplicates(){
   const query=d.getByLabel('Search titles or record references');await query.fill('Transect observation');await query.press('Enter');
   await expect(d.locator('.website-picker-results li')).toHaveCount(6);
  }
  await duplicates();
  const results=()=>d.locator('.website-picker-results li'),a=results().filter({hasText:'Coastal ecology › Field observations'}),b=results().filter({hasText:'Forest phenology › Instrument surveys'});
  await a.getByRole('checkbox').check();await b.getByRole('checkbox').check();
  await d.locator('.website-picker-queue li').last().getByRole('button',{name:'Move up',exact:true}).click();
  await d.getByRole('button',{name:'Insert 2 entries in this order'}).click();await expect(d.getByRole('status')).toHaveText('Inserted 2 into the saved page.');
  const saved=await store.open(id),chosen=corpus.examples.find(e=>e.notebookId===corpus.books[0].id),other=corpus.examples.find(e=>e.notebookId===corpus.books.at(-1).id);
  expect(saved.html.indexOf(other.id)).toBeLessThan(saved.html.indexOf(chosen.id));
  await a.getByRole('button',{name:'Preview',exact:true}).click();await expect(d.locator('.website-picker-detail')).toContainText('Sampling method');
  await expect(d.locator('.website-picker-facts')).toContainText('Hypothesis');
  await expect(d.locator('.website-picker-detail').getByRole('heading',{name:'Entry text'})).toBeVisible();
  const bounds=await d.evaluate(el=>{
   const area=el.getBoundingClientRect(),button=el.querySelector('[data-action="website-files-picker-insert"]').getBoundingClientRect();
   return {clip:el.scrollHeight-el.clientHeight,inside:button.top>=area.top&&button.bottom<=area.bottom&&button.right<=area.right};
  });expect(bounds.inside).toBe(true);expect(bounds.clip).toBeLessThanOrEqual(1);
  await d.getByRole('button',{name:'Insert another copy'}).click();await expect(d.getByRole('heading',{name:'Uses in this website (2)'})).toBeVisible();
  await d.getByRole('button',{name:'Close content picker'}).click();await page.locator('[data-website-file-page]').selectOption('notes.html');await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Field notes');
  await browse.click();await duplicates();await a.getByRole('button',{name:'Preview',exact:true}).click();await d.getByRole('button',{name:'Insert another copy'}).click();
  const uses=d.locator('.website-picker-places');await expect(uses).toContainText('Pages with this entry: 2');
  const home=()=>uses.locator('li').filter({hasText:'index.html'}).first();await home().getByRole('button',{name:'Open this placement'}).click();
  await expect(d).toHaveCount(0);await expect(page.locator('[data-website-file-page]')).toHaveValue('index.html');
  await browse.click();await duplicates();await a.getByRole('button',{name:'Preview',exact:true}).click();
  await home().getByRole('button',{name:'Remove this placement'}).click();await home().getByRole('button',{name:'Confirm removal'}).click();
  await expect(uses.getByRole('heading',{name:'Uses in this website (2)'})).toBeVisible();
  expect((await store.open(id)).html.split('data-observanda-source="'+chosen.id+'"').length-1).toBe(1);
  expect((await store.open(id,{path:'notes.html'})).html).toContain(chosen.id);
  const where=d.getByRole('button',{name:'Where used',exact:true}),back=d.getByRole('button',{name:'Show entry details',exact:true});
  await where.press('Enter');await expect(back).toBeFocused();await expect(d.getByRole('heading',{name:'Uses in this website (2)'})).toBeInViewport();
  await back.press('Enter');await expect(where).toBeFocused();await expect(d.getByRole('heading',{name:'Entry text'})).toBeVisible();
  await where.press('Enter');
  expect(siteScans).toBe(0);
  await d.getByRole('button',{name:'Find usage across websites'}).click();
  const external=d.locator('[data-action="website-files-picker-use-site"]').filter({hasText:'Regional archive'});await external.click();
  await expect(uses).toContainText('Uses in Regional archive (2)');
  await uses.locator('li').filter({hasText:'Occurrence 2'}).getByRole('button',{name:'Remove this placement'}).click();
  await uses.getByRole('button',{name:'Confirm removal'}).click();await expect(uses).toContainText('Uses in Regional archive (1)');
  expect((await store.open(otherSite.site.id)).html.split('data-observanda-source="'+chosen.id+'"').length-1).toBe(1);
  await uses.getByRole('button',{name:'Open this placement'}).first().click();await expect(page.locator('[data-website-file-site]')).toHaveValue(otherSite.site.id);
  await browse.click();await duplicates();
  await a.getByRole('checkbox').check();await b.getByRole('checkbox').check();
  const unrelated=await store.beginSourceUpdate({sourceId:other.id,target:'website'});
  const queue=d.locator('.website-picker-queue li');await expect(queue).toHaveCount(1,{timeout:12000});
  await expect(queue.locator('[data-source="'+chosen.id+'"]').first()).toBeVisible();await expect(d).not.toContainText('Sampling method');
  await store.putSource({sourceId:other.id,target:'website',visible:false,title:'Withdrawn'},{token:unrelated});
  const token=await store.beginSourceUpdate({sourceId:chosen.id,target:'website'});
  await expect(page.locator('#website-files-canvas')).toHaveCount(0,{timeout:12000});await expect(d).toHaveCount(0);
  await store.putSource({sourceId:chosen.id,target:'website',visible:false,title:'Withdrawn'},{token});
 }finally{await closeIdleMutationFiles();await rm(directory,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
});
