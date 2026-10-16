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
