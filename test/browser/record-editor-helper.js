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
 // A record opened for reading shows Edit record instead of the editing navigation.
 const edit=page.locator('main').getByRole('button',{name:'Edit record',exact:true});
 // A record being written for the first time keeps its evidence in a collapsed group instead.
 const draft=area==='Evidence and results'?page.locator('details[data-disclosure="draft-evidence"]:not([open]) > summary'):null;
 await expect((draft?control.or(button).or(edit).or(draft):control.or(button).or(edit)).first()).toBeVisible();
 if(await control.isVisible())return control;
 if(draft&&await draft.isVisible()){await draft.click();await expect(control).toBeVisible();return control;}
 if(!await button.isVisible()){await edit.click();await expect(button).toBeVisible();}
 if(!await control.isVisible())await button.click();
 return control;
}
