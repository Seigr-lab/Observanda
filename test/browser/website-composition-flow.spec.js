import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../../src/sample.js';
import {Workspace} from '../../src/storage.js';
import {startServer} from '../../src/server.js';
import {navigate} from './preferences-helper.js';
import {task,sectionTools} from './composer-helper.js';

let app,root,errors;
const canvas=page=>page.frameLocator('#website-draft-preview');
test.beforeEach(async({page})=>{
 root=await mkdtemp(path.join(os.tmpdir(),'observanda-compose-flow-'));errors=[];page.on('pageerror',e=>errors.push(e.message));
 const book=sampleNotebook();book.projects[0].description='Experiments, fieldwork, and creative practice.';book.website.footer='A collective of code, sound, and nature.';
 await new Workspace(root).create(book);app=await startServer({root,preferencesFile:path.join(root,'preferences.json'),port:0});
 await page.goto(app.url);await navigate(page,'Website editor');await expect(canvas(page).locator('main')).toBeVisible();
});
test.afterEach(async()=>{await app.close();await rm(root,{recursive:true,force:true});});

async function drag(page,kind){
 const from=page.locator(`[data-palette-kind="${kind}"]`),to=canvas(page).locator('[data-drop-parent=""]');
 await expect(from).toBeEnabled();await from.scrollIntoViewIfNeeded();const a=await from.boundingBox(),b=await to.boundingBox();
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:18});await expect(page.locator('.composer-drop-marker')).toBeVisible();await page.mouse.up();
}

test('Page keeps its palette during repeated insertion and selection; editing is explicit',async({page})=>{
 await page.setViewportSize({width:1600,height:1100});
 await page.getByRole('button',{name:'Add page',exact:true}).click();await page.getByLabel('Page title',{exact:true}).fill('Composition journey');await task(page,'Page');
 const pageTab=page.getByRole('navigation',{name:'Editing tools'}).getByRole('button',{name:'Page',exact:true});
 for(const kind of ['heading','text']){
  await drag(page,kind);await expect(canvas(page).locator('.section-'+kind)).toHaveCount(1);
  await expect(pageTab).toHaveAttribute('aria-current','page');await expect(page.locator('[data-palette-kind=heading]')).toBeVisible();
  await expect(canvas(page).locator('[contenteditable="true"],[contenteditable="plaintext-only"]')).toHaveCount(0);
 }
 await page.locator('[data-palette-kind=divider]').click();await expect(canvas(page).locator('[data-section-id]')).toHaveCount(3);
 await page.locator('#website-outline .section-select').first().click();await expect(pageTab).toHaveAttribute('aria-current','page');
 await canvas(page).locator('.section-heading h2').click();await expect(pageTab).toHaveAttribute('aria-current','page');
 await canvas(page).locator('.section-heading>.canvas-section-edit').click();await page.getByLabel('Section heading',{exact:true}).fill('The work begins');
 await expect(canvas(page).locator('.section-heading h2')).toHaveText('The work begins');
 await task(page,'Page');await expect(page.locator('[data-palette-kind=text]')).toBeVisible();
 const edit=page.locator('#website-outline [data-action=website-edit-section]').nth(1);await edit.focus();await page.keyboard.press('Enter');
 await canvas(page).getByRole('textbox',{name:'Section text',exact:true}).fill('A detailed account.');
 await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();
 await expect(canvas(page).locator('.section-text .prose')).toContainText('A detailed account.');
 await page.setViewportSize({width:390,height:844});await task(page,'Page');await page.locator('[data-palette-kind=callout]').click();
 await expect(pageTab).toHaveAttribute('aria-current','page');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 expect(errors).toEqual([]);
});

test('independent collection alignment and the final footer survive save, reload and public review',async({page,browser})=>{
 test.setTimeout(60000);
 await task(page,'Page');await page.locator('#website-outline [data-action=website-edit-section]').first().click();await sectionTools(page,'Layout');
 await page.getByLabel('Heading alignment',{exact:true}).selectOption('center');
 await page.getByLabel('Item heading alignment',{exact:true}).selectOption('end');
 await page.getByLabel('Body alignment',{exact:true}).selectOption('start');
 await page.getByLabel('Details alignment',{exact:true}).selectOption('center');
 const check=async frame=>{
  const section=frame.locator('.section-projects');
  await expect(section.locator(':scope>h2')).toHaveCSS('text-align','center');
  await expect(section.locator('.publication-card h2').first()).toHaveCSS('text-align','end');
  await expect(section.locator('.publication-card .prose').first()).toHaveCSS('text-align','start');
  await expect(section.locator('.publication-card .count').first()).toHaveCSS('text-align','center');
  const credit=frame.getByRole('link',{name:'Powered by Observanda',exact:true});await expect(credit).toHaveAttribute('href','https://github.com/Seigr-lab/Observanda');
  await expect(frame.locator('body>footer:last-child>.powered-by:last-child')).toHaveCSS('text-align','start');
  await expect(frame.locator('footer')).toContainText('A collective of code, sound, and nature.');
 };
 await check(canvas(page));await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('#save-status')).toHaveText('Saved');await page.reload();
 await check(canvas(page));await expect(page.getByLabel('Item heading alignment',{exact:true})).toHaveValue('end');
 // Emulate the CSS viewport and pixel ratio of 200% desktop zoom. This checks
 // responsive layout; it is not a claim about every browser's native zoom UI.
 const zoomContext=await browser.newContext({viewport:{width:720,height:500},deviceScaleFactor:2,storageState:await page.context().storageState()});
 const zoomed=await zoomContext.newPage();await zoomed.goto(page.url());await expect(zoomed.getByRole('button',{name:'Save website',exact:true})).toBeVisible();
 expect(await zoomed.evaluate(()=>innerWidth)).toBe(720);expect(await zoomed.evaluate(()=>devicePixelRatio)).toBe(2);
 expect(await zoomed.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await zoomed.getByRole('button',{name:'Save website',exact:true}).scrollIntoViewIfNeeded();await expect(zoomed.getByRole('button',{name:'Save website',exact:true})).toBeInViewport();
 await zoomed.screenshot({path:test.info().outputPath('editor-200-percent.png'),fullPage:true});
 await page.getByRole('button',{name:'Preview & export',exact:true}).click();await page.getByRole('button',{name:'Prepare selected edition',exact:true}).click();const review=page.frameLocator('iframe[title="Publication preview"]');await check(review);
 await expect(review.locator('.canvas-section-edit,[contenteditable]')).toHaveCount(0);
 await page.screenshot({path:test.info().outputPath('review-mixed-alignment.png'),fullPage:true});
 const href=await page.locator('#full-public-preview').getAttribute('href'),visitor=await page.context().newPage();await visitor.goto(new URL(href,app.url).href);
 await zoomed.goto(visitor.url());await check(zoomed);expect(await zoomed.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await zoomed.screenshot({path:test.info().outputPath('public-200-percent.png'),fullPage:true});await zoomContext.close();
 await visitor.setViewportSize({width:390,height:844});await check(visitor);expect(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await visitor.screenshot({path:test.info().outputPath('public-narrow.png'),fullPage:true});await visitor.close();expect(errors).toEqual([]);
});
