import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {ResearchMaterials} from '../../src/research-materials.js';

test('nested dataset form combines visits and lookup values with explicit mapping controls',async({page})=>{
 test.setTimeout(90000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-nested-ui-')),f=await encryptedFixture(directory,sampleNotebook()),materials=new ResearchMaterials(f.workspace),record=(await f.workspace.read()).book.entries[0];
 const bytes=Buffer.from('{"visits":[{"rows":[{"count":9007199254740993,"control":"a"}],"id":"first","controls":[{"id":"a","expected":4}]},{"id":"second","controls":[{"id":"a","expected":8}],"rows":[{"count":5,"control":"a"}]}]}');
 const upload=await materials.startImport({recordId:record.id,name:'nested.json',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);await materials.finishImport(upload.id);
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();await dialog.getByLabel('Title',{exact:true}).fill('Joined acquisitions');
  await dialog.getByLabel('Source format').selectOption('json-nested');await dialog.getByLabel('Path to rows array').fill('/visits/*/rows');
  await dialog.getByRole('button',{name:'Add lookup',exact:true}).click();
  await dialog.getByLabel('Lookup name',{exact:true}).fill('control');await dialog.getByLabel('Lookup rows array path').fill('/visits/*/controls');
  await dialog.getByLabel('Acquisition key path').fill('/control');await dialog.getByLabel('Lookup key path',{exact:true}).fill('/id');
  for(const [i,name,source,path] of [[0,'Count','row','/count'],[1,'Visit','context','/visits/*/id'],[2,'Expected','control','/expected']]){
   if(i)await dialog.getByRole('button',{name:'Add column',exact:true}).click();const row=dialog.locator('.material-json-field').nth(i);
   await row.getByLabel('Column name',{exact:true}).fill(name);await row.getByLabel('Column source',{exact:true}).selectOption(source);await row.getByLabel('Field path',{exact:true}).fill(path);
  }
  await dialog.getByRole('button',{name:'Preview mapping'}).click();await expect(dialog.getByRole('region',{name:'Mapping preview'})).toContainText('9007199254740993');
  await expect(dialog.getByRole('region',{name:'Mapping preview'})).toContainText('second');
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('9007199254740993',{timeout:30000});
  const head=(await materials.heads()).find(h=>h.kind==='dataset');expect((await materials.datasetPage(head)).rows.map(r=>r.cells)).toEqual([['9007199254740993','first','4'],['5','second','8']]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
test('JSON mapping preview, cancel/reopen/retry, exact dataset and retained schema are usable on a narrow screen',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-dataset-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),record=book.entries[0];
 const bytes=Buffer.from('{"measurements":[{"counter":18446744073709551615,"digits":"105"},{"counter":-0,"digits":null},{}]}');
 const session=await materials.startImport({recordId:record.id,name:'readings.json',size:bytes.length});await materials.appendImport(session.id,0,[bytes]);await materials.finishImport(session.id);
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),dialog=page.locator('#dialog'),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const prepare=ResearchMaterials.prototype.prepareDataset;let hold=true;
 ResearchMaterials.prototype.prepareDataset=async function(command,options){
  if(hold)await new Promise((resolve,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
  return prepare.call(this,command,options);
 };
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();
  await dialog.getByLabel('Title',{exact:true}).fill('Hardware readings');
  await dialog.getByLabel('Source format').selectOption('json');
  await dialog.getByLabel('Path to rows array').fill('/measurements');
  await dialog.getByLabel('Column name',{exact:true}).fill('Counter');
  await dialog.getByLabel('Field path',{exact:true}).fill('/counter');
  await dialog.getByRole('button',{name:'Add column',exact:true}).click();
  await dialog.getByLabel('Column name',{exact:true}).nth(1).fill('Senary');
  await dialog.getByLabel('Field path',{exact:true}).nth(1).fill('/digits');
  await dialog.getByRole('button',{name:'Preview mapping'}).click();
  await expect(dialog.getByRole('region',{name:'Mapping preview'})).toContainText('18446744073709551615');
  await expect(dialog.getByRole('region',{name:'Mapping preview'})).toContainText('[absent]');
  await page.setViewportSize({width:390,height:844});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  let loseResponse=true;const attempts=[];
  await page.route('**/api/research/materials/dataset',async route=>{
   attempts.push(route.request().postDataJSON().jobId);
   if(loseResponse){loseResponse=false;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();
  await expect(dialog.getByRole('button',{name:'Create dataset',exact:true})).toBeEnabled();
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Prepare dataset',exact:true})).toBeVisible();
  expect(attempts.length).toBe(2);expect(new Set(attempts).size).toBe(1);
  await page.unroute('**/api/research/materials/dataset');
  await dialog.getByRole('button',{name:'Back to evidence'}).click();
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByText('Evidence preparation jobs',{exact:true}).click();
  await dialog.getByRole('button',{name:'Check preparation'}).click();
  await dialog.getByRole('button',{name:'Cancel dataset preparation'}).focus();await page.keyboard.press('Enter');
  await expect(dialog.getByText('Dataset preparation cancelled.',{exact:false})).toBeVisible();
  expect((await materials.heads()).filter(h=>h.kind==='dataset')).toEqual([]);
  hold=false;await dialog.getByRole('button',{name:'Retry dataset preparation'}).click();
  await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('18446744073709551615',{timeout:15000});
  await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('[null]');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await dialog.getByRole('button',{name:'Edit schema & exclusions'}).click();
  await dialog.locator('[data-material-column="0"]').getByLabel('Representation',{exact:true}).selectOption('integer');
  await dialog.locator('.material-schema-column > summary').filter({hasText:'Senary'}).click();
  await dialog.locator('[data-material-column="1"]').getByLabel('Representation',{exact:true}).selectOption('radix');
  await dialog.locator('[data-material-column="1"]').getByLabel('Base (for explicit base)').fill('6');
  await dialog.getByRole('button',{name:'Save dataset revision'}).click();
  await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('base 6');
  const dataset=(await materials.heads()).find(h=>h.kind==='dataset'),doc=await materials.read(dataset);
  expect(doc.content.sourceMapping.rowsPath).toBe('/measurements');expect(doc.previous).toBeTruthy();
  expect((await materials.datasetPage(dataset)).rows[0].cells).toEqual(['18446744073709551615','105']);
  await dialog.screenshot({path:test.info().outputPath('dataset-phone.png')});
  expect(errors).toEqual([]);
 }finally{await app.close();ResearchMaterials.prototype.prepareDataset=prepare;clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});

test('wide dataset inspection and schema paging retain edits, exclusions and exact historical values',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-wide-schema-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),record=book.entries[0];
 const names=Array.from({length:36},(_,i)=>'Field '+i),bytes=Buffer.from(names.join(',')+'\n'+Array.from({length:3},()=>names.map((_,i)=>i===0?'18446744073709551615':i===33?'105':String(i)).join(',')).join('\n'));
 const session=await materials.startImport({recordId:record.id,name:'wide.csv',size:bytes.length});await materials.appendImport(session.id,0,[bytes]);
 const artifact=await materials.finishImport(session.id),original=await materials.dataset({recordId:record.id,title:'Wide readings',artifact});
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),dialog=page.locator('#dialog'),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.locator('.material-list li').filter({hasText:'Wide readings'}).getByRole('button',{name:'Inspect',exact:true}).click();
  const table=dialog.getByRole('region',{name:'Dataset values'});
  await expect(table).toContainText('18446744073709551615');await expect(table.locator('thead th')).toHaveCount(18);
  await page.setViewportSize({width:390,height:844});
  await dialog.getByRole('button',{name:'Next columns',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(table).toContainText('Field 16');await expect(table).not.toContainText('18446744073709551615');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await dialog.getByRole('button',{name:'Previous columns',exact:true}).click();
  await dialog.getByRole('button',{name:'Edit schema & exclusions'}).click();
  const col=index=>dialog.locator('[data-material-column="'+index+'"]');
  await expect(dialog.locator('[data-material-column]')).toHaveCount(16);
  await col(0).getByLabel('Representation',{exact:true}).selectOption('integer');
  await col(0).getByLabel('Unit',{exact:true}).fill('counter');
  let failOnce=true;
  await page.route('**/api/research/materials/schema',async route=>{if(failOnce){failOnce=false;await route.abort('failed');}else await route.continue();});
  await dialog.getByRole('button',{name:'Next schema columns'}).click();
  await expect(dialog.getByRole('button',{name:'Next schema columns'})).toBeEnabled();
  await expect(col(0).getByLabel('Unit',{exact:true})).toHaveValue('counter');
  await dialog.getByRole('button',{name:'Next schema columns'}).click();
  await expect(col(16)).toBeVisible();await expect(col(0)).toHaveCount(0);
  await dialog.getByRole('button',{name:'Back to evidence'}).click();await expect(page.locator('#leave-dialog')).toBeVisible();
  await page.locator('#leave-dialog').getByRole('button',{name:'Stay here',exact:true}).click();
  await col(16).getByLabel('Unit',{exact:true}).fill('relative reading');
  await dialog.getByRole('button',{name:'Next schema columns'}).click();await expect(dialog.locator('[data-material-column]')).toHaveCount(4);
  await dialog.locator('.material-schema-column > summary').filter({hasText:'Field 33'}).click();
  await col(33).getByLabel('Representation',{exact:true}).selectOption('radix');
  await col(33).getByLabel('Base (for explicit base)').fill('6');
  await dialog.getByRole('button',{name:'Exclude an observation'}).click();
  await dialog.getByLabel('Acquisition row',{exact:true}).fill('2');
  await dialog.getByLabel('Reason for exclusion').fill('Interrupted measurement');
  await dialog.getByRole('button',{name:'Previous schema columns'}).click();
  await expect(col(16).getByLabel('Unit',{exact:true})).toHaveValue('relative reading');
  await expect(dialog.getByLabel('Reason for exclusion')).toHaveValue('Interrupted measurement');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  expect(await dialog.evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBeTruthy();
  await dialog.screenshot({path:test.info().outputPath('schema-phone.png')});
  await page.setViewportSize({width:720,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1)).toBeTruthy();
  await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:390,height:844});
  await dialog.getByRole('button',{name:'Save dataset revision'}).click();
  await expect(table).toContainText('counter',{timeout:15000});await expect(table).toContainText('Interrupted measurement');
  const current=await materials.current(original.id);
  expect((await materials.schemaPage(current,{offset:32})).items[1].radix).toBe(6);
  expect((await materials.schemaPage(current,{offset:16})).items[0].unit).toBe('relative reading');
  expect((await materials.schemaPage(original)).items[0].representation).toBe('text');
  expect((await materials.datasetPage(current)).rows[1].excluded).toBe('Interrupted measurement');
  expect((await materials.datasetPage(original)).rows[1].excluded).toBe(null);
  await dialog.getByRole('button',{name:'Previous revision',exact:true}).click();
  await expect(table).not.toContainText('Interrupted measurement');
  await dialog.getByRole('button',{name:'Next columns',exact:true}).click();
  await dialog.getByRole('button',{name:'Next columns',exact:true}).click();
  await expect(table.locator('thead th')).toHaveCount(6);await expect(table).toContainText('105');
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});


test('discovered wide JSON columns retain full values and original source inspection after reopening',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-wide-values-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),record=book.entries[0],long='begin '+('\u{1f36f}'.repeat(35000))+' END';
 const values=Object.fromEntries(Array.from({length:301},(_,i)=>['field'+i,i===300?long:i])),bytes=Buffer.from(JSON.stringify({rows:[values]}));
 const upload=await materials.startImport({recordId:record.id,name:'wide.json',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);await materials.finishImport(upload.id);
 const app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),dialog=page.locator('#dialog'),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();await dialog.getByLabel('Title',{exact:true}).fill('Discovered wide values');await dialog.getByLabel('Source format').selectOption('json');await dialog.getByLabel('Path to rows array').fill('/rows');await dialog.getByLabel('Discover columns from each row').check();
  await dialog.getByRole('button',{name:'Preview mapping'}).click();await expect(dialog).toContainText('16 of 301 columns');
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('field0',{timeout:45000});
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.locator('.material-list li').filter({hasText:'Discovered wide values'}).getByRole('button',{name:'Inspect',exact:true}).click();
  for(let offset=16;offset<=288;offset+=16){await dialog.getByRole('button',{name:'Next columns',exact:true}).click();await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('field'+offset);}
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await dialog.getByRole('region',{name:'Dataset values'}).getByRole('button',{name:/field300/}).click();await expect(dialog.locator('pre')).toContainText('begin ');await dialog.getByRole('button',{name:'Next characters',exact:true}).click();await expect(dialog.locator('pre')).not.toContainText('begin ');
  await dialog.getByRole('button',{name:'Inspect original',exact:true}).click();await expect(dialog).toContainText('/rows/0/field300');await expect(dialog.locator('pre')).toContainText('"begin ');await dialog.getByRole('button',{name:'Next characters',exact:true}).click();await expect(dialog.locator('pre')).not.toContainText('"begin ');
  expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
