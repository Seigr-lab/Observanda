import {test,expect} from '@playwright/test';
import {mkdtemp,rm,mkdir,unlink,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {sampleNotebook} from '../../src/sample.js';
import {startServer} from '../../src/server.js';
import {rememberLocation} from '../../src/preferences.js';
import {clearVault} from '../../src/encryption.js';

test('legacy markers are recovered inside the app without altering identity or research',async({page})=>{
 test.setTimeout(120000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-writer-recovery-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),preferences=path.join(directory,'preferences.json');
 await rememberLocation(preferences,f.workspace.root);const identity=await readFile(f.deviceStore.file),before=(await f.workspace.read()).etag;
 const files=[path.join(f.workspace.root,'.observanda','write.lock'),preferences+'.lock',f.deviceStore.file+'.lock'];
 for(const file of files){await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});await mkdir(file);}
 const app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore,preferencesFile:preferences});
 try{
  expect((await fetch(app.origin+'/api/writer-recovery')).status).toBe(401);
  await page.goto(app.url);const dialog=page.locator('dialog.writer-recovery');await expect(dialog).toBeVisible();await expect(dialog.locator('form')).toHaveCount(3);
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  const guarded=await page.evaluate(async()=>{const state=await(await fetch('/api/writer-recovery')).json(),lock=state.locks[0];return (await fetch('/api/writer-recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...lock,contextId:state.contextId})})).status;});expect(guarded).toBe(422);
  for(let remaining=3;remaining>0;remaining--){const form=dialog.locator('form').first();await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Release old writer marker'}).click();await expect(dialog.locator('form')).toHaveCount(remaining-1);}
  await dialog.getByRole('button',{name:'Continue',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  for(const file of files)expect((await lstat(file)).isFile()).toBe(true);
  expect(await readFile(f.deviceStore.file)).toEqual(identity);expect((await f.workspace.read()).etag).toBe(before);
 }finally{await app.close();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
