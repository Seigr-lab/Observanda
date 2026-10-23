import {test,expect} from '@playwright/test';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {ProjectModuleCommands} from '../../src/project-module-commands.js';
import {ProjectModuleReader} from '../../src/project-module-reader.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {defaultCalculationPolicy} from '../../src/web/tools/calculation-policy.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {domainValuePage} from '../../src/measurement-domain-storage.js';

test('upgrade a scalar calculator explicitly, retain exact structured results and repeat their pinned recipes',async({page},info)=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-structured-calculator-ui-')),book=sampleNotebook(),record=book.entries[0];record.title='Structured result destination';
 const f=await encryptedFixture(directory,book),materials=new ResearchMaterials(f.workspace),sourceId=randomUUID(),policy=defaultCalculationPolicy(),errors=[];policy.displayDigits=5;policy.rounding='ceiling';let app;
 try{
  const dashboard=defaultDashboard();dashboard.views[0].panels=[];dashboard.enabledModules=['scientific-calculator'];await writeWorkspaceDashboard(f.workspace,dashboard,(await readWorkspaceDashboard(f.workspace)).etag);
  const commands=new ProjectModuleCommands(f.workspace,book.id);await commands.initialize();await commands.execute({workspaceId:book.id,commandId:randomUUID(),action:'calculation.save',payload:{id:sourceId,expectedRevision:null,data:{name:'Pinned matrix calculation',links:[],engine:3,policy,mode:'expression',angle:'rad',expression:'sqrt(2)',digits:'',fromBase:10,toBase:6}}});
  app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));
  const main=page.locator('main'),input=name=>main.getByLabel(name,{exact:true}),button=name=>main.getByRole('button',{name,exact:true}),result=page.locator('dialog[data-calculator-result]'),dialog=page.locator('#dialog'),sourceURL=app.origin+'/#/modules/scientific-calculator/calculation/'+sourceId;
  const openPolicy=async()=>{if(!await input('Working significant digits').isVisible())await main.locator('[data-calculation-policy-panel] summary').click();};
  const save=async()=>{await button('Save calculation').click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');};
  const retain=async()=>{await button('Retain exact result').click();const picker=page.locator('[data-module-reference-picker]');await picker.getByRole('button',{name:record.title,exact:true}).click();await expect(result).toContainText('Exact result retained.',{timeout:45000});await result.getByRole('button',{name:'Close',exact:true}).click();};
  const dataset=async title=>(await materials.list({recordId:record.id,kind:'dataset'})).items.find(item=>item.title===title);
  const components=async ref=>{const doc=await materials.read(ref),row=(await materials.retainedDatasetPage(doc,0,{columns:[0]})).rows[0];return (await domainValuePage(materials,row.cells[0],{resolve:true})).items.map(item=>item.exact);};
  await page.goto(app.url);await expect(page.getByRole('button',{name:'Preferences',exact:true})).toBeVisible();await page.goto(sourceURL);await expect(input('Expression 1')).toHaveValue('sqrt(2)');await expect(input('Result 1')).toContainText('1.4143');
  await button('Use exact vectors, matrices and complex values').click();await openPolicy();await expect(input('Displayed significant digits')).toHaveValue('5');await expect(input('Approximate rounding')).toHaveValue('ceiling');await expect(input('Structured component limit')).toHaveValue('256');await expect(input('Result 1')).toContainText('1.4143');
  await input('Expression 1').fill('[1,2]+[1,2,3]');await expect(input('Result 1')).toHaveAttribute('role','alert');await expect(input('Expression 1')).toHaveValue('[1,2]+[1,2,3]');expect((await materials.list({recordId:record.id,kind:'dataset'})).items).toEqual([]);
  const expression='matmul([[1,2],[3,4]],[[5,6],[7,8]])';await input('Structured component limit').fill('1');await input('Expression 1').fill(expression);await expect(input('Result 1')).toHaveAttribute('role','alert');await input('Structured component limit').fill('256');await expect(input('Result 1')).not.toHaveAttribute('role','alert');await expect(input('Result 1')).toContainText('19');await expect(input('Result 1')).toContainText('50');await input('Complete result character limit').fill('64');await expect(input('Result 1')).toHaveAttribute('role','alert');await input('Complete result character limit').fill('65536');await expect(input('Result 1')).not.toHaveAttribute('role','alert');await expect(input('Result 1')).toContainText('50');
  await save();const saved=(await new ProjectModuleReader(f.workspace,book.id).selected({workspaceId:book.id,id:sourceId})).entity;expect(saved.data.engine).toBe(4);expect(saved.data.policy.version).toBe(2);expect(saved.data.policy.displayDigits).toBe(5);expect(saved.data.policy.rounding).toBe('ceiling');await retain();
  const first=await dataset('Pinned matrix calculation - expression 1'),firstDoc=await materials.read(first),recipe=await materials.read(firstDoc.content.calculatorResult.recipe);expect(recipe.content.recipe.version).toBe(2);expect(recipe.content.recipe.expression).toBe(expression);expect(await components(first)).toEqual(['19/1','22/1','43/1','50/1']);
  await page.setViewportSize({width:390,height:844});await input('Result 1').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('structured-calculator-phone.png')});await page.setViewportSize({width:1440,height:1000});
  await input('Name').fill('Pinned complex calculation');await input('Expression 1').fill('sqrt(-1)');await expect(input('Result 1')).not.toHaveAttribute('role','alert');await expect(input('Result 1')).toContainText('i');await save();await retain();const second=await dataset('Pinned complex calculation - expression 1');expect(second.id).not.toBe(first.id);expect(await components(second)).toEqual(['0/1','1/1']);expect(await components(first)).toEqual(['19/1','22/1','43/1','50/1']);
  await page.reload();await expect(input('Expression 1')).toHaveValue('sqrt(-1)');await openPolicy();await expect(input('Displayed significant digits')).toHaveValue('5');await expect(input('Structured component limit')).toHaveValue('256');
  await page.goto(app.origin+'/#/records/'+record.id);await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await dialog.locator('.material-list li').filter({has:page.locator('strong').filter({hasText:/^Pinned matrix calculation - expression 1$/})}).getByRole('button',{name:'Inspect',exact:true}).click();await dialog.getByRole('button',{name:'Repeat captured calculation',exact:true}).click();await expect.poll(async()=>(await materials.current(first.id)).revision,{timeout:45000}).not.toBe(first.revision);const repeated=await materials.current(first.id);expect(await components(repeated)).toEqual(['19/1','22/1','43/1','50/1']);expect(await components(second)).toEqual(['0/1','1/1']);
  await expect(dialog.getByRole('button',{name:'Captured calculator recipe',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Captured calculator recipe',exact:true}).click();await expect(dialog.locator('[data-calculator-recipe]')).toContainText(expression);expect((await materials.read((await materials.read(repeated)).content.calculatorResult.recipe)).content.recipe).toEqual(recipe.content.recipe);expect(errors).toEqual([]);
 }catch(error){await info.attach('failed-view',{body:await page.locator('body').innerText(),contentType:'text/plain'});await page.screenshot({path:info.outputPath('failure.png'),fullPage:true});throw error;}
 finally{await page.close();await app?.close();clearVault(f.vault);expect(path.dirname(directory)).toBe(parent);expect(path.basename(directory).startsWith('observanda-structured-calculator-ui-')).toBeTruthy();await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
