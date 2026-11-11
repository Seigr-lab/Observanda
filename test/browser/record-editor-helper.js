import {expect} from '@playwright/test';

// The record editor keeps evidence in its collapsed "Evidence and results" group. The editing
// navigation focuses that area, which opens the group; other views show the launch button directly.
export async function openEvidence(page){
 const open=page.getByRole('button',{name:'Open evidence & analysis',exact:true});
 const area=page.getByRole('navigation',{name:'Record editing areas',exact:true}).getByRole('button',{name:'Evidence and results',exact:true});
 await expect(open.or(area).first()).toBeVisible();
 if(!await open.isVisible())await area.click();
 await open.click();
}

// Other editor controls also live in collapsed groups. Returns the control once it is visible,
// opening its area through the editing navigation only when the control is hidden.
export async function revealInEditor(page,control,area){
 const button=page.getByRole('navigation',{name:'Record editing areas',exact:true}).getByRole('button',{name:area,exact:true});
 await expect(control.or(button).first()).toBeVisible();
 if(!await control.isVisible())await button.click();
 return control;
}
