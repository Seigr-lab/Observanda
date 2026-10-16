import {test,expect} from '@playwright/test';
import path from 'node:path';
import {intakeFixture,hash} from '../fixtures/local-intake.js';
import {startServer} from '../../src/server.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
test('record intake previews, resumes after reload and applies through the actual UI with readiness receipts',async({page},testInfo)=>{
 let cleanup;const f=await intakeFixture({after:fn=>{cleanup=fn;}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const app=await startServer({root:f.ws.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')});
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,f.record.id);
  const dialog=page.locator('#dialog');await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.getByRole('button',{name:'Intake & readiness',exact:true}).click();
  await dialog.getByLabel('Proposal folder',{exact:true}).fill(f.source);await dialog.getByRole('button',{name:'Validate proposal',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'Proposal preview'})).toBeVisible();expect(await new ResearchMaterials(f.ws).current(f.manifest.files[0].id)).toBeNull();
  await dialog.getByRole('button',{name:'Stage privately'}).click();await expect(dialog.getByRole('button',{name:'Apply reviewed proposal'})).toBeVisible({timeout:30000});
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.getByRole('button',{name:'Intake & readiness',exact:true}).click();await dialog.getByRole('button',{name:'Inspect Next run evidence'}).click();
  await dialog.getByRole('button',{name:'Apply reviewed proposal'}).click();await expect(dialog.getByText('Application receipt',{exact:true})).toBeVisible({timeout:30000});
  await dialog.getByRole('button',{name:'Back to intake'}).click();await dialog.getByRole('button',{name:'Run readiness',exact:true}).click();
  await expect(dialog.getByText('1 original file',{exact:true})).toBeVisible();await expect(dialog.getByText('Current revision',{exact:false})).toBeVisible();
  await dialog.getByText('Project completion policy',{exact:true}).click();await dialog.getByLabel('Validation',{exact:true}).check();await dialog.getByRole('button',{name:'Save completion policy'}).click();
  await dialog.getByRole('button',{name:'Link receipt',exact:true}).click();await dialog.getByLabel('Receipt kind').selectOption('git');
  await dialog.getByLabel('Private source revision',{exact:true}).fill('private-source-v1');
  await dialog.getByLabel('Scope and verification statement').fill('Declared external source commit');await dialog.getByLabel('Source SHA-256',{exact:true}).fill(hash('source'));await dialog.getByLabel('Repository identifier').fill('synthetic/private');await dialog.getByLabel('Git commit identity').fill('a'.repeat(40));
  await dialog.getByRole('button',{name:'Save receipt'}).click();await expect(dialog.getByText('Declared external source commit',{exact:true})).toBeVisible();
  await dialog.locator('li').filter({hasText:'Declared external source commit'}).getByText('Receipt details',{exact:true}).click();await expect(dialog).toContainText('private-source-v1');await expect(dialog).toContainText('synthetic/private');
  await page.setViewportSize({width:390,height:844});await expect(dialog.getByRole('button',{name:'Back to evidence'})).toBeVisible();
  const bounds=await dialog.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+2);await page.screenshot({path:testInfo.outputPath('intake-readiness.png')});expect(errors).toEqual([]);
 }finally{await page.close();await app.close();await cleanup();}
});

test('large record reader admits an evidence proposal without opening the full record',async({page})=>{
 test.setTimeout(120000);let cleanup;const f=await intakeFixture({after:fn=>{cleanup=fn;}},{large:true}),errors=[],requests=[],record=ResearchCatalogue.prototype.record,owner=ResearchMaterials.prototype.owner;
 ResearchCatalogue.prototype.record=()=>{throw Error('Reader intake reconstructed the record');};ResearchMaterials.prototype.owner=()=>{throw Error('Reader intake loaded a complete owner');};
 const app=await startServer({root:f.ws.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();const dialog=page.locator('#dialog');await dialog.getByRole('button',{name:'Intake & readiness',exact:true}).click();
  await dialog.locator('summary').filter({hasText:'Target record ID'}).click();await expect(dialog).toContainText(f.manifest.expectedRevision);await dialog.getByLabel('Proposal folder',{exact:true}).fill(f.source);await dialog.getByRole('button',{name:'Validate proposal',exact:true}).click();await dialog.getByRole('button',{name:'Stage privately',exact:true}).click();await expect(dialog.getByRole('button',{name:'Apply reviewed proposal',exact:true})).toBeVisible({timeout:30000});
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await dialog.getByRole('button',{name:'Intake & readiness',exact:true}).click();await dialog.getByRole('button',{name:'Inspect Next run evidence',exact:true}).click();await dialog.getByRole('button',{name:'Apply reviewed proposal',exact:true}).click();await expect(dialog.getByText('Application receipt',{exact:true})).toBeVisible({timeout:30000});
  await dialog.getByRole('button',{name:'Back to intake',exact:true}).click();await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(f.record.title);expect(requests).not.toContain('/api/workspace/read/selection');expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=record;ResearchMaterials.prototype.owner=owner;await app.close();await cleanup();}
});

test('a reviewed full-record amendment refreshes the reader after closing intake',async({page})=>{
 test.setTimeout(90000);let cleanup;const f=await intakeFixture({after:fn=>{cleanup=fn;}}),requests=[];f.manifest.record={...f.record,title:'Amended through reviewed intake',share:false};await f.write();
 const app=await startServer({root:f.ws.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')});page.on('request',r=>requests.push(new URL(r.url()).pathname));
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();const dialog=page.locator('#dialog');await dialog.getByRole('button',{name:'Intake & readiness',exact:true}).click();await dialog.getByLabel('Proposal folder',{exact:true}).fill(f.source);await dialog.getByRole('button',{name:'Validate proposal',exact:true}).click();await dialog.getByRole('button',{name:'Stage privately',exact:true}).click();await expect(dialog.getByRole('button',{name:'Apply reviewed proposal',exact:true})).toBeVisible({timeout:30000});await dialog.getByRole('button',{name:'Apply reviewed proposal',exact:true}).click();await expect(dialog.getByText('Application receipt',{exact:true})).toBeVisible({timeout:30000});
  await dialog.getByRole('button',{name:'Back to intake',exact:true}).click();await dialog.getByRole('button',{name:'Back to evidence',exact:true}).click();await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(f.manifest.record.title,{timeout:15000});expect(requests).not.toContain('/api/workspace/read/selection');
 }finally{await app.close();await cleanup();}
});
