import {projectTemplateFixture} from './project-template-fixture.js';
import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {RecordStarters} from '../../src/record-starters.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';
import {randomUUID} from 'node:crypto';

for(const dedicated of [false,true])test((dedicated?'project: ':'workspace: ')+'author, release, reuse, revise, archive and exchange record templates through the app',async({page})=>{
 test.setTimeout(180000);
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-starter-ui-')),book=upgradeNotebook(sampleNotebook());
 const fixture=dedicated?await projectTemplateFixture(dir,book):await encryptedFixture(dir,book),{workspace:ws,vault,deviceStore}=fixture,app=await testServer({root:fixture.applicationRoot??ws.root,deviceStore,port:0,headless:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const dialog=page.locator('#dialog'),click=label=>dialog.getByRole('button',{name:label,exact:true}).click(),store=new RecordStarters(ws,{});
 try{
  await page.goto(app.url);await page.evaluate(({owner,notebook})=>location.hash='#/'+(owner?'owners/'+owner+'/':'')+'notebooks/'+notebook,{owner:dedicated?book.projects[0].id:null,notebook:book.notebooks[0].id});
  await page.getByRole('button',{name:'New record',exact:true}).click();await click('Record templates');await click('New template');
  await dialog.getByLabel('Template name',{exact:true}).fill('Repeatable lab method');await dialog.getByLabel('Title for new records',{exact:true}).fill('Next instrument trial');
  await dialog.getByRole('textbox',{name:'Starting instructions',exact:true}).fill('Check calibration before beginning.');
  await click('Save draft');await click('Edit draft');await dialog.getByRole('button',{name:'Edit section',exact:true}).nth(2).click();
  await dialog.getByRole('textbox',{name:'Section instructions',exact:true}).fill('Take three readings. Keep exact units.');await click('Save draft');await click('Back to sections');await click('Back to template');
  await click('Release version');await dialog.getByLabel('What changed / review note').fill('Reviewed initial method.');await click('Release version');
  await click('Review instructions');await dialog.getByRole('button',{name:'Read section',exact:true}).nth(2).click();await expect(dialog).toContainText('Take three readings. Keep exact units.');await click('Back to sections');await click('Back to template');await expect(dialog.getByLabel('Released versions')).toHaveValue((await store.list({workspaceId:book.id,cursor:null})).items[0].latest);
  await click('Create record from this version');await expect(page.locator('.record-editing h1')).toHaveText('Next instrument trial');
  const created=(await ws.read()).book.entries.find(e=>e.title==='Next instrument trial');expect(created.share).toBe(false);expect(created.status).toBe('draft');expect(created.attachments).toEqual([]);
  await page.getByRole('button',{name:'Read record',exact:true}).click();await page.getByRole('button',{name:'Record templates',exact:true}).click();await click('Template origin');await click('Starting instructions');await expect(dialog).toContainText('Check calibration before beginning.');await click('Back to sections');await click('Back to template');
  await click('Edit draft');await click('Starting instructions');await dialog.getByRole('textbox',{name:'Starting instructions',exact:true}).fill('Changed calibration requirements.');
  await click('Back to sections');await page.locator('#leave-dialog').getByRole('button',{name:'Stay here'}).click();await expect(dialog.getByRole('textbox',{name:'Starting instructions',exact:true})).toContainText('Changed calibration');
  await click('Save draft');await click('Back to sections');await click('Back to template');await click('Release version');await dialog.getByLabel('What changed / review note').fill('Updated calibration.');await click('Release version');
  await dialog.getByLabel('Released versions').selectOption({index:1});await expect(dialog).toContainText('Check calibration before beginning.');await expect(dialog).not.toContainText('Changed calibration requirements.');
  await click('Export encrypted template');await dialog.getByLabel('Package password (at least 12 characters)',{exact:true}).fill('a good exchange password');await dialog.getByLabel('Repeat password').fill('a good exchange password');const downloadPromise=page.waitForEvent('download');await click('Download template package');const download=await downloadPromise,file=path.join(dir,'method.observanda-template');await download.saveAs(file);
  await click('Archive template');await expect(dialog.getByRole('button',{name:'Create record from this version'})).toHaveCount(0);await click('Restore template');await expect(dialog.getByRole('button',{name:'Create record from this version'})).toBeVisible();
  await click('Back to templates');await click('Import template');await dialog.getByLabel('Encrypted template file').setInputFiles(file);await dialog.getByLabel('Package password (at least 12 characters)',{exact:true}).fill('a good exchange password');await click('Review package');await expect(dialog).toContainText('Check calibration before beginning.');await click('Import as new draft');await expect(dialog.getByLabel('Template name',{exact:true})).toHaveValue('Repeatable lab method');
  const listing=await store.list({workspaceId:book.id,cursor:null});expect(listing.items).toHaveLength(2);expect(listing.items.filter(h=>h.latest===null)).toHaveLength(1);
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:path.join(test.info().outputDir,'template-editor-narrow.png')});
  expect(errors).toEqual([]);
 }finally{await app.close();await fixture.close?.();clearVault(vault);expect(path.dirname(dir)).toBe(path.resolve(os.tmpdir()));expect(path.basename(dir).startsWith('observanda-starter-ui-')).toBe(true);await rm(dir,{recursive:true,force:true});}
});

test('large template pages and late edits survive lost acknowledgements without duplicating sections',async({page},info)=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-large-template-ui-')),book=upgradeNotebook(sampleNotebook()),{workspace:ws,vault,deviceStore}=await encryptedFixture(dir,book),store=new RecordStarters(ws),id=randomUUID();
 const draft={name:'Long reusable method',title:'Next full trial',type:'protocol',body:'Starting instructions',tags:[],sections:Array.from({length:65},(_,i)=>({title:'Instruction '+(i+1),body:'Exact step '+(i+1)+' '+('calibration evidence '.repeat(450))}))};await store.save({workspaceId:book.id,id,expectedRevision:null,draft});
 const app=await testServer({root:ws.root,deviceStore,port:0,headless:true}),dialog=page.locator('#dialog'),click=name=>dialog.getByRole('button',{name,exact:true}).click(),requests=[];page.on('request',r=>{if(r.url().includes('/api/research/starters/'))requests.push(r.url().split('/').at(-1));});
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/notebooks/'+id,book.notebooks[0].id);await page.getByRole('button',{name:'New record',exact:true}).click();await click('Record templates');await click('Open');await click('Edit draft');await expect(dialog.getByRole('button',{name:'Edit section',exact:true})).toHaveCount(20);
  await dialog.getByLabel('Go to section number').fill('65');await click('Go');await expect(dialog).toContainText('Sections 65–65 of 65');await click('Edit section');await expect(dialog.getByRole('textbox',{name:'Section instructions',exact:true})).toContainText('Exact step 65');
  await dialog.getByLabel('Section title',{exact:true}).fill('Reviewed final step');let lost=true;const commands=[];await page.route('**/api/research/starters/change',async route=>{commands.push(route.request().postDataJSON());const response=await route.fetch();if(lost){lost=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Lost template acknowledgement'})});}else await route.fulfill({response});});
  await click('Save draft');await expect(page.locator('#notice')).toContainText('Lost template acknowledgement');await expect(dialog.getByLabel('Section title',{exact:true})).toHaveValue('Reviewed final step');await click('Save draft');await expect(page.locator('#notice')).toContainText('Template draft saved');expect(commands[0].commandId).toBe(commands[1].commandId);
  await click('Back to sections');await click('Add section');await expect(dialog.getByLabel('Section title',{exact:true})).toHaveValue('New section');await dialog.getByLabel('Section title',{exact:true}).fill('Next independent instruction');await click('Save draft');await click('Back to sections');await expect(dialog).toContainText('Sections 66–66 of 66');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);await dialog.getByRole('button',{name:'Edit section',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('large-template-narrow.png')});
  expect(requests.some(op=>['read','release','export','preview','import'].includes(op))).toBe(false);const saved=await store.read({workspaceId:book.id,id});expect(saved.draft.sections).toHaveLength(66);expect(saved.draft.sections[64].title).toBe('Reviewed final step');expect(saved.draft.sections[64].body).toBe(draft.sections[64].body);
 }finally{await app.close();clearVault(vault);await rm(dir,{recursive:true,force:true});}
});

test('capture is selective, structural edits remain guarded and conflicts preserve the draft',async({page})=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'observanda-starter-capture-')),book=upgradeNotebook(sampleNotebook()),record=book.entries[0];
 record.body='Completed result must not become a new instruction';record.sections=[{id:crypto.randomUUID(),title:'Method',body:'Use the exact declared instrument configuration.'},{id:crypto.randomUUID(),title:'Results',body:'Old successful result'}];
 const {workspace:ws,vault,deviceStore}=await encryptedFixture(dir,book),app=await testServer({root:ws.root,deviceStore,port:0,headless:true}),store=new RecordStarters(ws,{}),dialog=page.locator('#dialog'),click=name=>dialog.getByRole('button',{name,exact:true}).click();
 try{
  await page.goto(app.url);await page.evaluate(id=>location.hash='#/records/'+id+'/read',record.id);
  await page.getByRole('button',{name:'Record templates',exact:true}).click();await click('Create from this record');
  await dialog.getByRole('group',{name:'1. Method',exact:true}).getByLabel('Include section heading').check();await dialog.getByRole('group',{name:'2. Results',exact:true}).getByLabel('Include section heading').check();
  await dialog.getByRole('checkbox',{name:'Copy instructions: Method',exact:true}).check();await click('Prepare template draft');
  await click('Starting instructions');await expect(dialog.getByRole('textbox',{name:'Starting instructions',exact:true})).not.toContainText('Completed result');await click('Back to sections');
  await dialog.getByRole('button',{name:'Edit section',exact:true}).nth(1).click();await expect(dialog.getByRole('textbox',{name:'Section instructions',exact:true})).not.toContainText('Old successful result');await click('Back to sections');
  await dialog.getByRole('button',{name:'Edit section',exact:true}).nth(0).click();await expect(dialog.getByRole('textbox',{name:'Section instructions',exact:true})).toContainText('exact declared instrument');await dialog.getByLabel('Section title',{exact:true}).fill('Revised method label');await click('Back to sections');await page.locator('#leave-dialog').getByRole('button',{name:'Stay here',exact:true}).click();
  await click('Save draft');await click('Move down');await expect(dialog.getByRole('button',{name:'Move down',exact:true})).toBeDisabled();await expect(dialog.getByLabel('Section title',{exact:true})).toHaveValue('Revised method label');await dialog.getByLabel('Section title',{exact:true}).fill('Unsaved method label');
  const {items}=await store.list({workspaceId:book.id,cursor:null}),current=await store.read({workspaceId:book.id,id:items[0].id});await store.save({workspaceId:book.id,id:items[0].id,expectedRevision:current.header.revision,draft:{...current.draft,name:'Changed by another window'}});
  await click('Save draft');await expect(page.locator('#notice')).toContainText('changed in another window');await expect(dialog.getByLabel('Section title',{exact:true})).toHaveValue('Unsaved method label');
  await click('Back to sections');await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Changed by another window',exact:true})).toBeVisible();
 }finally{await app.close();clearVault(vault);await rm(dir,{recursive:true,force:true});}
});
