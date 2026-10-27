import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../../src/server.js';
import {Workspace} from '../../src/storage.js';
import {sampleNotebook} from '../../src/sample.js';
import {navigate,preferences} from './preferences-helper.js';
let app,root;
import {editorTab as tab,typeTools} from './composer-helper.js';
const iframe=page=>page.locator('#website-draft-preview');
const frame=page=>page.frameLocator('#website-draft-preview');
const height=page=>iframe(page).evaluate(el=>el.offsetHeight);
const noInnerScroll=async locator=>{
 await expect.poll(()=>locator.evaluate(el=>{
   const d=el.contentDocument;return d?.querySelector('main')?Math.max(0,d.documentElement.scrollHeight-el.contentWindow.innerHeight):999;
 })).toBeLessThanOrEqual(1);
};
const noPanels=async page=>expect(await page.evaluate(()=>[...document.querySelectorAll('.website-controls,.website-canvas,.website-preview-panel,.dashboard-panel,.dashboard-panel>div,#main-navigation,.workspace-tree')].filter(el=>el.getClientRects().length&&el.scrollHeight>el.clientHeight+1&&/auto|scroll/.test(getComputedStyle(el).overflowY)).map(el=>el.className))).toEqual([]);
test.beforeEach(async({page})=>{
 root=await mkdtemp(path.join(os.tmpdir(),'observanda-scroll-'));const book=sampleNotebook();
 book.title='Field studies';book.website.home.sections=[{id:randomUUID(),kind:'text',title:'Notes from the river',show:true,body:Array.from({length:9},(_,i)=>`Observation ${i+1}. The river changed after the rain. We recorded water levels, photographed the bank and compared notes from the same location.`).join('\n\n')},{id:randomUUID(),kind:'text',title:'Follow-up work',show:true,body:'Return after the next rainfall and compare the measurements.'}];
 book.entries=Array.from({length:12},(_,i)=>({...book.entries[0],id:randomUUID(),title:`River observation ${i+1}`,body:'A record of conditions along the river bank.',figures:[]}));
 await new Workspace(root).create(book);app=await startServer({root,preferencesFile:path.join(root,'preferences.json'),port:0});await page.goto(app.url);await mkdir('.local/screenshots',{recursive:true});
});
test.afterEach(async()=>{await app?.close();app=null;});

test('long composer uses one scroll over controls and preview; typography grows and shrinks the whole page',async({page})=>{
 await page.setViewportSize({width:1834,height:900});await navigate(page,'Website editor');await tab(page,'Typography');await typeTools(page,'Size');
 await expect(frame(page).getByRole('heading',{name:'Follow-up work',exact:true})).toBeVisible();await noInnerScroll(iframe(page));await noPanels(page);
 const original=await height(page);await page.getByLabel('Body text size (px)',{exact:true}).fill('39');await expect(frame(page).locator('body')).toHaveCSS('font-size','39px');await expect.poll(()=>height(page)).toBeGreaterThan(original*1.4);await noInnerScroll(iframe(page));
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.local/screenshots/unified-type-large.png'});
 for(const x of [500,1200]){
   await page.evaluate(()=>scrollTo(0,0));await page.mouse.move(x,650);await page.mouse.wheel(0,420);await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(250);
   expect(await iframe(page).evaluate(el=>el.contentWindow.scrollY)).toBe(0);
 }
 await page.screenshot({path:'.local/screenshots/unified-type-scrolled.png'});
 await page.getByLabel('Body text size (px)',{exact:true}).fill('18');await expect(frame(page).locator('body')).toHaveCSS('font-size','18px');await expect.poll(()=>height(page)).toBeLessThan(original*1.2);await noInnerScroll(iframe(page));
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();await noInnerScroll(iframe(page));
 await page.getByRole('button',{name:'Save website',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'.local/screenshots/unified-composer-bottom.png'});
 await page.getByRole('button',{name:'Full screen',exact:true}).click();await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);await noInnerScroll(iframe(page));await noPanels(page);await page.getByRole('button',{name:'Exit full screen',exact:true}).click();
});

test('live text and viewport changes resize the preview without losing the editor or trapping phone scrolling',async({page})=>{
 await navigate(page,'Website editor');await tab(page,'Homepage');await page.locator('#website-outline [data-action=website-edit-section]').last().click();
 const editor=frame(page).getByRole('textbox',{name:'Section text',exact:true});await expect(editor).toBeVisible();const short=await height(page);
 await editor.fill(Array.from({length:18},(_,i)=>`Trial ${i+1}: recording the process and its outcome.`).join('\n'));await expect.poll(()=>height(page)).toBeGreaterThan(short+200);await noInnerScroll(iframe(page));
 await editor.press('ControlOrMeta+End');await editor.press('Enter');await editor.pressSequentially('The caret remains visible as the document grows.');
 await expect.poll(()=>page.evaluate(()=>{const f=document.querySelector('#website-draft-preview'),d=f.contentDocument,s=d.getSelection();if(!s.rangeCount)return false;const r=s.getRangeAt(0).getBoundingClientRect(),box=f.getBoundingClientRect(),scale=box.width/f.offsetWidth,tools=document.querySelector('.website-preview-tools').getBoundingClientRect();return box.top+r.bottom*scale<=innerHeight&&box.top+r.top*scale>=tools.bottom;})).toBe(true);
 await editor.fill('One follow-up observation.');await expect.poll(()=>height(page)).toBeLessThan(short+100);await noInnerScroll(iframe(page));
 await page.getByLabel('Viewport',{exact:true}).selectOption('phone');await noInnerScroll(iframe(page));await page.getByLabel('Viewport',{exact:true}).selectOption('canvas');await noInnerScroll(iframe(page));
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='24px');await noInnerScroll(iframe(page));await noPanels(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.local/screenshots/unified-mobile-controls.png'});
 await editor.scrollIntoViewIfNeeded();await page.screenshot({path:'.local/screenshots/unified-mobile-text.png'});
});

test('dashboard cards show their selected page, and appearance and publication previews expand too',async({page})=>{
 await navigate(page,'Dashboard');await page.getByRole('button',{name:'Settings for Recent records',exact:true}).click();const panel=page.locator('.desk-inspector');await panel.getByLabel('Items per page',{exact:true}).fill('12');await expect(panel.getByLabel('Items per page',{exact:true})).toHaveValue('12');await expect.poll(async()=>{const result=await page.request.get(app.origin+'/api/dashboard');return (await result.json()).settings.views[0].panels[0].count;}).toBe(12);await panel.getByRole('button',{name:'Close card settings',exact:true}).click();
 const recent=page.locator('.desk-card').filter({has:page.getByRole('heading',{name:'Recent records',exact:true})});await expect(recent.locator('.desk-item')).toHaveCount(12);await noPanels(page);await recent.getByRole('button',{name:/River observation 12/}).scrollIntoViewIfNeeded();await page.screenshot({path:'.local/screenshots/unified-dashboard.png'});
 await preferences(page,'Appearance');await noInnerScroll(page.locator('#design-preview'));await noPanels(page);
 await navigate(page,'Website editor');await tab(page,'Layout');await page.getByLabel('Site navigation',{exact:true}).selectOption('side');await noInnerScroll(iframe(page));
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.getByRole('button',{name:'Prepare edition',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();await noInnerScroll(page.locator('iframe[title="Publication preview"]'));const previewBox=await page.locator('iframe[title="Publication preview"]').boundingBox(),navigationBox=await page.frameLocator('iframe[title="Publication preview"]').locator('.site-name').boundingBox();expect(navigationBox.y-previewBox.y).toBeLessThan(100);await page.screenshot({path:'.local/screenshots/unified-review.png'});
});

test('dragging a canvas section near the screen edge scrolls the document and can be cancelled',async({page})=>{
 await navigate(page,'Website editor');await tab(page,'Homepage');const handle=frame(page).getByRole('button',{name:'Move canvas section 1',exact:true});await handle.scrollIntoViewIfNeeded();await handle.hover();const box=await handle.boundingBox();const initial=await page.evaluate(()=>scrollY);
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2,980,{steps:6});
 await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(initial+100);await page.keyboard.press('Escape');await page.mouse.up();await noInnerScroll(iframe(page));
 await expect(page.locator('#website-outline .section-select').first()).toHaveText('Notes from the river');
});
