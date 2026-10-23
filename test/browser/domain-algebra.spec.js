import {test,expect} from '@playwright/test';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {defaultColumn} from '../../src/web/dataset-schema.js';
import {defaultDomain} from '../../src/web/measurement-domain-model.js';
import {domainValuePage} from '../../src/measurement-domain-storage.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';

test('author exact vector arithmetic, recover refused shapes and retain independent revised results',async({page},testInfo)=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-domain-algebra-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 let app;const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const values=[['10','0.3'],['1','0.3'],['1','2','3']],csv=value=>'"'+JSON.stringify(value).replaceAll('"','""')+'"',bytes=Buffer.from('Left,Right,Wrong shape\n'+values.map(csv).join(',')),pending=await m.startImport({recordId,name:'operands.csv',size:bytes.length});await m.appendImport(pending.id,0,[bytes]);
  const source=await m.dataset({recordId,title:'Algebra operands',artifact:await m.finishImport(pending.id),columns:values.map((value,index)=>({...defaultColumn({label:['Left','Right','Wrong shape'][index]}),representation:'domain',domain:{...defaultDomain('vector'),namespace:'declared-coordinate-space',shape:[value.length],component:{version:1,representation:'radix-fraction',radix:6}}}))});
  app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,headless:true,preferencesFile:path.join(directory,'preferences.json')});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();await page.evaluate(id=>location.hash='#/records/'+id,recordId);await page.getByRole('button',{name:'Open evidence & analysis'}).click();const dialog=page.locator('#dialog');
  await dialog.locator('.material-list li').filter({hasText:'Algebra operands'}).getByRole('button',{name:'Inspect',exact:true}).click();await dialog.getByRole('button',{name:'Calculate derived dataset',exact:true}).click();
  const choose=async(key,index)=>{await dialog.locator('[data-action="material-calculation-graph-pick"][data-target="'+key+'"]').click();await dialog.locator('[data-graph-picker] [data-action="material-calculation-graph-choose"]').nth(index).click();},save=()=>dialog.getByRole('button',{name:'Save edit',exact:true}).click();
  for(let index=0;index<3;index++){await dialog.getByRole('button',{name:'Add column',exact:true}).click();await choose('binding',0);await dialog.locator('[data-graph-field="column"]').fill(String(index+1));await save();}
  await dialog.locator('[data-action="material-calculation-graph-domain-algebra"]').click();await dialog.locator('[data-action="material-calculation-graph-apply-domain-algebra"]').click();await expect(dialog.locator('[data-action="material-calculation-graph-add"][data-kind="domain-arithmetic"]')).toBeVisible();
  const graphHead=async()=>{const items=(await m.list({recordId,kind:'analysis'})).items;return items.find(item=>item.title==='Calculation graph');};
  const before=await graphHead();expect((await m.read(before)).content.graphVersion).toBe(8);
  await dialog.locator('[data-action="material-calculation-graph-add"][data-kind="domain-arithmetic"]').click();await choose('left',0);await choose('right',2);await save();await expect(page.locator('#notice')).toContainText('different declared domains, shapes, or coordinate namespaces');await expect(dialog.locator('[data-graph-edit]')).toBeVisible();expect((await graphHead()).revision).toBe(before.revision);
  await choose('right',1);await save();await expect(dialog.getByRole('button',{name:'nodes (4)',exact:true})).toBeVisible();
  await dialog.locator('[data-action="material-calculation-graph-add"][data-kind="domain-arithmetic"]').click();await dialog.locator('[data-graph-field="operation"]').selectOption('dot');await choose('left',0);await choose('right',1);await save();
  await dialog.getByRole('button',{name:'outputs (0)',exact:true}).click();for(const [name,index]of [['Vector sum',3],['Exact dot product',4]]){await dialog.getByRole('button',{name:'Add output',exact:true}).click();await dialog.locator('[data-graph-field="name"]').fill(name);await choose('node',index);await save();}
  await dialog.getByRole('button',{name:'Preview outputs',exact:true}).click();await expect(dialog.locator('[data-graph-preview]')).toContainText('25/4');
  await page.setViewportSize({width:390,height:844});await dialog.locator('[data-graph-preview]').scrollIntoViewIfNeeded();expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBeTruthy();await page.screenshot({path:testInfo.outputPath('domain-algebra-preview-phone.png')});await page.setViewportSize({width:1440,height:1000});
  await dialog.getByRole('button',{name:'Retain dataset',exact:true}).click();await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('25/4',{timeout:45000});
  const outputs=async()=>(await m.list({recordId,kind:'dataset'})).items.filter(item=>item.title==='Calculation graph result'),first=(await outputs())[0],firstDoc=await m.read(first);
  const exactVector=async ref=>{const doc=await m.read(ref),row=(await m.retainedDatasetPage(doc,0,{columns:[0]})).rows[0];return (await domainValuePage(m,row.cells[0],{resolve:true})).items.map(item=>item.exact);};
  expect(firstDoc.content.calculation.version).toBe(11);expect(firstDoc.content.algorithmVersion).toBe(10);expect(await exactVector(first)).toEqual(['7/1','1/1']);
  await dialog.getByRole('button',{name:'Reapply calculation recipe',exact:true}).click();await dialog.getByRole('button',{name:'nodes (5)',exact:true}).click();await dialog.locator('[data-calculation-graph] ol li').nth(3).getByRole('button',{name:'Edit',exact:true}).click();await dialog.locator('[data-graph-field="operation"]').selectOption('subtract');await save();await expect(dialog.locator('[data-calculation-graph]')).toBeVisible();
  expect((await m.read(firstDoc.content.calculation.graph)).content.graphVersion).toBe(8);expect((await graphHead()).revision).not.toBe(firstDoc.content.calculation.graph.revision);expect(await exactVector(first)).toEqual(['7/1','1/1']);
  await dialog.getByRole('button',{name:'Retain dataset',exact:true}).click();await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('25/4',{timeout:45000});const second=(await outputs()).find(item=>item.id!==first.id);expect(second).toBeTruthy();expect(await exactVector(second)).toEqual(['5/1','0/1']);expect(await exactVector(first)).toEqual(['7/1','1/1']);
  expect((await m.current(source.id)).revision).toBe(source.revision);await page.reload();await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();await page.getByRole('button',{name:'Open evidence & analysis'}).click();await expect(dialog.locator('.material-list li').filter({hasText:'Calculation graph result'})).toHaveCount(2);expect(errors).toEqual([]);
 }finally{await app?.close();clearVault(f.vault);expect(path.dirname(directory)).toBe(parent);expect(path.basename(directory).startsWith('observanda-domain-algebra-ui-')).toBeTruthy();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
