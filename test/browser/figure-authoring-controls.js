import {expect} from '@playwright/test';
import {RetainedFigureDocuments} from '../../src/retained-figure-document.js';
export async function figureProperty(dialog,property){
 const chooser=dialog.locator('[data-fe-property]');await expect(chooser).toBeEnabled();
 const label=await chooser.locator('option[value="'+property+'"]').textContent();await chooser.selectOption(property);
 const control=dialog.locator('[data-fe-value]');await expect(control).toHaveAccessibleName(label);await expect(control).toBeVisible();await expect(control).toBeEnabled();
 await expect(dialog.locator('[data-authored-editor]')).toHaveAttribute('aria-busy','false');return control;
}
// A record page figure is authored in its figure dialog: an editing area, then one property at a time.
// Each change is checkpointed before the next one is made.
export const figureDialog=page=>page.getByRole('dialog',{name:/^(Add|Edit) figure$/});
const idle=dialog=>expect(dialog.locator('[data-authored-editor]')).toHaveAttribute('aria-busy','false');
export async function figureArea(dialog,value){await expect(dialog.locator('[data-fe-part]')).toBeEnabled();await dialog.locator('[data-fe-part]').selectOption(value);await idle(dialog);}
export async function setFigureProperty(page,dialog,name,value){const control=await figureProperty(dialog,name),changed=page.waitForResponse(r=>r.url().endsWith('/drafts/figures/change'));await control.fill(value);await changed;await idle(dialog);}
export async function addFigureItem(page,dialog){const changed=page.waitForResponse(r=>r.url().endsWith('/drafts/figures/change'));await dialog.locator('[data-fe="add"]').click();await changed;await idle(dialog);}
// The measurements of a stored authored figure: for each panel, each series' points.
export async function figurePoints(workspace,figure){
 const reader=await new RetainedFigureDocuments(workspace).open(figure),panels=[];
 for await(const panel of reader.items({collection:'panels'})){const series=[];for await(const item of reader.items({collection:'series',plotId:panel.plotId})){const points=[];for await(const point of reader.items({collection:'points',plotId:panel.plotId,seriesId:item.id}))points.push(point.value);series.push(points);}panels.push(series);}
 return panels;
}
export async function discardFigureEdit(dialog){
 await dialog.getByRole('button',{name:'Discard this edit',exact:true}).click();
 await dialog.getByRole('button',{name:'Discard this edit and its checkpoint?',exact:true}).click();await expect(dialog).not.toBeVisible();
}
