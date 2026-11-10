import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {websiteMarkerShape,updateWebsiteSource} from '../../src/website-file-html.js';
import {validateWebsiteCSS,validateWebsiteHTML} from '../../src/website-file-policy.js';

const revision='a'.repeat(64), sourceId='b'.repeat(64);
const policy="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; connect-src 'self'";
const fragment='<div data-observanda-part="body"><p>A permitted paragraph</p></div>';
const saved='<!doctype html><html><head><title>Nested page</title><meta http-equiv="Content-Security-Policy" content="'+policy+'"><link rel="stylesheet" href="style.css"></head><body><main><section data-section-id="layout"><div class="container-content"><section data-section-id="text"><p>Nested <em>original</em> wording</p><p>Second paragraph</p></section></div></section><section data-observanda-source="'+sourceId+'" data-observanda-source-revision="'+revision+'">'+fragment+'</section></main></body></html>';
const css='body { font-family: sans-serif }';
const origin='http://127.0.0.1:48218', base='/api/website-files/preview/site/'+revision+'/';

async function fixture(page){
 let published;
 await page.context().route(origin+'/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<style>body{display:grid;grid-template-columns:22rem 1fr}iframe{width:100%;height:720px}</style><main id="styles"></main><iframe title="Canvas" sandbox="allow-same-origin" src="'+base+'index.html?canvas=1"></iframe>'});
  if(url.searchParams.has('canvas'))return route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'"},body:'<title>Canvas</title>'});
  if(url.pathname==='/published/index.html')return route.fulfill({contentType:'text/html',body:published.html});
  if(url.pathname==='/published/style.css')return route.fulfill({contentType:'text/css',body:published.css});
  if(['/locales/en/figureDiagnostics.json','/locales/languages.json'].includes(url.pathname))return route.fulfill({contentType:'application/json',body:await readFile(new URL('../../src/web'+url.pathname,import.meta.url))});
  if(/^\/(website-[a-z-]+|tabular-data|model-messages|font-catalogue|bundled-fonts|i18n\/runtime)\.js$/.test(url.pathname)){
    const source=await readFile(new URL('../../src/web'+url.pathname,import.meta.url));
    return route.fulfill({contentType:'text/javascript',body:source});
  }
  throw Error('Unexpected request: '+url.pathname);
 });
 await page.goto(origin);
 await page.evaluate(async({html,css,base})=>{
   const {loadWebsiteCanvas,editWebsiteCanvas,websiteCanvasValue}=await import('/website-html-document.js');
   const {bindWebsiteVisual,websiteVisualSections}=await import('/website-files-visual.js');
   const frame=document.querySelector('iframe'),doc=frame.contentDocument;
   loadWebsiteCanvas(doc,html,css,location.origin+base+'style.css');editWebsiteCanvas(doc);
   window.visual=bindWebsiteVisual({document:doc,inspector:document.querySelector('#styles'),t:name=>name,
     beforeChange:()=>{},change:()=>{},getCSS:()=>css,setCSS:value=>{css=value;},getViewport:()=>window.canvasViewport??'desktop'});
   window.rows=()=>websiteVisualSections(doc).map(({node,depth,path})=>({name:node.dataset.sectionId,depth,path}));
   window.saved=()=>({html:websiteCanvasValue(doc),css});
 },{html:saved,css,base});
 const frame=page.frameLocator('iframe');
 return {frame,publish:async value=>{published=value;await page.goto(origin+'/published/index.html');}};
}

test('the inspector explains effective typography and shows a transparent background without writing an override',async({page})=>{
 const {frame}=await fixture(page),before=await page.evaluate(()=>window.saved());
 await frame.getByText('Second paragraph',{exact:true}).click();
 const fields=page.locator('.website-visual-fields');
 await expect(fields.locator('[data-visual-property="background-color"]')).toHaveAccessibleDescription('sectionTransparent');
 await expect(fields.locator('[data-visual-property="font-size"]')).toHaveAttribute('placeholder',/^\d+(\.\d+)?px$/);
 await expect(fields.locator('[data-visual-property="font-weight"]')).toHaveAttribute('placeholder','400');
 await expect(fields.locator('[data-visual-property="font-family"] option').first()).toContainText('sans-serif');
 expect(await page.evaluate(()=>window.saved())).toEqual(before);
});

test('responsive inspector publishes distinct grid and stack layouts at desktop tablet and phone widths',async({page})=>{
 const {frame,publish}=await fixture(page),selector='[data-section-id="text"]';
 const row=await page.evaluate(()=>window.rows().find(r=>r.name==='text').path);
 await page.evaluate(path=>window.visual.select(path),row);await page.locator('.website-layout-inspector > summary').click();
 const field=property=>page.locator('[data-layout-property="'+property+'"]'),apply=()=>page.getByRole('button',{name:'layoutApply',exact:true}).click();
 const device=async(name,width)=>{
  await page.evaluate(({name,width})=>{window.canvasViewport=name;document.querySelector('iframe').style.width=width+'px';window.visual.viewportChanged();},{name,width});
 };
 await device('desktop',1200);await field('display').selectOption('grid');
 // Chromium queues opening a details element. Delivering that notification
 // after a keyboard choice must not clear the first property.
 await page.locator('.website-layout-inspector').dispatchEvent('toggle');
 await field('grid-template-columns').fill('3');await field('gap').fill('24px');
 await field('padding').fill('1rem 2rem');await field('border-width').fill('2px');await field('border-style').selectOption('solid');await field('width').fill('80%');await apply();
 await expect(frame.locator(selector),(await page.evaluate(()=>window.saved())).css).toHaveCSS('display','grid');
 await device('tablet',768);await field('grid-template-columns').fill('2');await field('gap').fill('16px');await apply();
 await device('phone',375);await field('display').selectOption('flex');await field('flex-direction').selectOption('column');
 await field('gap').fill('8px');await field('flex-basis').fill('50%');await apply();await expect(frame.locator(selector)).toHaveCSS('display','flex');
 await page.getByRole('button',{name:'layoutReset',exact:true}).click();await expect(frame.locator(selector)).toHaveCSS('gap','16px');
 await field('display').selectOption('flex');await field('flex-direction').selectOption('column');await field('gap').fill('8px');await field('flex-basis').fill('50%');await apply();
 const saved=await page.evaluate(()=>window.saved());expect(saved.html).not.toMatch(/\sstyle=/);expect(saved.css).toContain('body { font-family: sans-serif }');
 validateWebsiteHTML(saved.html);validateWebsiteCSS(saved.css);await publish(saved);
 for(const [width,display,gap,count] of [[1200,'grid','24px',3],[768,'grid','16px',2],[375,'flex','8px',0]]){
  await page.setViewportSize({width,height:800});const section=page.locator(selector);
  await expect(section).toHaveCSS('display',display);await expect(section).toHaveCSS('gap',gap);await expect(section).toHaveCSS('border-top-width','2px');
  if(count)expect((await section.evaluate(n=>getComputedStyle(n).gridTemplateColumns)).split(/\s+/)).toHaveLength(count);
  else{await expect(section).toHaveCSS('flex-direction','column');await expect(section).toHaveCSS('flex-basis','50%');}
 }
});

test('nested edit, rich text and visual styles survive saved HTML, external CSS and a source withdrawal',async({page})=>{
 const {frame,publish}=await fixture(page);
 const path=await page.evaluate(()=>window.rows().find(row=>row.name==='text'&&row.depth===1)?.path);
 expect(path).toBeTruthy();
 await page.evaluate(path=>window.visual.select(path,{edit:true}),path);
 await page.keyboard.type('Authored ');
 await expect(frame.locator('[data-section-id="text"] p').first()).toHaveText('Authored Nested original wording');
 const property=name=>page.locator('[data-visual-property="'+name+'"]');
 await property('font-size').fill('23');await property('line-height').fill('1.75');await property('letter-spacing').fill('1.2');
 await page.getByRole('button',{name:'sectionApply',exact:true}).click();
 await expect(frame.locator('[data-section-id="text"]')).toHaveCSS('font-size','23px');
 const first=frame.locator('[data-section-id="text"] em');
 await first.dblclick();
 await page.locator('[data-visual-command="bold"]').click();
 // Chromium's double-click may also select the following space outside the
 // emphasis element. The word must stay inside its original emphasis.
 await expect(first.locator('b,strong')).toHaveText('original');
 await first.dblclick();
 await page.locator('[data-visual-scope]').selectOption('selection');
 await property('font-weight').fill('500');await page.getByRole('button',{name:'sectionApply',exact:true}).click();
 await expect(first.locator('span')).toHaveCSS('font-weight','500');
 await frame.locator('[data-observanda-part] p').dblclick();
 await page.keyboard.type('Visible');
 await page.locator('[data-visual-scope]').selectOption('page');
 await property('padding').fill('17');await page.getByRole('button',{name:'sectionApply',exact:true}).click();
 await page.locator('[data-visual-scope]').selectOption('site');
 await property('font-family').selectOption({label:'sectionSerif'});await page.getByRole('button',{name:'sectionApply',exact:true}).click();
 const output=await page.evaluate(()=>window.saved());
 expect(output.html).toContain('Visible');expect(output.html).not.toMatch(/observanda-editor|contenteditable|style="/i);
 expect(websiteMarkerShape(output.html)).toEqual(websiteMarkerShape(saved));
 validateWebsiteHTML(output.html);validateWebsiteCSS(output.css);
 const withdrawn=updateWebsiteSource(output.html,{id:sourceId,revision:'c'.repeat(64),previousHtml:fragment,visible:false});
 expect(withdrawn).not.toContain('Visible');expect(withdrawn).toContain('Authored Nested');
 await publish(output);
 await expect(page.locator('[data-section-id="text"] p').first()).toHaveCSS('line-height','40.25px');
 await expect(page.locator('[data-section-id="text"] em span')).toHaveCSS('font-weight','500');
 await expect(page.locator('body')).toHaveCSS('padding-top','17px');
 await expect(page.locator('body')).toHaveCSS('font-family','Georgia, serif');
});

test('rich text headings lists links and plain-text paste preserve the document privacy boundary',async({page})=>{
 const {frame}=await fixture(page);
 const paragraph=frame.getByText('Second paragraph',{exact:true});
 await paragraph.dblclick();await page.getByRole('combobox',{name:'richHeading'}).selectOption('h3');
 await expect(frame.locator('h3')).toHaveText('Second paragraph');
 await frame.locator('h3').dblclick();await page.getByRole('button',{name:'richBullets',exact:true}).click();
 await expect(frame.locator('ul li')).toHaveText('Second paragraph');
 await frame.locator('li').dblclick();await page.getByRole('button',{name:'richLink',exact:true}).click();
 await page.getByRole('textbox',{name:'richLinkAddress'}).fill('https://example.org/notes');
 await page.getByRole('button',{name:'richApplyLink'}).click();
 await expect(frame.locator('a')).toHaveAttribute('href','https://example.org/notes');
 await frame.locator('a').dblclick();await page.getByRole('button',{name:'richUnlink'}).click();
 await expect(frame.locator('a')).toHaveCount(0);
 await frame.locator('li').dblclick();
 await frame.locator('li').evaluate(li=>{
   const clipboard=new DataTransfer();clipboard.setData('text/html','<img src="untrusted.png">');clipboard.setData('text/plain','Pasted');
   li.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));
 });
 await expect(frame.locator('li')).toContainText('Pasted');await expect(frame.locator('img')).toHaveCount(0);
 await frame.locator('main').evaluate(main=>{
   const range=main.ownerDocument.createRange();range.selectNodeContents(main);
   main.ownerDocument.body.focus();
   const select=main.ownerDocument.getSelection();select.removeAllRanges();select.addRange(range);
 });
 await page.keyboard.press('Delete');
 await expect(frame.getByText('A permitted paragraph',{exact:true})).toBeVisible();
 expect(websiteMarkerShape((await page.evaluate(()=>window.saved())).html)).toEqual(websiteMarkerShape(saved));
});

test('keyboard formatting retains a cross-inline selection when focus moves to the inspector',async({page})=>{
 const {frame}=await fixture(page);
 const paragraph=frame.locator('[data-section-id="text"] p').first();
 await paragraph.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
 expect(await paragraph.evaluate(el=>el.ownerDocument.getSelection().toString())).toBe('Nested original wording');
 const bold=page.locator('[data-visual-command=bold]');await bold.focus();await page.keyboard.press('Enter');
 await expect(paragraph.locator('b,strong').first()).toBeVisible();
 const text=await paragraph.evaluate(el=>[...el.querySelectorAll('b,strong')].map(node=>node.textContent).join(''));
 expect(text).toBe('Nested original wording');
 // A selectionchange is delivered on a later task. Moving HTML focus and
 // activating the inspector during the same task must use the current range.
 await paragraph.dblclick();
 await page.evaluate(()=>{
   const doc=document.querySelector('iframe').contentDocument,range=doc.createRange();
   range.selectNodeContents(doc.querySelector('[data-section-id="text"] p:nth-child(2)'));
   const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
   const button=document.querySelector('[data-visual-command="italic"]');button.focus();button.click();
 });
 await expect(frame.locator('[data-section-id="text"] p:nth-child(2) :is(i,em)')).toHaveText('Second paragraph');
});
