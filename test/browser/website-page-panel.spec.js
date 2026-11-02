import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('large saved sites search by folder, title and publication state and edit literal page metadata',async({page})=>{
 const files=new Map(await Promise.all(['website-files-pages','website-html-document'].map(async name=>[name+'.js',await readFile(new URL('../../src/web/'+name+'.js',import.meta.url),'utf8')])));
 await page.route('http://page-panel.test/**',route=>{
  const name=new URL(route.request().url()).pathname.slice(1);
  if(name==='')return route.fulfill({contentType:'text/html',body:'<main></main>'});
  return files.has(name)?route.fulfill({contentType:'text/javascript',body:files.get(name)}):route.abort();
 });
 await page.goto('http://page-panel.test/');
 await page.evaluate(async()=>{
  const {websiteFilesPages}=await import('/website-files-pages.js');
  const pages=Array.from({length:3410},(_,i)=>({path:'runs/'+i+'.html',title:'Run '+i}));
  pages.push({path:'studies/north/results.html',title:'Échantillons',draft:true},{path:'studies/south/results.html',title:'Échantillons'});
  const page={site:{id:'site',revision:'1',pages},path:pages.at(-1).path,html:'<!doctype html><html lang="en"><head><title>Original</title><meta name="description" content="Original summary"><meta name="description" content="Old duplicate"></head><body><h1>Authored heading</h1></body></html>'};
  const esc=text=>String(text).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const tr=(key,args)=>args?key+' '+JSON.stringify(args):key;
  const panel=websiteFilesPages({site:()=>page,esc,tr,render:()=>{document.querySelector('main').innerHTML=panel.view();},
   edit:work=>{const document=new DOMParser().parseFromString(page.html,'text/html');work(document);page.html='<!doctype html>'+document.documentElement.outerHTML;},
   save:async()=>{page.site.revision=String(Number(page.site.revision)+1);},openPage:path=>{page.path=path;panel.open();},close(){}});
  document.addEventListener('input',event=>panel.input(event.target));
  document.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button)return;
   try{await panel.handle(button.dataset.action.slice('website-files-'.length),button);}catch(e){window.failure=e.message;}
  });
  window.state={page,panel};panel.open();
 });
 const rows=page.locator('[data-pages-results] li');await expect(rows).toHaveCount(40);
 expect(await page.evaluate(()=>new DOMParser().parseFromString('<select>'+window.state.panel.options()+'</select>','text/html').querySelectorAll('option').length)).toBe(41);
 await page.locator('[data-action="website-files-pages-forward"]').click();await expect(rows.first()).toContainText('Run 40');
 await page.locator('[data-pages-search]').fill('echantillons studies/');
 await expect(rows).toHaveCount(2);await page.locator('[data-pages-state]').selectOption('draft');await expect(rows).toHaveCount(1);await expect(rows).toContainText('studies/north/results.html');
 await rows.getByRole('button').click();await expect(page.locator('[data-saved-page][aria-current]')).toHaveAttribute('data-saved-page','studies/north/results.html');
 await page.locator('[data-page-setting="title"]').fill('Sample <notes>');
 await page.locator('[data-page-setting="description"]').fill('A verified summary & details');
 await page.locator('[data-page-setting="language"]').fill('en_US');
 await page.locator('[data-action="website-files-pages-save"]').click();await expect.poll(()=>page.evaluate(()=>window.failure)).toBe('pageLanguageInvalid');
 await page.locator('[data-page-setting="language"]').fill('ca-ES');await page.locator('[data-action="website-files-pages-save"]').click();
 const html=await page.evaluate(()=>window.state.page.html);expect(html).toContain('<html lang="ca-ES">');expect(html).toContain('<title>Sample &lt;notes&gt;</title>');expect(html).toContain('A verified summary &amp; details');expect(html).not.toContain('Old duplicate');expect(html).toContain('<h1>Authored heading</h1>');
 await page.locator('[data-page-setting="description"]').fill('unsaved');
 await page.evaluate(()=>{window.state.page.site.revision='other';window.state.panel.open();});await expect(page.locator('[data-page-setting]')).toHaveCount(0);
});
