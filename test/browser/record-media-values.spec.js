import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {mediaValueFixture} from '../record-media-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {RecordWriting} from '../../src/record-writing.js';

test('reader media details recover, resolve conflicts, retry a lost acknowledgement and preserve late media and accessible descriptions',async({page},info)=>{
 test.setTimeout(240000);
 const f=await mediaValueFixture(),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),read=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=()=>{throw Error('Media detail UI reconstructed a full record');};
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/'))requests.push(new URL(request.url()).pathname);});
 const dialog=page.getByRole('dialog',{name:'Edit Media details',exact:true}),save=()=>dialog.getByRole('button',{name:'Save changes',exact:true}).click(),last=f.record.attachments[8];
 const tail=async()=>{await page.locator('[data-collection-position="attachments"]').fill('9');await page.locator('[data-action="content-collection-go"][data-collection="attachments"]').click();await expect(page.locator('[data-record-media="'+last.id+'"]')).toBeVisible();};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await tail();
  await page.getByRole('button',{name:'Edit media details for Media 8',exact:true}).click();await expect(dialog.getByLabel('Accessible description',{exact:true})).toHaveValue('Description 8');
  await dialog.getByLabel('Transcript / extended description',{exact:true}).fill('First line\nSecond line');await dialog.getByLabel('Caption',{exact:true}).fill('');
  await expect(dialog.locator('[data-writing-status]')).toHaveText('Recovery checkpoint saved.');await dialog.getByRole('button',{name:'Keep recovery checkpoint and close',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.getByRole('dialog',{name:'Recoverable record drafts',exact:true}).getByRole('button',{name:'Review draft',exact:true}).click();
  await expect(dialog.getByLabel('Caption',{exact:true})).toHaveValue('');await expect(dialog.getByLabel('Transcript / extended description',{exact:true})).toHaveValue('First line\nSecond line');
  await dialog.getByLabel('Caption',{exact:true}).fill('Reviewed video');await dialog.getByLabel('Accessible description',{exact:true}).fill('A blue calibration frame');await dialog.getByLabel('Make this media available for website publication',{exact:true}).check();
  let dropped=false;await page.route('**/api/research/records/values/save',async route=>{if(dropped)return route.continue();dropped=true;await route.fetch();await route.abort('failed');});
  await save();await expect(dialog.locator('[data-writing-error]')).not.toBeEmpty();await save();await expect(dialog).not.toBeVisible();await page.unroute('**/api/research/records/values/save');await tail();
  const block=page.locator('[data-record-media="'+last.id+'"]');await expect(block).toContainText('Available for publication');await expect(block.locator('video')).toHaveAttribute('aria-label','A blue calibration frame');await expect(block.locator('.result-statement-text')).toHaveText('First line\nSecond line');
  await page.getByRole('button',{name:'Edit media details for Reviewed video',exact:true}).click();await dialog.getByLabel('Caption',{exact:true}).fill('My correction');
  const base=await f.values.read(f.target(last.id));await f.save(base,{...base.value.value,caption:'Other correction',alt:'Other description'});
  await save();await expect(dialog.locator('.record-writing-conflict')).toContainText('Other description');await dialog.getByRole('button',{name:'Use saved value',exact:true}).click();await expect(dialog.getByLabel('Caption',{exact:true})).toHaveValue('Other correction');
  await dialog.getByLabel('Caption',{exact:true}).fill('Reviewed together');await dialog.getByLabel('Make this media available for website publication',{exact:true}).uncheck();
  const unrelated=await f.values.read(f.target(f.record.attachments[0].id));await f.save(unrelated,{...unrelated.value.value,caption:'Another attachment corrected'});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('media-details-mobile.png')});
  await save();await expect(dialog).not.toBeVisible();expect((await f.values.read(f.target(last.id))).value.value).toEqual({...base.value.value,caption:'Reviewed together',alt:'Other description',share:false});
  await expect.poll(async()=>(await new ResearchDrafts(f.workspace).list({workspaceId:f.book.id})).drafts.length).toBe(0);
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;await app.close();await f.close();}
});

test('an inline image keeps its placement when its description changes and all media kinds retain their own details',async({page})=>{
 test.setTimeout(180000);const f=await mediaValueFixture(),image=f.record.attachments[0],writing=new RecordWriting(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,sectionId:null},base=await writing.read(target);
 const body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Observation before image'}]},{type:'book_figure',attrs:{version:1,id:randomUUID(),figureId:image.id,alternative:'Context for this image'}},{type:'paragraph',content:[{type:'text',text:'Observation after image'}]}]};
 await writing.save({...target,expectedRevision:base.revision,value:{body}});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),read=ResearchCatalogue.prototype.record;ResearchCatalogue.prototype.record=()=>{throw Error('Inline media editing reconstructed a full record');};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');const dialog=page.getByRole('dialog',{name:'Edit Media details',exact:true});
  await page.getByRole('button',{name:'Edit media details for Media 0',exact:true}).click();await dialog.getByLabel('Alternative text',{exact:true}).fill('Measured green target');await dialog.getByLabel('Caption',{exact:true}).fill('Inline caption <not HTML>');await dialog.getByLabel('Transcript / extended description',{exact:true}).fill('Image reading retained');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  const figure=page.locator('.book-figure-placement figure');await expect(figure).toHaveCount(1);await expect(figure.locator('img')).toHaveAttribute('alt','Measured green target');await expect(figure.locator('figcaption')).toHaveText('Inline caption <not HTML>');await expect(figure.locator('.book-diagram-reading')).toHaveText('Image reading retained');expect((await writing.read(target)).value.body).toEqual(body);
  await page.getByRole('button',{name:'Edit media details for Media 1',exact:true}).click();await expect(dialog.getByLabel('Accessible description',{exact:true})).toHaveValue('Description 1');await dialog.getByLabel('Accessible description',{exact:true}).fill('Calibration tone');await dialog.getByLabel('Transcript / extended description',{exact:true}).fill('Tone starts\nTone ends');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('[data-record-media="'+f.record.attachments[1].id+'"] audio')).toHaveAttribute('aria-label','Calibration tone');
  expect((await f.values.read(f.target(f.record.attachments[2].id))).value.value.caption).toBe('Media 2');
 }finally{ResearchCatalogue.prototype.record=read;await app.close();await f.close();}
});
