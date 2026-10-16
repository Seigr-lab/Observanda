import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {startServer} from '../../src/server.js';

test('inspect native bytes, declare exact fractions and clock metadata, retain provenance and reopen after reload',async({page},testInfo)=>{
 test.setTimeout(150000);const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-measurement-ui-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 const {workspace,vault,deviceStore}=await encryptedFixture(directory,book),materials=new ResearchMaterials(workspace);
 const upload=async(name,bytes)=>{const s=await materials.startImport({recordId:record.id,name,size:bytes.length});await materials.appendImport(s.id,0,[bytes]);return materials.finishImport(s.id);};
 const original=Buffer.from('native bytes: 000001 000010 000011'),native=await upload('capture.bin',original),csv=await upload('decoded.csv',Buffer.from('Counter,Value,Offset,Length\n255,15.3,14,6\n0,0.1,21,6\n1,0,28,6'));
 // Keep native ranges valid; the last row intentionally has its own full extent.
 const data=await materials.dataset({recordId:record.id,title:'Decoded observations',artifact:csv,nativeMapping:{artifact:native,offsetColumn:2,lengthColumn:3,pointerColumn:null,idColumn:null}});
 const app=await startServer({root:workspace.root,port:0,deviceStore,preferencesFile:path.join(directory,'preferences.json')}),dialog=page.locator('#dialog'),requests=[],errors=[];
 page.on('request',r=>requests.push(new URL(r.url()).pathname));page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.locator('.material-list li').filter({hasText:'Decoded observations'}).getByRole('button',{name:'Inspect',exact:true}).click();
  await dialog.getByRole('button',{name:'Edit schema & exclusions'}).click();
  const counter=dialog.locator('[data-material-column="0"]');await counter.getByLabel('Representation',{exact:true}).selectOption('integer');
  await counter.locator('summary').filter({hasText:'Time metadata'}).click();await counter.getByLabel('Time meaning',{exact:true}).selectOption('counter');
  await counter.getByLabel('Counter width (bits)').fill('8');await counter.getByLabel('Counter frequency (Hz, exact decimal)').fill('1000');await counter.getByLabel('Counter wrap',{exact:true}).selectOption('modulo');await counter.getByLabel('Counter reset',{exact:true}).selectOption('observed');await counter.getByLabel('Reset / wrap boundary or epoch').fill('Reset after row 2');
  await dialog.locator('.material-schema-column > summary').filter({hasText:'Value'}).click();const value=dialog.locator('[data-material-column="1"]');await value.getByLabel('Representation',{exact:true}).selectOption('radix-fraction');await value.getByLabel('Base (for explicit base)').fill('6');
  await dialog.getByRole('button',{name:'Save dataset revision'}).click();await expect(dialog.getByRole('button',{name:'Inspect value: Value · 1',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Inspect value: Value · 1',exact:true}).click();await expect(dialog).toContainText('23 / 2');await expect(dialog).toContainText('Surrounding observations');
  await dialog.getByRole('button',{name:'Inspect native record',exact:true}).click();
  const sliceEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download displayed byte slice'}).click();expect(await readFile(await (await sliceEvent).path())).toEqual(original.subarray(14,20));
  const event=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download original',exact:true}).click();expect(await readFile(await (await event).path())).toEqual(original);
  await dialog.getByRole('button',{name:'Back to source',exact:true}).click();await expect(dialog).toContainText('23 / 2');await dialog.getByRole('button',{name:'Inspect native record',exact:true}).click();
  await dialog.getByRole('button',{name:'Retain measurement or diagnostic'}).click();await dialog.getByLabel('Title',{exact:true}).fill('Native diagnostic');
  await dialog.getByLabel('Exact source value').fill('15.3');await dialog.getByLabel('Value availability').selectOption('value');await dialog.getByLabel('Representation',{exact:true}).selectOption('radix-fraction');await dialog.getByLabel('Base (for explicit base)').fill('6');
  await dialog.getByLabel('Declared completion').selectOption('partial');await dialog.getByLabel('Interpretation / limitations').fill('Acquired bytes; recognition remains unresolved.');
  await dialog.locator('summary').filter({hasText:'Quantity provenance'}).click();await dialog.getByLabel('Quantity origin',{exact:true}).selectOption('derived');await dialog.getByLabel('Unit',{exact:true}).fill('V');
  const conversion=dialog.locator('[data-provenance-reference="conversion"]');await conversion.getByRole('button',{name:'Choose retained revision'}).click();await conversion.getByLabel('Conversion reference',{exact:true}).selectOption('artifact:'+native.id+':'+native.revision);await conversion.getByRole('button',{name:'Use selected revision'}).click();
  await dialog.getByRole('button',{name:'Add contributing source'}).click();const selected=await materials.current(data.id);await dialog.getByLabel('Source',{exact:true}).selectOption('dataset:'+selected.id+':'+selected.revision);await dialog.getByLabel('Locator',{exact:true}).selectOption('cell');await dialog.getByLabel('Column (starting at 1)').fill('2');await dialog.getByRole('button',{name:'Add locator'}).click();await expect(dialog.getByLabel('Title',{exact:true})).toHaveValue('Native diagnostic');
  await dialog.getByRole('button',{name:'Save retained measurement'}).click();await expect(dialog.getByRole('heading',{name:'Native diagnostic',exact:true})).toBeVisible();
  await expect(dialog).toContainText('Partial');await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.locator('.material-list li').filter({hasText:'Native diagnostic'}).getByRole('button',{name:'Inspect',exact:true}).click();
  await expect(dialog).toContainText('15.3');await expect(dialog).toContainText('recognition remains unresolved');
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();await page.screenshot({path:testInfo.outputPath('measurement-phone.png')});
  await dialog.getByRole('button',{name:'Inspect source',exact:true}).first().focus();await page.keyboard.press('Enter');await expect(dialog.getByRole('button',{name:'Download displayed byte slice'})).toBeVisible();
  const current=await materials.current(data.id),doc=await materials.read(current),columns=await materials.datasetColumns(doc);expect(columns[0].time.clock.width).toBe(8);expect(columns[0].time.clock.reset).toBe('observed');expect(columns[1].radix).toBe(6);expect((await materials.datasetPage(current)).rows[1].cells[0]).toBe('0');
  expect(requests.filter(p=>p==='/api/workspace/read/page'||p==='/api/notebook')).toEqual([]);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}
});
