import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sourceAssets} from './built-assets-helper.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {testServer} from '../device-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {defaultStructuredCalculationPolicy} from '../../src/web/tools/calculation-policy.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {seedModuleCurrent} from '../module-current-fixture.js';

test('cached calculator errors and exact results follow language changes without new calculations or data edits',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-calculator-localization-'));
 const book=upgradeNotebook({...sampleNotebook(),title:'workspace'}),f=await encryptedFixture(directory,book),at=new Date().toISOString();
 const calculation=mode=>({id:randomUUID(),type:'calculation',revision:1,createdAt:at,updatedAt:at,data:{name:'Authored '+mode,links:[],engine:4,policy:defaultStructuredCalculationPolicy(),mode,angle:'rad',expression:'1/0\n0.1+0.2',digits:'6',fromBase:6,toBase:10}});
 const items=[calculation('expression'),calculation('bases')];
 await seedModuleCurrent(f.workspace,book.id,items);
 const settings=defaultDashboard();settings.enabledModules=['scientific-calculator'];
 await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await testServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json'),browserAssets:await sourceAssets()});
 const errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('request',request=>{if(request.method()==='POST'&&/\/modules\/(?:command|drafts\/write)$/.test(new URL(request.url()).pathname))writes.push(request.url());});
 try{
  await page.addInitScript(()=>{window.calculationRequests=0;const post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(message,...rest){if(message.kind==='calculator-sheet')window.calculationRequests++;return post.call(this,message,...rest);};});
  await page.goto(app.url);
  for(const item of items){
   const route='#/modules/scientific-calculator/calculation/'+item.id;
   await page.evaluate(route=>location.hash=route,route);
   await expect(page.locator('[data-calculator]')).toBeVisible();
   const output=item.data.mode==='bases'?page.locator('[data-calc-base-result]'):page.locator('[data-calc-row="0"] output');
   await expect(output).toHaveAttribute('role','alert');
   if(item.data.mode==='expression'){
    for(const selector of ['[data-calc-structured-builder]','details:has([data-calc-builder="values"])'])await page.locator(selector).locator(':scope > summary').click();
    await page.locator('[data-command="calc-structured"]').click();
    await page.locator('[data-command="calc-statistic"]').click();
    await expect(page.locator('[data-calc-structured-error]')).not.toBeEmpty();
    await expect(page.locator('[data-calc-builder-error]')).not.toBeEmpty();
   }
   const calculated=await page.evaluate(()=>window.calculationRequests);
   for(const locale of ['ca','es','nb','nn','en']){
    const messages=JSON.parse(await readFile(new URL('../../src/web/locales/'+locale+'/calculator.json',import.meta.url),'utf8'));
    await page.evaluate(()=>location.hash='#/preferences/help');
    await page.locator('[data-language-choice]').selectOption(locale);
    await expect(page.locator('.preferences-heading')).toHaveAttribute('lang',locale);
    await page.evaluate(route=>location.hash=route,route);
    await expect(page.locator('[data-calculator]')).toBeVisible();
    await expect(output).toHaveText(item.data.mode==='bases'?messages.mathErrorDigitBase.replace('{digit}','6').replace('{base}','6'):messages.mathErrorZero);
    await expect(page.locator('.module-heading .eyebrow')).toHaveText(messages.label);
    await expect(page.locator('[data-module-field="name"]')).toHaveValue(item.data.name);
    if(item.data.mode==='expression'){
     await expect(page.locator('[data-calc-expression="0"]')).toHaveValue('1/0');
     await expect(page.locator('[data-calc-row="1"] output')).toHaveText('0.3');
     await expect(page.locator('[data-calc-structured-error]')).toHaveText(messages.invalidStructuredValues);
     await expect(page.locator('[data-calc-builder-error]')).toHaveText(messages.invalidValues);
    }else await expect(page.locator('[data-module-field="digits"]')).toHaveValue('6');
    expect(await page.evaluate(()=>window.calculationRequests)).toBe(calculated);
   }
  }
  expect(writes).toEqual([]);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true});}
});
