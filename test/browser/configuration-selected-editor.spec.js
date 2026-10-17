import {test,expect} from '@playwright/test';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {clearVault} from '../../src/encryption.js';
import {ConfigurationDocuments} from '../../src/configuration-documents.js';
import {ConfigurationCommands} from '../../src/configuration-commands.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {withRecordDocument} from '../../src/record-document.js';
import {templateFrom} from '../../src/web/notebook-schema.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

test('selected configuration pages preserve late edits and create from the saved schema with exact Save retry',async({page})=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-selected-configuration-')),book=upgradeNotebook(sampleNotebook()),notebook=book.notebooks[0];
 const sections=Array.from({length:1100},(_,i)=>({id:randomUUID(),profileId:null,key:'kind-'+i,label:'Observation type '+i,description:'Synthetic type guidance '+('x'.repeat(1960)),enabled:true,fields:[]}));
 const section=sections[24];section.fields=Array.from({length:29},(_,i)=>({key:'field_'+i,label:'Condition '+i,type:'text',unit:'',required:false,choices:[]}));
 section.fields[24]={key:'field_24',label:'Choice condition',type:'select',unit:'',required:false,choices:Array.from({length:73},(_,i)=>'Condition choice '+i)};
 const largeSchema={profiles:[],sections};expect(Buffer.byteLength(JSON.stringify(largeSchema))).toBeGreaterThan(2*1024*1024);
 notebook.configuration={profiles:[],sections:[section]};const prior=book.entries[0];prior.notebookId=notebook.id;prior.template=templateFrom(section);prior.template.values.field_24='Condition choice 68';book.entries=[prior];const originalTemplate=structuredClone(prior.template);
 const fixture=await encryptedFixture(directory,book);
 await fixture.workspace.withLock(()=>fixture.workspace.catalogue(async store=>{
  const head=await store.head(),current=await store.indexed(await store.snapshot(head)),metadata=structuredClone(current.metadata),selected=metadata.notebooks.find(value=>value.id===notebook.id);
  selected.configuration=await new ConfigurationDocuments(store).retainInline({workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'},largeSchema);
  await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[]);
 }));
 const app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,headless:true,preferencesFile:path.join(directory,'preferences.json')});
 const commands=new ConfigurationCommands(fixture.workspace),owner={workspaceId:book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'},requests=[],errors=[],applied=[];
 page.on('pageerror',failure=>errors.push(failure.message));page.on('dialog',dialog=>dialog.accept());page.on('request',request=>{const route=new URL(request.url()).pathname;if(route.startsWith('/api/'))requests.push({route,body:request.method()==='POST'?request.postDataJSON():null});});
 await page.addInitScript(()=>{
  const originalFetch=window.fetch;
  window.fetch=async function(input,options){
   const target=new URL(typeof input==='string'?input:input.url,location.href);
   if(!target.pathname.endsWith('/api/workspace/structure'))return originalFetch.call(this,input,options);
   const started=performance.now(),request=JSON.parse(options.body);
   const pending=originalFetch.call(this,input,options);
   window.configurationSaveResult=pending.then(async response=>({request,status:response.status,events:(await response.clone().text()).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),elapsedMs:performance.now()-started}));
   return pending;
  };
 });
 const dialog=page.locator('#dialog'),editor=dialog.locator('[data-configuration-editor]');
 async function openSettings(){
  await page.evaluate(id=>location.hash='#/projects/'+id,notebook.projectId);await page.locator('.project-notebook').filter({hasText:notebook.title}).getByRole('button',{name:'Lab book settings',exact:true}).click();
  await expect(editor.getByRole('button',{name:'Observation type 0',exact:true})).toBeVisible();
 }
 async function lateChoice(){
  await editor.locator('[data-command=page][data-collection=sections][data-offset="20"]').click();await editor.getByRole('button',{name:section.label,exact:true}).click();
  await editor.locator('[data-command=page][data-collection=fields][data-offset="20"]').click();await editor.getByRole('button',{name:'Choice condition',exact:true}).click();
  await editor.locator('[data-command=page][data-collection=choices][data-offset="20"]').click();await editor.locator('[data-command=page][data-collection=choices][data-offset="40"]').click();await editor.locator('[data-command=page][data-collection=choices][data-offset="60"]').click();await editor.getByRole('button',{name:'Condition choice 68',exact:true}).click();
 }
 async function storedChoice(){const pin=(await commands.open({...owner,saved:true})).configurationPin;return (await commands.window({...owner,configurationPin:pin,collection:'choices',sectionId:section.id,fieldKey:'field_24',offset:68,limit:1})).rows[0].value;}
 try{
  await page.goto(app.url);await expect(page.locator('.brand[data-action=workspace-refresh]')).toBeVisible();await openSettings();await lateChoice();
  await editor.getByLabel('Choice',{exact:true}).fill('Discarded schema choice');await editor.getByRole('button',{name:'Save changes',exact:true}).click();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('#leave-dialog').getByRole('button',{name:'Discard changes',exact:true}).click();await expect(dialog).not.toBeVisible();expect(await storedChoice()).toBe('Condition choice 68');
  await openSettings();await lateChoice();await editor.getByLabel('Choice',{exact:true}).fill('Saved late condition');await editor.getByRole('button',{name:'Save changes',exact:true}).click();
  await editor.getByRole('button',{name:'Observation type 20',exact:true}).click();await editor.getByRole('button',{name:section.label,exact:true}).click();await expect(editor.getByLabel('Record type name',{exact:true})).toHaveValue(section.label);
  await dialog.getByRole('button',{name:'Save lab book',exact:true}).click();await page.waitForFunction(()=>!!window.configurationSaveResult);
  const savedResponse=await page.evaluate(()=>window.configurationSaveResult);console.log('Configuration Save completed in '+Math.round(savedResponse.elapsedMs)+' ms');if(savedResponse.events.some(event=>event.error))console.error('CONFIGURATION_SAVE_FAILURE',JSON.stringify(savedResponse));
  expect(savedResponse.status).toBe(200);expect(savedResponse.events.find(event=>event.error)).toBeUndefined();expect(savedResponse.events.at(-1).result).toBeTruthy();
  await expect(dialog).not.toBeVisible();expect(await storedChoice()).toBe('Saved late condition');
  await fixture.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),prior.id);await withRecordDocument(store,prior.id,row.revision,async document=>expect((await document.field(['template'])).value).toEqual(originalTemplate));});
  await page.evaluate(id=>location.hash='#/notebooks/'+id,notebook.id);await page.getByRole('button',{name:'New record',exact:true}).click();await dialog.getByRole('button',{name:'Next',exact:true}).click();await dialog.getByRole('button',{name:'Create observation type 24',exact:true}).click();
  const initial=page.locator('[data-configuration-record-host]');await expect(initial.locator('[data-record-value]')).toBeVisible();await initial.locator('[data-record-value]').fill('Created from saved selected schema');
  const created=new URL(page.url()).hash.split('/')[2];expect(created).not.toBe(prior.id);
  await initial.getByLabel('Choose what to edit',{exact:true}).selectOption('custom');
  for(let i=0;i<3;i++)await initial.getByRole('button',{name:'Next values',exact:true}).click();
  await initial.getByLabel('Value',{exact:true}).selectOption('template:field_24');await expect(initial.locator('[data-custom-choice-results]')).toContainText('Condition choice 0');
  await initial.locator('[data-custom-choice-page=next]').click();await initial.locator('[data-custom-choice-page=next]').click();await initial.getByRole('button',{name:'Saved late condition',exact:true}).click();
  await expect(initial.locator('[data-custom-choice-selected]')).toHaveValue('Saved late condition');
  let lost=false;await page.route('**/api/research/drafts/review/apply',async route=>{applied.push(route.request().postDataJSON());if(lost)return route.continue();lost=true;await route.fetch();await route.fulfill({status:503,json:{code:'IO',message:'Synthetic lost selected creation acknowledgement'}});});
  await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.locator('#notice')).toContainText('Synthetic lost selected creation acknowledgement');
  await expect(initial.locator('[data-writing-fields]')).toHaveJSProperty('inert',true);
  const count=()=>fixture.workspace.catalogue(async store=>{const snapshot=await store.snapshot();return {count:snapshot.count,row:await store.member(snapshot,created)};});
  expect((await count()).count).toBe(2);expect((await count()).row).not.toBeNull();await page.getByRole('button',{name:'Save record',exact:true}).click();
  await expect(page.locator('.record-editing h1')).toHaveText('Created from saved selected schema');expect(applied).toHaveLength(2);expect(applied[1]).toEqual(applied[0]);expect((await count()).count).toBe(2);
  await page.reload();await expect(page.locator('.record-editing h1')).toHaveText('Created from saved selected schema');
  const navigation=page.locator('[data-record-collection=fields]');await navigation.locator('input').fill('25');await navigation.getByRole('button',{name:'Go',exact:true}).click();await page.locator('[data-record-detail-field]').selectOption('template:field_24');await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();
  const selected=page.locator('dialog.record-writing[open]');await expect(selected.locator('[data-custom-choice-selected]')).toHaveValue('Saved late condition');await selected.locator('[data-custom-choice-page=next]').click();await selected.locator('[data-custom-choice-page=next]').click();await selected.getByRole('button',{name:'Condition choice 69',exact:true}).click();await selected.getByRole('button',{name:'Save changes',exact:true}).click();await expect(selected).not.toBeVisible();
  await fixture.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),created);await withRecordDocument(store,created,row.revision,async document=>{expect((await document.field(['template','values','field_24'])).value).toBe('Condition choice 69');expect((await document.field(['template','fields','24','choices','68'])).value).toBe('Saved late condition');});});
  expect((await new ResearchDrafts(fixture.workspace).list({workspaceId:book.id})).drafts).toEqual([]);
  expect(requests.some(request=>/\/api\/(?:research\/records\/save|workspace\/read\/(?:page|selection))$/.test(request.route))).toBe(false);
  const seeds=requests.filter(request=>request.route.endsWith('/configurations/seed'));expect(seeds).toHaveLength(1);expect(seeds[0].body.record.template).toBeUndefined();expect(Buffer.byteLength(JSON.stringify(seeds[0].body))).toBeLessThan(16384);
  expect(requests.filter(request=>request.route.endsWith('/configurations/window')).every(request=>request.body.limit<=32)).toBe(true);expect(errors).toEqual([]);
 }finally{await page.unrouteAll({behavior:'wait'});await app.close();clearVault(fixture.vault);expect(path.dirname(directory)).toBe(parent);expect(path.basename(directory)).toMatch(/^observanda-selected-configuration-/);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
