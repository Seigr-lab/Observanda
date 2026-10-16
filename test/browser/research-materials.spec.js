import os from 'node:os';
import {encryptedFixture} from './encrypted-fixture.js';
import {clearVault} from '../../src/encryption.js';
import {test,expect} from '@playwright/test';
import {completeRunCreation} from './run-creation-controls.js';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {startServer} from '../../src/server.js';
import {ResearchMaterials} from '../../src/research-materials.js';

test('creative run: pin method, retain source, declare columns, calculate, revise and inspect on narrow screens',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-research-workflow-')),root=path.join(directory,'workspace'),book=upgradeNotebook(sampleNotebook());
 const method=book.entries[1],run=book.entries[2];method.type='protocol';method.title='Listening method';method.body='Listen with the curtains closed.'+'\n\n'+Array.from({length:90},(_,i)=>'Context '+i+': Keep listening conditions and creative intentions separate from what was heard.').join('\n\n');
 run.type='run';run.title='Curtains closed — take 1';run.status='incomplete';run.sections=[];run.figures=[];
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(directory,book);const app=await startServer({root,port:0,deviceStore,preferencesFile:path.join(directory,'preferences.json')}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));const dialog=page.locator('#dialog'),requests=[];page.on('request',r=>requests.push(new URL(r.url()).pathname));
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,run.id);
  await page.getByRole('button',{name:'Link research',exact:true}).click();
  await dialog.getByLabel('Reference version').selectOption('exact');
  await dialog.getByRole('button',{name:/Listening method/}).click();
  await page.locator('.section-save [data-action="save"]').click();await expect(page.locator('#save-status')).toHaveText('Saved');
  const pinned=(await ws.read()).book.entries.find(e=>e.id===run.id).relations[0].target;expect(pinned.revision).toMatch(/^[a-f0-9]{64}$/);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await dialog.getByRole('button',{name:'Import original file',exact:true}).click();
  await dialog.getByLabel('Original file',{exact:true}).setInputFiles({name:'creative-takes.csv',mimeType:'text/csv',buffer:Buffer.from('Take,Level,Counter,Senary\nOne,0.2,18446744073709551615,15\nTwo,0.3,18446744073709551615,20\nThree,,18446744073709551615,21')});
  await dialog.getByLabel('Provenance / acquisition notes').fill('Private listening notes.');
  await dialog.getByRole('button',{name:'Import original',exact:true}).click();
  // Verification is a durable background job, not part of the upload response.
  await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible({timeout:15000});
  await expect(dialog.locator('.material-list strong').filter({hasText:'creative-takes.csv'})).toBeVisible();
  await dialog.locator('.material-list li').filter({hasText:'creative-takes.csv'}).getByRole('button',{name:'Inspect',exact:true}).click();
  const downloadEvent=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download original'}).click();const download=await downloadEvent;
  expect(download.suggestedFilename()).toBe('creative-takes.csv');
  expect(await readFile(await download.path(),'utf8')).toContain('18446744073709551615,15');
  const storeForDownload=new ResearchMaterials(ws),asset=(await storeForDownload.heads()).find(m=>m.kind==='artifact');
  const originalURL=new URL('/api/research/materials/original/'+asset.id+'/'+asset.revision+'?context=wrong',app.url).href;
  const wrongContext=await page.request.get(originalURL);expect((await wrongContext.json()).code).toBe('WORKSPACE_CHANGED');
  const anonymous=await fetch(originalURL);expect(anonymous.ok).toBe(false);
  await dialog.getByRole('button',{name:'Back to evidence'}).click();
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();
  await dialog.getByLabel('Title',{exact:true}).fill('Listening measurements');
  await dialog.getByRole('button',{name:'Create dataset',exact:true}).click();
  await expect(dialog.getByRole('region',{name:'Dataset values'})).toContainText('18446744073709551615');
  await dialog.getByRole('button',{name:'Edit schema & exclusions'}).click();
  await dialog.locator('[data-material-column="0"]').getByLabel('Unit',{exact:true}).fill('discard this');
  await dialog.getByRole('button',{name:'Back to evidence'}).click();await expect(page.locator('#leave-dialog')).toBeVisible();
  await page.locator('#leave-dialog').getByRole('button',{name:'Stay here',exact:true}).click();
  await dialog.locator('[data-material-column="0"]').getByLabel('Unit',{exact:true}).fill('');
  await dialog.locator('.material-schema-column > summary').filter({hasText:"Level"}).click();
  await dialog.locator('[data-material-column="1"]').getByLabel('Representation',{exact:true}).selectOption('decimal');
  await dialog.locator('.material-schema-column > summary').filter({hasText:"Counter"}).click();
  await dialog.locator('[data-material-column="2"]').getByLabel('Representation',{exact:true}).selectOption('integer');
  await dialog.locator('.material-schema-column > summary').filter({hasText:"Senary"}).click();
  await dialog.locator('[data-material-column="3"]').getByLabel('Representation',{exact:true}).selectOption('radix');
  await dialog.locator('[data-material-column="3"]').getByLabel('Base (for explicit base)').fill('6');
  await dialog.getByRole('button',{name:'Save dataset revision'}).click();
  await dialog.getByRole('button',{name:'Create reproducible figure'}).click();
  await dialog.getByLabel('Level · decimal',{exact:true}).check();
  await dialog.getByRole('button',{name:'Calculate & retain figure'}).click();
  await expect(dialog.locator('svg')).toBeVisible();
  await dialog.getByRole('button',{name:'Add retained figure to record'}).click();
  await page.locator('.section-save [data-action="save"]').click();await expect(page.locator('#save-status')).toHaveText('Saved');

  // A revised dataset flags the retained result; ordinary record saves do not recompute it.
  const store=new ResearchMaterials(ws),dataset=(await store.heads()).find(h=>h.kind==='dataset'),doc=await store.read(dataset);
  const columns=await store.datasetColumns(doc);columns[1].unit='relative amplitude';
  await store.dataset({id:doc.id,expectedRevision:dataset.revision,recordId:run.id,title:doc.title,artifact:doc.content.inputs[0],columns});
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await expect(dialog.getByText(/Newer or unavailable inputs/).first()).toBeVisible();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();

  // Updating the method leaves the old reading available through the pinned link.
  const changed=await ws.read();changed.book.entries.find(e=>e.id===method.id).body='Now use a different room.';await ws.save(changed.book,changed.etag);
  await page.getByRole('button',{name:'Listening method',exact:true}).click();
  await expect(dialog).toContainText('Listen with the curtains closed.');
  await expect(dialog).not.toContainText('Now use a different room.');
  await expect(dialog).toContainText('Context 89');
  await dialog.getByRole('button',{name:'Compare with saved record'}).click();
  await expect(dialog).toContainText('Now use a different room.');
  await expect(dialog).toContainText('Listen with the curtains closed.');
  await page.setViewportSize({width:390,height:844});
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBeTruthy();
  await dialog.getByRole('button',{name:'Close',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();
  await expect(dialog).toBeVisible();await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await page.setViewportSize({width:720,height:900});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>document.documentElement.style.fontSize='');await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Create another run or take'}).click();
  await completeRunCreation(page,null,{edit:false});
  const after=(await ws.read()).book,next=after.entries.find(e=>e.title==='Curtains closed — take 1 — next run');
  expect(next.status).toBe('planned');expect(next.share).toBe(false);expect(next.figures).toEqual([]);
  expect(next.relations.some(r=>r.target.id===method.id&&r.target.revision===pinned.revision)).toBe(true);
  expect(after.entries.find(e=>e.id===method.id).body).toBe('Now use a different room.');
  expect(requests.filter(p=>p==='/api/notebook'||p==='/api/workspace/read/page')).toEqual([]);expect(errors).toEqual([]);
 }finally{await app.close();clearVault(vault);await rm(directory,{recursive:true,force:true});}
});

test('verification can be reopened after reload, cancelled and retried without selecting the original again',async({page})=>{
 test.setTimeout(90000);page.setDefaultTimeout(10000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-worker-ui-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 const {workspace,vault,deviceStore}=await encryptedFixture(directory,book),app=await startServer({root:workspace.root,port:0,deviceStore,preferencesFile:path.join(directory,'preferences.json')});
 const prepare=ResearchMaterials.prototype.prepareImport;let hold=true;
 ResearchMaterials.prototype.prepareImport=async function(id,options){
  if(hold)await new Promise((resolve,reject)=>{if(options.signal.aborted)return reject(options.signal.reason);options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
  return prepare.call(this,id,options);
 };
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const dialog=page.locator('#dialog');
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id,record.id);
  await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.getByRole('button',{name:'Import original file',exact:true}).click();
  const bytes=Buffer.from('Take,Sound\nOne,quiet\n');await dialog.getByLabel('Original file',{exact:true}).setInputFiles({name:'retained-take.csv',mimeType:'text/csv',buffer:bytes});
  await dialog.getByRole('button',{name:'Import original',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Verify original file'})).toBeVisible();
  await expect(dialog.getByRole('progressbar',{name:'Verification progress'})).toBeVisible();
  await dialog.getByRole('button',{name:'Back to evidence'}).click();await expect(dialog.getByRole('button',{name:'Check verification'})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Open evidence & analysis'}).click();await dialog.getByRole('button',{name:'Check verification'}).click();
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBeTruthy();
  await dialog.getByRole('button',{name:'Cancel verification'}).focus();await page.keyboard.press('Enter');await expect(dialog.getByText('Verification cancelled.',{exact:false})).toBeVisible();
  const store=new ResearchMaterials(workspace);expect((await store.verify()).receivedBytes).toBe(bytes.length);expect((await store.heads()).length).toBe(0);
  hold=false;await dialog.getByRole('button',{name:'Retry verification'}).click();
  // The durable worker completes independently of browser clicks and may be
  // competing with other database/filesystem work in the qualification suite.
  await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible({timeout:15000});
  const fileSummary=dialog.locator('.material-file-summary');await expect(fileSummary).toContainText('retained-take.csv');await expect(fileSummary).toContainText(bytes.length+' bytes');await expect(fileSummary).toContainText(createHash('sha256').update(bytes).digest('hex'));
  const listedDownload=page.waitForEvent('download');await dialog.getByRole('link',{name:'Download retained-take.csv',exact:true}).click();expect(await readFile(await (await listedDownload).path())).toEqual(bytes);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await dialog.locator('.material-list li').filter({hasText:'retained-take.csv'}).getByRole('button',{name:'Inspect',exact:true}).click();
  const event=page.waitForEvent('download');await dialog.getByRole('button',{name:'Download original'}).click();const download=await event;expect(await readFile(await download.path())).toEqual(bytes);
  expect((await store.heads()).length).toBe(1);expect(errors).toEqual([]);
 }finally{await app.close();ResearchMaterials.prototype.prepareImport=prepare;clearVault(vault);await rm(directory,{recursive:true,force:true});}
});
