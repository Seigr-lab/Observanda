import {FONT_OPTIONS} from '../../src/web/font-catalogue.js';
export async function chooseFont(page,label,id){
 await page.getByRole('combobox',{name:label,exact:true}).click();
 const name=FONT_OPTIONS.find(([key])=>key===id)[1];
 await page.getByRole('option').filter({has:page.locator('span').filter({hasText:new RegExp('^'+name+'$')})}).click();
}
