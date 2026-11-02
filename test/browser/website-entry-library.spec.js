import {test,expect} from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteLibraryFacets,validateWebsiteLibraryRows} from '../../src/website-file-library.js';
import {websiteSourceUsage,changeWebsitePlacement} from '../../src/website-file-placements.js';
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
  await page.exposeFunction('filesAPI',async(route,data={})=>{
   switch(route.replace('/api/website-files/','')){
    case 'session':return {workspaceId:vault.id,title:'Ecology',sites:(await store.list()).items};
    case 'open':return store.open(id,data);
    case 'version':return {revision:await store.siteVersion(id)};
    case 'library/search':return store.searchLibrary(data);
    case 'library/facets':return store.scope(scope=>websiteLibraryFacets(store,scope,data));
    case 'library/validate':return store.scope(()=>validateWebsiteLibraryRows(store,data));
    case 'library/preview':return store.previewSource(data);
    case 'library/placements':return websiteSourceUsage(store,id,data);
    case 'library/remove-placement':return changeWebsitePlacement(store,id,'remove',data);
    case 'insert-sources':return store.insertSources(id,data);
    case 'insert-source':return store.insertSource(id,data);
    default:throw Error('Unexpected route '+route);
   }
  });
  await mountFilesEditor(page);const browse=page.getByRole('button',{name:'Browse available content',exact:true}),d=page.getByRole('dialog');
  await browse.press('Enter');await expect(d.getByText('24 entries available for websites')).toBeVisible();await expect(d.getByLabel('Search titles or record references')).toBeFocused();await expect(d.locator('.website-picker-results li')).toHaveCount(12);
  await d.locator('[data-picker-facet="book"] summary').click();
  const input=d.getByLabel('Find a lab book by name');await input.fill('Field observations');await input.press('Enter');
  const books=d.locator('[data-action="website-files-picker-choose-book"]');await expect(books).toHaveCount(3);
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
  await a.getByRole('checkbox').check();await b.getByRole('checkbox').check();
  const token=await store.beginSourceUpdate({sourceId:chosen.id,target:'website'});
  await expect(d.locator('.website-picker-queue li')).toHaveCount(1,{timeout:12000});await expect(d.locator('.website-picker-detail')).not.toContainText('Sampling method');
  await store.putSource({sourceId:chosen.id,target:'website',visible:false,title:'Withdrawn'},{token});
 }finally{await closeIdleMutationFiles();await rm(directory,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
});
