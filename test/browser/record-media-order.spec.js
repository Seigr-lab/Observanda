import {test,expect} from '@playwright/test';
import path from 'node:path';
import {mediaValueFixture} from '../record-media-values-fixture.js';
import {testServer} from '../device-fixture.js';
import {RecordContent} from '../../src/record-content.js';

test('authors order a record gallery across pages with earlier and later controls',async({page})=>{
 test.setTimeout(120000);
 const f=await mediaValueFixture({count:26}),app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const order=async()=>{const reader=new RecordContent(f.workspace),ids=[];for(let offset=0;offset<26;offset+=24)ids.push(...(await reader.read({workspaceId:f.book.id,recordId:f.record.id,pagedHeader:true,windows:{attachments:offset}})).header.attachments.map(item=>item.id));return ids;};
 const original=f.record.attachments.map(item=>item.id);
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Edit record',exact:true}).click();
  await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
  await expect(page.getByRole('button',{name:'Move Media 0 earlier',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Move Media 0 later',exact:true}).click();
  await expect.poll(order).toEqual([original[1],original[0],...original.slice(2)]);
  await expect(page.getByRole('button',{name:'Move Media 0 earlier',exact:true})).toBeEnabled();
  // A gallery window holds 24 items; moving past its end reveals the item on the next window.
  await page.getByRole('button',{name:'Move Media 23 later',exact:true}).click();
  await expect(page.locator('[data-record-media="'+original[23]+'"]')).toBeVisible();
  await expect.poll(order).toEqual([original[1],original[0],...original.slice(2,23),original[24],original[23],original[25]]);
  await expect(page.getByRole('button',{name:'Move Media 25 later',exact:true})).toBeDisabled();
  expect(errors).toEqual([]);
 }finally{await app.close();await f.close();}
});
