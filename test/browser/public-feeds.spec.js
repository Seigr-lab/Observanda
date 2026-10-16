import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {buildPublication} from '../../src/publication.js';
import {sampleNotebook} from '../../src/sample.js';
import {upgradeNotebook} from '../../src/model.js';
import {defaultFeed} from '../../src/web/website-feed-model.js';

async function fixture(count=73,{feeds=1}={}){
 const book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'Observation '+String(i).padStart(3,'0'),body:'Shared results '+i,share:true,tags:[i%3?'field':'control'],type:i%2?'run':'protocol',occurredOn:'2026-10-'+String(i%28+1).padStart(2,'0'),sections:[],figures:[],attachments:[],relations:[]}));
 book.website.home.sections=Array.from({length:feeds},(_,i)=>({id:'records'+i,kind:'records',title:'Observations '+i,show:true,layout:'grid',feed:{...defaultFeed('records'),pageSize:10+i,visitorFilters:true,visitorOrder:true,visitorView:true}}));
 const candidate=buildPublication(book),requests=[],server=createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname.replace(/^\/nested\/site\//,'');requests.push(name);const content=candidate.files.get(name);
  if(content===undefined){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'application/octet-stream'});res.end(content);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {book,candidate,requests,url:'http://127.0.0.1:'+server.address().port+'/nested/site/index.html',close:()=>new Promise(resolve=>server.close(resolve))};
}

test('visitors page, reverse, filter and change a long feed without loading or hiding the complete feed DOM',async({page})=>{
 const f=await fixture(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(f.url);const feed=page.locator('[data-public-feed]'),items=feed.locator('[data-feed-item]');
  await expect(items).toHaveCount(10);await expect(feed.getByRole('combobox',{name:'Order',exact:true})).toBeVisible();
  const initial=await items.evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId));
  expect(f.requests.filter(name=>name.startsWith('feed-'))).toHaveLength(0);
  await feed.getByRole('link',{name:'Next entries',exact:true}).click();await expect(items).toHaveCount(10);
  await expect.poll(()=>items.evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId))).not.toEqual(initial);
  await feed.getByRole('link',{name:'Previous entries',exact:true}).click();await expect.poll(()=>items.evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId))).toEqual(initial);
  await feed.getByLabel('Order',{exact:true}).selectOption('oldest');await expect(items).toHaveCount(10);await expect(feed).toHaveAttribute('aria-busy','false');
  const oldest=await items.evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId));expect(oldest).not.toEqual(initial);
  await feed.getByLabel('Tag',{exact:true}).fill('control');await feed.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(feed).toHaveAttribute('aria-busy','false');
  expect(await items.evaluateAll(nodes=>nodes.every(node=>JSON.parse(node.dataset.feedTags).includes('control')))).toBe(true);
  await feed.getByLabel('Search this feed',{exact:true}).fill('Observation 072');await feed.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(items).toHaveCount(1);await expect(items).toContainText('Observation 072');
  await feed.getByLabel('Display',{exact:true}).selectOption('list');await expect(feed).toHaveAttribute('data-feed-view','list');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='20px');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('feed-filters-phone.png')});
  await feed.getByRole('button',{name:'Clear filters',exact:true}).click();await expect(items).toHaveCount(10);await expect.poll(()=>items.evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId))).toEqual(initial);
  expect(errors).toEqual([]);
 }finally{await f.close();}
});

test('feed next and previous links preserve all entries and the website design without JavaScript',async({browser})=>{
 const f=await fixture(23),context=await browser.newContext({javaScriptEnabled:false}),page=await context.newPage();page.setDefaultTimeout(5000);
 try{
  await page.goto(f.url);const feed=page.locator('[data-public-feed]');await expect(feed.locator('[data-feed-item]')).toHaveCount(10);await expect(feed.locator('[data-feed-controls]')).toBeHidden();
  const first=await feed.locator('[data-feed-item]').first().getAttribute('data-feed-id');
  await feed.getByRole('link',{name:'Next entries',exact:true}).click();await expect(page).toHaveURL(/-1\.html#/);await expect(feed.locator('[data-feed-item]')).toHaveCount(10);await expect(page.locator('.site-footer')).toContainText('Powered by Observanda');
  await page.waitForLoadState('load');await feed.getByRole('link',{name:'Next entries',exact:true}).press('Enter');await expect(page).toHaveURL(/-2\.html#/);await expect(feed.locator('[data-feed-item]')).toHaveCount(3);await expect(feed.getByRole('link',{name:'Next entries',exact:true})).toBeHidden();
  await page.waitForLoadState('load');await feed.getByRole('link',{name:'Previous entries',exact:true}).press('Enter');await expect(page).toHaveURL(/-1\.html#/);await page.waitForLoadState('load');await feed.getByRole('link',{name:'Previous entries',exact:true}).press('Enter');await expect(page).toHaveURL(/-0\.html#/);await expect(feed.locator('[data-feed-item]').first()).toHaveAttribute('data-feed-id',first);
 }finally{await context.close();await f.close();}
});

test('ten feeds on one website page retain their own visible counts and visitor state',async({page})=>{
 const f=await fixture(73,{feeds:10});
 try{
  await page.goto(f.url);const feeds=page.locator('[data-public-feed]');await expect(feeds).toHaveCount(10);
  const rows=i=>feeds.nth(i).locator('[data-feed-item]'),ids=i=>rows(i).evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId));
  const initial=[];for(let i=0;i<10;i++){await expect(rows(i)).toHaveCount(10+i);initial.push(await ids(i));}
  await feeds.nth(3).getByLabel('Order',{exact:true}).selectOption('oldest');await expect(feeds.nth(3)).toHaveAttribute('aria-busy','false');
  await feeds.nth(3).getByLabel('Display',{exact:true}).selectOption('list');
  await feeds.nth(7).getByRole('link',{name:'Next entries',exact:true}).click();await expect.poll(()=>ids(7)).not.toEqual(initial[7]);await expect(rows(7)).toHaveCount(17);
  await feeds.nth(0).getByLabel('Search this feed',{exact:true}).fill('Observation 072');await feeds.nth(0).getByRole('button',{name:'Apply filters',exact:true}).click();await expect(rows(0)).toHaveCount(1);
  for(const i of [1,2,4,5,6,8,9])expect(await ids(i)).toEqual(initial[i]);
  await expect(feeds.nth(3).getByLabel('Order',{exact:true})).toHaveValue('oldest');await expect(feeds.nth(3)).toHaveAttribute('data-feed-view','list');await expect(rows(3)).toHaveCount(13);
  await feeds.nth(7).getByRole('link',{name:'Previous entries',exact:true}).click();await expect.poll(()=>ids(7)).toEqual(initial[7]);await expect(rows(0)).toHaveCount(1);
  const retained=[];for(let i=0;i<10;i++)retained.push(await ids(i));
  await page.reload();for(let i=0;i<10;i++)await expect.poll(()=>ids(i)).toEqual(retained[i]);
  await expect(feeds.nth(3).getByLabel('Order',{exact:true})).toHaveValue('oldest');await expect(feeds.nth(3)).toHaveAttribute('data-feed-view','list');
  await feeds.nth(1).getByRole('link',{name:'Next entries',exact:true}).click();await expect.poll(()=>ids(1)).not.toEqual(initial[1]);
  await page.goBack();await expect.poll(()=>ids(1)).toEqual(initial[1]);await expect(rows(0)).toHaveCount(1);
 }finally{await f.close();}
});

test('a failed or cancelled feed request preserves its current results and other feeds',async({page})=>{
 const f=await fixture(73,{feeds:2});
 try{
  await page.goto(f.url);const feeds=page.locator('[data-public-feed]'),feed=feeds.first(),items=feed.locator('[data-feed-item]');
  const ids=()=>items.evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId)),initial=await ids();
  const other=await feeds.nth(1).locator('[data-feed-item]').evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId));
  await page.route('**/feed-*.html',route=>route.fulfill({status:503,body:'Temporarily unavailable'}));
  await feed.getByLabel('Order',{exact:true}).selectOption('oldest');await expect(feed.getByRole('button',{name:'Retry',exact:true})).toBeVisible();expect(await ids()).toEqual(initial);
  await page.unroute('**/feed-*.html');await feed.getByRole('button',{name:'Retry',exact:true}).click();await expect(feed).toHaveAttribute('aria-busy','false');await expect.poll(ids).not.toEqual(initial);
  const restored=await ids();await page.route('**/feed-*.html',async route=>{await new Promise(resolve=>setTimeout(resolve,400));await route.abort().catch(()=>{});});
  await feed.getByLabel('Search this feed',{exact:true}).fill('absent');await feed.getByRole('button',{name:'Apply filters',exact:true}).click();await expect(feed).toHaveAttribute('aria-busy','true');await feed.getByRole('button',{name:'Cancel loading',exact:true}).click();
  await expect(feed).toHaveAttribute('aria-busy','false');expect(await ids()).toEqual(restored);await expect(feed.getByLabel('Search this feed',{exact:true})).toHaveValue('');
  expect(await feeds.nth(1).locator('[data-feed-item]').evaluateAll(nodes=>nodes.map(node=>node.dataset.feedId))).toEqual(other);
 }finally{await f.close();}
});
