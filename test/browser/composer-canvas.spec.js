import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Workspace} from '../../src/storage.js';
import {startServer} from '../../src/server.js';
import {createNotebook} from '../../src/model.js';
import {navigate} from './preferences-helper.js';
let app,root,errors;
const canvas=p=>p.frameLocator('#website-draft-preview');
const task=(p,name)=>p.getByRole('navigation',{name:'Editing tools',exact:true}).getByRole('button',{name:{Add:'Page',Content:'Content'}[name]??name,exact:true}).click();
test.beforeEach(async({page})=>{errors=[];page.on('pageerror',e=>errors.push(e.message));root=await mkdtemp(path.join(os.tmpdir(),'observanda-canvas-'));await new Workspace(root).create(createNotebook('Field & form',''));app=await startServer({root,preferencesFile:path.join(root,'preferences.json'),port:0});await page.goto(app.url);await navigate(page,'Website editor');await page.getByRole('button',{name:'Create homepage',exact:true}).click();await expect(canvas(page).locator('main')).toBeVisible();});
test.afterEach(async()=>app.close());
async function drag(page,from,to,{x=.5,y=.5}={}){
 await expect(from).toBeEnabled();await from.scrollIntoViewIfNeeded();const a=await from.boundingBox(),b=await to.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*x,b.y+b.height*y,{steps:18});await expect(page.locator('.composer-drop-marker')).toBeVisible();await page.mouse.up();
}
test('drag elements into nested containers, move between containers, retain node identity, undo and reopen',async({page})=>{
 test.setTimeout(60000);
 await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Listening outdoors');
 await task(page,'Add');await drag(page,page.locator('[data-palette-kind=container]'),canvas(page).locator('[data-drop-parent=""]'));
 await expect(canvas(page).locator('.section-container')).toHaveCount(1);
 await canvas(page).locator('.section-container>.canvas-section-edit').click();
 await page.getByLabel('Section heading',{exact:true}).fill('Opening');
 await task(page,'Add');await drag(page,page.locator('[data-palette-kind=heading]'),canvas(page).locator('.container-content>[data-drop-parent]'));
 await canvas(page).locator('.section-heading>.canvas-section-edit').click();
 await page.getByLabel('Section heading',{exact:true}).fill('Every place has a sound.');
 await page.getByLabel('Heading level',{exact:true}).selectOption('1');await expect(canvas(page).getByRole('heading',{name:'Every place has a sound.'})).toBeVisible();
 await canvas(page).locator('.section-heading h1').fill('Every place has its own sound.');
 await expect(page.getByLabel('Section heading',{exact:true})).toHaveValue('Every place has its own sound.');
 await page.getByRole('navigation',{name:'Section tools'}).getByRole('button',{name:'Style',exact:true}).click();
 await page.getByLabel('Section text size (px)',{exact:true}).fill('42');await expect(canvas(page).locator('.section-heading h1')).toHaveCSS('font-size','42px');
 const pagePath=await page.getByLabel('Page',{exact:true}).inputValue();
 await page.locator('#website-draft-preview').evaluate(f=>{f._doc=f.contentDocument;f._heading=f.contentDocument.querySelector('.section-heading');});
 await task(page,'Site');await page.locator('.site-tools').getByRole('button',{name:'Typography',exact:true}).click();
 await page.getByRole('button',{name:'Size',exact:true}).click();await page.getByLabel('Body text size (px)').fill('20');await expect(canvas(page).locator('body')).toHaveCSS('font-size','20px');
 expect(await page.locator('#website-draft-preview').evaluate(f=>f._doc===f.contentDocument&&f._heading===f.contentDocument.querySelector('.section-heading'))).toBe(true);
 await task(page,'Add');await drag(page,page.locator('[data-palette-kind=container]'),canvas(page).locator('[data-drop-parent=""]'));
 await expect(canvas(page).locator('.section-container')).toHaveCount(2);
 const headings=canvas(page).locator('.section-heading');
 await drag(page,headings.locator(':scope>.canvas-section-handle'),canvas(page).locator('.section-container').last().locator('.container-content>[data-drop-parent]'));
 await expect(canvas(page).locator('.section-container').last().locator('.section-heading')).toHaveCount(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(canvas(page).locator('.section-container').first().locator('.section-heading')).toHaveCount(1);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await expect(canvas(page).locator('.section-container').last().locator('.section-heading')).toHaveCount(1);
 await task(page,'Page');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Listening outdoors');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();
 await expect(page.getByLabel('Page',{exact:true})).toHaveValue(pagePath);await expect(canvas(page).locator('.section-container').last().locator('.section-heading')).toHaveCount(1);
 const saved=(await new Workspace(root).read()).book,parts=saved.pages[0].sections;expect(parts.find(e=>e.kind==='heading').parentId).toBe(parts.filter(e=>e.kind==='container').at(-1).id);expect(errors).toEqual([]);
});
test('a new image element remains in the page before upload, and a dragged move can be cancelled',async({page})=>{
 await task(page,'Add');await page.locator('[data-palette-kind=asset]').click();
 await expect(canvas(page).locator('.canvas-empty-media')).toBeVisible();
 const id=await canvas(page).locator('.section-asset').getAttribute('data-section-id');
 await canvas(page).locator('.section-asset>.canvas-section-edit').click();await page.getByLabel('Upload media for this element').setInputFiles('src/preview-assets/image.png');
 await expect(canvas(page).locator('.section-asset img')).toBeVisible();expect(await canvas(page).locator('.section-asset').getAttribute('data-section-id')).toBe(id);
 await task(page,'Add');const source=page.locator('[data-palette-kind=heading]'),target=canvas(page).locator('[data-drop-parent=""]');await source.scrollIntoViewIfNeeded();const a=await source.boundingBox(),b=await target.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});await page.keyboard.press('Escape');await page.mouse.up();await expect(canvas(page).locator('.section-heading')).toHaveCount(0);
 await page.getByRole('button',{name:'Preview & export'}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website'})).toBeVisible();await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.frameLocator('iframe[title="Publication preview"]').locator('.section-asset img')).toBeVisible();
 await page.getByRole('button',{name:'Back to website editor'}).click();await expect(canvas(page).locator('.section-asset')).toHaveAttribute('data-section-id',id);expect(errors).toEqual([]);
});

test('compose an editorial page with nested media and typography, review unsaved, export and retain both pages',async({page})=>{
 test.setTimeout(60000);
 await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Field journal');
 const first=await page.getByLabel('Page',{exact:true}).inputValue();
 await task(page,'Page');await page.getByRole('button',{name:'Page layouts',exact:true}).click();
 await page.getByRole('button',{name:'Field journal',exact:true}).click();await page.getByRole('button',{name:'Apply layout',exact:true}).click();
 await expect(canvas(page).locator('.section-heading h1')).toHaveText('Pay attention. There is more to discover.');
 await canvas(page).locator('.canvas-empty-media').click();await canvas(page).locator('.section-asset>.canvas-section-edit').click();await page.getByLabel('Upload media for this element').setInputFiles('src/preview-assets/image.png');
 await expect(canvas(page).locator('.section-asset img')).toBeVisible();
 await expect.poll(()=>canvas(page).locator('main').evaluate(main=>{const image=main.querySelector('.section-asset img').getBoundingClientRect(),next=main.querySelectorAll('.page-composition>.section-container')[1].getBoundingClientRect();return next.top>=image.bottom;})).toBe(true);
 await canvas(page).locator('.section-asset img').click();await page.getByLabel('Image proportions').selectOption('portrait');await page.getByLabel('Image fit',{exact:true}).selectOption('cover');
 await expect(canvas(page).locator('.section-asset img')).toHaveCSS('aspect-ratio','3 / 4');
 await canvas(page).locator('.section-asset img').scrollIntoViewIfNeeded();
 await expect(page.getByLabel('Image proportions')).toBeInViewport();
 if(await page.locator('#notice').isVisible())await page.locator('#notice button').click();await page.evaluate(()=>scrollTo(0,0));await mkdir('.local/ux-review/canvas',{recursive:true});await page.screenshot({path:'.local/ux-review/canvas/editor-desktop.png',fullPage:true});
 const before=await readFile(path.join(root,'observanda.json'),'utf8');
 await page.getByRole('button',{name:'Preview & export'}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await expect(page.getByRole('heading',{name:'Review website'})).toBeVisible();
 expect(await readFile(path.join(root,'observanda.json'),'utf8')).toBe(before);
 await page.getByLabel('Preview page',{exact:true}).selectOption(first);
 const href=await page.locator('#full-public-preview').getAttribute('href'),visitor=await page.context().newPage();
 await visitor.setViewportSize({width:1440,height:1000});await visitor.goto(new URL(href,app.url).href);await visitor.locator('.section-asset img').waitFor();await visitor.evaluate(()=>document.fonts.ready);
 await visitor.screenshot({path:'.local/ux-review/canvas/export-desktop.png',fullPage:true});
 await visitor.setViewportSize({width:390,height:844});
 await expect.poll(()=>visitor.locator('main').evaluate(main=>{const image=main.querySelector('.section-asset img').getBoundingClientRect(),next=main.querySelectorAll('.page-composition>.section-container')[1].getBoundingClientRect();return next.top>=image.bottom;})).toBe(true);
 await visitor.screenshot({path:'.local/ux-review/canvas/export-mobile.png',fullPage:true});
 expect(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await visitor.close();
 await page.getByRole('button',{name:'Back to website editor'}).click();await expect(page.getByLabel('Image proportions')).toHaveValue('portrait');
 await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('A second page');await task(page,'Add');await expect(page.locator('[data-palette-kind=text]')).toBeEnabled();await page.locator('[data-palette-kind=text]').click();await canvas(page).locator('.section-text>.canvas-section-edit').click();
 await canvas(page).getByRole('textbox',{name:'Section text'}).fill('This page has its own context.');
 await page.getByLabel('Page',{exact:true}).selectOption(first);await expect(page.getByLabel('Image proportions')).toHaveValue('portrait');await expect(canvas(page).locator('.section-heading h1')).toHaveText('Pay attention. There is more to discover.');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await expect(page.getByLabel('Page',{exact:true})).toHaveValue(first);await expect(page.getByLabel('Image proportions')).toHaveValue('portrait');
 expect(errors).toEqual([]);
});


test('keyboard moves accumulate, nest, cancel without changing the draft, and keep focus in structure',async({page})=>{
 await page.getByRole('button',{name:'Add page',exact:true}).click();
 await task(page,'Add');await expect(page.locator('[data-palette-kind=container]')).toBeEnabled();await page.locator('[data-palette-kind=container]').click();
 for(const title of ['First','Second','Third']){
   await task(page,'Add');await page.locator('[data-palette-kind=heading]').click();await canvas(page).locator('.canvas-selected>.canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill(title);
   await task(page,'Page');const item=page.locator('#website-outline [data-element-drag]').last();await item.focus();await page.keyboard.press('ArrowLeft');
 }
 await task(page,'Page');
 const handle=page.locator('#website-outline [data-element-drag]').last();await handle.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('Escape');
 await expect(page.locator('#website-outline .section-select')).toHaveText(['Container','First','Second','Third']);
 await handle.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowUp');await page.keyboard.press('Space');
 await expect(page.locator('#website-outline .section-select')).toHaveText(['Container','Third','First','Second']);
 await page.keyboard.press('ArrowRight');await expect(canvas(page).locator('.section-container .section-heading h2')).toHaveText('Third');
 await page.keyboard.press('ArrowLeft');await expect(canvas(page).locator('.section-container .section-heading')).toHaveCount(0);
 await expect(page.locator('#website-outline [data-element-drag]').nth(1)).toBeFocused();expect(errors).toEqual([]);
});


test('touch inserts into the canvas and cancellation retains the document and draft',async({page})=>{
 await page.getByRole('button',{name:'Add page',exact:true}).click();await task(page,'Add');
 const from=page.locator('[data-palette-kind=container]'),to=canvas(page).locator('[data-drop-parent=""]');await expect(from).toBeEnabled();await from.scrollIntoViewIfNeeded();
 const cdp=await page.context().newCDPSession(page),a=await from.boundingBox(),b=await to.boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x+a.width/2,y:a.y+a.height/2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
 await expect(page.locator('.composer-drop-marker')).toBeVisible();await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(canvas(page).locator('.section-container')).toHaveCount(1);await canvas(page).locator('.section-container>.canvas-section-edit').click();await page.getByLabel('Container layout').selectOption('column');
 await expect(canvas(page).locator('.container-column')).toBeVisible();await expect(page.locator('#website-preview-status')).toHaveText('');
 await task(page,'Add');await page.locator('#website-draft-preview').evaluate(f=>f._retained=f.contentDocument);
 const h=await page.locator('[data-palette-kind=heading]').boundingBox(),c=await canvas(page).locator('.container-content>[data-drop-parent]').boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:h.x+h.width/2,y:h.y+h.height/2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:c.x+c.width/2,y:c.y+c.height/2}]});
 await expect(page.locator('.composer-drop-marker')).toBeVisible();await cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
 await expect(page.locator('.composer-drop-marker')).toBeHidden();await expect(canvas(page).locator('.section-heading')).toHaveCount(0);
 await page.getByLabel('Viewport',{exact:true}).selectOption('tablet');await page.getByLabel('Zoom',{exact:true}).selectOption('actual');
 expect(await page.locator('#website-draft-preview').evaluate(f=>f._retained===f.contentDocument)).toBe(true);
 await cdp.detach();expect(errors).toEqual([]);
});
