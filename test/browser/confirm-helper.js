import {expect} from '@playwright/test';

// Answers the app's own confirmation dialog, which opens with focus on Cancel.
export async function answerConfirmation(page,action,accept=true){
 const dialog=page.locator('dialog.confirm-action');
 await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await dialog.getByRole('button',{name:accept?action:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
}
