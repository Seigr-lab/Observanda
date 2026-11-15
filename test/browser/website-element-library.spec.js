import {test,expect} from '@playwright/test';
import {EventEmitter} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../../src/storage.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {websiteFilesHttp} from '../../src/website-files-http.js';
import {closeIdleMutationFiles} from '../../src/mutation-files.js';
import {mountFilesEditor} from './mount-files-editor.js';

test('authors find elements by plain words, click to add after the selection and drag to an exact spot',async({page})=>{
 test.setTimeout(40000);page.setDefaultTimeout(8000);
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-element-library-'));
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)}),store=new WebsiteFileStore(workspace),id=randomUUID();
 try{
  await mkdir(path.join(root,'.observanda'));
  await store.importFiles(id,{name:'Field notes',files:new Map([['style.css','body{font:18px sans-serif;padding:1rem} section,p{padding:1rem}'],['index.html','<html lang="en"><head><title>Field notes</title><link rel="stylesheet" href="style.css"></head><body><main><h1>Field notes</h1><p>First observation</p><p>Second observation</p></main></body></html>']])});
  await page.exposeFunction('filesAPI',async(route,data)=>{
   let value;await websiteFilesHttp({method:'POST',headers:{}},new EventEmitter(),{workspace,url:new URL(route,'https://website.test'),body:async()=>data??{},json:r=>{value=r;},check:async()=>{},title:'Field notes',preparation:async()=>({state:'ready',defaultSiteId:id})});return value;
  });
  await page.setViewportSize({width:1440,height:950});await mountFilesEditor(page);
  const canvas=page.frameLocator('#website-files-canvas'),library=page.getByRole('region',{name:'Add to page',exact:true});
  await expect(canvas.getByRole('heading',{name:'Field notes'})).toBeVisible();
  // Every element is a card with a plain description, grouped by purpose.
  await expect(library.getByRole('heading',{name:'From your lab books',exact:true})).toBeVisible();
  await expect(library.getByRole('button',{name:/^Accordion A title that opens to show more text\./})).toBeVisible();
  // Search matches names and descriptions.
  await library.getByLabel('Find an element',{exact:true}).fill('content side by side');
  await expect(library.locator('.element-card:not([hidden])')).toHaveCount(1);await expect(library.locator('.element-card:not([hidden])')).toHaveAttribute('data-block','columns');
  await library.getByLabel('Find an element',{exact:true}).fill('no such thing');await expect(library.getByText('No element matches.',{exact:true})).toBeVisible();
  await library.getByLabel('Find an element',{exact:true}).fill('');
  // Click adds after the selected part.
  await canvas.getByText('First observation',{exact:true}).click();
  await library.locator('.element-card[data-block="divider"]').click();
  await expect(canvas.locator('main > *')).toHaveCount(4);await expect(canvas.locator('main > :nth-child(3)')).toHaveJSProperty('localName','hr');
  // Drag places the element before the part it is dropped on (upper half).
  await library.locator('.element-card[data-block="quote"]').dragTo(canvas.getByText('Second observation',{exact:true}),{targetPosition:{x:10,y:2}});
  await expect(canvas.locator('main > *')).toHaveCount(5);
  expect(await canvas.locator('main > *').evaluateAll(nodes=>nodes.map(node=>node.localName))).toEqual(['h1','p','hr','blockquote','p']);
  // A ready-made section arrives with its own styles in the site stylesheet.
  await expect(library.getByRole('heading',{name:'Ready-made sections',exact:true})).toBeVisible();
  await canvas.getByText('Second observation',{exact:true}).click();await library.getByRole('button',{name:/^Numbered steps A method or procedure/}).click();
  await expect(canvas.locator('main > section.ow-steps li')).toHaveCount(3);await expect(canvas.locator('main > section.ow-steps li').first()).toHaveCSS('display','grid');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  const saved=await store.open(id);expect(saved.html).toMatch(/<hr[^>]*>[\s\S]*<blockquote[^>]*>[\s\S]*Second observation[\s\S]*class="ow-steps"/);expect(saved.css).toContain('.ow-steps li');
 }finally{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
