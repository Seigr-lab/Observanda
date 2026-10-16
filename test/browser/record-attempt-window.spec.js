import {test,expect} from '@playwright/test';
import path from 'node:path';
import {attemptWindowFixture} from '../record-attempt-window-fixture.js';
import {testServer} from '../device-fixture.js';
import {RecordDocument} from '../../src/record-document.js';
import {RecordValues} from '../../src/record-values.js';
import {ResearchMaterials} from '../../src/research-materials.js';
import {recordRevision} from '../../src/research.js';

test('reader and historical views navigate run facts independently with correction and preparation context',async({page},info)=>{
 test.setTimeout(180000);page.setDefaultTimeout(15000);const f=await attemptWindowFixture(),target={workspaceId:f.book.id,recordId:f.record.id},values=new RecordValues(f.workspace),original=RecordDocument.prototype.field;
 const pinned=await new ResearchMaterials(f.workspace).pinRecord(f.record.id,recordRevision(f.record)),title=await values.read({...target,field:'title'});await values.save({...target,field:'title',expectedRevision:title.revision,value:{value:'Current interpretation'}});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 RecordDocument.prototype.field=function(path,...args){if(path.join()==='attempt')throw Error('Reading assembled all run facts');return original.call(this,path,...args);};
 try{
  await page.goto(app.url);await page.goto(app.origin+'/#/records/'+f.record.id+'/read');const events=page.locator('[data-attempt-group="events"]'),assessments=page.locator('[data-attempt-group="assessments"]');
  await expect(events).toContainText('1–4 of 15');await expect(events).toContainText('Preparation revision 9');await expect(assessments).toContainText('Preparation revision 7');
  await expect(events.locator('.attempt-event').filter({hasText:'Acquisition 0'}).getByRole('button',{name:'Add correction',exact:true})).toHaveCount(0);
  let failed=false;await page.route('**/api/workspace/read/record-content',async route=>{if(!failed&&route.request().postDataJSON().windows?.events===4){failed=true;await route.abort('failed');return;}await route.continue();});
  await events.getByRole('button',{name:'Next items',exact:true}).click();await expect(events).toContainText('Acquisition 0');await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(events).toContainText('5–8 of 15');await expect(assessments).toContainText('1–4 of 15');
  await events.getByRole('spinbutton',{name:'Go to item',exact:true}).fill('12');await events.getByRole('button',{name:'Go',exact:true}).click();await expect(events).toContainText('Corrected acquisition zero');await expect(events).not.toContainText('Acquisition 0 —');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await events.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);await events.evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:info.outputPath('run-history-navigation-mobile.png')});
  await page.getByRole('button',{name:'History',exact:true}).click();const dialog=page.locator('#dialog');await dialog.getByRole('button',{name:'Review version',exact:true}).click();
  await dialog.getByRole('combobox',{name:'Browse content',exact:true}).selectOption('assessments');await dialog.getByRole('spinbutton',{name:'Go to item',exact:true}).fill('12');await dialog.getByRole('button',{name:'Go',exact:true}).click();await expect(dialog).toContainText('Corrected assessment zero');await expect(dialog).toContainText('Preparation revision 7');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  // Open the evidence owner, then follow its retained-reference action.
  await page.getByRole('button',{name:'Open evidence & analysis',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Evidence & analysis',exact:true})).toBeVisible();
  await page.evaluate(ref=>{const button=document.createElement('button');button.dataset.action='material-reference';button.dataset.ref=JSON.stringify(ref);button.textContent='Inspect retained source';document.querySelector('#dialog').append(button);},pinned);
  await page.getByRole('button',{name:'Inspect retained source',exact:true}).click();await expect(dialog.locator('.retained-record-reader')).toBeVisible();await dialog.getByRole('combobox',{name:'Navigate',exact:true}).selectOption('events');await dialog.getByRole('spinbutton',{name:'Go to item',exact:true}).fill('12');await dialog.getByRole('button',{name:'Go',exact:true}).click();await expect(dialog).toContainText('Corrected acquisition zero');expect(errors).toEqual([]);
 }finally{RecordDocument.prototype.field=original;await app.close();await f.close();}
});
