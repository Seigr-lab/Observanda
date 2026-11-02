import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const web=new URL('../../src/web/',import.meta.url),labels=JSON.parse(await readFile(new URL('locales/en/websiteFiles.json',web)));
async function mount(page,html){
 await page.route('http://equation.test/**',async route=>{
  const filename=new URL(route.request().url()).pathname.slice(1);
  if(!filename)return route.fulfill({contentType:'text/html',body:'<button id="edit">Compose</button><iframe title="Published math" sandbox="allow-same-origin"></iframe>'});
  const allowed=['website-files-equation.js','website-equation-math.js','website-equation-markup.js','website-equation-structures.js','retry-module.js','vendor/equations.js','website-files-equation.css'];
  if(!allowed.includes(filename))return route.abort();
  return route.fulfill({contentType:filename.endsWith('.css')?'text/css':'text/javascript',body:await readFile(new URL(filename,web),'utf8')});
 });
 await page.goto('http://equation.test/');
 await page.evaluate(async({html,labels})=>{
  const {editWebsiteEquation}=await import('/website-files-equation.js');window.pageHTML=html;
  const show=()=>{document.querySelector('iframe').srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'">'+window.pageHTML;};
  document.querySelector('#edit').onclick=async()=>{
   const doc=new DOMParser().parseFromString(window.pageHTML,'text/html'),at=doc.querySelector('figure')??doc.querySelector('main > p');
   await editWebsiteEquation({doc,at,t:k=>labels[k],apply:d=>{window.pageHTML=d.documentElement.outerHTML;show();}});
  };show();
 },{html,labels});return page.frameLocator('iframe');
}
test('a desktop author builds nested equations by keyboard and mouse, edits a saved numerator visually, and publishes scriptless native math',async({page})=>{
 const output=await mount(page,'<main><p>Method</p></main>'),button=name=>page.getByRole('button',{name,exact:true});
 await button('Compose').click();await page.getByLabel('Math expression (TeX)').fill('f=');
 await button('Fraction').focus();await page.keyboard.press('Enter');await page.getByLabel('Numerator',{exact:true}).fill('x');
 await page.getByLabel('Denominator',{exact:true}).focus();await button('Square root').click();
 await page.getByLabel('Radicand').fill('y');await button('Use structure').last().click();
 await button('Use structure').click();await page.getByLabel('Accessible description').fill('Ratio of x to the square root of y');await button('Apply equation').click();
 await expect(output.locator('figure math mfrac > msqrt')).toHaveCount(1);await expect(output.locator('figcaption')).toHaveText('Ratio of x to the square root of y');
 await button('Compose').click();await page.getByLabel('Structures in this expression').selectOption('0');await button('Edit selected structure').click();
 await expect(page.getByLabel('Numerator',{exact:true})).toHaveValue('x');await page.getByLabel('Numerator',{exact:true}).fill('z');await button('Apply equation').click();
 await expect(output.locator('figure')).toHaveCount(1);await expect(output.locator('math mfrac > mi')).toHaveText('z');
 await expect(output.locator('math semantics annotation')).toHaveText('f=\\frac{z}{\\sqrt{y}}');
 await expect(output.locator('script,img')).toHaveCount(0);
});
test('a matrix can contain ordinary text and symbols, while unsafe TeX cannot replace the existing equation',async({page})=>{
 const output=await mount(page,'<main><figure><math><mfrac><mi>a</mi><mi>b</mi></mfrac></math></figure></main>');
 const button=name=>page.getByRole('button',{name,exact:true});await button('Compose').click();
 const source=page.getByLabel('Math expression (TeX)');await expect(source).toHaveValue('\\frac{a}{b}');await source.fill('');
 await button('Matrix').click();await page.getByLabel('Matrix cell 1, 1').focus();await button('π').click();
 await page.getByLabel('Matrix cell 1, 2').fill('2');await page.getByLabel('Matrix cell 2, 1').fill('3');
 await page.getByLabel('Matrix cell 2, 2').focus();await button('Plain text').click();await page.getByLabel('Text',{exact:true}).fill('mass & charge');
 await button('Apply equation').click();await expect(output.locator('math mtable mtd')).toHaveCount(4);await expect(output.locator('math mtext')).toHaveText('mass & charge');
 await button('Compose').click();await source.fill('\\href{javascript:alert(1)}{x}');await expect(button('Apply equation')).toBeDisabled();
 await button('Cancel').click();await expect(output.locator('math mtable mtd')).toHaveCount(4);await expect(output.locator('a,script')).toHaveCount(0);
});
