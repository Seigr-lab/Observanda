import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from '../record-figure-values-fixture.js';
import {ResearchDrafts} from '../../src/research-drafts.js';
import {ResearchCatalogue} from '../../src/research-catalogue.js';
import {RecordValues} from '../../src/record-values.js';
import {recordRevision} from '../../src/research.js';
import {testServer} from '../device-fixture.js';
const fresh=(f,i)=>({...structuredClone(f.record),id:randomUUID(),title:'Unfinished legacy run '+i,body:'Evidence from acquisition '+i,sections:[],figures:[],attachments:[],relations:[],results:{version:1,statements:[]},share:false,status:'draft'});
async function open(page){await page.getByRole('button',{name:'Review drafts',exact:true}).click();await page.locator('.record-draft-list').getByRole('button',{name:'Review draft',exact:true}).click();}

test('legacy checkpoints page their records and retain remaining work after a lost recovery acknowledgement',async({page})=>{
 test.setTimeout(180000);const f=await figureValueFixture(),records=Array.from({length:7},(_,i)=>fresh(f,i)),drafts=new ResearchDrafts(f.workspace),id=randomUUID();await drafts.write({id,workspaceId:f.book.id,expectedRevision:null,changes:records.map(record=>({base:null,record,expectedRevision:null}))});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,errors=[],summaries=[];ResearchCatalogue.prototype.record=()=>{throw Error('Legacy recovery loaded a full saved record');};page.on('pageerror',e=>errors.push(e.message));page.on('response',async response=>{if(response.url().endsWith('/api/research/drafts/read'))summaries.push(await response.json());});
 try{
  await page.goto(app.url);await open(page);const picker=page.locator('.record-draft-records');await picker.getByRole('button',{name:'Next records',exact:true}).click();await expect(picker).toContainText(records[6].title);
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await picker.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await picker.locator('.record-draft-row').filter({hasText:records[6].title}).getByRole('button',{name:'Review draft',exact:true}).click();await expect(page.locator('.record-draft-preview')).toContainText(records[6].body);await page.locator('[data-preview-recover]').click();const review=page.locator('.record-draft-review');await expect(review).toContainText('This draft has not been saved as a record.');
  await page.route('**/api/research/drafts/review/apply',async route=>{await route.fetch();await route.abort('failed');},{times:1});await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review.locator('[role=alert]')).not.toBeEmpty({timeout:30000});await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review).toHaveCount(0,{timeout:30000});await expect(page.locator('.record-reader > h1')).toHaveText(records[6].title);
  await open(page);await picker.getByRole('button',{name:'Next records',exact:true}).click();await expect(picker.locator('.record-draft-row').filter({hasText:records[6].title}).getByRole('button',{name:'Recovered',exact:true})).toBeDisabled();await expect(picker.locator('.record-draft-row').filter({hasText:records[5].title}).getByRole('button',{name:'Review draft',exact:true})).toBeEnabled();
  await picker.locator('.record-draft-row').last().scrollIntoViewIfNeeded();await picker.screenshot({path:'.local/legacy-checkpoint-records.png'});expect(await drafts.read(id,{expand:false,header:true})).not.toBe(null);expect(summaries.length).toBeGreaterThan(0);expect(summaries.every(value=>value.draft.changes===undefined&&value.draft.count===7)).toBe(true);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();await f.close();}
});

test('compact legacy checkpoints review conflicts without downloading historical or draft records',async({page})=>{
 test.setTimeout(120000);const f=await figureValueFixture(),base=(await f.workspace.read()).book.entries[0],id=randomUUID(),drafts=new ResearchDrafts(f.workspace);await drafts.write({id,workspaceId:f.book.id,expectedRevision:null,changes:[{baseRevision:recordRevision(base),expectedRevision:recordRevision(base),record:{...base,title:'Recovered compact title'}}]});
 const values=new RecordValues(f.workspace),target={workspaceId:f.book.id,recordId:base.id,field:'title'},current=await values.read(target);await values.save({...target,expectedRevision:current.revision,value:{value:'Concurrent title'}});
 const app=await testServer({root:f.workspace.root,deviceStore:f.deviceStore,port:0,preferencesFile:path.join(f.directory,'preferences.json')}),original=ResearchCatalogue.prototype.record,requests=[],errors=[];ResearchCatalogue.prototype.record=()=>{throw Error('Legacy recovery loaded full history');};page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(new URL(r.url()).pathname));
 try{
  await page.goto(app.url);await open(page);await page.locator('[data-preview-recover]').click();const review=page.locator('.record-draft-review');await expect(review.locator('[role=status]')).toContainText('0 of 1');await review.locator('[data-review=choose-mine]').click();await review.getByRole('button',{name:'Save recovered record',exact:true}).click();await expect(review).toHaveCount(0,{timeout:30000});await expect(page.locator('.record-reader > h1')).toHaveText('Recovered compact title');expect(await drafts.read(id,{header:true})).toBe(null);expect(requests.some(route=>route.includes('/drafts/transfer/read')||route==='/api/workspace/read/selection'||route==='/api/research/records/save')).toBe(false);expect(errors).toEqual([]);
 }finally{ResearchCatalogue.prototype.record=original;await app.close();await f.close();}
});
