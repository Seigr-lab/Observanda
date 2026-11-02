import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {validateWebsiteLibraryRows,websiteLibraryFacets} from '../../src/website-file-library.js';
import {websiteSourceUsage} from '../../src/website-file-placements.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {seedWebsitePickerCorpus} from '../helpers/website-picker-corpus.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('a website entry opens before owner counts finish and late counts cannot restore a withdrawn entry',async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'website-picker-counts-'));
 const held=Promise.withResolvers();let waiting=0;
 try{
  await mkdir(path.join(directory,'.observanda'));
  const vault=new Workspace(directory,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(vault);
  const {examples:[source]}=await seedWebsitePickerCorpus(store,{count:1}),{site}=await store.create({name:'Atlas'});
  await page.exposeFunction('filesAPI',async(route,data={})=>{
   switch(route.replace('/api/website-files/','')){
    case 'session':return {workspaceId:vault.id,title:'Ecology',defaultSiteId:site.id,sites:[site]};
    case 'open':return store.open(data.siteId,data);
    case 'version':return {revision:await store.siteVersion(site.id)};
    case 'preparation':return {preparation:{}};
    case 'library/search':return store.searchLibrary(data);
    case 'library/preview':return store.previewSource(data);
    case 'library/placements':return websiteSourceUsage(store,site.id,data);
    case 'library/validate':return store.scope(()=>validateWebsiteLibraryRows(store,data));
    case 'library/facets':{
     const result=await store.scope(scope=>websiteLibraryFacets(store,scope,data));
     if(waiting<2){waiting++;await held.promise;}return result;
    }
    default:throw Error('Unexpected route '+route);
   }
  });
  await mountFilesEditor(page);await page.getByRole('button',{name:'Browse available content'}).click();
  const d=page.getByRole('dialog');await expect.poll(()=>waiting).toBe(2);
  await d.getByRole('button',{name:'Transect observation',exact:true}).click();await expect(d.locator('.website-picker-detail')).toContainText('Sampling method');
  await expect(d.locator('[data-picker-total]')).toBeEmpty();
  const token=await store.beginSourceUpdate({sourceId:source.id,target:'website'});
  await expect(d.locator('.website-picker-results li')).toHaveCount(0,{timeout:12000});
  await expect(d.locator('[data-picker-total]')).toHaveText('0 entries available for websites');
  held.resolve();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await expect(d.locator('[data-picker-total]')).toHaveText('0 entries available for websites');
  await expect(d).not.toContainText('Sampling method');await expect(d.locator('[data-picker-owner-results] button')).toHaveCount(0);
  await store.putSource({sourceId:source.id,target:'website',visible:false,title:'Withdrawn'},{token});
 }finally{held.resolve();await closeIdleMutationFiles();await rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
});
