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

// A new record is written on the record page as a draft until Save record (the toolbar
// shows Save record and Discard record); its title is a record detail like any other.
export async function newRecordOpened(page){await expect(page.getByRole('button',{name:'Save record',exact:true})).toBeVisible({timeout:30000});return page.evaluate(()=>location.hash.split('/')[2]);}
export async function setNewRecordTitle(page,title){
 const dialog=await openRecordDetail(page);await dialog.getByLabel('Record title',{exact:true}).fill(title);await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.locator('main h1').first()).toHaveText(title);
}
export async function saveNewRecord(page){await page.getByRole('button',{name:'Save record',exact:true}).click();await expect(page.getByRole('button',{name:'Save record',exact:true})).toHaveCount(0,{timeout:30000});await expect(page.locator('.record-editing h1')).toBeVisible();}
export async function discardNewRecord(page){await page.getByRole('button',{name:'Discard record',exact:true}).click();await page.getByRole('button',{name:'Discard this new record?',exact:true}).click();await expect(page.getByRole('button',{name:'Save record',exact:true})).toHaveCount(0);}

// A record type's own fields are listed a few at a time in Record details; Go to item brings a later one into view.
export async function openTemplateValue(page,key,position){
 const control=page.locator('main [data-action=record-value-edit][data-value-field="template:'+key+'"]').first(),fields=page.locator('main [data-record-collection=fields]');
 await revealInEditor(page,control.or(fields).first(),'Record details');
 if(!await control.isVisible()){await fields.getByRole('spinbutton',{name:'Go to item',exact:true}).fill(String(position));await fields.getByRole('button',{name:'Go',exact:true}).click();}
 await control.click();
 const dialog=page.locator('dialog.record-writing[open]');await expect(dialog.locator('[data-writing-fields] input,[data-writing-fields] select,[data-writing-fields] textarea').first()).toBeVisible();return dialog;
}
export async function saveRecordValue(dialog,{timeout=15000}={}){await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).not.toBeVisible({timeout});}
