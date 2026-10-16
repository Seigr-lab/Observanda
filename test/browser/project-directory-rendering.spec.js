import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

async function fixture(page){
 await page.route('https://directory.test/**',async route=>{
  const pathname=new URL(route.request().url()).pathname;
  if(pathname==='/')return route.fulfill({contentType:'text/html',body:'<main><h1>Project directory</h1><div id="directories"></div><label>Retained input<input id="retained" value="Unrelated editing"></label></main>'});
  const body=await readFile(new URL('../../src/web'+pathname,import.meta.url),'utf8');await route.fulfill({contentType:pathname.endsWith('.json')?'application/json':'text/javascript',body});
 });
 await page.goto('https://directory.test/');
}

test('completed project changes patch cards and ancestor links without replacing focused controls or unrelated content',async({page})=>{
 await fixture(page);
 await page.evaluate(async()=>{
  const {projectDirectory}=await import('/project-directory.js');
  const row=(title,parentId=null)=>({projectId:crypto.randomUUID(),parentId,summary:{title,description:'',kind:'Project'}});
  window.directoryParent=row('Original parent');window.child=row('Selected child',directoryParent.projectId);window.roots=[directoryParent,row('Removed one'),row('Removed two')];window.chain=[directoryParent,child];window.calls=0;
  window.state={book:{projects:[{id:child.projectId,title:child.summary.title,parentId:null}]},projectOwner:{projectId:child.projectId},page:'project',storage:{contextId:'workspace',researchStorage:'catalogue'}};
  window.directory=projectDirectory({state,esc:value=>String(value),changed:()=>{},api:async(route,input)=>{calls++;return {projects:input.parentId?[]:roots,ancestors:input.parentId?chain:[],revision:String(calls),total:input.parentId?0:roots.length};}});
  document.querySelector('#directories').innerHTML=directory.cards(null)+directory.trail(child.projectId,'Workspace');await directory.refresh();
  const host=document.querySelector('[data-project-directory]'),trail=document.querySelector('[data-project-trail]');window.retained={host,grid:host.querySelector('.project-grid'),card:host.querySelector('article'),button:host.querySelector('.card-title'),trail,ancestor:trail.querySelector('[data-project-ancestor] button'),input:document.querySelector('#retained')};retained.button.focus();
 });
 await expect(page.locator('[data-project-trail]')).toContainText('Original parent');
 await page.evaluate(async()=>{
  directoryParent.summary={title:'Renamed parent',description:'Updated description',kind:'Research'};roots=[directoryParent];
  window.operation={id:crypto.randomUUID(),kind:'/api/projects/'+directoryParent.projectId+'/settings/save',state:'completed'};await directory.activity({contextId:'workspace',operations:[operation]});
 });
 await expect(page.locator('[data-project-directory] article')).toHaveCount(1);await expect(page.locator('.card-title')).toHaveText('Renamed parent');await expect(page.locator('.subtitle')).toHaveText('Updated description');await expect(page.locator('.scope-kicker')).toHaveText('Research');await expect(page.locator('[data-project-trail] button').last()).toHaveText('Renamed parent');await expect(page.locator('.card-title')).toBeFocused();
 expect(await page.evaluate(()=>({host:retained.host===document.querySelector('[data-project-directory]'),grid:retained.grid===document.querySelector('.project-grid'),card:retained.card===document.querySelector('article'),button:retained.button===document.querySelector('.card-title'),trail:retained.trail===document.querySelector('[data-project-trail]'),ancestor:retained.ancestor===document.querySelector('[data-project-ancestor] button'),input:retained.input===document.querySelector('#retained')}))).toEqual({host:true,grid:true,card:true,button:true,trail:true,ancestor:true,input:true});
 await page.getByLabel('Retained input').fill('Still editing');await page.evaluate(async()=>{window.before=calls;await directory.activity({contextId:'workspace',operations:[operation]});});expect(await page.evaluate(()=>calls)).toBe(await page.evaluate(()=>before));await expect(page.getByLabel('Retained input')).toBeFocused();
 await page.evaluate(async()=>{child.parentId=null;chain=[child];await directory.activity({contextId:'workspace',operations:[operation,{id:crypto.randomUUID(),kind:'/api/projects/'+child.projectId+'/directory/reparent',state:'completed'}]});});
 await expect(page.locator('[data-project-ancestor]')).toHaveCount(0);await expect(page.locator('[data-project-trail]')).toHaveText('Workspace');await expect(page.getByLabel('Retained input')).toHaveValue('Still editing');await expect(page.getByLabel('Retained input')).toBeFocused();
});

test('directory pagination and failed refresh keep existing cards and expose a scoped retry',async({page})=>{
 await fixture(page);
 await page.evaluate(async()=>{
  const {projectDirectory}=await import('/project-directory.js');window.rows=['First project','Second project'].map(title=>({projectId:crypto.randomUUID(),parentId:null,summary:{title,description:'',kind:'Project'}}));window.fail=false;
  window.directory=projectDirectory({state:{book:{projects:[]},page:'projects',storage:{contextId:'workspace',researchStorage:'catalogue'}},esc:value=>String(value),changed:()=>{},api:async(route,input)=>{if(fail)throw {message:'Directory unavailable'};return {projects:rows.slice(input.offset,input.offset+1),ancestors:[],total:rows.length,revision:'current'};}});
  document.querySelector('#directories').innerHTML=directory.cards(null);await directory.refresh();window.card=document.querySelector('article');window.button=card.querySelector('.card-title');button.focus();
 });
 await expect(page.getByRole('button',{name:'More projects',exact:true})).toBeVisible();await page.evaluate(()=>directory.action({dataset:{action:'project-directory-more',parent:''}}));
 await expect(page.locator('article')).toHaveCount(2);await expect(page.getByRole('button',{name:'More projects',exact:true})).toBeHidden();await expect(page.getByRole('button',{name:'First project',exact:true})).toBeFocused();expect(await page.evaluate(()=>card===document.querySelector('article')&&button===card.querySelector('.card-title'))).toBe(true);
 await page.evaluate(async()=>{fail=true;await directory.action({dataset:{action:'project-directory-retry',parent:''}});});await expect(page.getByRole('alert')).toHaveText('Directory unavailable');await expect(page.locator('article')).toHaveCount(2);await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
 await page.evaluate(async()=>{fail=false;await directory.action({dataset:{action:'project-directory-retry',parent:''}});});await expect(page.getByRole('alert')).toBeHidden();await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeHidden();await expect(page.getByRole('button',{name:'More projects',exact:true})).toBeHidden();await expect(page.locator('article')).toHaveCount(2);expect(await page.evaluate(()=>card===document.querySelector('article'))).toBe(true);
});
