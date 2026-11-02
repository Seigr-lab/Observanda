import {expect} from '@playwright/test';
import path from 'node:path';

// Through the renderer only. The caller has already made the research stores
// inaccessible. Return to the same home page before its publication review.
export async function authorSite(page){
 const click=action=>page.locator('[data-action="website-files-'+action+'"]').click();
 const canvas=page.frameLocator('#website-files-canvas');
 const paragraph=canvas.locator('main > p').filter({hasText:'Edited with PostgreSQL offline.'});
 await selectLine(page,paragraph);
 await expect.poll(()=>paragraph.evaluate(node=>node.ownerDocument.getSelection().toString())).toBe('Edited with PostgreSQL offline.');
 await page.locator('[data-visual-command="bold"]').click();
 await expect(paragraph.locator('strong,b')).toHaveCount(1);
 await page.locator('[data-visual-scope]').selectOption('section');
 await page.locator('[data-visual-property="letter-spacing"]').fill('2');
 await page.getByRole('button',{name:'Apply styles',exact:true}).click();
 await expect(paragraph).toHaveCSS('letter-spacing','2px');await click('save');

 await click('new-page');await page.getByLabel('Page title',{exact:true}).fill('Methods');
 await page.getByLabel('Page file name',{exact:true}).fill('methods/index.html');
 await page.locator('[data-website-files-form] button[type=submit]').click();
 await expect(canvas.getByRole('heading',{name:'Methods'})).toBeVisible();
 await click('menu');await click('menu-add');
 const row=page.locator('[data-menu-row]').last();await row.locator('[data-menu-field=label]').fill('Methods');
 await row.locator('[data-menu-field=href]').fill('methods/index.html');await click('menu-save');await click('menu-cancel');
 await page.locator('[data-website-file-page]').selectOption('index.html');await expect(paragraph).toBeVisible();
 await canvas.locator('nav a').filter({hasText:'Methods'}).click();await expect(canvas.getByRole('heading',{name:'Methods'})).toBeVisible();
 await page.locator('[data-website-file-page]').selectOption('index.html');await click('preview');
 const preview=page.frameLocator('#website-files-preview');await preview.locator('nav a').filter({hasText:'Methods'}).click();await expect(preview.getByRole('heading',{name:'Methods'})).toBeVisible();
 await click('preview-back');await expect(preview.locator('main > p')).toContainText('Edited with PostgreSQL offline.');await click('visual');
 await click('media');const form=page.locator('[data-recording-form]');
 await form.locator('[name=kind]').selectOption('audio');await form.locator('[name=upload]').setInputFiles(path.resolve('src/preview-assets/audio.wav'));
 await form.locator('[name=title]').fill('Field recording');await form.locator('[name=transcript]').fill('A recording of the instrument.');
 await form.locator('button[type=submit]').click();await expect(canvas.locator('audio[controls]')).toHaveCount(1,{timeout:60000});
}

export async function selectLine(page,locator){
 await locator.click();
 await page.keyboard.press(process.platform==='darwin'?'Meta+ArrowLeft':'Home');
 await page.keyboard.press(process.platform==='darwin'?'Meta+Shift+ArrowRight':'Shift+End');
}

export async function authorScientificContent(page){
 const canvas=page.frameLocator('#website-files-canvas');
 async function insert(type){
  await page.locator('[data-website-file-block]').selectOption(type);
  await page.getByRole('button',{name:'Insert element',exact:true}).click();
 }
 await insert('section');
 const placeholder=canvas.getByText('Write your text here.',{exact:true});
 await selectLine(page,placeholder);await page.keyboard.type('H2O');
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('Shift+ArrowLeft');
 await page.locator('[data-visual-command=subscript]').click();
 await expect(canvas.locator('p sub')).toHaveText('2');
 await insert('equationEdit');
 const equation=page.getByRole('dialog',{name:'Equation'});
 await equation.getByRole('button',{name:'Fraction',exact:true}).click();
 await equation.getByLabel('Numerator',{exact:true}).fill('I_0');await equation.getByLabel('Denominator',{exact:true}).fill('I');
 await equation.getByRole('button',{name:'Use structure'}).click();
 await equation.getByLabel('Accessible description').fill('Ratio of incident to transmitted intensity');
 await equation.getByRole('button',{name:'Apply equation'}).click();
 await expect(canvas.locator('math mfrac')).toHaveCount(1);
 const references=page.locator('.website-science-inspector');await references.locator('summary').click();
 await references.getByLabel('Task',{exact:true}).selectOption('scienceReference');
 await references.getByLabel('Author or authors').fill('Laboratory team');
 await references.getByLabel('Work title').fill('Transmission calibration protocol');
 await references.getByRole('button',{name:'Save reference',exact:true}).click();
 await expect(references.getByRole('status')).toHaveText('Saved to the page. Save the website to keep the change.');
 await expect(canvas.locator('cite')).toHaveText('Transmission calibration protocol');
 await page.getByRole('button',{name:'Save website',exact:true}).click();
 await expect(page.locator('[data-website-files-status]')).toHaveText('Website saved.');
 await page.reload();
 await expect(canvas.locator('math mfrac')).toHaveCount(1);await expect(canvas.locator('p sub')).toHaveText('2');
 await expect(canvas.locator('cite')).toHaveText('Transmission calibration protocol');
}
