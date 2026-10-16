import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {packedSource,packedMapping} from '../fixtures/packed-dataset.js';

test('packed-array controls prepare two full timing runs and reject truncated or misaligned ranges',async({page})=>{
 test.setTimeout(180000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-packed-ui-')),f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),record=(await f.workspace.read()).book.entries[0],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const bytes=Buffer.from(JSON.stringify(packedSource())),upload=await materials.startImport({recordId:record.id,name:'packed-runs.json',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);await materials.finishImport(upload.id);
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();
  await dialog.getByLabel('Title',{exact:true}).fill('Two packed timing runs');await dialog.getByLabel('Source format').selectOption('json-nested');await dialog.getByLabel('Path to rows array').fill('/runs/*/acquisitions');
  await dialog.getByRole('button',{name:'Add lookup',exact:true}).click();const lookup=dialog.locator('.material-lookup');await lookup.getByLabel('Lookup name',{exact:true}).fill('timing');await lookup.getByLabel('Match acquisition and lookup rows').selectOption('position');await lookup.getByLabel('Lookup rows array path').fill('/runs/*/packed');
  await lookup.getByLabel('Extract fixed-width records from this array').check();await lookup.getByLabel('Offset (array elements, starting at zero)').fill('384');await lookup.getByLabel('Record width (array elements)').fill('6');await lookup.getByLabel('Record count per window').fill('3889');
  for(const [i,definition] of packedMapping().fields.entries()){
   if(i)await dialog.getByRole('button',{name:'Add column',exact:true}).click();const row=dialog.locator('.material-json-field').nth(i);await row.getByLabel('Column name',{exact:true}).fill(definition.name);await row.getByLabel('Column source',{exact:true}).selectOption(definition.source);await row.getByLabel('Field path',{exact:true}).fill(definition.path);
  }
  await dialog.getByRole('button',{name:'Preview mapping'}).click();await expect(page.getByText(/packed source array is shorter/)).toBeVisible();expect((await materials.heads()).filter(h=>h.kind==='dataset')).toHaveLength(0);
  await lookup.getByLabel('Record count per window').fill('3887');await dialog.getByRole('button',{name:'Preview mapping'}).click();await expect(page.getByText(/Positional alignment requires an acquisition array/)).toBeVisible();
  await lookup.getByLabel('Record count per window').fill('3888');await dialog.getByRole('button',{name:'Preview mapping'}).click();await expect(dialog.getByRole('region',{name:'Mapping preview'})).toContainText('Timing 5');
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await lookup.getByLabel('Record count per window').scrollIntoViewIfNeeded();await page.screenshot({path:test.info().outputPath('packed-array-controls.png')});
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('Timing 5',{timeout:60000});
  await dialog.locator('summary').filter({hasText:'Source mapping'}).click();await expect(dialog.getByText(/3888 records per window, 6 array elements per record, starting at offset 384/)).toBeVisible();
  const head=(await materials.heads()).find(h=>h.kind==='dataset'),ref={kind:head.kind,id:head.id,revision:head.revision},doc=await materials.read(ref);expect(doc.content.rowCount).toBe(7776);expect(doc.content.sourceMapping).toEqual(packedMapping());
  const inspected=await materials.measurements.inspect({ref,selector:{kind:'cell',page:0,row:37,column:6}});expect(inspected.original.selector.pointer).toBe('/runs/0/packed/611');expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
