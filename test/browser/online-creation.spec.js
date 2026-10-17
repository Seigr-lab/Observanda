import {test,expect} from '@playwright/test';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ConfigurationCommands} from '../../src/configuration-commands.js';
import {withRecordDocument} from '../../src/record-document.js';
import {liveCreationFixture} from '../fixtures/live-creation.js';
import {startLiveHost} from '../../src/collaboration/live-host.js';
import {startServer} from '../../src/server.js';
import {navigate,preferences} from './preferences-helper.js';

test('create a shared record with host fields, write together, and resume a lost creation response after reloading',async({browser})=>{
 test.setTimeout(180000);const cleanup=[],errors=[],requests=[],f=await liveCreationFixture({after:fn=>cleanup.push(fn)});
 const notebook=f.book.notebooks[0],configuration=new ConfigurationCommands(f.author.workspace),owner={workspaceId:f.book.id,projectId:notebook.projectId,notebookId:notebook.id,slot:'configuration'};
 async function write(operation){let result;await expect.poll(async()=>{try{result=await operation();return true;}catch(error){if(error.code!=='LOCKED')throw error;return false;}}).toBe(true);return result;}
 async function changeConfiguration(operations){
  let selected=await configuration.open(owner);
  for(let at=0;at<operations.length;at+=32){const command={...owner,configurationPin:selected.configurationPin,draftId:selected.draft?.id??null,expectedRevision:selected.draft?.revision??null,commandId:randomUUID(),operations:operations.slice(at,at+32)};selected=await write(()=>configuration.change(command));}
  const save={...owner,configurationPin:selected.configurationPin,draftId:selected.draft.id,expectedRevision:selected.draft.revision,commandId:randomUUID()};await write(()=>configuration.save(save));
 }
 const extraFields=Array.from({length:16},(_,i)=>({type:'append',collection:'fields',sectionId:f.templateId,value:{key:'late_'+i,label:'Extension '+i,type:'text',unit:'',required:false,choices:[]}}));
 const extraChoices=Array.from({length:21},(_,i)=>({type:'append',collection:'choices',sectionId:f.templateId,fieldKey:'control',value:'Control '+i}));
 await changeConfiguration([...extraFields,...extraChoices]);
 const recordsByTitle=title=>f.author.workspace.catalogue(async store=>{const records=[];for await(const row of store.members(await store.snapshot()))await withRecordDocument(store,row.id,row.revision,async document=>{if((await document.field(['title'])).value===title)records.push(await store.record(row.id,row.revision));});return records;});
 const host=await startLiveHost(f.author.workspace,f.author.deviceStore,{host:'127.0.0.1',advertise:'https://127.0.0.1',port:0}),app=await startServer({root:f.member.workspace.root,port:0,headless:true,deviceStore:f.member.deviceStore,preferencesFile:path.join(f.directory,'creation.prefs')}),context=await browser.newContext(),page=await context.newPage();
 try{
  page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));page.on('request',request=>{if(new URL(request.url()).pathname==='/api/live/request')requests.push(request.postDataJSON());});await page.goto(app.url);
  await navigate(page,'Preferences');await preferences(page,'Modules');await page.getByRole('switch',{name:'Enable Organizations & teams',exact:true}).check();await navigate(page,'Organizations & teams');
  await page.getByRole('button',{name:'Connect to an installation',exact:true}).click();const dialog=page.locator('#dialog');
  await dialog.getByLabel('Connection card',{exact:true}).setInputFiles({name:'shared.observanda-online',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(await host.card(f.grant.id)))});
  await expect(dialog.locator('[data-online-fingerprint]')).toContainText('Owner’s identity');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:'Connect to an installation',exact:true}).click();await expect(dialog).not.toBeVisible();
  async function createRecord(){
   const started=performance.now(),completed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/live/create-record'&&response.request().method()==='POST');
   await dialog.getByRole('button',{name:'Create record',exact:true}).click();const response=await completed,result=await response.json();console.log('Shared record Create completed in '+Math.round(performance.now()-started)+' ms');
   expect(response.ok(),JSON.stringify(result)).toBe(true);expect(result.rejected).toBeUndefined();expect(result.result?.record?.id).toBeTruthy();await expect(dialog).not.toBeVisible();
  }
  await page.getByRole('button',{name:'Open shared books',exact:true}).click();await page.getByRole('button',{name:'New shared record',exact:true}).click();
  await expect(dialog.getByLabel('Record type',{exact:true})).toHaveValue('template:'+f.templateId);await expect(dialog.getByLabel('Lab book',{exact:true}).locator('option')).toHaveCount(1);
  await dialog.getByLabel('Record title',{exact:true}).fill('Next shared acquisition');await dialog.getByLabel('Exact counter (ticks)',{exact:true}).fill('9007199254740993.123456789');await dialog.getByLabel('Accepted',{exact:true}).selectOption('false');await dialog.getByLabel('Conditions',{exact:true}).fill('Dark chamber');
  await dialog.locator('[data-command=online-creation-fields-next]').click();await dialog.getByLabel('Extension 15',{exact:true}).fill('Late shared observation');await dialog.locator('[data-command=online-creation-fields-previous]').click();
  await expect(dialog.getByLabel('Exact counter (ticks)',{exact:true})).toHaveValue('9007199254740993.123456789');await expect(dialog.getByLabel('Accepted',{exact:true})).toHaveValue('false');
  await dialog.locator('[data-command=online-creation-choose][data-key=control]').click();await dialog.locator('[data-command=online-creation-choices-next]').click();await dialog.getByRole('button',{name:'Control 20',exact:true}).click();await expect(dialog.locator('[data-creation-field=control]')).toHaveValue('Control 20');
  await page.setViewportSize({width:390,height:844});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('shared-record-creation-phone.png')});
  await createRecord();await expect(page.locator('[data-live-details]').getByLabel('Record title',{exact:true})).toHaveValue('Next shared acquisition');
  const editor=page.locator('.online-research [contenteditable="true"]');await expect(editor).toBeVisible();await editor.fill('A new observation from the collaborator.');
  await expect.poll(async()=>JSON.stringify((await recordsByTitle('Next shared acquisition'))[0]?.body)).toContain('A new observation from the collaborator.');
  let record=(await recordsByTitle('Next shared acquisition'))[0];expect(record.template.values.late_15).toBe('Late shared observation');expect(record.template.values.control).toBe('Control 20');expect(record.template.values.counter).toBe('9007199254740993.123456789');expect(record.template.values.accepted).toBe(false);expect(record.share).toBe(false);
  await page.getByRole('button',{name:'New shared record',exact:true}).click();await expect(dialog).toBeVisible();await dialog.getByLabel('Record type',{exact:true}).selectOption('type:experiment');await dialog.getByLabel('Record title',{exact:true}).fill('Retry-safe experiment');
  let lost=false;
  await page.route('**/api/live/create-record',async route=>{if(!lost){lost=true;await route.fetch();await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'IO',message:'Synthetic lost creation response'})});return;}await route.continue();});
  await dialog.getByRole('button',{name:'Create record',exact:true}).click();await expect(dialog.getByRole('button',{name:'Retry pending request',exact:true})).toBeVisible();await expect(dialog).toContainText('Retry-safe experiment');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.reload();await navigate(page,'Organizations & teams');await page.getByRole('button',{name:'Open shared books',exact:true}).click();
  await page.getByRole('button',{name:'Resume record creation',exact:true}).click();await dialog.getByRole('button',{name:'Open created record',exact:true}).click();await expect(dialog).not.toBeVisible();
  await expect(page.locator('[data-live-details]').getByLabel('Record title',{exact:true})).toHaveValue('Retry-safe experiment');
  const records=await recordsByTitle('Retry-safe experiment');expect(records).toHaveLength(1);expect(records[0].sections.length).toBeGreaterThan(3);
  await page.getByRole('button',{name:'New shared record',exact:true}).click();await dialog.getByLabel('Record title',{exact:true}).fill('After template review');await dialog.getByLabel('Exact counter (ticks)',{exact:true}).fill('12345678901234567890');await dialog.getByLabel('Accepted',{exact:true}).selectOption('true');
  await changeConfiguration([{type:'replace',collection:'sections',key:f.templateId,value:{description:'Reviewed host procedure'}}]);
  await dialog.getByRole('button',{name:'Create record',exact:true}).click();await dialog.getByRole('button',{name:'Review creation details',exact:true}).click();
  await expect(dialog).toContainText('Reviewed host procedure');await expect(dialog.getByLabel('Record title',{exact:true})).toHaveValue('After template review');await expect(dialog.getByLabel('Exact counter (ticks)',{exact:true})).toHaveValue('12345678901234567890');
  await createRecord();await expect(page.locator('[data-live-details]').getByLabel('Record title',{exact:true})).toHaveValue('After template review');
  const {generation,...grant}=f.grant;void generation;const identity=await f.a.identity.public();await write(()=>f.sa.access.saveLocal(identity,{...grant,workspaceId:f.book.id,expectedRevision:1,role:'reader'}));
  await page.getByRole('button',{name:'Close shared books',exact:true}).click();await page.getByRole('button',{name:'Open shared books',exact:true}).click();await expect(page.getByRole('button',{name:'New shared record',exact:true})).toHaveCount(0);expect(requests.some(request=>request.operation==='creationFields'&&request.data.offset===20)).toBe(true);expect(requests.some(request=>request.operation==='creationChoices'&&request.data.offset===20)).toBe(true);expect(requests.filter(request=>['creationFields','creationChoices'].includes(request.operation)).every(request=>request.data.limit===20&&request.data.source.configurationPin)).toBe(true);expect(errors).toEqual([]);
 }finally{await context.close();await app.close();await host.close();for(const fn of cleanup.reverse())await fn();}
});
