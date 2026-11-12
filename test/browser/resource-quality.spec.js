import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {workspaceModules} from '../../src/modules/index.js';
import {testServer} from '../device-fixture.js';

const blockedMessage='The selected lot or equipment is blocked by its readiness rule.';
test('readiness rules on a lot and on equipment block consumption and work bookings where they apply',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(12000);
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-resource-quality-ui-')),book=sampleNotebook(),f=await encryptedFixture(dir,book),preferencesFile=path.join(dir,'preferences.json');
 const settings=defaultDashboard();settings.enabledModules=['resources','planning'];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile,port:0,headless:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const main=page.locator('main'),dialog=page.locator('#dialog'),alert=main.locator('.module-error');
 try{
  await page.goto(app.url);await page.evaluate(()=>location.hash='#/modules/resources/resource');

  // A material lot held for a missing supplier certificate, blocked only for consumption.
  await main.getByRole('button',{name:'New item',exact:true}).click();await main.getByLabel('Item name',{exact:true}).fill('Reference buffer');
  await main.getByLabel('Item kind',{exact:true}).selectOption('material');await main.getByLabel('Stock unit',{exact:true}).fill('mL');await main.getByLabel('Opening quantity',{exact:true}).fill('100');
  await main.getByRole('button',{name:'Track this material by lot',exact:true}).click();
  const rules=main.locator('[data-quality-editor]');await expect(rules.getByRole('heading',{name:'Readiness rules',exact:true})).toBeVisible();
  await rules.getByLabel('Lot or batch number',{exact:true}).fill('LOT-42');await rules.getByLabel('Supplier',{exact:true}).fill('Synthetic supplier');
  await rules.getByLabel('Reason for holding this item',{exact:true}).fill('Awaiting supplier certificate');
  await rules.getByLabel('When consuming',{exact:true}).selectOption('block');
  await expect(rules.locator('[data-readiness]')).toHaveText('Warning · On hold · Awaiting supplier certificate');
  await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.getByRole('heading',{name:'Stock & allocations',exact:true})).toBeVisible();

  await main.getByRole('button',{name:'Consume',exact:true}).click();await main.getByLabel('Quantity (mL)',{exact:true}).fill('5');await main.getByLabel('Reason / reference',{exact:true}).fill('Titration');
  await main.getByRole('button',{name:'Record movement',exact:true}).click();
  await expect(alert).toContainText(blockedMessage);await expect(alert).toContainText('Reference buffer · Blocked · On hold · Awaiting supplier certificate');
  expect((await workspaceModules(f.workspace).current()).entities.filter(e=>e.type==='movement').map(e=>e.data.reason)).toEqual(['Opening stock']);
  await main.getByRole('button',{name:'Cancel',exact:true}).click();

  // Reserving follows its own warning rule and keeps the readiness seen at that moment.
  await main.getByRole('button',{name:'Reserve',exact:true}).click();await main.getByLabel('Quantity (mL)',{exact:true}).fill('10');await main.getByLabel('Reason / reference',{exact:true}).fill('Planned titration');
  await main.getByRole('button',{name:'Record reservation',exact:true}).click();
  const reservations=main.locator('.module-block').filter({has:page.getByRole('heading',{name:'Reservations',exact:true})});
  await expect(reservations).toContainText('Current readiness for use · Blocked · On hold · Awaiting supplier certificate');
  await reservations.locator('summary').filter({hasText:'Readiness at reservation'}).click();await expect(reservations.locator('details')).toContainText('Lot or batch number LOT-42');await expect(reservations.locator('details')).toContainText('Warning · On hold · Awaiting supplier certificate');
  await reservations.getByRole('button',{name:'Consume reserved',exact:true}).click();await expect(alert).toContainText(blockedMessage);

  // Releasing the hold makes the lot ready; the recorded use carries its readiness.
  await main.getByRole('button',{name:'Details',exact:true}).click();
  await expect(rules.getByLabel('Lot or batch number',{exact:true})).toHaveAttribute('readonly','');
  await rules.getByLabel('Reason for holding this item',{exact:true}).fill('');await expect(rules.locator('[data-readiness]')).toHaveText('Ready');
  await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  await main.getByRole('button',{name:'Stock & allocations',exact:true}).click();
  await reservations.getByRole('button',{name:'Consume reserved',exact:true}).click();await expect(alert).toHaveCount(0);
  const ledger=main.locator('.module-block').filter({has:page.getByRole('heading',{name:'Stock ledger',exact:true})});
  await expect(ledger.locator('.module-ledger').first()).toContainText('Reference buffer · Item revision');await expect(ledger.locator('.module-ledger').first()).toContainText('Lot or batch number LOT-42');await expect(ledger.locator('.module-ledger').first()).toContainText('Ready · Block');
  await expect(reservations).toContainText('Warning · On hold · Awaiting supplier certificate');
  const lot=(await workspaceModules(f.workspace).current()).entities.find(e=>e.type==='movement'&&e.data.useKind==='used');
  expect(lot.data.qualityAtUse.quality.number).toBe('LOT-42');expect(lot.data.qualityAtUse.issues).toEqual([]);

  // Equipment without a calibration certificate, blocked for work reservations.
  await main.getByRole('button',{name:'Back to items',exact:true}).click();
  await main.getByRole('button',{name:'New item',exact:true}).click();await main.getByLabel('Item name',{exact:true}).fill('Analytical balance');
  await main.getByLabel('Item kind',{exact:true}).selectOption('equipment');
  await main.getByRole('button',{name:'Track equipment calibration',exact:true}).click();
  await expect(rules.getByLabel('When consuming',{exact:true})).toHaveCount(0);await expect(rules.getByRole('group',{name:'Calibration certificate',exact:true})).toBeVisible();
  await rules.getByLabel('When reserving',{exact:true}).selectOption('block');await expect(rules.locator('[data-readiness]')).toHaveText('Warning · Missing calibration');
  await main.getByRole('button',{name:'Save item',exact:true}).click();await expect(main.getByRole('heading',{name:'Placement',exact:true})).toBeVisible();

  await page.evaluate(()=>location.hash='#/modules/planning/task');await main.getByRole('button',{name:'Equipment agenda',exact:true}).click();
  await main.getByRole('button',{name:'New booking',exact:true}).click();await main.getByLabel('Booking title',{exact:true}).fill('Weighing standards');
  await main.getByRole('button',{name:'Equipment',exact:true}).click();await dialog.getByRole('button',{name:'Select Analytical balance',exact:true}).click();
  await main.getByLabel('Starts',{exact:true}).fill('2026-10-15T10:00');await main.getByLabel('Ends',{exact:true}).fill('2026-10-15T11:00');
  await main.getByRole('button',{name:'Save booking',exact:true}).click();
  await expect(alert).toContainText(blockedMessage);await expect(alert).toContainText('Analytical balance · Blocked · Missing calibration');
  await main.getByLabel('Booking type',{exact:true}).selectOption('maintenance');await main.getByRole('button',{name:'Save booking',exact:true}).click();await expect(main.locator('[data-module-status]')).toHaveText('Saved');
  await expect(main).not.toContainText('Readiness at reservation');
  const booking=(await workspaceModules(f.workspace).current()).entities.find(e=>e.type==='booking');
  expect(booking.data.kind).toBe('maintenance');expect(Object.hasOwn(booking.data,'qualityAtReservation')).toBe(false);

  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(errors).toEqual([]);
 }finally{await app.close();await clearVault(f.vault);await rm(dir,{recursive:true,force:true});}
});
