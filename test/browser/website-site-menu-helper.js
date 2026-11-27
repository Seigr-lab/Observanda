import {expect} from '@playwright/test';

// Opens the website editor's Websites menu (new website, manage this website) and returns it.
export async function siteMenu(page){
 const menu=page.locator('[data-website-site-menu="site"]');
 if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();
 return menu;
}

// Opens the website editor's Publish panel (destination, checks, review, search and sharing,
// publishing, ZIP download and releases) and returns it.
export async function publishPanel(page){
 const panel=page.locator('.website-publish-panel');
 if(!await panel.isVisible())await page.getByRole('button',{name:'Publish',exact:true}).click();
 await expect(panel).toBeVisible();
 return panel;
}
