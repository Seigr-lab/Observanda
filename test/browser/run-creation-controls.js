import {expect} from '@playwright/test';
// Continue the explicit creation form before exercising ordinary record tools.
export async function completeRunCreation(page,title,{edit=true}={}){
 const dialog=page.getByRole('dialog').filter({has:page.locator('[data-run-title]')});await expect(dialog.getByLabel('Run title',{exact:true})).toBeEnabled();
 if(title)await dialog.getByLabel('Run title',{exact:true}).fill(title);
 const expected=await dialog.getByLabel('Run title',{exact:true}).inputValue();await dialog.getByRole('button',{name:'Create run',exact:true}).click();await expect(page.locator('.record-reader h1')).toHaveText(expected);if(edit)await page.getByRole('button',{name:'Edit record',exact:true}).click();
 return page.url().split('/records/')[1].split('/')[0];
}
