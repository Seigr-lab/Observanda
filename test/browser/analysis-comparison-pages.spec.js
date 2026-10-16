import {test,expect} from '@playwright/test';
import path from 'node:path';
import {comparisonFixture} from '../analysis-comparison-fixture.js';
import {startServer} from '../../src/server.js';

test('comparison contexts and retained observations page independently and survive source inspection',async({page},testInfo)=>{
 test.setTimeout(180000);const cleanup=[],f=await comparisonFixture({after:fn=>cleanup.push(fn)},{groups:25});let app;
 try{
  await f.m.comparisons.save(f.command);
  app=await startServer({root:f.workspace.root,port:0,deviceStore:f.deviceStore,preferencesFile:path.join(f.directory,'preferences.json')});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.url);await expect(page.locator('#main-navigation')).toBeVisible();await page.evaluate(id=>location.hash='#/records/'+id,f.recordId);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();const dialog=page.locator('#dialog');
  await dialog.locator('.material-list li').filter({hasText:f.command.title}).getByRole('button',{name:'Inspect',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:f.command.title,exact:true})).toBeVisible();
  const groups=dialog.locator('[data-comparison-groups]');await groups.locator('summary').click();
  await expect(groups.locator('tbody tr')).toHaveCount(20);
  await groups.getByRole('button',{name:'Next groups',exact:true}).focus();await page.keyboard.press('Enter');
  await expect(groups.locator('tbody tr')).toHaveCount(5);await expect(groups).toContainText('Group 24');
  await groups.getByRole('button',{name:'Show this group',exact:true}).last().click();
  await expect(dialog.locator('[data-comparison-filter]')).toContainText('Group 24');
  await expect(dialog.getByRole('button',{name:'Inspect source',exact:true})).toHaveCount(3);
  await dialog.getByLabel('Analysis view').selectOption('distribution');await dialog.getByLabel('Category filter').selectOption('mismatched');
  await expect(dialog.getByRole('button',{name:'Inspect source',exact:true})).toHaveCount(1);
  await expect(dialog).toContainText(String(9007199254740993n+73n));
  await dialog.getByRole('button',{name:'Inspect source',exact:true}).click();await expect(dialog).toContainText(String(9007199254740993n+73n)+' / 1');
  await dialog.getByRole('button',{name:'Back to source',exact:true}).click();
  await expect(dialog.getByLabel('Analysis view')).toHaveValue('distribution');await expect(dialog.getByLabel('Category filter')).toHaveValue('mismatched');
  await expect(dialog.locator('[data-comparison-filter]')).toContainText('Group 24');await expect(groups.locator('tbody tr')).toHaveCount(5);await expect(groups).toHaveAttribute('open','');
  await groups.getByRole('button',{name:'Previous groups',exact:true}).click();await expect(groups.locator('tbody tr')).toHaveCount(20);await expect(groups).toHaveAttribute('open','');
  await dialog.getByRole('button',{name:'Show all groups',exact:true}).click();await expect(dialog.getByRole('button',{name:'Inspect source',exact:true})).toHaveCount(20);
  let failNext=true,failFilter=false;await page.route('**/api/research/materials/comparison-page',async route=>{
   const command=route.request().postDataJSON();if(failNext&&command.view==='distribution'&&command.offset===20||failFilter&&command.category==='correct'){failNext=false;failFilter=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',error:'Synthetic interrupted comparison query'})});}return route.continue();
  });
  await dialog.getByRole('button',{name:'More observations',exact:true}).click();await expect(page.locator('#notice')).toBeVisible();
  await expect(dialog.locator('[data-comparison-page-status]')).toHaveText('Results 1–20 of 25');
  await dialog.getByRole('button',{name:'Inspect source',exact:true}).first().click();await dialog.getByRole('button',{name:'Back to source',exact:true}).click();
  await expect(dialog.locator('[data-comparison-page-status]')).toHaveText('Results 1–20 of 25');
  await dialog.getByRole('button',{name:'More observations',exact:true}).click();await expect(dialog.getByRole('button',{name:'Inspect source',exact:true})).toHaveCount(5);
  await expect(dialog.locator('[data-comparison-page-status]')).toHaveText('Results 21–25 of 25');
  await dialog.getByRole('button',{name:'Previous observations',exact:true}).focus();await page.keyboard.press('Enter');await expect(dialog.getByRole('button',{name:'Inspect source',exact:true})).toHaveCount(20);
  failFilter=true;await dialog.getByLabel('Category filter').selectOption('correct');await expect(dialog.getByLabel('Category filter')).toHaveValue('mismatched');await expect(dialog.locator('[data-comparison-page-status]')).toHaveText('Results 1–20 of 25');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);expect(await dialog.locator('form').evaluate(el=>el.clientHeight)).toBeGreaterThan(300);
  await dialog.getByRole('button',{name:'Inspect source',exact:true}).first().focus();await page.keyboard.press('Enter');await expect(dialog.locator('[data-measurement-inspection]')).toBeVisible();
  await dialog.getByRole('button',{name:'Back to source',exact:true}).click();await expect(dialog.getByRole('button',{name:'Inspect source',exact:true})).toHaveCount(20);
  await dialog.getByLabel('Analysis view').scrollIntoViewIfNeeded();await page.screenshot({path:testInfo.outputPath('comparison-paged-phone.png')});expect(errors).toEqual([]);
 }finally{await app?.close();for(const fn of cleanup.reverse())await fn();}
});
