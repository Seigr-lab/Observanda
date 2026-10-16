import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {ResearchMaterials} from '../../src/research-materials.js';

test('positional preparation rejects a short schedule and then retains 432 aligned acquisitions through the UI',async({page})=>{
 test.setTimeout(120000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-positional-ui-')),f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),record=(await f.workspace.read()).book.entries[0],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const source={windows:Array.from({length:3},(_,window)=>({id:'window-'+window,acquisitions:Array.from({length:144},(_,i)=>({count:i})),controls:Array.from({length:144},(_,i)=>({value:'control-'+window+'-'+i})),configuration:Array.from({length:144},(_,i)=>({value:'configuration-'+window+'-'+i})),schedule:Array.from({length:144},(_,i)=>({value:'schedule-'+window+'-'+i})),shortSchedule:Array.from({length:143},()=>({value:0}))}))};
 const bytes=Buffer.from(JSON.stringify(source)),upload=await materials.startImport({recordId:record.id,name:'parallel-windows.json',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);await materials.finishImport(upload.id);
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();await dialog.getByLabel('Title',{exact:true}).fill('All windows aligned');await dialog.getByLabel('Source format').selectOption('json-nested');await dialog.getByLabel('Path to rows array').fill('/windows/*/acquisitions');
  for(const [i,name] of ['controls','configuration','schedule'].entries()){
   await dialog.getByRole('button',{name:'Add lookup',exact:true}).click();const lookup=dialog.locator('.material-lookup').nth(i);await lookup.getByLabel('Lookup name',{exact:true}).fill(name);await lookup.getByLabel('Match acquisition and lookup rows').selectOption('position');await expect(lookup.getByLabel('Acquisition key path')).not.toBeVisible();await lookup.getByLabel('Lookup rows array path').fill('/windows/*/'+(name==='schedule'?'shortSchedule':name));
  }
  for(const [i,name,source,path] of [[0,'Count','row','/count'],[1,'Window','context','/windows/*/id'],[2,'Control','controls','/value'],[3,'Configuration','configuration','/value'],[4,'Schedule','schedule','/value']]){
   if(i)await dialog.getByRole('button',{name:'Add column',exact:true}).click();const row=dialog.locator('.material-json-field').nth(i);await row.getByLabel('Column name',{exact:true}).fill(name);await row.getByLabel('Column source',{exact:true}).selectOption(source);await row.getByLabel('Field path',{exact:true}).fill(path);
  }
  await dialog.getByRole('button',{name:'Preview mapping'}).click();await expect(page.getByText(/Positional alignment requires an acquisition array/)).toBeVisible();expect((await materials.heads()).filter(h=>h.kind==='dataset')).toHaveLength(0);
  await dialog.locator('.material-lookup').nth(2).getByLabel('Lookup rows array path').fill('/windows/*/schedule');await dialog.getByRole('button',{name:'Preview mapping'}).click();await expect(dialog.getByRole('region',{name:'Mapping preview'})).toContainText('schedule-0-0');
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();await dialog.screenshot({path:test.info().outputPath('positional-preparation-phone.png')});
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('control-0-0',{timeout:40000});
  const head=(await materials.heads()).find(h=>h.kind==='dataset'),doc=await materials.read(head);expect(doc.content.sourceMapping.joins.every(j=>j.mode==='position')).toBe(true);
  let count=0;for await(const row of materials.iterateDataset(head)){void row;count++;}expect(count).toBe(432);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
