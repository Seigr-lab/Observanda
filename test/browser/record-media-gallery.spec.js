import {test,expect} from '@playwright/test';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {mediaValueFixture} from '../record-media-values-fixture.js';
import {testServer} from '../device-fixture.js';

test('a large record gallery shows reduced copies, pages by 24 and opens a display copy only on request',async({page})=>{
 test.setTimeout(180000);
 const f=await mediaValueFixture({count:30}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')});
 const errors=[],media=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url());if(/\/api\/media\//.test(url.pathname))media.push(url.pathname);});
 // A camera photograph larger than the thumbnail widths.
 const file=path.join(f.directory,'large.png');execFileSync('ffmpeg',['-v','error','-n','-f','lavfi','-i','color=c=green:s=1600x1200','-frames:v','1',file],{windowsHide:true,stdio:'pipe',timeout:30000});
 const large=await f.media.import(await readFile(file),'image');
 const ready=await f.workspace.read(),record=ready.book.entries.find(item=>item.id===f.record.id);record.attachments.unshift({...large,caption:'Wide survey photograph',alt:'A green field',transcript:'',share:false});await f.workspace.save(ready.book,ready.etag);
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');
  const gallery=page.getByRole('list',{name:'Photographs and recordings',exact:true});
  await expect(gallery).toBeVisible();await expect(gallery.locator('> li')).toHaveCount(24);
  await expect(page.locator('[data-record-collection="attachments"]')).toContainText('1–24');
  const first=page.locator('#record-figure-'+large.id);
  await expect(first.locator('summary img')).toHaveAttribute('src',new RegExp('/api/media/'+large.id+'/thumbnail-320$'));
  await expect.poll(()=>media.some(route=>route.endsWith(large.id+'/thumbnail-320')||route.endsWith(large.id+'/thumbnail-640'))).toBe(true);
  expect(media.filter(route=>/\/api\/media\/[a-f0-9-]{36}$/.test(route)&&route.endsWith(large.id))).toEqual([]);
  // Keyboard: focus the tile and open the display copy.
  await first.locator('summary').focus();await page.keyboard.press('Enter');
  await expect(first.locator('.record-media-full')).toBeVisible();
  await expect.poll(()=>media.some(route=>route.endsWith('/api/media/'+large.id))).toBe(true);
  await page.locator('[data-action="content-collection-next"][data-collection="attachments"]').click();
  await expect(gallery.locator('> li')).toHaveCount(7);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  expect(errors).toEqual([]);
 }finally{await app.close();await f.close();}
});
