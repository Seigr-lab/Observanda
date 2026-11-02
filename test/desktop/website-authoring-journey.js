import {expect} from '@playwright/test';
import path from 'node:path';

// Through the renderer only. The caller has already made the research stores
// inaccessible. Return to the same home page before its publication review.
export async function authorSite(page){
 const click=action=>page.locator('[data-action="website-files-'+action+'"]').click();
 const canvas=page.frameLocator('#website-files-canvas');
 const paragraph=canvas.locator('main > p').filter({hasText:'Edited with PostgreSQL offline.'});
 await paragraph.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');
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
