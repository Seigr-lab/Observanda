import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {seedModuleCurrent} from '../module-current-fixture.js';
import {defaultDashboard} from '../../src/web/dashboard-model.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../../src/security/dashboard-storage.js';
import {preferences} from './preferences-helper.js';

test('old unscoped module deep links replace history for cold and reused editors',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-route-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),id=randomUUID(),now=new Date().toISOString(),errors=[];let app;
 try{
  const settings=defaultDashboard();settings.enabledModules=['planning'];settings.views[0].panels=[];await writeWorkspaceDashboard(f.workspace,settings,(await readWorkspaceDashboard(f.workspace)).etag);
  await seedModuleCurrent(f.workspace,book.id,[{id,type:'task',revision:1,createdAt:now,updatedAt:now,data:{projectId:null,title:'Direct linked task',description:'',status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[]}}]);
  app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});page.on('pageerror',error=>errors.push(error.message));await page.goto(app.url);await preferences(page,'General');
  const previous=page.url(),old=app.origin+'/#/modules/planning/task/'+id,canonical='#/modules/planning/scope/workspace/task/'+id;
  for(const warm of [false,true]){
   const before=await page.evaluate(()=>history.length);await page.goto(old);await expect(page.getByLabel('Task title',{exact:true})).toHaveValue('Direct linked task');await expect.poll(()=>page.evaluate(()=>location.hash)).toBe(canonical);
   // The second visit replaces the forward entry that Back left in place.
   expect(await page.evaluate(()=>history.length)).toBe(before+(warm?0:1));
   await page.goBack();await expect(page).toHaveURL(previous);await expect(page.locator('.preferences-heading')).toBeVisible();await expect(page.locator('#leave-dialog')).not.toBeVisible();
  }
  expect(errors).toEqual([]);
 }finally{await page.close();await app?.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
