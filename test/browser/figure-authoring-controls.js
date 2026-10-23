import {expect} from '@playwright/test';
export async function figureProperty(dialog,property){
 const chooser=dialog.locator('[data-fe-property]');await expect(chooser).toBeEnabled();
 const label=await chooser.locator('option[value="'+property+'"]').textContent();await chooser.selectOption(property);
 const control=dialog.locator('[data-fe-value]');await expect(control).toHaveAccessibleName(label);await expect(control).toBeVisible();await expect(control).toBeEnabled();
 await expect(dialog.locator('[data-authored-editor]')).toHaveAttribute('aria-busy','false');return control;
}
export async function discardFigureEdit(dialog){
 await dialog.getByRole('button',{name:'Discard this edit',exact:true}).click();
 await dialog.getByRole('button',{name:'Discard this edit and its checkpoint?',exact:true}).click();await expect(dialog).not.toBeVisible();
}
