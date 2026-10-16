import {test,expect} from '@playwright/test';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {mediaValueFixture} from '../record-media-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {RecordContent} from '../../src/record-content.js';
import {MediaImports} from '../../src/media-imports.js';
import {MediaStore} from '../../src/media.js';
import {DurableJobs} from '../../src/jobs.js';

test('reader uploads and removes media with acknowledgement retries, retained originals and no full-record editor',async({page},info)=>{
 test.setTimeout(180000);const f=await mediaValueFixture(),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),read=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=()=>{throw Error('Reader media intake reconstructed a full record');};
 const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/api/'))requests.push(new URL(request.url()).pathname);});
 const imports=new MediaImports(f.workspace),reader=new RecordContent(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');
  let lost=false;await page.route('**/api/research/records/media',async route=>{if(lost)return route.continue();lost=true;await route.fetch();await route.abort('failed');});
  await page.getByLabel('Add image, audio or video',{exact:true}).setInputFiles(f.files.audio.file);
  await expect(page.getByRole('button',{name:'Retry media change',exact:true})).toBeVisible({timeout:30000});
  await page.getByRole('button',{name:'Retry media change',exact:true}).click();await expect(page.getByRole('button',{name:'Retry media change',exact:true})).toHaveCount(0);
  const [received]=await imports.list(),id=received.id,block=page.locator('[data-record-media="'+id+'"]');
  await expect(block.locator('audio')).toBeVisible();expect((await reader.read({...target,windows:{attachments:9}})).collections.attachments.total).toBe(10);
  await page.unroute('**/api/research/records/media');
  await block.getByRole('button',{name:'Edit media details for Audio',exact:true}).click();const details=page.getByRole('dialog',{name:'Edit Media details',exact:true});
  await details.getByLabel('Caption',{exact:true}).fill('Intake tone');await details.getByRole('button',{name:'Save changes',exact:true}).click();await expect(details).not.toBeVisible();
  await page.getByRole('button',{name:'Media imports',exact:true}).click();const library=page.getByRole('dialog',{name:'Media imports',exact:true});
  await expect(library).toContainText('attaches a prepared copy to this record immediately');
  const downloadEvent=page.waitForEvent('download');await library.getByRole('link',{name:'Download original',exact:true}).click();expect(await readFile(await (await downloadEvent).path())).toEqual(f.files.audio.bytes);
  await library.getByRole('button',{name:'Use media',exact:true}).click();await expect(library).not.toBeVisible();await expect(block).toContainText('Intake tone');
  expect((await reader.read(target)).collections.attachments.total).toBe(10);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await page.locator('.record-media-intake').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('reader-media-intake-mobile.png')});
  page.once('dialog',dialog=>dialog.accept());lost=false;await page.route('**/api/research/records/media',async route=>{if(lost)return route.continue();lost=true;await route.fetch();await route.abort('failed');});
  await block.getByRole('button',{name:'Remove media',exact:true}).click();await expect(page.getByRole('button',{name:'Retry media change',exact:true})).toBeVisible();await page.getByRole('button',{name:'Retry media change',exact:true}).click();
  await expect(page.getByRole('button',{name:'Retry media change',exact:true})).toHaveCount(0);await expect(block).toHaveCount(0);expect((await reader.read(target)).collections.attachments.total).toBe(9);
  await page.reload();await page.getByRole('button',{name:'Media imports',exact:true}).click();await expect(library.getByRole('button',{name:'Use media',exact:true})).toBeVisible();
  expect(requests.filter(route=>/^\/api\/workspace\/read\/(selection|page)$/.test(route)||route==='/api/research/records/save')).toEqual([]);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=read;await app.close();await f.close();}
});

test('prepared uploads survive navigation and service restart, then attach to the chosen empty reader and can be shared',async({page})=>{
 test.setTimeout(180000);const f=await mediaValueFixture({count:0,shared:true}),options={root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')};
 let app=await testServer(options),release,entered=false;const wait=new Promise(resolve=>release=resolve),prepare=MediaStore.prototype.prepare,read=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.record=()=>{throw Error('Reader media library reconstructed a full record');};
 MediaStore.prototype.prepare=async function(...args){entered=true;await wait;return prepare.apply(this,args);};
 const reader=new RecordContent(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true},imports=new MediaImports(f.workspace),other=f.book.entries[1].id;
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByLabel('Add image, audio or video',{exact:true}).setInputFiles(f.files.image.file);
  await expect.poll(()=>entered).toBe(true);await page.evaluate(id=>location.hash='#/records/'+id+'/read',other);await expect(page.getByRole('heading',{name:'Another record using the same media',exact:true})).toBeVisible();release();
  const [received]=await imports.list();await expect.poll(async()=>(await new DurableJobs(f.workspace,{}).read(received.id))?.state,{timeout:30000}).toBe('completed');
  expect((await reader.read(target)).header.attachments).toEqual([]);expect((await reader.read({...target,recordId:other})).header.attachments).toEqual([]);
  await app.close();app=await testServer(options);await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');
  const library=page.getByRole('dialog',{name:'Media imports',exact:true});await page.getByRole('button',{name:'Media imports',exact:true}).click();await library.getByRole('button',{name:'Use media',exact:true}).click();
  await expect(page.locator('[data-record-media="'+received.id+'"] img')).toBeVisible();
  await page.goto(app.origin+'/#/records/'+other+'/read');await page.getByRole('button',{name:'Media imports',exact:true}).click();await library.getByRole('button',{name:'Use media',exact:true}).click();await expect(page.locator('[data-record-media="'+received.id+'"] img')).toBeVisible();
  expect((await reader.read(target)).header.attachments[0].id).toBe(received.id);expect((await reader.read({...target,recordId:other})).header.attachments[0].id).toBe(received.id);
 }finally{release();MediaStore.prototype.prepare=prepare;ResearchCatalogue.prototype.record=read;await app.close();await f.close();}
});
