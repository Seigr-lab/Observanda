import {test,expect} from '@playwright/test';
import {indexedBook} from '../publication-index-fixture.js';
import {buildPublication,verifyPublication} from '../../src/publication.js';
import {collectionPagePath} from '../../src/web/public-collection-pages.js';

for(const scripts of [true,false])test('published collections preserve design, continuation and return navigation '+(scripts?'with scripts':'without scripts'),async({browser},info)=>{
 const book=indexedBook(53),output=buildPublication(book);verifyPublication(output);
 const context=await browser.newContext({javaScriptEnabled:scripts}),page=await context.newPage();page.setDefaultTimeout(5000);page.setDefaultNavigationTimeout(5000);
 await context.route('https://edition.invalid/nested/site/**',route=>{
  const name=new URL(route.request().url()).pathname.slice('/nested/site/'.length),value=output.files.get(name);
  return route.fulfill({status:value===undefined?404:200,contentType:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'application/octet-stream',body:value??'Missing'});
 });
 try{
  for(const target of ['project:'+book.projects[0].id,'notebook:'+book.notebooks[0].id]){
   await page.goto('https://edition.invalid/nested/site/'+collectionPagePath(target,0));
   const rows=page.locator('main .publication-card'),nav=page.locator('[data-record-collection="body"]'),ids=[];
   for(let part=0;part<3;part++){
    await expect(rows).toHaveCount(part===2?5:24);ids.push(...await rows.evaluateAll(nodes=>nodes.map(n=>n.dataset.recordId)));
    await expect(page.locator('.site-footer')).toContainText('Powered by Observanda');
    await expect(page.locator('body')).toHaveAttribute('data-page',target);
    if(part<2){await nav.locator('[data-collection-next]').press('Enter');await page.waitForLoadState('load');}
   }
   expect(new Set(ids).size).toBe(53);await expect(nav.locator('[data-collection-next]')).toBeHidden();
   const finalUrl=page.url(),recordLink=rows.first().getByRole('link');if(scripts)await recordLink.click();else await recordLink.press('Enter');await expect(page.locator('.record-page')).toBeVisible();await page.goBack();await expect(page).toHaveURL(finalUrl);await expect(rows).toHaveCount(5);
   await page.waitForLoadState('load');await nav.locator('[data-collection-previous]').press('Enter');await expect(rows).toHaveCount(24);expect(await rows.evaluateAll(nodes=>nodes.map(n=>n.dataset.recordId))).toEqual(ids.slice(24,48));
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:info.outputPath('collection-phone.png')});
 }finally{await context.close();}
});
