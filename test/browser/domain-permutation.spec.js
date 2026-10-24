import {test,expect} from '@playwright/test';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {defaultColumn} from '../../src/web/dataset-schema.js';
import {defaultDomain} from '../../src/web/measurement-domain-model.js';
import {defaultDatasetResourcePolicy} from '../../src/web/dataset-resource-policy.js';
import {executeMaterialRequest} from '../../src/material-requests.js';
import {materialReference} from '../../src/web/material-reference.js';
import {domainValuePage} from '../../src/measurement-domain-storage.js';
import {retainedTableHTML} from '../../src/publication-retained-tables.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';

test('explicit axis order preserves exact components and earlier results through authoring and reopening',async({page},testInfo)=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-axis-ui-')),book=sampleNotebook(),recordId=book.entries[0].id,f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),errors=[];let app;
 page.on('pageerror',error=>errors.push(error.message));
 const values=['00','1','0.3',null,'4','5','10','11','12','13','14','15'],nested=[values.slice(0,6),values.slice(6)].map(plane=>[plane.slice(0,2),plane.slice(2,4),plane.slice(4)]),expected=[0,1,6,7,2,3,8,9,4,5,10,11].map(index=>values[index]);
 try{
  const bytes=Buffer.from('Coordinates\n"'+JSON.stringify(nested).replaceAll('"','""')+'"'),upload=await m.startImport({recordId,name:'coordinates.csv',size:bytes.length});await m.appendImport(upload.id,0,[bytes]);
  const source=await m.dataset({recordId,title:'Observed coordinates',artifact:await m.finishImport(upload.id),columns:[{...defaultColumn({label:'Coordinates'}),representation:'domain',unit:'declared units',domain:{...defaultDomain('tensor'),namespace:'declared-axis-space',shape:[2,3,2],component:{version:1,representation:'radix-fraction',radix:6}}}]});
  const historicalPolicy=defaultDatasetResourcePolicy(),historicalGraph=(await executeMaterialRequest(f.workspace,{material:'calculation-graph-create'},{recordId,title:'Calculation graph',source,graphVersion:10,policy:historicalPolicy})).ref;
  app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,headless:true,preferencesFile:path.join(directory,'preferences.json')});const dialog=page.locator('#dialog');
  const inspect=async reference=>{await page.keyboard.press('Escape');await page.goto(app.origin+'/#/records/'+recordId);await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.locator('.material-list li').filter({hasText:reference.revision.slice(0,12)}).getByRole('button',{name:'Inspect',exact:true}).click();};
  const choose=async(key,index)=>{await dialog.locator('[data-action="material-calculation-graph-pick"][data-target="'+key+'"]').click();await dialog.locator('[data-graph-picker] [data-action="material-calculation-graph-choose"]').nth(index).click();},save=()=>dialog.getByRole('button',{name:'Save edit',exact:true}).click();
  await page.goto(app.url);await inspect(historicalGraph);await dialog.getByRole('button',{name:'Edit calculation graph',exact:true}).click();await dialog.locator('[data-action="material-calculation-graph-permute-upgrade"]').click();await dialog.locator('[data-dataset-resource="maxOperations"]').fill('48000');await dialog.locator('[data-action="material-calculation-graph-apply-permute-upgrade"]').click();await expect(dialog.getByRole('button',{name:'Add column',exact:true})).toBeVisible();expect((await m.read(await m.current(historicalGraph.id))).content.policy.resources.maxOperations).toBe(48000);expect((await m.read(historicalGraph)).content.policy).toEqual(historicalPolicy);
  await dialog.getByRole('button',{name:'Add column',exact:true}).click();await choose('binding',0);await save();await expect(dialog.getByRole('button',{name:'nodes (1)',exact:true})).toBeVisible();
  await dialog.locator('[data-action="material-calculation-graph-add"][data-kind="domain-permute"]').click();const axes=dialog.locator('[data-graph-field="axes"]');await expect(axes).toHaveValue('');await choose('left',0);await axes.fill('1, 1, 3');await save();await expect(axes).toHaveValue('1, 1, 3');await expect(page.locator('#notice')).toBeVisible();
  await axes.fill('2, 1');const refusal=page.waitForResponse(response=>response.url().endsWith('/calculation-graph-change'));await save();expect((await refusal).ok()).toBe(false);await expect(axes).toHaveValue('2, 1');await axes.fill('2, 1, 3');
  await page.setViewportSize({width:430,height:900});await axes.scrollIntoViewIfNeeded();expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBeTruthy();await page.screenshot({path:testInfo.outputPath('axis-order-phone.png')});await page.setViewportSize({width:1440,height:1000});await save();await expect(dialog.getByRole('button',{name:'nodes (2)',exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'outputs (0)',exact:true}).click();await dialog.getByRole('button',{name:'Add output',exact:true}).click();await dialog.locator('[data-graph-field="name"]').fill('Reordered coordinates');await choose('node',1);await save();await dialog.getByRole('button',{name:'Retain dataset',exact:true}).click();await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('observanda.tensor',{timeout:60000});
  const first=materialReference((await m.list({recordId,kind:'dataset'})).items.find(item=>item.title==='Calculation graph result')),firstDoc=await m.read(first),graph=firstDoc.content.calculation.graph;
  const components=async reference=>{const doc=await m.read(reference),row=(await m.retainedDatasetPage(doc,0,{columns:[0]})).rows[0];return (await domainValuePage(m,row.cells[0],{limit:32,resolve:true})).items.map(item=>item.spelling);};
  expect(firstDoc.content.calculation.version).toBe(14);expect(firstDoc.content.algorithmVersion).toBe(13);expect((await m.datasetColumn(firstDoc,0)).domain.shape).toEqual([3,2,2]);expect((await m.datasetColumn(firstDoc,0)).domain.component.radix).toBe(6);expect(await components(first)).toEqual(expected);expect(await components(source)).toEqual(values);
  let html='';for await(const part of retainedTableHTML(m,{source:first,table:{version:3,selection:{columns:'all',offset:0,count:null,includeExcluded:false}}}))html+=part;expect(html).toContain('&quot;00&quot;');expect(html).toContain('&quot;0.3&quot;');expect(html).toContain('null');expect(html).not.toContain(source.id);
  await inspect(graph);await dialog.getByRole('button',{name:'Edit calculation graph',exact:true}).click();await dialog.locator('[data-calculation-graph] ol li').nth(1).getByRole('button',{name:'Edit',exact:true}).click();await expect(axes).toHaveValue('2, 1, 3');await axes.fill('1, 2, 3');await save();await dialog.getByRole('button',{name:'Retain dataset',exact:true}).click();await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('observanda.tensor',{timeout:60000});
  const second=materialReference((await m.list({recordId,kind:'dataset'})).items.find(item=>item.title==='Calculation graph result'&&item.id!==first.id));expect(second.id).not.toBe(first.id);expect(await components(second)).toEqual(values);expect(await components(first)).toEqual(expected);expect((await m.current(source.id)).revision).toBe(source.revision);
  await page.keyboard.press('Escape');await page.reload();await inspect(first);await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('observanda.tensor');await dialog.getByRole('button',{name:'Reapply calculation recipe',exact:true}).click();await dialog.locator('[data-calculation-graph] ol li').nth(1).getByRole('button',{name:'Edit',exact:true}).click();await expect(axes).toHaveValue('2, 1, 3');expect(errors).toEqual([]);
 }finally{await app?.close();clearVault(f.vault);expect(path.dirname(directory)).toBe(parent);expect(path.basename(directory).startsWith('observanda-axis-ui-')).toBeTruthy();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
