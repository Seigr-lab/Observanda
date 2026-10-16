import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {startServer} from '../../src/server.js';
import {StructureCommands} from '../../src/structure-commands.js';

const click=(scope,name)=>scope.getByRole('button',{name,exact:true}).click();
const card=(page,name)=>page.locator('.project-notebook').filter({has:page.getByRole('button',{name,exact:true})});
async function fixture(page){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-structure-ui-')),book=sampleNotebook();
 book.projects.push({id:randomUUID(),title:'Listening studio',description:'',share:true,logoId:null});
 book.entries.forEach(e=>e.share=true);
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book);
 const app=await startServer({root:ws.root,deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const navigate=async projectId=>{await page.evaluate(id=>location.hash='#/projects/'+id,projectId);await expect(page.locator('main h1')).toBeVisible();};
 await page.goto(app.url);await navigate(book.projects[0].id);
 return {book,ws,app,errors,navigate,async close(){await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}};
}
const saved=async(page,fn,workspace)=>{
 const response=page.waitForResponse(r=>r.url().endsWith('/api/workspace/structure')&&r.request().method()==='POST');
 await fn();const reply=await response;expect(reply.ok()).toBe(true);
 expect(reply.headers()['content-type']).toContain('application/x-ndjson');
 expect(reply.request().postDataJSON().response).toBe('outline');
 expect(reply.request().postDataJSON().commandId).toMatch(/^[a-f0-9-]{36}$/);
 await expect(page.locator('#dialog')).not.toBeVisible();
 return workspace.catalogue(store=>store.recordOutline());
};

test('existing project and lab-book forms reconcile indexed saves, moved contents and later record edits',async({page})=>{
 test.setTimeout(90000);
 const f=await fixture(page),dialog=page.locator('#dialog'),main=page.locator('main');
 try{
  await click(main,'Settings');await dialog.getByLabel('Name',{exact:true}).fill('Research studio');
  const project=await saved(page,()=>click(dialog,'Save project'),f.ws);
  expect(project.total).toBe(f.book.entries.length);await expect(main.locator('h1')).toHaveText('Research studio');
  await click(main,'New lab book');await dialog.getByLabel('Lab book name',{exact:true}).fill('Transferred takes');
  await dialog.getByLabel('Project',{exact:true}).selectOption(f.book.projects[1].id);
  await saved(page,()=>click(dialog,'Save lab book'),f.ws);await expect(dialog).not.toBeVisible();
  const destination=(await f.ws.read()).book.notebooks.find(n=>n.title==='Transferred takes');
  await click(card(page,f.book.notebooks[0].title),'Lab book settings');await click(dialog,'Delete lab book');
  await dialog.getByLabel('What should happen to its records?',{exact:true}).selectOption('move');
  await dialog.getByLabel('Destination lab book',{exact:true}).selectOption(destination.id);
  const move=await saved(page,()=>click(dialog,'Move records and delete lab book'),f.ws);
  expect(move.total).toBe(f.book.entries.length);expect(move.notebookCounts[destination.id]).toBe(f.book.entries.length);
  await expect(dialog).not.toBeVisible();await expect(card(page,f.book.notebooks[0].title)).toHaveCount(0);
  const current=(await f.ws.read()).book;
  expect(current.entries.every(e=>e.notebookId===destination.id&&!e.share)).toBe(true);
  await f.navigate(f.book.projects[1].id);await expect(card(page,'Transferred takes')).toContainText(f.book.entries.length+' records');
  // A record save must use the new saved base/revision, not an obsolete client copy.
  await page.evaluate(id=>location.hash='#/records/'+id,f.book.entries[0].id);
  await page.getByLabel('Record title',{exact:true}).fill('Edited after transfer');
  const recordResponse=page.waitForResponse(r=>r.url().endsWith('/api/research/records/save'));
  await page.locator('.section-save [data-action="save"]').click();expect((await recordResponse).ok()).toBe(true);
  await expect(page.locator('#save-status')).toHaveText('Saved');
  expect((await f.ws.read()).book.entries[0].title).toBe('Edited after transfer');
  await f.navigate(f.book.projects[1].id);await click(card(page,'Transferred takes'),'Lab book settings');await click(dialog,'Delete lab book');
  await dialog.getByLabel('What should happen to its records?',{exact:true}).selectOption('delete');
  const deletion=await saved(page,()=>click(dialog,'Delete lab book'),f.ws);
  expect(deletion.total).toBe(0);
  await expect(dialog).not.toBeVisible();await expect(card(page,'Transferred takes')).toHaveCount(0);
  await page.reload();await expect(card(page,'Transferred takes')).toHaveCount(0);expect((await f.ws.read()).book.entries).toEqual([]);
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('stale structure forms keep their draft and remain keyboard usable at a narrow enlarged layout',async({page},testInfo)=>{
 test.setTimeout(60000);
 const f=await fixture(page),dialog=page.locator('#dialog'),main=page.locator('main');
 try{
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='150%');
  await click(main,'New lab book');await dialog.getByLabel('Lab book name',{exact:true}).fill('Unsent field notes');
  const base=await f.ws.read();
  await new StructureCommands(f.ws).execute('structure',{etag:base.etag,change:{kind:'project',value:{...base.book.projects[0],description:'Concurrent project change'}}});
  const response=page.waitForResponse(r=>r.url().endsWith('/api/workspace/structure'));
  await dialog.getByRole('button',{name:'Save lab book',exact:true}).focus();await page.keyboard.press('Enter');
  expect((await response).headers()['content-type']).toContain('application/x-ndjson');
  await expect(dialog.getByRole('alert')).toContainText('Your choices are still here');
  await expect(dialog.getByLabel('Lab book name',{exact:true})).toHaveValue('Unsent field notes');
  expect((await f.ws.read()).book.notebooks.some(n=>n.title==='Unsent field notes')).toBe(false);
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
  await page.screenshot({path:testInfo.outputPath('structure-conflict-narrow.png')});
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('retrying a lost structure acknowledgement reuses its receipt without creating another project',async({page})=>{
 const f=await fixture(page),dialog=page.locator('#dialog'),commands=[];let lost=true,committed=null;
 try{
  await page.route('**/api/workspace/structure',async route=>{
   commands.push(route.request().postDataJSON());
   if(lost){lost=false;const response=await route.fetch();expect(response.ok()).toBe(true);committed=(await f.ws.outline()).etag;await route.abort('failed');}
   else await route.continue();
  });
  await page.locator('main [data-action="new-project"]').first().click();
  await dialog.getByLabel('Name',{exact:true}).fill('Retried project');
  await click(dialog,'Save project');await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Name',{exact:true})).toHaveValue('Retried project');
  await click(dialog,'Save project');await expect(dialog).not.toBeVisible();
  expect(commands).toHaveLength(2);expect(commands[1]).toEqual(commands[0]);
  const result=await f.ws.outline();expect(result.etag).toBe(committed);expect(result.metadata.projects.filter(p=>p.title==='Retried project')).toHaveLength(1);
  expect(f.errors).toEqual([]);
 }finally{await f.close();}
});

test('a pending structure operation can be stopped from its form and retried with its choices intact',async({page})=>{
 const f=await fixture(page),dialog=page.locator('#dialog'),execute=StructureCommands.prototype.execute;let waiting=true,aborted=false;
 StructureCommands.prototype.execute=async function(kind,data,options){
  if(waiting&&options?.signal){
   await new Promise(resolve=>{if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',resolve,{once:true});});
   waiting=false;aborted=true;options.signal.throwIfAborted();
  }
  return execute.call(this,kind,data,options);
 };
 try{
  const before=(await f.ws.outline()).etag;
  await page.locator('main [data-action="new-project"]').first().click();await dialog.getByLabel('Name',{exact:true}).fill('Stopped and resumed');
  await click(dialog,'Save project');await click(dialog,'Stop waiting');
  await expect(dialog.getByRole('alert')).toContainText('requested cancellation');
  await expect.poll(()=>aborted).toBe(true);expect((await f.ws.outline()).etag).toBe(before);
  await expect(dialog.getByLabel('Name',{exact:true})).toHaveValue('Stopped and resumed');
  await click(dialog,'Save project');await expect(dialog).not.toBeVisible();
  expect((await f.ws.outline()).metadata.projects.filter(p=>p.title==='Stopped and resumed')).toHaveLength(1);expect(f.errors).toEqual([]);
 }finally{StructureCommands.prototype.execute=execute;await f.close();}
});
