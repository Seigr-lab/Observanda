import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {newElement} from '../../src/web/composition-tree.js';
import {mediaStyle} from '../../src/web/media-presentation.js';
import {MediaStore} from '../../src/media.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {navigate} from './preferences-helper.js';
import {openBlock,editorTab} from './composer-helper.js';

test('authors choose gallery inspection; visitors enlarge, navigate, download and return to the selected image',async({page,browser},info)=>{
 test.setTimeout(90000);page.setDefaultTimeout(15000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-gallery-viewer-')),f=await encryptedFixture(root,sampleNotebook()),store=new MediaStore(f.workspace.root,f.vault),bytes=await readFile(new URL('../../src/preview-assets/image.png',import.meta.url)),assets=[];
 for(let i=0;i<3;i++)assets.push({...await store.import(bytes,'image'),caption:'Plant study '+i,alt:'Plant detail '+i,transcript:''});
 const sites=new WebsiteSites(f.workspace),saved=await sites.read(null),book=saved.book,first={...newElement('gallery',randomUUID),title:'Field studies',assetIds:assets.map(a=>a.id)},second={...newElement('gallery',randomUUID),title:'Another gallery',assetIds:[assets[1].id]};book.website.assets=assets;book.website.home={...book.website.home,enabled:true,sections:[first,second]};
 const scope='home#'+first.id;book.website.presentation.media.push({...mediaStyle(book.website,scope,assets[2].id),scope,id:assets[2].id,link:'https://example.org/research'});await sites.save(null,{workspaceId:book.id,baseEtag:saved.etag,websitePin:saved.websitePin,metadata:{website:book.website},projects:[],changes:[],removed:[],selection:saved.site.selection});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(root,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await navigate(page,'Website editor');await editorTab(page,'Homepage');await openBlock(page,0);await page.getByRole('button',{name:'Choose and arrange images',exact:true}).click();
  const option=page.getByLabel('Open images in a viewer',{exact:true});await expect(option).toBeChecked();await option.uncheck();await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await editorTab(page,'Homepage');await openBlock(page,0);await page.getByRole('button',{name:'Choose and arrange images',exact:true}).click();await expect(option).not.toBeChecked();await option.check();
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website',exact:true})).toBeVisible({timeout:45000});
  const href=await page.locator('#full-public-preview').getAttribute('href'),url=new URL(href,app.origin).href,visitor=await page.context().newPage();visitor.setDefaultTimeout(15000);visitor.on('pageerror',error=>errors.push(error.message));
  try{
   await visitor.goto(url,{waitUntil:'domcontentloaded'});const group=visitor.locator('[data-section-id="'+first.id+'"]'),link=group.locator('[data-gallery-image]').first();await expect(group.locator('a[href="https://example.org/research"]')).toHaveCount(1);await link.focus();await visitor.keyboard.press('Enter');
   const dialog=visitor.getByRole('dialog',{name:'Image gallery',exact:true});await expect(dialog).toBeVisible();await expect.poll(()=>dialog.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),{timeout:15000}).toBe(true);await expect(dialog.getByRole('button',{name:'Previous image',exact:true})).toBeDisabled();await expect(dialog.getByRole('status')).toHaveText('Image 1 of 2');await expect(dialog.locator('img')).toHaveAttribute('alt','Plant detail 0');
   await visitor.keyboard.press('ArrowRight');await expect(dialog.getByRole('status')).toHaveText('Image 2 of 2');await expect(dialog.locator('.public-gallery-caption')).toHaveText('Plant study 1');await expect(dialog.getByRole('button',{name:'Next image',exact:true})).toBeDisabled();
   await dialog.getByRole('button',{name:'Actual image size',exact:true}).click();await expect(dialog.getByRole('button',{name:'Actual image size',exact:true})).toHaveAttribute('aria-pressed','true');
   const transfer=visitor.waitForEvent('download');await dialog.getByRole('link',{name:'Download image',exact:true}).click();const download=await transfer;expect(await readFile(await download.path())).toEqual((await store.get(assets[1].id)).bytes);
   await visitor.screenshot({path:info.outputPath('gallery-desktop.png')});await visitor.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(link).toBeFocused();
   await visitor.locator('[data-section-id="'+second.id+'"] [data-gallery-image]').click();await expect(dialog.getByRole('status')).toHaveText('Image 1 of 1');await expect(dialog.getByRole('button',{name:'Next image',exact:true})).toBeDisabled();await visitor.setViewportSize({width:390,height:844});await visitor.screenshot({path:info.outputPath('gallery-mobile.png')});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await dialog.getByRole('button',{name:'Close gallery',exact:true}).click();
  }finally{await visitor.close();}
  const fallback=await browser.newContext({javaScriptEnabled:false});await fallback.addCookies(await page.context().cookies());const reader=await fallback.newPage();try{await reader.goto(url);const image=reader.locator('[data-gallery-image]').first();const target=await image.getAttribute('href');await image.click();expect(new URL(reader.url()).pathname.endsWith(target)).toBe(true);await expect(reader.locator('img')).toBeVisible();}finally{await fallback.close();}
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
