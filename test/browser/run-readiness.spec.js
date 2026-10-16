import {test,expect} from '@playwright/test';
import path from 'node:path';
import {intakeFixture,hash} from '../fixtures/local-intake.js';
import {startServer} from '../../src/server.js';
import {WebsiteSites} from '../../src/website-sites.js';
import {websiteWorkspace} from '../../src/website-workspace.js';
import {PublicationJobs} from '../../src/publication-jobs.js';

test('manual readiness selects project editions, exposes source receipts and detects new evidence without an importer',async({page},testInfo)=>{
 test.setTimeout(60000);let cleanup,releasePolicy;const f=await intakeFixture({after:fn=>{cleanup=fn;}}),sites=new WebsiteSites(f.ws),ids=[],projectId=f.book.notebooks.find(n=>n.id===f.record.notebookId).projectId;
 for(const [name,record] of [['Research journal',f.record],['Unrelated website',f.book.entries[1]]]){
  const site=await sites.change({workspaceId:f.book.id,etag:(await f.ws.outline()).etag,operation:'create',name}),current=await sites.read(site.id);ids.push(site.id);
  await sites.save(site.id,{workspaceId:f.book.id,baseEtag:current.etag,metadata:{},projects:[],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[{id:record.id,share:true,attachments:[]}]}});
  await new PublicationJobs(websiteWorkspace(f.ws,site.id)).inline({etag:(await f.ws.outline()).etag});
 }
 const app=await startServer({root:f.ws.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));const dialog=page.locator('#dialog');
 const readiness=async()=>{await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await dialog.getByRole('button',{name:'Run readiness',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Run readiness',exact:true})).toBeVisible();};
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,f.record.id);await readiness();
  await dialog.getByRole('button',{name:'Link receipt',exact:true}).click();
  for(const [label,value] of [['Private source revision','PRIVATE source 1'],['Source SHA-256',hash('source')],['Scope and verification statement','PRIVATE manual validation'],['Validation tool','Independent inspection'],['Tool version','1'],['Tool source SHA-256',hash('validator')]])await dialog.getByLabel(label,{exact:true}).fill(value);
  await dialog.getByRole('button',{name:'Save receipt',exact:true}).click();await expect(dialog.getByText('PRIVATE manual validation',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Link receipt',exact:true}).click();await dialog.getByLabel('Receipt kind',{exact:true}).selectOption('publication');await dialog.getByLabel('Website',{exact:true}).selectOption(ids[1]);await expect(dialog.getByRole('button',{name:'Save receipt',exact:true})).toBeDisabled();
  await dialog.getByLabel('Website',{exact:true}).selectOption(ids[0]);await expect(dialog.getByLabel('Prepared edition',{exact:true})).toBeVisible();await expect(dialog.getByRole('button',{name:'Save receipt',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Save receipt',exact:true}).click();
  await dialog.getByText('Receipt details',{exact:true}).first().click();await expect(dialog).toContainText('PRIVATE source 1');await expect(dialog).toContainText(hash('source'));
  await dialog.getByText('Receipt details',{exact:true}).last().click();await expect(dialog).toContainText('Research journal');
  await dialog.getByText('Project completion policy',{exact:true}).click();await dialog.getByLabel('Validation',{exact:true}).check();await dialog.getByLabel('Publication edition',{exact:true}).check();await dialog.getByRole('button',{name:'Save completion policy',exact:true}).click();await expect(dialog.getByLabel('Validation',{exact:true})).not.toBeVisible();
  await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByLabel('Progress',{exact:true}).selectOption('completed');await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');
  await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await dialog.getByRole('button',{name:'Import original file',exact:true}).click();await dialog.getByLabel('Original file',{exact:true}).setInputFiles({name:'later-evidence.txt',mimeType:'text/plain',buffer:Buffer.from('PRIVATE later observation')});await dialog.getByRole('button',{name:'Import original',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Run readiness',exact:true}).click();
  await expect(dialog).toContainText('Required completion receipts missing: Validation, Publication edition');await expect(dialog.getByText('Evidence has changed since this receipt was linked. It does not satisfy the current completion policy.',{exact:true})).toHaveCount(2);
  await page.setViewportSize({width:390,height:844});await dialog.getByText('Receipt details',{exact:true}).first().click();const bounds=await dialog.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+2);await page.screenshot({path:testInfo.outputPath('readiness-phone.png')});
  // Returning to evidence while the policy response is delayed must not let
  // that late response replace the user's current view.
  let policyWritten;const written=new Promise(resolve=>{policyWritten=resolve;}),hold=new Promise(resolve=>{releasePolicy=resolve;});
  await page.route('**/api/v1/intake/policy',async route=>{const response=await route.fetch();policyWritten();await hold;await route.fulfill({response});});
  await dialog.getByText('Project completion policy',{exact:true}).click();await dialog.getByLabel('Git commit',{exact:true}).check();await dialog.getByRole('button',{name:'Save completion policy',exact:true}).click();await written;
  await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();const delivered=page.waitForResponse('**/api/v1/intake/policy');releasePolicy();await delivered;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();expect(errors).toEqual([]);
 }finally{releasePolicy?.();await page.close();await app.close();await cleanup();}
});
