import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function fixture(page){
 await page.route('http://access.test/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/')return route.fulfill({contentType:'text/html',body:'<dialog id="dialog"><form><label>Analysis title<input value="Retained comparison"></label><label>Column mapping<select><option>Value</option><option selected>State</option></select></label><button type="button" id="choose">Choose source</button></form></dialog>'});
  return route.fulfill({contentType:path.endsWith('.json')?'application/json':'text/javascript',body:await readFile(new URL('../../src/web'+path,import.meta.url),'utf8')});
 });
 await page.goto('http://access.test/');await page.evaluate(async()=>{
  const {projectAccessUI}=await import('/project-access-ui.js');window.state={storage:{contextId:'comparison'}};window.calls=[];window.mode='failure';window.response=null;window.source=document.querySelector('#dialog');source.showModal();window.form=source.querySelector('form');source.querySelector('#choose').focus();
  window.access=projectAccessUI({state,esc:value=>value,field:(label,control)=>'<label>'+label+control+'</label>',showDialog:html=>{source.innerHTML=html;if(!source.open)source.showModal();},api:async(route,data,options)=>{calls.push({route,data});if(mode==='held')await new Promise(resolve=>response=resolve);if(mode==='failure')throw {code:'ACCESS_DENIED',message:'Incorrect fixture password'};return {};}});
  window.open=()=>{window.result=null;void access.open('project','book','Selected book').then(()=>result='opened',error=>result=error.name??error.code);};
 });
}

test('selected owner access preserves the mounted comparison form through cancellation, rejected credentials and successful retry',async({page})=>{
 await fixture(page);await page.evaluate(()=>open());const unlock=page.locator('[data-project-access]');await expect(unlock).toBeVisible();await expect(page.locator('#dialog')).toBeVisible();
 await unlock.locator('[data-project-unlock-cancel]').click();await expect(unlock).toHaveCount(0);expect(await page.evaluate(()=>result)).toBe('AbortError');expect(await page.evaluate(()=>source.querySelector('form')===form)).toBe(true);await expect(page.getByRole('button',{name:'Choose source'})).toBeFocused();
 await page.evaluate(()=>open());await unlock.locator('[name=password]').fill('incorrect');await unlock.locator('[type=submit]').click();await expect(unlock.getByRole('alert')).toHaveText('Incorrect fixture password');await expect(unlock.locator('[name=password]')).toHaveValue('');
 await page.evaluate(()=>mode='success');await unlock.locator('[name=password]').fill('correct');await unlock.locator('[type=submit]').click();await expect(unlock).toHaveCount(0);expect(await page.evaluate(()=>result)).toBe('opened');expect(await page.evaluate(()=>source.querySelector('form')===form)).toBe(true);
 await expect(page.getByLabel('Analysis title')).toHaveValue('Retained comparison');await expect(page.getByLabel('Column mapping')).toHaveValue('State');expect(await page.evaluate(()=>calls.length)).toBe(2);
});

test('late selected-owner authorization cannot complete after its comparison context changed',async({page})=>{
 await fixture(page);await page.evaluate(()=>{mode='held';open();});const unlock=page.locator('[data-project-access]');await unlock.locator('[name=password]').fill('correct');await unlock.locator('[type=submit]').click();await expect.poll(()=>page.evaluate(()=>typeof response)).toBe('function');
 await page.evaluate(()=>{state.storage.contextId='new-owner';response();});await expect(unlock).toHaveCount(0);expect(await page.evaluate(()=>result)).toBe('AbortError');expect(await page.evaluate(()=>source.querySelector('form')===form)).toBe(true);await expect(page.getByLabel('Analysis title')).toHaveValue('Retained comparison');
});
