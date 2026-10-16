import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {intakeFixture,hash} from '../fixtures/local-intake.js';
import {RunReadiness} from '../../src/run-readiness.js';
import {RunReceiptStore} from '../../src/run-receipt-store.js';
import {withWorkspaceMetadataBatch} from '../../src/metadata-batch.js';
import {testServer} from '../device-fixture.js';

test('receipt history pages, retries and late valid evidence remain usable in the reader',async({page},info)=>{
 test.setTimeout(120000);let cleanup;const f=await intakeFixture({after:fn=>{cleanup=fn;}}),ready=new RunReadiness(f.ws),view=await ready.view(f.command),store=new RunReceiptStore(f.ws,f.record.id);
 await f.ws.withLock(()=>withWorkspaceMetadataBatch(f.ws,async()=>{for(let i=0;i<45;i++)await store.appendLocked({id:randomUUID(),kind:'validation',recordRevision:i?hash('earlier record'):view.revision,evidenceRevision:view.evidenceRevision,recordedAt:new Date(Date.UTC(2020,0,1)+i*1000).toISOString(),statement:'Receipt '+i,declared:true});}));await ready.setPolicy({...f.command,expectedPolicy:view.policy.etag,required:['validation']});
 const app=await testServer({root:f.ws.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();const dialog=page.locator('#dialog');await dialog.getByRole('button',{name:'Run readiness',exact:true}).click();const history=dialog.locator('[data-receipt-history]');
  await expect(history.locator('ul > li')).toHaveCount(20);await expect(history).toContainText('Showing 20 receipts. 45 in history.');await expect(history).toContainText('Receipt 44');await expect(dialog).not.toContainText('Required completion receipts missing');
  await page.route('**/api/v1/intake/readiness',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Synthetic page interruption'})}));await history.getByRole('button',{name:'Older receipts',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic page interruption');await expect(history).toContainText('Receipt 44');await page.unroute('**/api/v1/intake/readiness');
  await history.getByRole('button',{name:'Older receipts',exact:true}).click();await expect(history).toContainText('Receipt 24');await expect(history.locator('[data-receipt-status]')).toBeFocused();await history.getByRole('button',{name:'Older receipts',exact:true}).click();await expect(history.locator('ul > li')).toHaveCount(5);await expect(history).toContainText('Receipt 0');await expect(history.locator('li').filter({hasText:'Receipt 0'})).toContainText('Current revision');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');await history.locator('[data-receipt-status]').scrollIntoViewIfNeeded();expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('receipt-history-mobile.png')});
  await history.getByRole('button',{name:'Previous receipts',exact:true}).click();await expect(history).toContainText('Receipt 24');await history.getByRole('button',{name:'Latest receipts',exact:true}).click();await expect(history).toContainText('Receipt 44');expect(errors).toEqual([]);
 }finally{await app.close();await cleanup();}
});
