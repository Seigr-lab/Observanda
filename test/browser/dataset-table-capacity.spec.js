import {test,expect} from '@playwright/test';
import {realpath,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {retainDatasetOriginal} from '../fixtures/dataset-original.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {defaultColumn} from '../../src/web/dataset-schema.js';
import {startServer} from '../../src/server.js';
import {openEvidence} from './record-editor-helper.js';

// This explicitly selected capacity run prepares two complete native
// materials. A routine browser run should not have to recreate a million rows.
test('locate a column among 3,210 and a known observation among one million physical rows from the normal evidence window',async({page})=>{
 test.skip(process.env.OBSERVANDA_TABLE_CAPACITY!=='1','Explicit physical capacity qualification');
 test.setTimeout(90*60*1000);page.setDefaultTimeout(40000);
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-table-capacity-')),book=sampleNotebook(),recordId=book.entries[0].id;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let fixture,app;
 try{
  fixture=await encryptedFixture(directory,book);
  const materials=new ResearchMaterials(fixture.workspace),width=3210,rows=1_000_000;
  const names=Array.from({length:width},(_,i)=>i===width-1?'Spectrum reference wavelength':'Detector '+(i+1));
  const wide=Buffer.from(names.join(',')+'\n'+names.map((_,i)=>i===width-1?'451.00030':'2').join(','));
  const sheet=await retainDatasetOriginal(materials,recordId,'detectors.csv',wide.length,[wide]);
  await materials.dataset({recordId,title:'Detector spectrum',artifact:sheet});
  const header=Buffer.from('Counter\n'),line=Buffer.from('9007199254740993\n'),last=Buffer.from('9007199254740995\n'),block=Buffer.from(line.toString().repeat(4096));
  async function* readings(){
   yield header;for(let i=0;i<rows-1;i+=4096)yield block.subarray(0,Math.min(4096,rows-1-i)*line.length);yield last;
  }
  const series=await retainDatasetOriginal(materials,recordId,'series.csv',header.length+(rows-1)*line.length+last.length,readings());
  const original=await materials.dataset({recordId,title:'Counter readings',artifact:series,columns:[{...defaultColumn({label:'Counter'}),representation:'integer'}],exclusions:{[series.id+':1000001']:'Stopped acquisition'}});
  const doc=await materials.read(original);expect(doc.content.rowCount).toBe(rows);
  app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,headless:true});
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+recordId);
  await page.getByRole('button',{name:'Evidence and results',exact:true}).click();
  await openEvidence(page);
  const dialog=page.locator('#dialog'),grid=dialog.getByRole('grid'),tools=dialog.getByRole('region',{name:'Table view'});
  const open=title=>dialog.locator('.material-list li').filter({has:page.getByText(title,{exact:true})}).getByRole('button',{name:'Inspect',exact:true}).click();
  await open('Detector spectrum');await expect(grid).toBeVisible();
  await tools.locator('summary').filter({hasText:/^Columns$/}).click();await tools.getByLabel('Find a column').fill('reference wavelength');
  await tools.getByLabel('Find a column').press('Enter');
  const choice=tools.locator('[data-column-results] .inline-actions').filter({hasText:'3,210. Spectrum reference wavelength'});
  await choice.getByRole('button',{name:'Show',exact:true}).click();await expect(grid.locator('thead th').nth(1)).toContainText('Spectrum reference wavelength');
  await expect(grid.locator('[data-table-row="0"][data-table-column="0"]')).toHaveText('451.00030');
  await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();await open('Counter readings');
  await tools.getByLabel('Go to result row').fill('1000000');await tools.getByRole('button',{name:'Go',exact:true}).click();
  const cell=grid.locator('[data-table-row="0"][data-table-column="0"]');await expect(cell).toHaveText('9007199254740995');
  await expect(grid.locator('tbody tr')).toHaveCount(1);await expect(grid.locator('tbody tr')).toContainText('Stopped acquisition');
  await tools.locator('summary').filter({hasText:/^Filter and sort$/}).click();await tools.getByLabel('Exact observation ID').fill(series.id+':1000001');
  await tools.getByRole('button',{name:'Apply view'}).click();await expect(dialog.getByText(/of 1 results/)).toBeVisible();
  await cell.focus();await cell.press('Enter');await expect(dialog.locator('[data-measurement-inspection]')).toContainText(series.id+':1000001');
  await dialog.getByRole('button',{name:'Back to source',exact:true}).click();await expect(cell).toBeFocused();await expect(cell).toHaveText('9007199254740995');expect(errors).toEqual([]);
 }finally{
  await app?.close();if(fixture)await clearVault(fixture.vault);expect(path.dirname(directory)).toBe(parent);
  await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
});
