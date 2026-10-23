import {test,expect} from '@playwright/test';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {defaultColumn} from '../../src/web/dataset-schema.js';
import {defaultDatasetResourcePolicy} from '../../src/web/dataset-resource-policy.js';
import {blankAnalysisMethod,blankAnalysisSource,addressedComparisonInputs} from '../../src/web/analysis-model.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';

test('comparison editing retains declared limits and complete long values across saved revisions',async({page},testInfo)=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-comparison-policy-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),m=new ResearchMaterials(f.workspace),recordId=book.entries[0].id;
 let app;const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  const policy=defaultDatasetResourcePolicy();Object.assign(policy.resources,{maxScalarCharacters:12000,maxOperations:500000});
  const long='0'.repeat(9000)+'9007199254740993',bytes=Buffer.from('Value,Lower,Upper\n'+long+',9007199254740992,9007199254740994\n9007199254740994,9007199254740993,9007199254740995'),pending=await m.startImport({recordId,name:'exact-boundaries.csv',size:bytes.length});await m.appendImport(pending.id,0,[bytes]);
  const artifact=await m.finishImport(pending.id),dataset=await m.dataset({recordId,title:'Exact boundary observations',artifact,columns:['Value','Lower','Upper'].map(label=>({...defaultColumn({label}),representation:'integer',resourcePolicy:policy}))}),source=blankAnalysisSource(dataset);Object.assign(source.columns,{value:0,lower:1,upper:2});
  const inputs=addressedComparisonInputs({method:{...blankAnalysisMethod(),unavailable:'Synthetic declared method.',uncertainty:'Bounds explicitly supplied.',limitations:'No statistical inference.'},comparison:{version:3,resourcePolicy:policy,sources:[source],ordering:'source',expected:null}},book.id);
  const original=await m.comparisons.save({recordId,title:'Exact boundary comparison',tool:'Declared boundary check',version:'1',...inputs});
  app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,headless:true,preferencesFile:path.join(directory,'preferences.json')});
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();
  const dialog=page.locator('#dialog');
  const open=async()=>{await page.evaluate(id=>location.hash='#/records/'+id,recordId);await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.locator('.material-list li').filter({hasText:'Exact boundary comparison'}).getByRole('button',{name:'Inspect',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Exact boundary comparison',exact:true})).toBeVisible();};
  await open();await expect(dialog.locator('.comparison-value-preview').first()).toContainText('Value preview:');
  const disclosure=dialog.locator('details').filter({has:page.locator('summary').filter({hasText:'Show complete value ('+long.length+' characters)'})}).first();
  await disclosure.locator('summary').click();await expect(disclosure.getByRole('region',{name:'Complete retained value'})).toHaveText(long);
  await page.setViewportSize({width:390,height:844});await disclosure.locator('summary').scrollIntoViewIfNeeded();expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBeTruthy();await page.screenshot({path:testInfo.outputPath('comparison-value-phone.png')});await disclosure.locator('summary').click();await page.setViewportSize({width:1440,height:1000});
  await dialog.getByRole('button',{name:'Revise comparison',exact:true}).click();await dialog.locator('[data-comparison-policy] summary').click();
  await expect(dialog.locator('[data-dataset-resource="maxScalarCharacters"]')).toHaveValue('12000');await dialog.locator('[data-dataset-resource="maxScalarCharacters"]').fill('');
  await dialog.getByRole('button',{name:'Retain comparison',exact:true}).click();await expect(page.locator('#notice')).toContainText('whole number');expect((await m.current(original.id)).revision).toBe(original.revision);
  await dialog.locator('[data-dataset-resource="maxScalarCharacters"]').fill('20000');await dialog.getByLabel('Sources, scope and limitations').fill('Revised declared limit; source and earlier result unchanged.');
  await dialog.getByRole('button',{name:'Retain comparison',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Exact boundary comparison',exact:true})).toBeVisible({timeout:45000});
  const revised=await m.current(original.id);expect(revised.revision).not.toBe(original.revision);expect((await m.read(original)).content.comparison.resourcePolicy.resources.maxScalarCharacters).toBe(12000);expect((await m.read(revised)).content.comparison.resourcePolicy.resources.maxScalarCharacters).toBe(20000);
  await page.reload();await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();await open();await dialog.getByRole('button',{name:'Revise comparison',exact:true}).click();await dialog.locator('[data-comparison-policy] summary').click();await expect(dialog.locator('[data-dataset-resource="maxScalarCharacters"]')).toHaveValue('20000');await page.setViewportSize({width:390,height:844});await dialog.locator('[data-dataset-resource="maxScalarCharacters"]').scrollIntoViewIfNeeded();expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBeTruthy();await page.screenshot({path:testInfo.outputPath('comparison-policy-phone.png')});expect(errors).toEqual([]);
 }finally{await app?.close();clearVault(f.vault);expect(path.dirname(directory)).toBe(parent);expect(path.basename(directory).startsWith('observanda-comparison-policy-ui-')).toBeTruthy();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
