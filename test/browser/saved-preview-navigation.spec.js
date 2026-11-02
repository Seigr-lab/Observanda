import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('a preview menu tracks a click while page images are still loading',async({page})=>{
 const origin='http://127.0.0.1:48218',navigation=await readFile(new URL('../../src/web/website-files-navigation.js',import.meta.url),'utf8');
 const stalled=Promise.withResolvers();
 await page.route(origin+'/**',async route=>{
  switch(new URL(route.request().url()).pathname){
   case '/':return route.fulfill({contentType:'text/html',body:'<iframe sandbox="allow-same-origin" title="Preview"></iframe><output></output>'});
   case '/navigation.js':return route.fulfill({contentType:'text/javascript',body:navigation});
   case '/site/home.html':return route.fulfill({contentType:'text/html',body:'<a href="notes.html">Field notes</a><img src="slow.png" alt="">'});
   case '/site/slow.png':await stalled.promise;return route.abort();
   default:throw Error('Unexpected navigation: '+route.request().url());
  }
 });
 try{
  await page.goto(origin);
  await page.evaluate(async()=>{
   const {openSavedPreview,bindSavedLinks}=await import('/navigation.js'),url=new URL('/site/home.html',location),directory=new URL('./',url);
   openSavedPreview(document.querySelector('iframe'),url.href,doc=>bindSavedLinks(doc,{
    url,directory,pages:[{path:'home.html'},{path:'notes.html'}],
    navigate:page=>{document.querySelector('output').textContent=page.path;},unavailable:()=>{}
   }));
  });
  const link=page.frameLocator('iframe').getByRole('link',{name:'Field notes'});
  await link.click();
  await expect(page.locator('output')).toHaveText('notes.html');
  expect(await link.evaluate(node=>node.ownerDocument.readyState)).toBe('interactive');
 }finally{stalled.resolve();}
});
