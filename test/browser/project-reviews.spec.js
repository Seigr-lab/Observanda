import {openRecordActions} from './record-editing-helper.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {projectTemplateFixture} from './project-template-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {Reviews} from '../../src/reviews.js';
import {ReviewIdentity,reviewHash} from '../../src/security/review-exchange.js';
import {TestDeviceStore} from '../device-fixture.js';
import {navigate,preferences} from './preferences-helper.js';

test('project review authoring keeps the selected owner through downloads and reopening',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-reviews-')),book=sampleNotebook(),f=await projectTemplateFixture(directory,book),errors=[],routes=[];let app;
 try{
  const reviews=new Reviews(f.workspace,f.deviceStore),reviewer=new ReviewIdentity(new TestDeviceStore({file:path.join(directory,'reviewer.key')})),contact=await reviewer.contact();
  await reviews.run('contact',{workspaceId:book.id,name:'Project reviewer',contact,verified:true});
  app=await startServer({root:f.applicationRoot,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:path.join(directory,'preferences.json')});
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const route=new URL(request.url()).pathname;if(route.includes('/reviews/'))routes.push(route);});
  await page.goto(app.url);await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Collaboration',exact:true}).check();
  const record=book.entries[0],url=app.origin+'/#/owners/'+book.projects[0].id+'/records/'+record.id+'/read';
  await page.goto(url);await openRecordActions(page);await page.getByRole('button',{name:'Witnessed by',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByRole('button',{name:'Request review',exact:true}).click();await expect(dialog.getByLabel('Reviewer',{exact:true})).toContainText('Project reviewer');
  await dialog.getByLabel('Review instructions',{exact:true}).fill('Check this project observation.');await dialog.getByRole('button',{name:'Preview selection',exact:true}).click();await expect(dialog.locator('[data-review-plan]')).toContainText('1 saved record selected.');
  const downloading=page.waitForEvent('download');await dialog.getByRole('button',{name:'Create encrypted request',exact:true}).click();const download=await downloading,request=await reviewer.open(JSON.parse(await readFile(await download.path(),'utf8')));
  expect(request.value.workspaceId).toBe(book.id);expect(request.value.records[0].id).toBe(record.id);
  const identity=await reviews.run('identity',{workspaceId:book.id}),response=await reviewer.sign({kind:'response',id:randomUUID(),requestId:request.value.id,requestHash:reviewHash(request),createdAt:new Date().toISOString(),sender:contact,recipient:reviewHash(identity.contact),decisions:[{id:record.id,revision:request.value.records[0].revision,decision:'reviewed',comment:'Feedback belongs to this project.'}]});
  await reviews.run('import',{workspaceId:book.id,file:await reviewer.seal(response,identity.contact)});
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await navigate(page,'Dashboard');await page.goto(url);await openRecordActions(page);await page.getByRole('button',{name:'Witnessed by',exact:true}).click();await expect(dialog).toContainText('Feedback belongs to this project.');await expect(dialog).toContainText('Current saved revision');
  expect(routes.length).toBeGreaterThan(3);expect(routes.every(route=>route.startsWith('/api/projects/'+book.projects[0].id+'/reviews/'))).toBe(true);expect(errors).toEqual([]);
 }finally{await test.info().attach('review-requests',{body:JSON.stringify({routes,errors}),contentType:'application/json'});await app?.close();await f.close();await rm(directory,{recursive:true,force:true});}
});
