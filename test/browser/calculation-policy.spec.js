import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {navigate,preferences} from './preferences-helper.js';
import {seedModuleCurrent} from '../module-current-fixture.js';
import {ProjectModuleReader} from '../../src/project-module-reader.js';
test('calculator and spreadsheet retain their explicit precision, budgets and recoverable policy edits',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-policy-ui-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),at=new Date().toISOString(),legacy={id:randomUUID(),type:'calculation',revision:1,createdAt:at,updatedAt:at,data:{name:'Fixed precision',links:[],engine:2,mode:'expression',angle:'rad',expression:'sqrt(2)',digits:'',fromBase:10,toBase:6}};
 await seedModuleCurrent(f.workspace,book.id,[legacy]);const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const main=page.locator('main'),input=name=>main.getByLabel(name,{exact:true}),button=name=>main.getByRole('button',{name,exact:true}),saved=()=>expect(main.locator('[data-module-status]')).toHaveText('Saved');
 const policy=()=>main.locator('[data-calculation-policy-panel]'),openPolicy=async()=>{if(!await input('Working significant digits').isVisible())await policy().locator('summary').click();};
 try{
  await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Modules');for(const name of ['Scientific calculator','Spreadsheet'])await main.getByRole('switch',{name:'Enable '+name,exact:true}).check();
  await navigate(page,'Scientific calculator');await button('New calculation').click();await input('Name').fill('Selected precision');await input('Expression 1').fill('sqrt(2)');await openPolicy();
  await input('Working significant digits').fill('80');await input('Displayed significant digits').fill('5');await input('Approximate rounding').selectOption('ceiling');await expect(input('Result 1')).toHaveText('≈ 1.4143');
  await input('Exact integer bit limit').fill('64');await input('Expression 1').fill('1e100+1-1e100');await expect(input('Result 1')).toContainText('resource budget');await expect(input('Result 1')).toHaveAttribute('role','alert');
  await input('Exact integer bit limit').fill('65536');await expect(input('Result 1')).toHaveText('1');await input('Expression 1').fill('sqrt(2)');await expect(input('Result 1')).toHaveText('≈ 1.4143');
  await button('Save calculation').click();await saved();await page.reload();await openPolicy();await expect(input('Working significant digits')).toHaveValue('80');await expect(input('Displayed significant digits')).toHaveValue('5');await expect(input('Approximate rounding')).toHaveValue('ceiling');await expect(input('Result 1')).toHaveText('≈ 1.4143');
  const checkpoint=page.waitForResponse(r=>r.url().includes('/modules/drafts/write')&&r.request().method()==='POST'&&r.request().postDataJSON()?.drafts?.some(d=>d.data?.policy?.displayDigits===9)&&r.status()===200);
  await input('Displayed significant digits').fill('9');await checkpoint;await page.reload();await button('Restore draft').click();await expect(main.locator('.module-workbench')).toHaveAttribute('aria-busy','false');await openPolicy();await expect(input('Displayed significant digits')).toHaveValue('9');await expect(input('Result 1')).toHaveText('≈ 1.41421357');await button('Save calculation').click();await saved();
  await page.getByRole('button',{name:'Dismiss',exact:true}).click();await page.setViewportSize({width:390,height:844});await policy().evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:test.info().outputPath('calculation-policy-phone.png')});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.setViewportSize({width:1280,height:900});await policy().evaluate(node=>node.scrollIntoView({block:'start'}));await page.screenshot({path:test.info().outputPath('calculation-policy-desktop.png')});
  await navigate(page,'Spreadsheet');await button('New spreadsheet').click();await input('Name').fill('Retained precision sheet');await openPolicy();await input('Displayed significant digits').fill('3');
  await input('Cell A1').fill('=sqrt(2)');await input('Cell B1').fill('=A1*A1');await input('Cell C1').fill('=B1-2');await expect(main.locator('[data-cell-result="0:0"]')).toHaveText('≈ 1.41');await expect(main.locator('[data-cell-result="0:2"]')).toHaveText('≈ 0');
  await input('Arithmetic operation limit').fill('1');await expect(main.locator('[data-cell-result="0:0"]')).toContainText('resource budget');await input('Arithmetic operation limit').fill('50000');await expect(main.locator('[data-cell-result="0:2"]')).toHaveText('≈ 0');
  await button('Save spreadsheet').click();await saved();await page.reload();await openPolicy();await expect(input('Displayed significant digits')).toHaveValue('3');await expect(main.locator('[data-cell-result="0:2"]')).toHaveText('≈ 0');
  await navigate(page,'Scientific calculator');await main.locator('article').filter({has:page.getByRole('heading',{name:'Fixed precision',exact:true})}).getByRole('button',{name:'Open calculation',exact:true}).click();await expect(policy()).toHaveCount(0);await expect(main.getByText('This saved revision uses the fixed exact/64-digit engine.',{exact:false})).toBeVisible();await input('Name').fill('Fixed precision retained');await button('Save calculation').click();await saved();
  const old=(await new ProjectModuleReader(f.workspace,book.id).selected({workspaceId:book.id,id:legacy.id})).entity;expect(old.data.engine).toBe(2);expect(old.data.policy).toBeUndefined();
  await button('Use configurable precision').click();await openPolicy();await input('Displayed significant digits').fill('5');await expect(input('Result 1')).toHaveText('≈ 1.4142');await button('Save calculation').click();await saved();
  const updated=(await new ProjectModuleReader(f.workspace,book.id).selected({workspaceId:book.id,id:legacy.id})).entity;expect(updated.data.engine).toBe(3);expect(updated.data.policy.displayDigits).toBe(5);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
