import {test,expect} from '@playwright/test';
import {access,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {desktopFixture} from './fixture.js';
import {sampleNotebook} from '../../src/sample.js';

test('packaged upgrade adopts the existing folder name, renames its database and reopens preserved research',async()=>{
 test.skip(!process.env.OBSERVANDA_DESKTOP_PREVIOUS_EXECUTABLE,'Requires the previous installed development build.');
 test.setTimeout(240000);
 const fixture=await desktopFixture('observanda-desktop-naming-'),source=path.join(fixture.directory,'Legacy workspace folder'),name='Research Workspace 1 – café',destination=path.join(fixture.directory,name),bytes=Buffer.alloc(1024*1024,81);
 let app,page;const errors=[];
 const launch=async executable=>{app=await fixture.start(executable);page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));};
 const data=()=>page.evaluate(async()=>{const storage=await (await fetch('/api/storage')).json(),r=await fetch('/api/notebook',{headers:{'X-Observanda-Workspace':storage.contextId}});if(!r.ok)throw Error('Notebook read failed');return r.json();});
 try{
  await launch(process.env.OBSERVANDA_DESKTOP_PREVIOUS_EXECUTABLE);
  await expect(page.getByRole('heading',{name:'Create a workspace',exact:true})).toBeVisible({timeout:60000});
  await page.getByLabel('Workspace name',{exact:true}).fill('Legacy metadata title');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Workspace folder',{exact:true}).fill(source);await page.getByLabel('Use this device',{exact:false}).check();await page.getByRole('button',{name:'Create workspace',exact:true}).click();
  await expect(page.locator('.topbar .workspace-name')).toHaveText('Legacy metadata title',{timeout:60000});
  await page.evaluate(async sample=>{
   const storage=await (await fetch('/api/storage')).json(),headers={'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},response=await fetch('/api/notebook',{headers});if(!response.ok)throw Error('Fixture notebook read failed: '+await response.text());const current=await response.json();sample.id=current.book.id;sample.title=current.book.title;sample.revision=current.book.revision;sample.createdAt=current.book.createdAt;
   const r=await fetch('/api/notebook/save',{method:'POST',headers,body:JSON.stringify({book:sample,etag:current.etag})});if(!r.ok)throw Error('Fixture research save failed: '+await r.text());
  },sampleNotebook());
  const before=await data(),accessBefore=await readFile(path.join(source,'.observanda/access.json')),bindingBefore=await readFile(path.join(source,'.observanda/research.observanda'));
  await writeFile(path.join(source,'.observanda/naming-original.bin'),bytes);await fixture.close(app);app=null;
  await launch();await expect(page.locator('.topbar .workspace-name')).toHaveText(path.basename(source),{timeout:60000});
  const adopted=await data();expect(adopted.book.id).toBe(before.book.id);expect(adopted.book.entries).toEqual(before.book.entries);
  await page.locator('#main-navigation').getByRole('button',{name:'Preferences',exact:true}).click();
  await page.locator('#workspace-name-form').getByLabel('Workspace name',{exact:true}).fill(name);await page.getByRole('button',{name:'Save workspace',exact:true}).click();
  await expect(page.locator('.topbar .workspace-name')).toHaveText(name,{timeout:60000});await expect(page.getByRole('button',{name:'Save workspace',exact:true})).toBeDisabled();
  const renamed=await data();expect(renamed.book.title).toBe(name);expect(renamed.book.entries).toEqual(before.book.entries);expect(renamed.book.id).toBe(before.book.id);
  await expect(access(source)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(path.join(destination,'.observanda/access.json'))).toEqual(accessBefore);expect(await readFile(path.join(destination,'.observanda/research.observanda'))).toEqual(bindingBefore);expect(await readFile(path.join(destination,'.observanda/naming-original.bin'))).toEqual(bytes);
  await fixture.close(app);app=null;await launch();await expect(page.locator('.topbar .workspace-name')).toHaveText(name,{timeout:60000});expect(await data()).toEqual(renamed);
  await page.evaluate(async()=>{const storage=await (await fetch('/api/storage')).json(),headers={'Content-Type':'application/json','X-Observanda-Workspace':storage.contextId},response=await fetch('/api/notebook',{headers});if(!response.ok)throw Error('Fixture notebook read failed: '+await response.text());const current=await response.json();current.book.description='Continued research after update';const r=await fetch('/api/notebook/save',{method:'POST',headers,body:JSON.stringify(current)});if(!r.ok)throw Error('Continued authoring failed');});
  expect((await data()).book.description).toBe('Continued research after update');expect(errors).toEqual([]);
 }finally{await fixture.dispose(app);}
});
