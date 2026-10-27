import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {desktopFixture} from './fixture.js';

test('an unexpected successful service exit is reported and startup diagnostics stay private',async()=>{
 const fixture=await desktopFixture(),app=await fixture.start();
 try{
  const page=await app.firstWindow();await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
  const children=await app.evaluate(({dialog})=>{
   dialog.showMessageBox=async(...args)=>{globalThis.observandaUnexpectedExit=args.at(-1);return new Promise(()=>{});};
   const services=process._getActiveHandles().filter(handle=>handle.spawnargs?.some(value=>String(value).endsWith('desktop-service.js')));
   for(const service of services)service.send({type:'stop'});return services.length;
  });expect(children).toBe(1);
  await expect.poll(()=>app.evaluate(()=>globalThis.observandaUnexpectedExit?.message),{timeout:20000}).toContain('service stopped unexpectedly');
  const raw=await readFile(path.join(fixture.directory,'diagnostics/operations-0.jsonl'),'utf8');
  expect(raw).toContain('service-start');expect(raw).toContain('service-stop');expect(raw).not.toContain(fixture.directory.replaceAll('\\','\\\\'));
 }finally{await fixture.dispose(app);}
});
