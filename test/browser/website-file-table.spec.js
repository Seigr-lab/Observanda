import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const moduleURL=new URL('../../src/web/website-files-table.js',import.meta.url),messages=JSON.parse(await readFile(new URL('../../src/web/locales/en/websiteFiles.json',import.meta.url)));
async function setup(page,html){
 await page.route('http://table-fixture.test/**',async route=>{
  const name=new URL(route.request().url()).pathname;
  if(name==='/')return route.fulfill({contentType:'text/html',body:'<main><iframe></iframe><aside></aside></main>'});
  const file=name==='/table.js'?moduleURL:new URL('../../src/web'+name,import.meta.url);
  return route.fulfill({contentType:name.endsWith('.json')?'application/json':'text/javascript',body:await readFile(file)});
 });
 await page.goto('http://table-fixture.test/');
 await page.evaluate(async({html,messages})=>{
  const {websiteTableTools}=await import('/table.js'),doc=document.querySelector('iframe').contentDocument;
  doc.body.innerHTML=html;window.edits=[];
  const api=websiteTableTools({document:doc,inspector:document.querySelector('aside'),translate:key=>messages[key],beforeChange:()=>window.edits.push('before'),changed:()=>window.edits.push('after')});
  doc.addEventListener('click',e=>api.select(e.target));api.select(doc.querySelector('table'));
 },{html,messages});return page.frameLocator('iframe');
}
test('keyboard table controls edit exact numbers, heading scope and caption and add or remove real rows and columns',async({page})=>{
 const source='<table><caption>Readings</caption><thead><tr><th scope="col">Time</th><th scope="col">Voltage</th></tr></thead><tbody><tr><td>T0</td><td class="sample">13.00</td></tr></tbody></table>';
 const frame=await setup(page,source),table=frame.locator('table'),button=name=>page.getByRole('button',{name,exact:true});
 const address=async(row,col)=>{await page.getByLabel('Row number').fill(String(row));await page.getByLabel('Row number').press('Tab');await page.getByLabel('Column number').fill(String(col));await page.getByLabel('Column number').press('Tab');};
 await address(2,2);await expect(page.getByLabel('Cell text or number')).toHaveValue('13.00');
 await page.getByLabel('Cell text or number').fill('−0.004E+03');await page.getByLabel('Cell type').selectOption('row');await page.getByLabel('Table caption').fill('Calibration <A>');
 await button('Apply cell and caption changes').focus();await page.keyboard.press('Enter');
 await expect(table.locator('tbody th.sample[scope="row"]')).toHaveText('−0.004E+03');await expect(table.locator('caption')).toHaveText('Calibration <A>');
 await button('Insert row below').click();await expect(table.locator('tr')).toHaveCount(3);
 await button('Insert column to the left').click();await expect(table.locator('thead th')).toHaveCount(3);await expect(table.locator('tbody tr').last().locator('td,th')).toHaveCount(3);
 await button('Delete selected column').click();await button('Delete selected row').click();
 await expect(table.locator('tbody tr')).toHaveCount(1);await expect(table.locator('thead th')).toHaveCount(2);await expect(table.locator('tbody th.sample')).toHaveText('−0.004E+03');
 const events=await page.evaluate(()=>window.edits);expect(events).toEqual(Array.from({length:5},()=>['before','after']).flat());
});
test('table tools preserve marked content, merged grids and rich text cells',async({page})=>{
 const frame=await setup(page,'<table id="simple"><tr><td><em>kept</em></td></tr></table><table id="merged"><tr><td colspan="2">sum</td></tr><tr><td>2</td><td>3</td></tr></table><section data-observanda-source="old"><table id="linked"><tr><td>secret</td></tr></table></section>');
 await expect(page.getByLabel('Cell text or number')).toBeDisabled();await expect(page.getByRole('button',{name:'Delete selected row'})).toBeDisabled();
 await page.getByLabel('Cell type').selectOption('col');await page.getByRole('button',{name:'Apply cell and caption changes'}).click();
 await expect(frame.locator('#simple th[scope="col"] em')).toHaveText('kept');
 await frame.locator('#merged td').first().click();await expect(page.getByRole('button',{name:'Insert column to the right'})).toBeDisabled();
 await frame.locator('#linked td').click();await expect(page.getByRole('group',{name:'Edit table'})).toBeHidden();
 await expect(frame.locator('#linked td')).toHaveText('secret');
});
