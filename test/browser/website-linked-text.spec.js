import {test,expect} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {sampleNotebook} from '../../src/sample.js';
import {clearVault} from '../../src/encryption.js';
import {encryptedFixture} from './encrypted-fixture.js';
import {testServer} from '../device-fixture.js';

// A section of cards, each card a link to another page of the site, as most sites have.
// The author changes a card's text in place, and Edit section shows what it does.
const html='<!doctype html><html lang="en"><head><title>Studio</title><link rel="stylesheet" href="style.css"></head><body><header><a href="index.html">Studio</a></header><main>'+
 '<h1>Studio</h1><p>Some things should not be reduced to a single purpose.</p>'+
 '<ul class="index"><li><a href="lab.html"><span class="label">01 / Research</span><h3>The lab</h3><p>Developing tools from the electrical foundation.</p></a></li>'+
 '<li><a href="reserve.html"><span class="label">02 / Nature</span><h3>The reserve</h3><p>A small living ecosystem.</p></a></li></ul></main></body></html>';
const css='body{margin:0;font:17px/1.5 Georgia,serif}main{padding:24px}.index{display:grid;grid-template-columns:repeat(auto-fit,minmax(16rem,1fr));gap:0;margin:2.5rem 0 0;padding:0;list-style:none;border-block-start:1px solid #111}.index>li{padding:1.5rem 1.5rem 2rem 0;border-block-end:1px solid #ccc}.index a{color:inherit;text-decoration:none}.index p{margin:.25rem 0 0}.label{font:11px monospace;text-transform:uppercase}';

test('the text inside a linked card is changed in place, and Edit section opens visible tools',async({page})=>{
 test.setTimeout(100000);page.setDefaultTimeout(12000);await page.setViewportSize({width:1904,height:960});
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-linked-text-'));let fixture,app;
 try{
  const book=sampleNotebook();book.entries=[];fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID();
  await store.importFiles(id,{name:'Studio',files:new Map([['index.html',html],['style.css',css],['lab.html','<!doctype html><html><head><title>Lab</title></head><body><h1>Lab page</h1></body></html>'],['reserve.html','<!doctype html><html><head><title>Reserve</title></head><body><h1>Reserve page</h1></body></html>']])});
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,preferencesFile:path.join(directory,'preferences.json'),port:0});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);
  const canvas=page.frameLocator('#website-files-canvas'),title=canvas.getByText('The lab',{exact:true});
  await expect(title).toBeVisible();
  await title.click();await page.keyboard.press('End');await page.keyboard.type(' and studio');
  // A click on the card's label or on its empty area stays on this page too: links are not followed while editing.
  await canvas.getByText('01 / Research',{exact:true}).click();const card=canvas.locator('.index li').first(),box=await card.boundingBox();await card.click({position:{x:20,y:box.height-8}});
  await page.waitForTimeout(800);
  // The page stays the one being edited, and the card's title changed.
  await expect(canvas.getByText('Lab page',{exact:true})).toHaveCount(0);
  await expect(canvas.locator('.index h3').first()).toHaveText('The lab and studio');
  // Edit section opens the section's texts as fields; typing in one changes the page.
  await canvas.getByRole('button',{name:'Edit section',exact:true}).click();
  const content=page.locator('#inspector-panel-content');await expect(content).toBeVisible();
  await expect(content.locator('.website-content-fields').getByLabel('Text',{exact:true}).first()).toBeFocused();await expect(content.locator('.website-content-fields').getByLabel('Text',{exact:true}).first()).toHaveValue('01 / Research');
  const field=content.locator('.website-content-fields').getByLabel('Paragraph',{exact:true}).first();
  await field.focus();await page.screenshot({path:test.info().outputPath('content-fields.png')});
  await field.fill('Developing instruments from the electrical foundation.');
  await expect(canvas.locator('.index p').first()).toHaveText('Developing instruments from the electrical foundation.');
  await expect(content.locator('.website-content-fields').getByLabel('Heading',{exact:true}).first()).toHaveValue('The lab and studio');
  // Following a link is deliberate: Ctrl+click opens the linked page once the change is saved.
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  expect((await store.open(id)).html).toContain('The lab and studio');expect((await store.open(id)).html).toContain('Developing instruments from the electrical foundation.');
  await canvas.getByText('The reserve',{exact:true}).click({modifiers:['Control']});
  await expect(canvas.getByText('Reserve page',{exact:true})).toBeVisible();
 }finally{await app?.close();if(fixture)await clearVault(fixture.vault);await rm(directory,{recursive:true,force:true});}
});
