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
