import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {desktopFixture} from './fixture.js';

test('an unexpected successful service exit is reported and startup diagnostics stay private',async()=>{
 const fixture=await desktopFixture(),app=await fixture.start();
 try{
  const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
  const children=await app.evaluate(({dialog})=>{
   globalThis.serviceDialogs=0;dialog.showMessageBox=async()=>{globalThis.serviceDialogs++;return {response:0};};
   const services=process._getActiveHandles().filter(handle=>handle.spawnargs?.some(value=>String(value).endsWith('desktop-service.js')));
   for(const service of services)service.send({type:'stop'});return services.length;
  });expect(children).toBe(1);
  await expect(page.getByRole('alert')).toContainText('service stopped unexpectedly',{timeout:20000});
  expect(await app.evaluate(({BrowserWindow})=>({dialogs:globalThis.serviceDialogs,visible:BrowserWindow.getAllWindows().some(window=>window.isVisible())}))).toEqual({dialogs:0,visible:false});
  const raw=await readFile(path.join(fixture.directory,'diagnostics/operations-0.jsonl'),'utf8');
  expect(raw).toContain('service-start');expect(raw).toContain('service-stop');expect(raw).not.toContain(fixture.directory.replaceAll('\\','\\\\'));
 }finally{await fixture.dispose(app);}
});
