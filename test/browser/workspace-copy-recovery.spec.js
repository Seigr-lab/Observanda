import {test,expect} from '@playwright/test';
import {setRecordTitle} from './record-editing-helper.js';
import {mkdtemp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {clearVault} from '../../src/encryption.js';
import {readPreference,inspectLocation} from '../../src/locations.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {preferences} from './preferences-helper.js';
import {setTimeout as delay} from 'node:timers/promises';
const copyNotebook=()=>({...sampleNotebook(),title:'workspace'});

for(const fresh of [false,true])test(`${fresh?'fresh-key':'ordinary'} workspace copy recovers a lost completion response without copying again`,async({page})=>{
 test.setTimeout(60000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-response-')),f=await encryptedFixture(directory,copyNotebook()),preferencesFile=path.join(directory,'preferences'),destination=path.join(directory,'verified-copy');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile}),before=await f.workspace.read();let attempts=0,confirmed=false;
 const route=fresh?'/api/storage/encrypt':'/api/storage/copy',dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toHaveText(path.basename(f.workspace.root));await preferences(page,'Storage & access');
  if(fresh){await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();await page.getByText('Continue with a different group',{exact:true}).click();await page.getByRole('button',{name:'Create private successor',exact:true}).click();}
  else await page.getByRole('button',{name:'Copy workspace to another folder',exact:true}).click();
  await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);if(fresh)await dialog.getByRole('button',{name:'Review encrypted copy',exact:true}).click();
  await page.route('**'+route,async request=>{attempts++;if(attempts===1)return request.abort('connectionreset');const result=await request.fetch();expect(result.ok()).toBe(true);confirmed=true;await request.abort('connectionreset');});
  const submit=dialog.getByRole('button',{name:fresh?'Encrypt and use this copy':'Copy and use this folder',exact:true});await submit.click();await expect(submit).toBeEnabled();
  await expect(access(destination)).rejects.toMatchObject({code:'ENOENT'});expect(await f.workspace.read()).toEqual(before);
  await submit.click();await expect.poll(()=>confirmed).toBe(true);await expect(dialog).not.toBeVisible();expect(attempts).toBe(2);
  expect(await readPreference(preferencesFile)).toBe(destination);await preferences(page,'Storage & access');await expect(page.locator('.storage-path').first()).toHaveText(destination);expect(await f.workspace.read()).toEqual(before);
  await page.reload();await expect(page.locator('.workspace-name')).toHaveText(path.basename(destination));expect(attempts).toBe(2);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

for(const code of ['ENOSPC','EACCES'])test(`failed backup verification (${code}) keeps the source active and editable`,async({page})=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-failure-')),f=await encryptedFixture(directory,copyNotebook()),preferencesFile=path.join(directory,'preferences'),destination=path.join(directory,'incomplete-copy');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile}),before=await f.workspace.read(),remembered=await readPreference(preferencesFile),verify=ResearchCatalogue.prototype.verify;
 let injected=false;
 ResearchCatalogue.prototype.verify=function(...args){if(this.workspace.root===destination){injected=true;throw Object.assign(Error('Synthetic verification failure'),{code});}return verify.apply(this,args);};
 try{
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toHaveText(path.basename(f.workspace.root));await preferences(page,'Storage & access');await page.getByRole('button',{name:'Copy workspace to another folder',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);
  await dialog.getByRole('button',{name:'Copy and use this folder',exact:true}).click();await expect.poll(()=>injected).toBe(true);
  await expect(dialog.getByRole('button',{name:'Copy and use this folder',exact:true})).toBeEnabled();expect(await readPreference(preferencesFile)).toBe(remembered);expect(await f.workspace.read()).toEqual(before);await expect(inspectLocation(destination)).rejects.toMatchObject({code:'STORAGE_INCOMPLETE'});
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.evaluate(id=>location.hash='#/records/'+id,before.book.entries[0].id);
  await expect(page.locator('.record-editing h1')).toHaveText(before.book.entries[0].title);await setRecordTitle(page,'Work continues after the failed backup');expect((await f.workspace.read()).book.entries[0].title).toBe('Work continues after the failed backup');
 }finally{ResearchCatalogue.prototype.verify=verify;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

for(const fresh of [false,true])test(`${fresh?'fresh-key':'ordinary'} copy stays connected beyond the server idle timeout`,async({page})=>{
 test.setTimeout(60000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-timeout-')),f=await encryptedFixture(directory,copyNotebook()),destination=path.join(directory,'verified-copy'),preferencesFile=path.join(directory,'preferences');
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile}),verify=ResearchCatalogue.prototype.verify,route=fresh?'/api/storage/encrypt':'/api/storage/copy';
 let socket,requests=0,completed=0,earlyDisconnects=0,delayed=false;
 app.server.prependListener('request',(req,res)=>{if(req.url===route){
  socket=req.socket;requests++;req.setTimeout(250);
  res.once('finish',()=>completed++);res.once('close',()=>{if(!res.writableFinished)earlyDisconnects++;});
 }});
 ResearchCatalogue.prototype.verify=async function(...args){
  if(this.workspace.root===destination&&!delayed){delayed=true;expect(socket.timeout).toBe(0);await delay(750);}
  return verify.apply(this,args);
 };
 try{
  await page.goto(app.url);await expect(page.locator('.workspace-name')).toHaveText(path.basename(f.workspace.root));await preferences(page,'Storage & access');
  if(fresh){await page.getByRole('button',{name:'Manage workspace access',exact:true}).click();await page.getByText('Continue with a different group',{exact:true}).click();await page.getByRole('button',{name:'Create private successor',exact:true}).click();}
  else await page.getByRole('button',{name:'Copy workspace to another folder',exact:true}).click();
  const dialog=page.locator('#dialog');await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);if(fresh)await dialog.getByRole('button',{name:'Review encrypted copy',exact:true}).click();
  const responding=page.waitForResponse(response=>new URL(response.url()).pathname===route);
  await dialog.getByRole('button',{name:fresh?'Encrypt and use this copy':'Copy and use this folder',exact:true}).click();const response=await responding;
  expect(response.headers()['content-type']).toContain('application/x-ndjson');
  await expect(dialog).not.toBeVisible({timeout:30000});await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  // Chromium can report ERR_ABORTED after a consumed streaming body. Check
  // the actual server completion, destination activation and subsequent read.
  expect(delayed).toBe(true);expect(requests).toBe(1);expect(completed).toBe(1);expect(earlyDisconnects).toBe(0);expect(await readPreference(preferencesFile)).toBe(destination);
  await preferences(page,'Storage & access');await expect(page.locator('.storage-path').first()).toHaveText(destination);
 }finally{ResearchCatalogue.prototype.verify=verify;await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});


test('an interrupted workspace copy resumes the same folder after restarting the application',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-copy-restart-')),f=await encryptedFixture(directory,copyNotebook()),preferencesFile=path.join(directory,'preferences'),destination=path.join(directory,'Recovered Workspace 1');
 const verify=ResearchCatalogue.prototype.verify;let failed=false,app;
 ResearchCatalogue.prototype.verify=function(...args){if(this.workspace.root===destination&&!failed){failed=true;throw Object.assign(Error('Synthetic interruption'),{code:'ENOSPC'});}return verify.apply(this,args);};
 const start=()=>startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile});
 const begin=async()=>{await page.goto(app.url);await preferences(page,'Storage & access');await page.getByRole('button',{name:'Copy workspace to another folder',exact:true}).click();const dialog=page.locator('#dialog');await dialog.getByLabel('Workspace folder',{exact:true}).fill(destination);if(failed){await dialog.getByRole('button',{name:'Check folder',exact:true}).click();await expect(dialog.locator('.storage-check-result')).toHaveText('Ready to resume this workspace copy.');}await dialog.getByRole('button',{name:'Copy and use this folder',exact:true}).click();return dialog;};
 try{
  app=await start();const first=await begin();await expect.poll(()=>failed).toBe(true);await expect(first.getByRole('button',{name:'Copy and use this folder',exact:true})).toBeEnabled();await expect(inspectLocation(destination)).rejects.toMatchObject({code:'STORAGE_INCOMPLETE'});
  await app.close();app=await start();const retried=await begin();await expect(retried).not.toBeVisible({timeout:60000});expect(await readPreference(preferencesFile)).toBe(destination);
  await preferences(page,'Storage & access');await expect(page.locator('.storage-path').first()).toHaveText(destination);await page.reload();await expect(page.locator('.workspace-name')).toHaveText('Recovered Workspace 1');
 }finally{ResearchCatalogue.prototype.verify=verify;await app?.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
