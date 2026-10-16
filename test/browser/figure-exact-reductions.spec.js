import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
const column=(name,representation)=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});

test('native figure authoring retains the exact difference of large counters and exposes its pinned source',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-exact-figure-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 const bytes=Buffer.from('Take,Delta\nA,9007199254740993\nA,-9007199254740992\n');
 const upload=await m.startImport({recordId,name:'counter-deltas.csv',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);const artifact=await m.finishImport(upload.id);
 await m.dataset({recordId,title:'Exact counter deltas',artifact,columns:[column('Take','text'),column('Delta','integer')]});
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,recordId);await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  const dialog=page.locator('#dialog');await dialog.locator('.material-list li').filter({hasText:'Exact counter deltas'}).getByRole('button',{name:'Inspect',exact:true}).click();
  await dialog.getByRole('button',{name:'Create reproducible figure'}).click();await dialog.getByLabel('Title',{exact:true}).fill('Exact total delta');
  await dialog.getByLabel('Transformation').selectOption('sum');await dialog.getByLabel('Chart type').selectOption('bar');await dialog.locator('[data-material-value="1"]').check();
  await dialog.getByRole('button',{name:'Calculate & retain figure'}).click();await expect(dialog.locator('svg')).toBeVisible({timeout:30000});
  await expect(dialog).toContainText('Groups and summaries are calculated with exact rational values. Only the final coordinates are converted for plotting.');
  const retained=(await m.heads()).find(h=>h.kind==='analysis'),doc=await m.read(retained);expect(doc.content.figure.series[0].points[0].y).toBe(1);
  await dialog.getByText('Calculation coverage',{exact:true}).click();await dialog.getByRole('button',{name:'Inspect source rows & exclusions'}).click();
  await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('9007199254740993');
  await dialog.getByRole('button',{name:'Back to evidence'}).click();await dialog.locator('.material-list li').filter({hasText:'Exact total delta'}).getByRole('button',{name:'Inspect',exact:true}).click();
  await dialog.getByRole('button',{name:'Add retained figure to record'}).click();await page.locator('.section-save [data-action="save"]').click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.locator('.material-list li').filter({hasText:'Exact total delta'}).getByRole('button',{name:'Inspect',exact:true}).click();
  await expect(dialog).toContainText('Groups and summaries are calculated with exact rational values.');
  expect((await f.workspace.read()).book.entries.find(r=>r.id===recordId).figures.find(v=>v.id===doc.content.figure.id).series[0].points[0].y).toBe(1);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
