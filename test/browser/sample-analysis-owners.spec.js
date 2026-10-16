import {test,expect} from '@playwright/test';
import path from 'node:path';
import {sampleAnalysisOwnerFixture} from '../sample-analysis-owner-fixture.js';
import {testServer} from '../device-fixture.js';
import {defaultDashboard,createPanel} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {SampleAnalysisReader} from '../../src/sample-analysis-reader.js';

test('sample cards open, edit, review and print in their selected lab book',async({browser})=>{
 test.setTimeout(240000);const cleanup=[],page=await browser.newPage(),errors=[];let app;page.setDefaultTimeout(15000);
 try{
  const f=await sampleAnalysisOwnerFixture({after:fn=>cleanup.push(fn)}),chosen=f.books[0],options={scopeMode:'selected',projectIds:[chosen.projectId],includeDescendants:false,includeWorkspace:false,notebookMode:'selected',notebookIds:[chosen.labBookId]};
  for(const owner of f.owners){const settings=defaultDashboard();settings.enabledModules.push('laboratory');if(!owner.projectId)settings.views[0].panels=[{...createPanel('analyses','results'),moduleId:'laboratory',options},{...createPanel('samples','samples'),moduleId:'laboratory',options}];await writeWorkspaceDashboard(owner.storage,settings,(await readWorkspaceDashboard(owner.storage)).etag);}
  app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,headless:true,preferencesFile:path.join(f.directory,'preferences.json')});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);
  const card=page.locator('[data-desk-card="results"]'),dialog=page.locator('#dialog');await expect(card.getByRole('button',{name:'Retry',exact:true})).toBeVisible();await card.getByRole('button',{name:'Retry',exact:true}).click();
  const unlock=page.locator('#project-unlock-form');await unlock.getByLabel('Lab book password',{exact:true}).fill('Protected observations 456!');await unlock.getByRole('button',{name:'Unlock',exact:true}).click();await expect(unlock).not.toBeVisible();
  await expect(card.getByRole('button',{name:'Analysis 0000',exact:true})).toBeVisible();await expect(card).toContainText(chosen.directory);
  await card.getByRole('button',{name:'Analysis 0000',exact:true}).click();await expect(page).toHaveURL(new RegExp('/owners/'+chosen.projectId+'/books/'+chosen.labBookId+'/'));await expect(dialog.getByLabel('Result value',{exact:true})).toHaveValue('3');
  await dialog.getByLabel('Result value',{exact:true}).fill('7');await dialog.getByRole('button',{name:'Save result',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.locator('main').getByRole('button',{name:/^Analyses /}).click();await page.getByRole('button',{name:'Analysis 0000',exact:true}).click();await expect(dialog.getByLabel('Result value',{exact:true})).toHaveValue('7');await dialog.getByRole('button',{name:'Save and submit for review',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.getByRole('button',{name:'Analysis 0000',exact:true}).click();await dialog.getByRole('button',{name:'Review result',exact:true}).click();await dialog.getByLabel('Reviewer name',{exact:true}).fill('Fixture reviewer');await dialog.locator('input[type="checkbox"]').check();await dialog.getByRole('button',{name:'Record review',exact:true}).click();await expect(dialog).not.toBeVisible();
  await page.locator('main').getByRole('button',{name:/^Analyses /}).click();await page.getByRole('button',{name:'Analysis 0000',exact:true}).click();const sheet=dialog.locator('a[target="_blank"]');await expect(sheet).toHaveAttribute('href',new RegExp('/api/projects/'+chosen.projectId+'/lab-books/'+chosen.labBookId+'/laboratory/issued/'));
  const [report]=await Promise.all([page.waitForEvent('popup'),sheet.click()]);await expect(report.getByRole('heading',{name:'Result sheet',exact:true})).toBeVisible();await expect(report.locator('tbody')).toContainText('7');await report.close();await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await expect(page.locator('main').getByRole('heading',{name:'Sample analysis',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Dashboard',exact:true}).getByRole('button',{name:'Dashboard',exact:true}).click();await expect(card.getByRole('button',{name:'Analysis 0000',exact:true})).toBeVisible();await expect(card.locator('.desk-data-scope')).toHaveText('Field Project 1');await expect(page.locator('[data-desk-card="samples"]').getByRole('button',{name:'Sample 0000',exact:true})).toBeVisible();await page.screenshot({path:test.info().outputPath('owned-sample-results.png'),fullPage:true});
  const root=await new SampleAnalysisReader(f.owners[0].service).selected({workspaceId:f.workspaceId,kind:'analysis',id:f.analyses[0].id});expect(root.record.result.value).toBe(0);expect(root.record.status).toBe('draft');expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();for(const close of cleanup.reverse())await close();}
});
