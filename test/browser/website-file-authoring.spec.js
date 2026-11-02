import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Exercise the real browser document editor. No research service is provided;
// the unrelated installed acceptance test must also qualify packaging/storage.
const id='10000000-0000-4000-8000-000000000001',web=path.resolve('src/web');
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
 await page.route('http://website.test/**',async route=>{
  const url=new URL(route.request().url());if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><main id="root"></main><script type="module">
   import {websiteFilesUI} from '/website-files-ui.js';const root=document.querySelector('#root'),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   const files=websiteFilesUI({api:window.filesAPI,esc,render(){root.innerHTML=files.view();files.bind();}});root.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)files.action(b);});root.addEventListener('input',e=>files.input(e.target));await files.load();</script>`});
  if(url.pathname.startsWith('/api/website-files/preview/'))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/html',headers:{'Content-Security-Policy':"default-src 'none'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'"},body:url.searchParams.has('canvas')?'<!doctype html><body></body>':url.pathname.endsWith('.css')?css:html});
  const file=path.resolve(web,'.'+url.pathname);if(!file.startsWith(web+path.sep))return route.abort();try{return await route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'text/css',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto('http://website.test/');const canvas=page.frameLocator('#website-files-canvas');await expect(canvas.locator('h1')).toHaveCSS('color','rgb(12, 34, 56)');
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
