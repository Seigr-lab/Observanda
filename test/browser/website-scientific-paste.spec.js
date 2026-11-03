import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../../src/sample.js';
import {WebsiteFileStore} from '../../src/website-file-store.js';
import {clearVault} from '../../src/encryption.js';
import {testServer} from '../device-fixture.js';
import {encryptedFixture} from './encrypted-fixture.js';

test.use({screenshot:'off',trace:'off',video:'off'});
async function clipboardPaste(target,text,html=''){
 // Exercise the browser editor's clipboard handler without writing the host
 // user's system clipboard. Focus, selection and navigation use real keys.
 await target.evaluate((node,{text,html})=>{
  const clipboard=new DataTransfer();clipboard.setData('text/plain',text);if(html)clipboard.setData('text/html',html);
  node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));
 },{text,html});
}
test('scientists retain notation and paste instrument rows across saved pages beside a figure',async({page})=>{
 test.setTimeout(120000);page.setDefaultTimeout(15000);
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-science-paste-')),old=process.env.OBSERVANDA_DATABASE_URL;let fixture,app;
 try{
  const book=sampleNotebook();book.entries=[];fixture=await encryptedFixture(directory,book);
  const store=new WebsiteFileStore(fixture.workspace),id=randomUUID(),pageHTML=(title,content)=>'<!doctype html><html><head><title>'+title+'</title></head><body><main><h1>'+title+'</h1>'+content+'</main></body></html>';
  await store.importFiles(id,{name:'Estuary assays',files:new Map([
   ['index.html',pageHTML('Water chemistry','<p id="notation">Fe<sup>3+</sup> in H<sub>2</sub>O and <em>E. coli</em></p>')],
   ['results.html',pageHTML('Spectrophotometry','<p id="reporting">Notation: </p><p id="external">Source: </p><figure><img src="plate.png" alt="Specimen plate"><figcaption>Specimen plate A</figcaption></figure><table><caption>Absorption readings</caption><thead><tr><th scope="col">nm</th><th scope="col">Absorbance</th></tr></thead><tbody><tr><td>old</td><td></td></tr></tbody><tfoot><tr><th scope="row"><strong>Audited total</strong></th><td>Locked annotation</td></tr></tfoot></table>')],
   ['plate.png',await readFile(new URL('../../src/preview-assets/image.png',import.meta.url))],['style.css','']])});
  process.env.OBSERVANDA_DATABASE_URL='postgresql://unavailable:unavailable@127.0.0.1:1/unavailable';await expect(fixture.workspace.catalogue(db=>db.head())).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE'});
  app=await testServer({root:fixture.workspace.root,deviceStore:fixture.deviceStore,port:0,preferencesFile:path.join(directory,'preferences.json')});
  await page.goto(app.origin+'/?view=website#'+app.launchToken);await page.locator('[data-website-file-site]').selectOption(id);
  const canvas=page.frameLocator('#website-files-canvas'),source=canvas.locator('#notation');
  await source.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
  const copied=await source.evaluate(node=>{const selection=node.ownerDocument.getSelection(),div=node.ownerDocument.createElement('div');div.append(selection.getRangeAt(0).cloneContents());return {text:selection.toString(),html:div.innerHTML};});
  expect(copied.html).toMatch(/<sup>3\+<\/sup>/);
  await page.locator('[data-website-file-page]').selectOption('results.html');const report=canvas.locator('#reporting');
  await report.click();await page.keyboard.press('End');await clipboardPaste(report,copied.text,copied.html);await page.keyboard.type(' measured.');
  const external=canvas.locator('#external');await external.click();await page.keyboard.press('End');
  await clipboardPaste(external,'Reference 13','<!--StartFragment--><p><a href="https://doi.org/10.1234/assay" onclick="bad()">Reference</a> <span style="vertical-align:super;color:red" class="foreign">13</span><span hidden>clipboard-private-canary</span></p><!--EndFragment-->');
  await page.keyboard.type(' label.');
  const first=canvas.locator('tbody tr').first().locator('td').first();
  await first.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
  await clipboardPaste(first,'500.00\t1.2300e-5\t"west\tA"\r\n525.00\t−0.0010\teast');
  await expect(canvas.locator('tbody tr')).toHaveCount(2);
  await page.keyboard.press('Control+z');await expect(canvas.locator('tbody tr')).toHaveCount(1);await expect(canvas.locator('tbody td').first()).toHaveText('old');
  await expect.poll(()=>canvas.locator('tbody td').first().evaluate(cell=>cell.ownerDocument.getSelection().toString())).toBe('old');
  await page.keyboard.press('Control+Shift+z');await expect(canvas.locator('tbody tr')).toHaveCount(2);
  const footer=canvas.locator('tfoot th');await footer.click();await page.keyboard.press('End');await clipboardPaste(footer,'overwrite\tother');
  await expect(page.getByText('This grid would cross a header or footer, or replace formatted cell content. Choose plain cells in one table section.',{exact:true})).toBeVisible();
  const caption=canvas.locator('figcaption');await caption.click();await page.keyboard.press('End');await page.keyboard.type(' at 500 nm.');
  await page.getByRole('button',{name:'Save website',exact:true}).click();await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
  await page.locator('[data-website-file-page]').selectOption('index.html');await expect(canvas.locator('#notation sub')).toHaveText('2');
  await page.locator('[data-website-file-page]').selectOption('results.html');
  await page.getByRole('button',{name:'Preview saved website',exact:true}).click();const saved=page.frameLocator('#website-files-preview');
  await expect(saved.getByRole('img',{name:'Specimen plate'})).toBeVisible();
  expect(await saved.getByRole('img',{name:'Specimen plate'}).evaluate(async img=>{await img.decode();return img.naturalWidth;})).toBeGreaterThan(0);
  await expect(saved.locator('figcaption')).toHaveText('Specimen plate A at 500 nm.');
  // Check persisted DOM independently of what the inspector last displayed.
  expect((await saved.locator('#reporting').innerHTML()).replaceAll('&nbsp;',' ')).toMatch(/Fe<sup>3\+<\/sup> in H<sub>2<\/sub>O and <em>E\. coli<\/em> measured\./);
  await expect(saved.getByRole('link',{name:'Reference'})).toHaveAttribute('href','https://doi.org/10.1234/assay');await expect(saved.locator('sup').filter({hasText:'13'})).toHaveText('13');
  const actual=(await store.open(id,{path:'results.html'})).html;
  expect(actual).not.toMatch(/clipboard-private-canary|onclick=|class="foreign"|data-observanda-editor|contenteditable=/);
  expect(await saved.locator('tbody tr').evaluateAll(rows=>rows.map(row=>[...row.cells].map(c=>c.textContent)))).toEqual([['500.00','1.2300e-5','west\tA'],['525.00','−0.0010','east']]);
  await expect(saved.locator('caption')).toHaveText('Absorption readings');await expect(saved.locator('thead th[scope=col]')).toHaveCount(3);await expect(saved.locator('tfoot th strong')).toHaveText('Audited total');
 }finally{
  try{await app?.close();if(fixture)await clearVault(fixture.vault);}finally{if(old===undefined)delete process.env.OBSERVANDA_DATABASE_URL;else process.env.OBSERVANDA_DATABASE_URL=old;}
  if(path.dirname(directory)!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('observanda-science-paste-'))throw Error('Unexpected fixture');
  await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:120});
 }
});
