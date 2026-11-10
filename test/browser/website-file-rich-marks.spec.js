import {test,expect} from '@playwright/test';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {WebsiteFilesCandidate} from '../../src/website-files-candidate.js';
import {contentBuffer} from '../../src/file-content.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('desktop formatting controls demonstrate their effect and save mixed text and chemical notation as portable HTML',async({page})=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'website-formatted-text-'));
 try{
  await mkdir(path.join(root,'.observanda'));
  const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});workspace.catalogue=()=>{throw Error('Research unavailable');};
  const store=new WebsiteFileStore(workspace);
  let opened=await store.create({name:'Chemical notation',html:'<!doctype html><html><head><title>Chemistry</title><link rel="stylesheet" href="style.css"></head><body><main><section><p id="water">H2O</p><p id="iron">Fe3+</p><p id="legend">Peak <strong>area</strong></p><p id="link"><a href="#water"><em id="term">solvent</em></a></p></section></main></body></html>'});
  await page.exposeFunction('filesAPI',async(route,data)=>{
   if(route.endsWith('/session'))return {workspaceId:workspace.vault.id,title:'Laboratory',sites:[opened.site],preparation:{state:'ready'}};
   if(route.endsWith('/open'))return store.open(opened.site.id,{path:data.path});
   if(route.endsWith('/save'))return opened=await store.save(opened.site.id,data);
   if(route.endsWith('/version'))return {revision:opened.site.revision};
   throw Error('Unexpected operation '+route);
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1600,height:1000});await mountFilesEditor(page);
  const frame=page.frameLocator('#website-files-canvas'),button=name=>page.locator('[data-visual-command="'+name+'"]');
  await expect.poll(async()=>errors[0]??(await frame.locator('#water').count()?'ready':'opening')).toBe('ready');
  await expect(frame.locator('#water')).toHaveText('H2O');
  await expect(button('bold').locator('strong')).toHaveCSS('font-weight','700');
  await expect(button('italic').locator('em')).toHaveCSS('font-style','italic');
  await expect(button('underline').locator('u')).toHaveCSS('text-decoration-line','underline');
  await expect(button('strikeThrough').locator('s')).toHaveCSS('text-decoration-line','line-through');
  await expect(button('subscript').locator('sub')).toHaveCSS('vertical-align','sub');
  await expect(button('superscript').locator('sup')).toHaveCSS('vertical-align','super');
  await expect(button('bold')).toHaveAttribute('aria-keyshortcuts','Control+B Meta+B');
  const select=async(id,start,count)=>{
   const p=frame.locator(id);await p.click({position:{x:3,y:5}});await page.keyboard.press('Home');
   for(let i=0;i<start;i++)await page.keyboard.press('ArrowRight');
   for(let i=0;i<count;i++)await page.keyboard.press('Shift+ArrowRight');
  };
  // Formatting controls are offered once the cursor is in the page.
  await expect(button('subscript')).toBeHidden();
  await select('#water',1,1);await expect(button('subscript')).toBeVisible();
  await expect(button('subscript')).toHaveAccessibleName('Subscript');
  await expect(button('superscript')).toHaveAccessibleName('Superscript');
  await button('subscript').focus();await page.keyboard.press('Enter');
  await expect(frame.locator('#water sub')).toHaveText('2');await expect(button('subscript')).toHaveAttribute('aria-pressed','true');
  await select('#iron',2,2);await button('superscript').click();await expect(frame.locator('#iron sup')).toHaveText('3+');
  await select('#legend',0,9);await expect(button('bold')).toHaveAttribute('aria-pressed','mixed');
  await page.keyboard.press('Control+b');await expect(button('bold')).toHaveAttribute('aria-pressed','true');
  await button('italic').click();await button('underline').click();await button('strikeThrough').click();
  await expect(frame.locator('#legend s').first()).toHaveCSS('text-decoration-line','line-through');
  await select('#link',1,4);await button('highlight').click();await button('inlineCode').click();
  await expect(frame.locator('#link mark code')).toHaveText('olve');
  await select('#link',2,2);await button('clearFormatting').click();
  await expect(frame.locator('#link a')).toHaveAttribute('href','#water');await expect(frame.locator('#term')).toHaveCount(1);
  const untreated=await frame.locator('#link').evaluate(node=>{
    const walker=node.ownerDocument.createTreeWalker(node,4);let text='';
    for(let item=walker.nextNode();item;item=walker.nextNode())if(!item.parentElement.closest('em,i,mark,code'))text+=item.data;
    return text;
  });expect(untreated).toBe('lv');
  await page.locator('[data-action="website-files-save"]').click();
  await expect.poll(()=>opened.html.includes('<sub>2</sub>')).toBe(true);
  await page.reload();await expect(frame.locator('#iron sup')).toHaveCSS('vertical-align','super');
  const candidate=await WebsiteFilesCandidate.open(store,opened.site.id,opened.site.revision);await candidate.verify();
  const html=(await contentBuffer(candidate.files.get('index.html'),{maxBytes:65536})).toString();
  expect(html).not.toMatch(/contenteditable|data-observanda-editor/);
  await page.context().route('https://published.test/index.html',route=>route.fulfill({contentType:'text/html',body:html}));
  const css=await contentBuffer(candidate.files.get('style.css'),{maxBytes:65536});
  await page.context().route('https://published.test/style.css',route=>route.fulfill({contentType:'text/css',body:css}));
  await page.goto('https://published.test/index.html');
  await expect(page.locator('#water')).toHaveText('H2O');await expect(page.locator('#water sub')).toHaveCSS('vertical-align','sub');
  await expect(page.locator('#iron')).toHaveText('Fe3+');await expect(page.locator('#iron sup')).toHaveCSS('vertical-align','super');
  await expect(page.locator('#legend strong').first()).toHaveCSS('font-weight','700');
  await expect(page.locator('#legend em').first()).toHaveCSS('font-style','italic');
  await expect(page.locator('#legend u').first()).toHaveCSS('text-decoration-line','underline');
  await expect(page.locator('#legend s').first()).toHaveCSS('text-decoration-line','line-through');
  await expect(page.locator('#link code').first()).toHaveCSS('font-family',/mono/);
  await expect(page.locator('#link mark').first()).toHaveCSS('background-color','rgb(255, 255, 0)');
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:6,retryDelay:100});}
});
