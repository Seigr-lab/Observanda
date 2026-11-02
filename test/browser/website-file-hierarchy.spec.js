import {test,expect} from '@playwright/test';
import {mountFilesEditor} from './mount-files-editor.js';

async function editor(page){
 const id='10000000-0000-4000-8000-000000000012',revision='a'.repeat(64);
 const pages=[{path:'index.html',title:'Home'},...Array.from({length:1200},(_,i)=>({path:'plots/'+i+'.html',title:'Plot '+i,draft:i===1199}))];
 const site={id,name:'Field reports',revision,cssPath:'style.css',pages};
 const protection='<section data-observanda-source="'+'f'.repeat(64)+'" data-observanda-source-revision="'+'c'.repeat(64)+'"><p data-observanda-part="body">Permissioned text</p></section>';
 let html='<!doctype html><html><body><main><section id="station"><h2>Station</h2><section id="nest"><h3>Inner observations</h3></section></section><section id="landing"></section><p id="specimen">Individual specimen</p>'+protection+
  Array.from({length:100},(_,n)=>'<section id="field-'+n+'"><h2>Field '+n+'</h2></section>').join('')+'</main></body></html>';
 const calls=[];const css='#landing{min-height:150px}';
 await page.exposeFunction('filesAPI',(route,data)=>{
  calls.push(route);
  if(route.endsWith('/session'))return {workspaceId:id,title:'Measurements',sites:[site]};
  if(route.endsWith('/version'))return {revision};
  if(route.endsWith('/open'))return {site,path:data.path||'index.html',html:data.path==='index.html'||!data.path?html:'<!doctype html><main><h1>Selected private plot</h1></main>',css};
  if(route.endsWith('/save')){html=data.html;return {site,path:data.path,html,css};}
  throw Error('Unexpected route '+route);
 });
 await mountFilesEditor(page);const canvas=page.frameLocator('#website-files-canvas'),list=page.locator('[data-website-files-structure]');
 await expect(canvas.locator('#station')).toBeVisible();return {canvas,list,calls,html:()=>html};
}

test('finds saved pages, tools, elements and nested layers with a keyboard and bounded results',async({page})=>{
 const {canvas,list,calls}=await editor(page);
 await expect(list.getByRole('listitem')).toHaveCount(48);
 await canvas.locator('body').press('Control+k');
 const search=page.getByRole('combobox',{name:'Search by name or path'}),dialog=page.getByRole('dialog');
 await expect(search).toBeFocused();expect(await dialog.getByRole('option').count()).toBeLessThanOrEqual(32);
 await search.fill('inner observations');await search.press('Enter');
 await expect(list.locator('[aria-current=true]')).toContainText('Inner observations');
 await expect(list.locator('[data-layer-toggle][aria-expanded=true]').first()).toBeVisible();
 const filter=page.getByRole('searchbox',{name:'Filter page layers'});await filter.fill('field 99');
 await expect(list.getByRole('listitem')).toHaveCount(2);
 await filter.fill('');await page.getByRole('button',{name:'Next layers'}).click();await expect(list.getByRole('listitem')).toHaveCount(48);
 await page.keyboard.press('Control+k');await search.fill('elements');await expect(dialog.getByRole('group',{name:'Elements'})).toBeVisible();await search.press('Escape');
 await page.keyboard.press('Control+k');await search.fill('tools');await expect(dialog.getByRole('group',{name:'Tools'})).toBeVisible();await search.press('Escape');
 await page.keyboard.press('Control+k');await search.fill('plots/1199.html');await expect(dialog.getByRole('option')).toContainText('private draft');
 await search.press('Enter');await expect(canvas.getByRole('heading',{name:'Selected private plot'})).toBeVisible();
 expect(calls.every(route=>route.startsWith('/api/website-files/'))).toBe(true);
});

test('moves across containers with the keyboard and onto the canvas, preserving saved provenance',async({page})=>{
 const {canvas,list,html}=await editor(page);
 const choose=async name=>list.getByRole('button',{name,exact:true}).first().click();
 await choose('Individual specimen');await page.getByRole('button',{name:'Move to…'}).click();
 const dialog=page.getByRole('dialog'),search=dialog.getByRole('combobox');await search.fill('inner observations');
 await dialog.getByRole('group',{name:'Inside',exact:true}).getByRole('option').first().click();
 await expect(canvas.locator('#nest > #specimen')).toHaveText('Individual specimen');
 await expect(list.locator('[aria-current=true]')).toContainText('Individual specimen');
 const filter=page.getByRole('searchbox',{name:'Filter page layers'});await filter.fill('permissioned');
 await choose('Permissioned text');await expect(list.getByRole('button',{name:'Move to…'})).toHaveCount(0);
 await filter.fill('individual specimen');
 const source=list.locator('[draggable=true]').first(),target=canvas.locator('#landing');
 await source.scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded();
 const a=await source.boundingBox(),b=await target.boundingBox();await page.mouse.move(a.x+10,a.y+a.height/2);await page.mouse.down();
 await page.mouse.move(a.x+22,a.y+a.height/2,{steps:5});await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:15});
 await page.mouse.move(b.x+b.width/2+1,b.y+b.height/2);await page.mouse.up();
 await expect(canvas.locator('#landing > #specimen')).toHaveCount(1);
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
 expect(html()).toContain('data-observanda-part="body">Permissioned text</p>');expect(html()).not.toMatch(/data-layer-|data-observanda-editor/);
});
