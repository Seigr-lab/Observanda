// Opens the website editor's "Manage and publish" menu and returns it.
export async function siteMenu(page){
 const menu=page.locator('[data-website-site-menu]');
 if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();
 return menu;
}
