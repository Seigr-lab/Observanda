import {test,expect} from '@playwright/test';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {startServer} from '../../src/server.js';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';

test('authorization stays on the application origin across native resources, reload and another loopback listener',async({page,context})=>{
 const parent=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-session-browser-')),fixture=await encryptedFixture(directory,{...sampleNotebook(),title:'workspace'});
 const app=await startServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences')}),received=[];
 const other=http.createServer((request,response)=>{received.push(request.headers);response.end('<!doctype html><title>Other local service</title>');});other.listen(0,'127.0.0.1');await once(other,'listening');const otherOrigin='http://127.0.0.1:'+other.address().port;
 try{
  await page.goto(app.url);await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  const session=await page.evaluate(async()=>{const {browserSession}=await import('/session-store.js');return browserSession();});expect(session).toMatch(/^[a-f0-9]{64}$/);
  expect((await context.cookies()).filter(cookie=>cookie.name==='observanda')).toHaveLength(0);
  // Simulate even the strongest captured-cookie case: a cookie containing the
  // actual valid session ID must never authenticate without the custom header.
  await context.addCookies([{name:'observanda',value:session,url:app.origin,httpOnly:true,sameSite:'Strict'}]);
  const unrelated=await context.newPage();await unrelated.goto(otherOrigin);expect(received.at(-1).cookie).toContain(session);expect(received.at(-1)['x-observanda-session']).toBeUndefined();
  const replay=await fetch(app.origin+'/api/access/status',{headers:{Cookie:received.at(-1).cookie}});expect(replay.status).toBe(401);
  expect((await fetch(app.origin+'/api/access/status',{headers:{'X-Observanda-Session':session}})).status).toBe(200);
  expect(await page.evaluate(async()=>{try{await fetch('http://127.0.0.1:1/');}catch{}return (await fetch('/api/access/status')).status;})).toBe(200);
  // The origin store is shared by legitimate tabs, not other ports.
  expect(await unrelated.evaluate(async()=>{const databases=await indexedDB.databases();return databases.map(value=>value.name);})).not.toContain('observanda-browser-session');
  const native=await context.newPage();await native.goto(app.origin+'/api/access/status');expect(await native.locator('body').innerText()).toContain('locked');await native.close();
  await page.reload();await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await unrelated.close();
 }finally{await app.close();await clearVault(fixture.vault);await new Promise(resolve=>other.close(resolve));expect(path.dirname(directory)).toBe(parent);expect(path.basename(directory)).toMatch(/^observanda-session-browser-/);await rm(directory,{recursive:true,force:true});}
});
