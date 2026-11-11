import {test,expect} from '@playwright/test';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {mediaValueFixture} from '../record-media-values-fixture.js';
import {testServer} from '../device-fixture.js';

// A JPEG whose EXIF block names the photographer (Artist "Maria").
function withExif(jpeg){
 const block=Buffer.from('4d4d002a000000080001013b00020000000600000016000000004d6172696100','hex');
 const app1=Buffer.concat([Buffer.from('Exif\0\0','latin1'),block]),length=Buffer.alloc(2);length.writeUInt16BE(app1.length+2);
 return Buffer.concat([jpeg.subarray(0,2),Buffer.from([0xff,0xe1]),length,app1,jpeg.subarray(2)]);
}

test('media details show technical facts and offer camera details without changing the original',async({page})=>{
 test.setTimeout(120000);
 const f=await mediaValueFixture({count:3}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const file=path.join(f.directory,'camera.jpg');execFileSync('ffmpeg',['-v','error','-n','-f','lavfi','-i','color=c=green:s=96x64','-frames:v','1',file],{windowsHide:true,stdio:'pipe',timeout:30000});
 const photo=await f.media.import(withExif(await readFile(file)),'image');
 const ready=await f.workspace.read(),record=ready.book.entries.find(item=>item.id===f.record.id);record.attachments.unshift({...photo,caption:'Camera photograph',alt:'',transcript:'',share:false});await f.workspace.save(ready.book,ready.etag);
 const dialog=page.getByRole('dialog',{name:'Edit Media details',exact:true});
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
  // A recording shows its sample rate, channels and duration.
  await page.getByRole('button',{name:'Edit media details for Media 1',exact:true}).click();
  const technical=dialog.getByLabel('Technical details',{exact:true});await expect(technical).toContainText('Sample rate');await expect(technical).toContainText('Hz');await expect(technical).toContainText('Channels');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Edit media details for Camera photograph',exact:true}).click();
  const camera=dialog.locator('[data-media-camera]');await expect(camera).toContainText('Maria');
  await expect(dialog.getByLabel('Creator (photographer, recordist or author)',{exact:true})).toHaveValue('');
  await camera.getByLabel('Copy these details into the empty fields below',{exact:true}).check();
  await expect(dialog.getByLabel('Creator (photographer, recordist or author)',{exact:true})).toHaveValue('Maria');
  await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();
  expect((await f.values.read(f.target(photo.id))).value.value.metadata.creator).toBe('Maria');
  const {metadata,directory}=await f.media.metadata(photo.id);expect(metadata.technical).toMatchObject({width:96,height:64});
  expect(errors).toEqual([]);
 }finally{await app.close();await f.close();}
});
