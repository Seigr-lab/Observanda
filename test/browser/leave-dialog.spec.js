import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

for(const choice of ['save','discard'])for(const exit of ['stay','escape'])test(`${choice} can wait without trapping the leave dialog; ${exit} prevents late navigation`,async({page})=>{
 const source=await readFile(new URL('../../src/web/unsaved-changes.js',import.meta.url),'utf8');
 await page.route('http://dialog.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'text/javascript':'text/html',body:route.request().url().endsWith('.js')?source:'<main><h1>Current page</h1></main>'}));
 await page.goto('http://dialog.test/');
 await page.evaluate(async()=>{
  const {unsavedChanges}=await import('/unsaved-changes.js');
  window.navigations=[];window.messages=[];window.writes=0;
  const operation=()=>{window.writes++;return new Promise(resolve=>{window.finishWrite=resolve;});};
  window.guard=unsavedChanges({esc:value=>value,changes:()=>({labels:['Actual edits'],canSave:true,forms:[]}),save:operation,discard:operation,busy:()=>false,notify:message=>window.messages.push(message)});
  window.first=guard.run(()=>window.navigations.push('first'));
 });
 const dialog=page.locator('#leave-dialog');await dialog.locator(`[data-choice="${choice}"]`).click();
 await expect(dialog.locator('[data-choice="stay"]')).toBeEnabled();await expect(dialog.locator('[data-choice="save"]')).toBeDisabled();
 if(exit==='escape')await page.keyboard.press('Escape');else await dialog.locator('[data-choice="stay"]').click();
 await expect(dialog).not.toBeVisible();expect(await page.evaluate(()=>window.first)).toBe(false);
 await page.evaluate(()=>{window.second=guard.run(()=>window.navigations.push('second'));});
 await expect(dialog).toBeVisible();await expect(dialog.locator('[data-choice="discard"]')).toBeDisabled();
 await page.evaluate(()=>finishWrite());await expect(dialog.locator('[data-choice="save"]')).toBeEnabled();
 await expect(dialog).toBeVisible();expect(await page.evaluate(()=>({navigations,writes}))).toEqual({navigations:[],writes:1});
 await dialog.locator('[data-choice="stay"]').click();await expect(dialog).not.toBeVisible();expect(await page.evaluate(()=>messages)).toEqual([]);
});

test('clean history navigation needs no decision while real edits and busy forms remain guarded',async({page})=>{
 const source=await readFile(new URL('../../src/web/unsaved-changes.js',import.meta.url),'utf8');
 await page.route('http://dialog.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'text/javascript':'text/html',body:route.request().url().endsWith('.js')?source:'<main>Ready</main>'}));await page.goto('http://dialog.test/');
 const result=await page.evaluate(async()=>{const {unsavedChanges}=await import('/unsaved-changes.js');let labels=[],busy=false;const guard=unsavedChanges({esc:v=>v,changes:()=>({labels}),busy:()=>busy,notify:()=>{}}),values=[guard.canLeaveImmediately()];labels=['Edit'];values.push(guard.canLeaveImmediately());labels=[];busy=true;values.push(guard.canLeaveImmediately());busy=false;values.push(guard.canLeaveImmediately());return values;});expect(result).toEqual([true,false,false,true]);await expect(page.locator('#leave-dialog')).not.toBeVisible();
});

async function prepareFixture(page){
 const source=await readFile(new URL('../../src/web/unsaved-changes.js',import.meta.url),'utf8');
 await page.route('http://dialog.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'text/javascript':'text/html',body:route.request().url().endsWith('.js')?source:'<main>Current draft</main>'}));
 await page.goto('http://dialog.test/');
 await page.evaluate(async()=>{
  const {unsavedChanges}=await import('/unsaved-changes.js');
  window.dirty=false;window.busy=false;window.navigations=[];window.messages=[];window.preparations=[];window.writes=0;
  window.guard=unsavedChanges({esc:v=>v,defaultScope:'navigation',prepare:scope=>new Promise((resolve,reject)=>preparations.push({scope,resolve,reject})),changes:()=>({labels:dirty?['Draft']:[],forms:[],canSave:true}),save:()=>{writes++;},discard:()=>{writes++;},busy:()=>busy,notify:message=>messages.push(message)});
 });
}

test('navigation prepares an already durable draft without applying it or opening a decision',async({page})=>{
 await prepareFixture(page);
 await page.evaluate(()=>{window.pending=guard.run(()=>navigations.push('next'));});
 expect(await page.evaluate(()=>({scopes:preparations.map(v=>v.scope),immediate:guard.canLeaveImmediately(),navigations}))).toEqual({scopes:['navigation'],immediate:false,navigations:[]});
 await expect(page.locator('#leave-dialog')).not.toBeVisible();
 await page.evaluate(()=>{dirty=false;preparations[0].resolve();});
 expect(await page.evaluate(()=>pending)).toBe(true);
 expect(await page.evaluate(()=>({navigations,writes,messages}))).toEqual({navigations:['next'],writes:0,messages:[]});
 await expect(page.locator('#leave-dialog')).not.toBeVisible();
});

test('failed checkpoint keeps the current draft and reports its actual error',async({page})=>{
 await prepareFixture(page);
 await page.evaluate(()=>{window.pending=guard.run(()=>navigations.push('next')).catch(error=>({error:error.message}));dirty=true;preparations[0].reject(Error('Checkpoint unavailable'));});
 expect(await page.evaluate(()=>pending)).toEqual({error:'Checkpoint unavailable'});
 expect(await page.evaluate(()=>({navigations,writes,dirty,immediate:guard.canLeaveImmediately()}))).toEqual({navigations:[],writes:0,dirty:true,immediate:false});
 await expect(page.locator('#leave-dialog')).not.toBeVisible();
});

for(const obsoleteReply of ['success','failure'])test(`newer navigation supersedes a pending checkpoint ${obsoleteReply}`,async({page})=>{
 await prepareFixture(page);
 await page.evaluate(()=>{window.first=guard.run(()=>navigations.push('old'));window.second=guard.run(()=>navigations.push('new'));dirty=false;preparations[1].resolve();});
 expect(await page.evaluate(()=>second)).toBe(true);
 await page.evaluate(reply=>{if(reply==='success')preparations[0].resolve();else preparations[0].reject(Error('Obsolete failure'));},obsoleteReply);
 expect(await page.evaluate(()=>first)).toBe(false);
 expect(await page.evaluate(()=>({navigations,writes,messages}))).toEqual({navigations:['new'],writes:0,messages:[]});
});

test('preparation cannot bypass a newly busy operation or an unapplied action',async({page})=>{
 await prepareFixture(page);
 await page.evaluate(()=>{window.first=guard.run(()=>navigations.push('next'));busy=true;preparations[0].resolve();});
 expect(await page.evaluate(()=>first)).toBe(false);expect(await page.evaluate(()=>navigations)).toEqual([]);
 await page.evaluate(()=>{busy=false;window.second=guard.run(()=>navigations.push('next'),{scope:'all'});dirty=true;preparations[1].resolve();});
 const dialog=page.locator('#leave-dialog');await expect(dialog).toBeVisible();
 expect(await page.evaluate(()=>preparations[1].scope)).toBe('all');
 await dialog.locator('[data-choice="stay"]').click();expect(await page.evaluate(()=>second)).toBe(false);
 expect(await page.evaluate(()=>({navigations,writes}))).toEqual({navigations:[],writes:0});
});
