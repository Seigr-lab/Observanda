import {test,expect} from '@playwright/test';
import {mountFilesEditor} from './mount-files-editor.js';

// Exercise the real browser document editor. No research service is provided;
// the unrelated installed acceptance test must also qualify packaging/storage.
const id='10000000-0000-4000-8000-000000000001';
const savedSite={id,name:'Recovered site',revision:'c'.repeat(64),cssPath:'style.css',pages:[{path:'index.html',title:'Home'}]};
const savedPage={site:savedSite,path:'index.html',css:'',html:'<!doctype html><html><body><main><h1>Original saved home</h1></main></body></html>'};
const sessionWith=(sites,preparation)=>({workspaceId:id,title:'Lab',sites,preparation});

test('a prepared website opens from saved files without another user action',async({page})=>{
 const calls=[];let checks=0;
 await page.exposeFunction('filesAPI',route=>{
  calls.push(route);
  switch(route){
   case '/api/website-files/session':return sessionWith([],{state:'preparing'});
   case '/api/website-files/preparation':return {preparation:++checks===1?{state:'preparing',stage:'copying-files',completed:8,stageTotal:15}:{state:'ready'}};
   case '/api/website-files/list':return {items:[savedSite],next:null};
   case '/api/website-files/open':return savedPage;
   default:throw Error('Unexpected request '+route);
  }
 });
 await mountFilesEditor(page);await expect(page.getByRole('status')).toHaveText('Preparing saved websites…');
 await expect(page.getByRole('button',{name:'New website'})).toHaveCount(0);
 await expect(page.getByRole('status')).toHaveText('Copying website files (8 of 15)');
 await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Original saved home');
 expect(calls).toEqual(['session','preparation','preparation','list','open'].map(op=>'/api/website-files/'+op));
});

test('private draft remains identifiable and new pages use the public stylesheet',async({page})=>{
 const draft={path:'drafts/notes.html',title:'Notes',draft:true},pages=[...savedSite.pages,draft];
 const site={...savedSite,pages},home={...savedPage,site,css:'main{color:blue}'};
 const privatePage={...savedPage,site:{...site,cssPath:'drafts/draft.css'},path:draft.path,css:'.private-note{color:red}'};
 const writes=[];
 await page.exposeFunction('filesAPI',(route,data)=>{
  if(route==='/api/website-files/session')return sessionWith([site],{state:'ready'});
  if(route==='/api/website-files/open')return data.path===draft.path?privatePage:home;
  if(route==='/api/website-files/version')return {revision:site.revision};
  if(route==='/api/website-files/save'){
   writes.push(data);return {...home,path:data.path,html:data.html,site:{...site,pages:[...pages,{path:data.path,title:data.title}]}};
  }
  throw Error('Unexpected request '+route);
 });
 await mountFilesEditor(page);
 const select=page.locator('[data-website-file-page]'),notice=page.getByText('Saving keeps this page as a private draft. Exports and publications exclude it.');
 await expect(select.locator('option').last()).toHaveText('Notes (private draft)');
 await select.selectOption(draft.path);await expect(notice).toBeVisible();
 await page.getByRole('button',{name:'Add page'}).click();
 await page.getByLabel('Page title').fill('Field work');await page.getByLabel('Page file name').fill('pages/field.html');
 await page.getByRole('button',{name:'Add page'}).click();await expect(select).toHaveValue('pages/field.html');
 await expect(notice).toHaveCount(0);expect(writes).toHaveLength(1);
 expect(writes[0].html).toContain('href="../style.css"');expect(writes[0].css).toBe(home.css);
});

test('the empty workspace creates once, disables actions while writing, and retains a failed form',async({page})=>{
 let finish,creates=0;
 await page.exposeFunction('filesAPI',async route=>{
  if(route==='/api/website-files/session')return sessionWith([],{state:'ready'});
  if(route==='/api/website-files/create'){
   creates++;if(creates>1)return savedPage;
   await new Promise(resolve=>{finish=resolve;});return {errorCode:'UNAVAILABLE',message:'Storage is unavailable.'};
  }
  throw Error('Unexpected request '+route);
 });
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await mountFilesEditor(page);
 const create=page.getByRole('button',{name:'New website',exact:true});
 await expect(create).toHaveCount(1);await create.click();
 await page.getByLabel('Website name').fill('Recovered site');await expect(create).toHaveCount(1);await create.click();
 await expect(create).toBeDisabled();await expect(page.getByRole('button',{name:'Cancel'})).toBeDisabled();
 await expect(page.getByLabel('Website name')).toBeDisabled();expect(creates).toBe(1);
 finish();await expect(page.getByRole('alert')).toHaveText('Storage is unavailable.');
 await expect(page.getByLabel('Website name')).toHaveValue('Recovered site');expect(errors).toEqual([]);
 await create.click();await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Original saved home');
 expect(creates).toBe(2);
});

test('a missing bookmarked site can be recovered without displaying another site under its name',async({page})=>{
 const requested='20000000-0000-4000-8000-000000000002',calls=[];
 await page.exposeFunction('filesAPI',(route,data)=>{
  calls.push([route,data?.siteId]);
  if(route==='/api/website-files/session')return sessionWith([savedSite],{state:'ready'});
  if(route==='/api/website-files/open')return data.siteId===requested?{errorCode:'NOT_FOUND',message:'Missing'}:savedPage;
  throw Error('Unexpected request '+route);
 });
 await mountFilesEditor(page,{hash:'#/websites/'+requested+'/editor'});
 await expect(page.getByText('This website could not be opened. Return to the workspace to check it.')).toBeVisible();
 await expect(page.locator('#website-files-canvas')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'New website'})).toHaveCount(0);
 await page.locator('[data-website-file-site]').selectOption(id);
 await expect(page.frameLocator('#website-files-canvas').locator('h1')).toHaveText('Original saved home');
 expect(calls).toEqual([['/api/website-files/session',undefined],['/api/website-files/open',requested],['/api/website-files/open',id]]);
});
for(const [state,message] of [
 ['unprepared','Open the workspace to check for saved websites.'],
 ['failed','The workspace could not prepare its saved websites. Return to the workspace to check storage and access.']
]){
 test('workspace preparation state '+state+' cannot be mistaken for an empty workspace',async({page})=>{
  const calls=[];
  await page.exposeFunction('filesAPI',route=>{calls.push(route);return sessionWith([],{state});});
  await mountFilesEditor(page);await expect(page.getByText(message,{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Retry'})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'New website'})).toHaveCount(0);
  await expect(page.locator('#website-files-canvas')).toHaveCount(0);
  expect(calls).toEqual(['/api/website-files/session']);
 });
}
test('visual edits preserve saved HTML, styles and placement and reject outdated drafts',async({page})=>{
 let version=1,html='<!doctype html><html lang="en"><head><title>Observation</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Observation</h1><p>Initial notes</p><section data-observanda-source="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" data-observanda-source-revision="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"><p data-observanda-part="body">Copied text</p><p data-observanda-part="section-1">First release</p></section></main></body></html>',css='h1{color:rgb(12, 34, 56)}';
 const revision=()=>String(version).padStart(64,'a'),site=()=>({id,name:'Observation',revision:revision(),pages:[{path:'index.html',title:'Observation'}],cssPath:'style.css'}),open=()=>({site:site(),path:'index.html',html,css});
 const calls=[];await page.exposeFunction('filesAPI',async(route,data)=>{calls.push(route);switch(route){
  case '/api/website-files/session':return {workspaceId:id,title:'Lab',sites:[site()]};
  case '/api/website-files/open':return open();case '/api/website-files/version':return {revision:revision()};
  case '/api/website-files/save':if(data.expectedRevision!==revision())throw Error('stale revision');html=data.html;css=data.css;version++;return open();
  default:throw Error('Unexpected request '+route);
 }});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await mountFilesEditor(page,{resource:url=>url.pathname.endsWith('.css')?css:html});const canvas=page.frameLocator('#website-files-canvas');await expect(canvas.locator('h1')).toHaveCSS('color','rgb(12, 34, 56)');
 const paragraph=canvas.locator('main > p');await paragraph.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.type('Edited on canvas');await expect(paragraph).toHaveText('Edited on canvas');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');expect(html).toContain('<p>Edited on canvas</p>');expect(html).not.toMatch(/contenteditable|data-observanda-editor/);
 await page.getByRole('button',{name:'CSS',exact:true}).click();await page.getByLabel('CSS',{exact:true}).fill('p{font-weight:700}');await page.getByRole('button',{name:'Preview saved website'}).click();await expect(page.frameLocator('iframe').locator('main > p')).toHaveCSS('font-weight','700');
 await page.reload();await expect(canvas.locator('main > p')).toHaveText('Edited on canvas');
 const part=canvas.locator('[data-observanda-part="body"]');await part.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.type('My webpage wording');await expect(part).toHaveText('My webpage wording');
 const release=canvas.locator('[data-observanda-part="section-2"]');
 version++;html=html.replace('b'.repeat(64),'c'.repeat(64)).replace('<p data-observanda-part="section-1">First release</p>','<p data-observanda-part="section-2">Second release</p>');
 await expect(release).toHaveText('Second release',{timeout:10000});await expect(canvas.getByText('First release',{exact:true})).toHaveCount(0);await expect(part).toHaveText('My webpage wording');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');expect(html).toContain('My webpage wording');
 version++;html=html.replace('c'.repeat(64),'d'.repeat(64)).replace('<p data-observanda-part="body">My webpage wording</p>','');
 await expect(part).toHaveCount(0,{timeout:10000});await expect(canvas.getByText('My webpage wording',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'HTML',exact:true}).click();const source=page.getByLabel('HTML',{exact:true});await source.fill(html.replace('Edited on canvas','Uncommitted change'));version++;html=html.replace('Edited on canvas','Updated visibility');await expect(page.locator('[data-website-files-status]')).toContainText('Website content changed',{timeout:10000});
 expect(await source.inputValue()).toContain('Uncommitted change');await expect(page.getByRole('button',{name:'Preview saved website'})).toBeDisabled();expect(calls.every(call=>call.startsWith('/api/website-files/'))).toBe(true);expect(errors).toEqual([]);
});
