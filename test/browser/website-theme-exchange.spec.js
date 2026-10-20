import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {createNotebook} from '../../src/model.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {WebsiteEditor} from '../../src/website-editor.js';
import {MediaStore} from '../../src/media.js';
import {WorkspaceFonts} from '../../src/workspace-fonts.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {task} from './composer-helper.js';

test('website theme download and reviewed import retain independent websites and refresh imported design controls',async({page})=>{
 test.setTimeout(150000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-theme-browser-'));let fixture,app,releaseApply;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const book=createNotebook('Theme library');fixture=await encryptedFixture(directory,book);
  const sites=new WebsiteSites(fixture.workspace),create=async name=>(await sites.change({workspaceId:book.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id;
  const sourceId=await create('Field notes'),destinationId=await create('Public journal'),templateId=randomUUID();
  const image=await new MediaStore(fixture.workspace).import(await readFile(new URL('../../src/preview-assets/image.png',import.meta.url)),'image');
  const font=await new WorkspaceFonts(fixture.workspace).import(await readFile(new URL('../../src/fonts/dm-sans.ttf',import.meta.url)),{embed:true});
  const editor=new WebsiteEditor(fixture.workspace),common={workspaceId:book.id,websiteId:sourceId};let source=await editor.execute('open',common);
  source=await editor.execute('change',{...common,websitePin:source.websitePin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[
   {type:'settings',path:['document','appearance'],value:{...source.site.document.appearance,font:font.id}},
   {type:'settings',path:['document','website','palette'],value:{accent:'#268070'}},
   {type:'settings',path:['document','website','templates'],value:[{id:templateId,name:'Illustrated notes',sections:[{id:randomUUID(),kind:'asset',title:'Design image',show:true,assetId:image.id}]}]},
   {type:'append',collection:'assets',values:[{...image,caption:'Design image',alt:'Reusable illustration',transcript:''}]}
  ]});
  await editor.execute('save',{...common,websitePin:source.websitePin,draftId:source.draft.id,expectedRevision:source.draft.revision,commandId:randomUUID()});
  let beforeSource,beforeDestination,research;
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Menu',exact:true})).toBeVisible();
  async function openTheme(id){await page.goto(new URL('/#/websites/'+id+'/editor',app.url).href);await expect(page.locator('.website-site-context')).toContainText(id===sourceId?'Field notes':'Public journal');await task(page,'Site');await page.locator('.theme-exchange>summary').click();}
  await openTheme(sourceId);beforeSource=await sites.read(sourceId);beforeDestination=await sites.read(destinationId);research=(await fixture.workspace.outline()).etag;
  await page.getByLabel('Theme name',{exact:true}).fill('Reusable field design');await page.getByLabel('Illustrated notes',{exact:true}).check();
  await page.getByRole('button',{name:'Review theme export',exact:true}).click();
  const review=page.getByRole('region',{name:'Theme review'});await expect(review).toContainText('Illustrated notes');await expect(review).toContainText('1 media assets and 2 fonts');
  const downloadPromise=page.waitForEvent('download');await review.getByRole('button',{name:'Download theme',exact:true}).click();const download=await downloadPromise,file=path.join(directory,'reviewed-design.obsvtheme');await download.saveAs(file);
  const bytes=await readFile(file);expect(bytes.length).toBeGreaterThan(1000);for(const id of [book.id,sourceId,templateId,image.id,font.id])expect(bytes.includes(Buffer.from(id))).toBe(false);
  await openTheme(destinationId);
  await page.getByLabel('Import website theme',{exact:true}).setInputFiles(file);await expect(review).toContainText('Reusable field design');await expect(review.getByRole('button',{name:'Apply theme to draft',exact:true})).toBeEnabled();
  expect((await sites.read(destinationId)).websitePin).toEqual(beforeDestination.websitePin);
  const fontRefresh=page.waitForResponse(response=>response.url().endsWith('/api/fonts')&&response.request().method()==='GET');
  const pendingApply=new Promise(resolve=>{releaseApply=resolve;}),applyStarted=page.waitForRequest(request=>request.url().endsWith('/api/websites/editor/change')&&request.postDataJSON()?.operations?.some(operation=>operation.type==='theme-apply'));
  const delayApply=async route=>{if(route.request().postDataJSON()?.operations?.some(operation=>operation.type==='theme-apply'))await pendingApply;await route.continue().catch(()=>{});};await page.route('**/api/websites/editor/change',delayApply);
  await review.getByRole('button',{name:'Apply theme to draft',exact:true}).click();await applyStarted;await expect(page.locator('.website-controls')).toHaveJSProperty('inert',true);releaseApply();await expect(review).toHaveCount(0);await expect(page.locator('.website-controls')).toHaveJSProperty('inert',false);expect((await fontRefresh).ok()).toBe(true);await page.unroute('**/api/websites/editor/change',delayApply);
  await expect(page.getByLabel('Illustrated notes',{exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByLabel('Illustrated notes',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(page.getByLabel('Illustrated notes',{exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(page.locator('.website-site-context')).toContainText('Public journal');await task(page,'Site');await page.locator('.theme-exchange>summary').click();await expect(page.getByLabel('Illustrated notes',{exact:true})).toHaveCount(1);
  const saved=await sites.read(destinationId);expect(saved.book.website.palette.accent).toBe('#268070');expect(saved.book.appearance.font).toBe(font.id);expect(saved.book.website.templates[0].id).not.toBe(templateId);expect(saved.book.website.assets[0].id).not.toBe(image.id);expect(saved.book.pages).toEqual(beforeDestination.book.pages);expect(saved.site.selection).toEqual(beforeDestination.site.selection);
  expect((await sites.read(sourceId)).websitePin).toEqual(beforeSource.websitePin);expect((await fixture.workspace.outline()).etag).toBe(research);expect(errors).toEqual([]);
 }finally{releaseApply?.();await page.close();await app?.close();if(fixture)clearVault(fixture.vault);expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));await rm(directory,{recursive:true,force:true});}
});
