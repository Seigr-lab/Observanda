import {expect} from '@playwright/test';
import {revealInEditor} from './record-editor-helper.js';

export async function openRecordDetail(page,field='title'){
 // A record opened for reading shows Edit record; details live in the editor's Record details area.
 await (await revealInEditor(page,page.locator('main [data-action=record-value-edit][data-value-field="'+field+'"]').first(),'Record details')).click();
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
