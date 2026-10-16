import {test,expect} from '@playwright/test';
import {indexedBook} from '../publication-index-fixture.js';
import {buildPublication,verifyPublication} from '../../src/publication.js';
import {publicIndexPage} from '../../src/web/public-browse-pages.js';
import {contentBuffer} from '../../src/file-content.js';

async function fixture(browser,{javascript=true}={}){
 const book=indexedBook(),output=buildPublication(book);verifyPublication(output);const context=await browser.newContext({javaScriptEnabled:javascript}),requests=[],policy={mode:'normal'};
 await context.route('https://edition.invalid/nested/site/**',async route=>{
  const key=new URL(route.request().url()).pathname.slice('/nested/site/'.length),index=publicIndexPage(key);let value=output.files.get(key);requests.push(key);
  if(index>0&&policy.mode==='fail')return route.fulfill({status:503,body:'Unavailable'});
  if(index>0&&policy.mode==='stale')value=value.replace(/(&quot;identity&quot;:&quot;)[a-f0-9]{64}/,'$1'+'f'.repeat(64));
  if(index>0&&policy.mode==='slow')await new Promise(resolve=>setTimeout(resolve,500));
  await route.fulfill({status:value===undefined?404:200,contentType:key.endsWith('.html')?'text/html':key.endsWith('.css')?'text/css':key.endsWith('.js')?'text/javascript':'application/octet-stream',body:value===undefined?'Missing':typeof value==='string'?value:await contentBuffer(value)});
 });
 return {context,requests,policy,book,page:await context.newPage()};
}

test('a long public index filters and pages across the full selection, retains return state and supports no-script navigation',async({browser},info)=>{
 const f=await fixture(browser),{page}=f,errors=[];page.on('pageerror',e=>errors.push(e.message));
 const rows=page.locator('[data-public-record]'),next=page.locator('[data-index-next]'),previous=page.locator('[data-index-previous]'),wait=()=>expect(page.locator('[data-book-records]')).toHaveAttribute('aria-busy','false');
 try{
  await page.goto('https://edition.invalid/nested/site/browse.html');await expect(rows).toHaveCount(24);expect(f.requests.filter(p=>publicIndexPage(p)!==null)).toHaveLength(1);
  await next.click();await wait();await expect(rows.first()).toContainText('Reading 0024');await previous.click();await wait();await expect(rows.first()).toContainText('Reading 0000');
  await page.getByLabel('Tag',{exact:true}).fill('needle');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await wait();await expect(rows).toHaveCount(24);await expect(rows.last()).toContainText('Reading 0299');expect(f.requests.filter(p=>publicIndexPage(p)!==null).length).toBeLessThan(20);
  await next.click();await wait();await expect(rows).toHaveCount(23);await expect(rows.first()).toContainText('Reading 0312');await expect(rows.last()).toContainText('Reading 0598');await expect(next).toBeHidden();
  const earlier=await previous.getAttribute('href');await page.reload();await wait();await expect(rows.first()).toContainText('Reading 0312');await page.goto(new URL(earlier,page.url()).href);await wait();await expect(rows).toHaveCount(24);await expect(rows.last()).toContainText('Reading 0299');await next.click();await wait();
  await rows.first().getByRole('link').click();await expect(page.locator('[data-book-next]')).toContainText('Reading 0325');await page.locator('[data-book-next]').click();await expect(page.locator('h1')).toHaveText('Reading 0325');await page.locator('[data-book-back]').click();await wait();await expect(rows).toHaveCount(23);await expect(page.getByLabel('Tag',{exact:true})).toHaveValue('needle');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();await wait();await expect(rows).toHaveCount(24);expect(new URL(page.url()).search).toBe('');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('continued-index-phone.png')});expect(errors).toEqual([]);
 }finally{await f.context.close();}
 const nojs=await fixture(browser,{javascript:false});try{
  await nojs.page.goto('https://edition.invalid/nested/site/browse.html');const ids=[];
  for(;;){await expect(nojs.page.locator('[data-book-browse]')).toBeHidden();const values=await nojs.page.locator('[data-public-record]').evaluateAll(rows=>rows.map(r=>r.dataset.publicRecord));expect(values.length).toBeLessThanOrEqual(24);ids.push(...values);if(await nojs.page.locator('[data-index-next]').isHidden())break;await nojs.page.locator('[data-index-next]').click();}
  expect(ids).toHaveLength(601);expect(new Set(ids).size).toBe(601);
 }finally{await nojs.context.close();}
});

test('failed, changed and cancelled index pages preserve the displayed records and allow retry',async({browser})=>{
 const f=await fixture(browser),{page}=f,rows=page.locator('[data-public-record]'),next=page.locator('[data-index-next]');
 try{
  await page.goto('https://edition.invalid/nested/site/browse.html');f.policy.mode='fail';await next.click();await expect(page.getByRole('button',{name:'Retry index loading'})).toBeVisible();await expect(rows.first()).toContainText('Reading 0000');
  f.policy.mode='normal';await page.getByRole('button',{name:'Retry index loading'}).click();await expect(rows.first()).toContainText('Reading 0024');
  f.policy.mode='stale';await next.click();await expect(page.getByRole('button',{name:'Retry index loading'})).toBeVisible();await expect(rows.first()).toContainText('Reading 0024');
  f.policy.mode='slow';await page.getByRole('button',{name:'Retry index loading'}).click();await page.locator('[data-index-cancel]').click();await page.waitForTimeout(650);await expect(rows.first()).toContainText('Reading 0024');await expect(page.getByRole('button',{name:'Retry index loading'})).toBeHidden();
  f.policy.mode='normal';await next.click();await expect(rows.first()).toContainText('Reading 0048');await expect(rows).toHaveCount(24);
  await page.getByLabel('From date').fill('2026-10-10');await page.getByLabel('Through date').fill('2026-10-01');await expect(page.locator('[data-filter-error]')).toBeVisible();await expect(rows.first()).toContainText('Reading 0048');
 }finally{await f.context.close();}
});
