import {test,expect} from '@playwright/test';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {validateWebsiteLibraryRows,websiteLibraryFacets} from '../../src/website-file-library.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {seedWebsitePickerCorpus} from '../helpers/website-picker-corpus.js';
import {mountFilesEditor} from './mount-files-editor.js';

test.use({screenshot:'off',trace:'off',video:'off'});
test('dock the library and drop a permitted entry between authored sections in the canvas',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-canvas-drop-'));
 try{
  await mkdir(path.join(root,'.observanda'));
  const vault=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
  vault.catalogue=vault.storageKind=()=>{throw Error('Unexpected research read');};
  const store=new WebsiteFileStore(vault);
  await seedWebsitePickerCorpus(store,{count:6});
  const first=await store.create({name:'Survey atlas'}),id=first.site.id;
  await store.save(id,{path:first.path,expectedRevision:first.site.revision,css:first.css,
   html:'<!doctype html><html><head><title>Survey atlas</title></head><body><main><h1>Field survey</h1><p>Results follow</p></main></body></html>'});
  const calls=[];
  await page.exposeFunction('filesAPI',async(route,data={})=>{
   switch(route.slice('/api/website-files/'.length)){
    case 'session':return {workspaceId:vault.id,defaultSiteId:id,sites:(await store.list()).items};
    case 'open':return store.open(id,data);
    case 'version':return {revision:await store.siteVersion(id)};
    case 'preparation':return {preparation:{library:{}}};
    case 'library/search':return store.searchLibrary(data);
    case 'library/facets':return store.scope(scope=>websiteLibraryFacets(store,scope,data));
    case 'library/validate':return store.scope(()=>validateWebsiteLibraryRows(store,data));
    case 'insert-source':calls.push(data);return store.insertSource(id,data);
    default:throw Error('Unexpected route '+route);
   }
  });
  await page.setViewportSize({width:1440,height:900});await mountFilesEditor(page);
  const canvas=page.frameLocator('#website-files-canvas'),target=canvas.getByText('Results follow');
  await expect(target).toBeVisible();
  await page.getByRole('button',{name:'Browse available content'}).click();
  const dialog=page.getByRole('dialog');
  await expect(dialog.locator('[data-picker-row]')).toHaveCount(6);
  await dialog.getByRole('button',{name:'Place on canvas'}).click();
  await expect(dialog).toHaveAttribute('data-placement-dock','');
  const row=dialog.locator('[data-picker-row]').first(),sourceId=await row.getAttribute('data-picker-row');
  const handle=await row.locator('[data-picker-drag-handle]').boundingBox(),block=await target.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(block.x+block.width/2,block.y+2,{steps:22});
  await page.mouse.move(block.x+block.width/2+1,block.y+3);await page.mouse.up();
  await expect.poll(()=>calls.length).toBe(1);
  expect(calls[0]).toMatchObject({sourceId,position:{before:1}});
  await expect(canvas.locator('main > h1 + [data-observanda-source] + p')).toHaveText('Results follow');
  expect((await store.open(id)).html).not.toContain('website-placement-line');
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true});}
});
