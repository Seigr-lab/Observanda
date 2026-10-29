import {expect} from '@playwright/test';

export async function openRecordDetail(page,field='title'){
 await page.getByRole('navigation',{name:'Record editing areas',exact:true}).getByRole('button',{name:'Record details',exact:true}).click();
 await page.locator('[data-record-detail-field]').selectOption(field);
 await page.getByRole('button',{name:'Edit selected detail',exact:true}).click();
 const dialog=page.locator('dialog.record-writing[open]');await expect(dialog.locator('[data-writing-fields] input,[data-writing-fields] select,[data-writing-fields] textarea').first()).toBeVisible();return dialog;
}
export async function setRecordTitle(page,title){
 const dialog=await openRecordDetail(page);await dialog.getByLabel('Record title',{exact:true}).fill(title);await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('.record-reader h1')).toHaveText(title);
}
export async function openRecordWriting(page){
 await page.getByRole('button',{name:'Edit summary / context',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit summary / context',exact:true});await expect(dialog.locator('.ProseMirror')).toBeVisible();return dialog;
}

export async function openRecordActions(page){
 await expect(page.locator('.record-toolbar')).toBeVisible();
 const menu=page.locator('.record-toolbar details[data-disclosure="record-actions"]');
 if(await menu.count()&&!await menu.evaluate(node=>node.open))await menu.locator(':scope > summary').click();
}
