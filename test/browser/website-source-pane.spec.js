import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('edit scientific HTML and CSS alongside the canvas, correct invalid source, save and reopen',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(12000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-source-pane-'));
 try{
  await mkdir(path.join(root,'.observanda'));const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
  workspace.catalogue=workspace.openCatalogue=()=>{throw Error('The code editor opened research');};
  const store=new WebsiteFileStore(workspace),id=randomUUID(),html='<!doctype html><html lang="en"><head><title>Seismic survey</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Seismic survey</h1><p id="depth">Depth at station 1.</p></main></body></html>';
  await store.importFiles(id,{name:'Survey',files:new Map([['index.html',html],['style.css','p{line-height:1.4}']])});
  const initial=await store.siteVersion(id),calls=[];
  await page.exposeFunction('filesAPI',async(route,data)=>{
   let result;calls.push(route);try{
    await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace,url:new URL(route,'https://website.test'),body:async()=>data??{},json:r=>{result=r;},check:async()=>{},preparation:async()=>({state:'ready',defaultSiteId:id})});
    return result;
   }catch(reason){return {errorCode:reason.code,message:reason.message};}
  });
  await mountFilesEditor(page);await page.getByRole('button',{name:'Canvas and code',exact:true}).click();const canvas=page.frameLocator('#website-files-canvas'),code=page.getByRole('textbox',{name:'HTML',exact:true});
  await expect(canvas.locator('#depth')).toHaveText('Depth at station 1.');
  await code.fill(html.replace('Depth at station 1.','<iframe src="https://example.invalid"></iframe>'));
  await expect(page.locator('[data-source-status]')).toContainText('last valid draft');await expect(canvas.locator('iframe')).toHaveCount(0);
  await expect(canvas.locator('#depth')).toHaveText('Depth at station 1.');expect(await store.siteVersion(id)).toBe(initial);
  await code.fill(html.replace('Depth at station 1.','Depth 2 × 10<sup>3</sup> m.'));await expect(canvas.locator('#depth sup')).toHaveText('3');
  await canvas.locator('#depth').click();await page.keyboard.press('End');await page.keyboard.type(' Verified.');
  await expect(code).toHaveValue(/Verified\./);await page.getByRole('combobox',{name:'Source language'}).selectOption('css');
  const css=page.getByRole('textbox',{name:'CSS',exact:true});await css.fill('#depth{color:rgb(24,92,81)}');
  await expect(canvas.locator('#depth')).toHaveCSS('color','rgb(24, 92, 81)');expect(await store.siteVersion(id)).toBe(initial);
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.reload();await expect(canvas.locator('#depth')).toContainText('Verified.');
  await expect(canvas.locator('#depth')).toHaveCSS('color','rgb(24, 92, 81)');const saved=await store.open(id);
  expect(saved.html).toContain('<sup>3</sup>');expect(saved.css).toBe('#depth{color:rgb(24,92,81)}');
  expect(calls.filter(p=>p==='/api/website-files/save')).toHaveLength(1);
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:12,retryDelay:100});}
});
