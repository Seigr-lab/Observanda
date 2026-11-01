import {test,expect} from '@playwright/test';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {setTimeout as wait} from 'node:timers/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {InventoryReconciliation} from '../../src/modules/inventory-reconciliation.js';
import {preferences} from './preferences-helper.js';

test('inventory maintenance can be cancelled and retried after navigation without polling hidden storage',async({page})=>{
 test.setTimeout(120000);const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-maintenance-ui-')),f=await encryptedFixture(directory,sampleNotebook()),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore}),prepare=InventoryReconciliation.prototype.prepare;
 let paused=false,statusReads=0;const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().endsWith('/maintenance/inventory/status'))statusReads++;});
 InventoryReconciliation.prototype.prepare=async function(options){if(!paused){paused=true;await wait(60000,null,{signal:options.signal});}return prepare.call(this,options);};
 try{
  await page.goto(app.url);await preferences(page,'Storage & access');const panel=page.locator('[data-inventory-maintenance="storage-maintenance"]');
  await expect(panel.getByRole('heading',{name:'Inventory check',exact:true})).toBeVisible();await expect(panel.getByRole('button',{name:'Check inventory',exact:true})).toBeEnabled();
  await panel.getByRole('button',{name:'Check inventory',exact:true}).click();await expect(panel.getByRole('button',{name:'Cancel check',exact:true})).toBeVisible();
  await preferences(page,'General');await expect(panel).toHaveCount(0);const before=statusReads;await page.waitForTimeout(1800);expect(statusReads).toBe(before);
  await preferences(page,'Storage & access');await expect(panel.getByRole('button',{name:'Cancel check',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'Cancel check',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Check cancelled.');await panel.getByRole('button',{name:'Retry check',exact:true}).click();await expect(panel.getByRole('status')).toHaveText('Inventory totals match the retained entries.',{timeout:30000});
  await expect(panel.getByRole('button',{name:'Check again',exact:true})).toBeEnabled();const completedReads=statusReads;await page.waitForTimeout(1800);expect(statusReads).toBe(completedReads);expect(errors).toEqual([]);
 }finally{InventoryReconciliation.prototype.prepare=prepare;await app.close();await clearVault(f.vault);expect(path.dirname(directory)).toBe(parent);expect(await realpath(directory)).toBe(directory);await rm(directory,{recursive:true,force:true});}
});

test('inventory maintenance discards an older owner response and cancels its status read',async({page})=>{
 test.setTimeout(90000);const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-maintenance-owner-ui-')),f=await encryptedFixture(directory,sampleNotebook()),app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});
 try{
  await page.goto(app.url);await page.locator('#main').waitFor();
  const result=await page.evaluate(async()=>{
   const {inventoryMaintenanceUI}=await import('/inventory-maintenance-ui.js'),state={storage:{contextId:'fixture-context'}},calls=[];let owner={id:'first',prefix:'/api/projects/first'},release;
   const ui=inventoryMaintenanceUI({state,esc:value=>String(value),actions:'fixture-maintenance',owner:()=>owner,api:async(route,data,options)=>{calls.push({route,signal:options.signal});if(route.includes('/first/'))return new Promise(resolve=>release=resolve);return {job:null};}});
   const container=document.createElement('div');document.body.append(container);container.innerHTML=ui.view();ui.bind();owner={id:'second',prefix:'/api/projects/second'};container.innerHTML=ui.view();ui.bind();await new Promise(resolve=>setTimeout(resolve,20));release({job:{id:'old',state:'completed',progress:{stage:'ready',done:999,total:999}}});await new Promise(resolve=>setTimeout(resolve,20));
   const result={routes:calls.map(call=>call.route),aborted:calls[0].signal.aborted,status:container.querySelector('[data-status]').textContent};container.remove();ui.bind();return result;
  });
  expect(result.routes).toEqual(['/api/projects/first/maintenance/inventory/status','/api/projects/second/maintenance/inventory/status']);expect(result.aborted).toBe(true);expect(result.status).toBe('No inventory check has been started.');
 }finally{await app.close();await clearVault(f.vault);expect(path.dirname(directory)).toBe(parent);expect(await realpath(directory)).toBe(directory);await rm(directory,{recursive:true,force:true});}
});
