// Chooses a panel of the page editor's left column (Add, Layers or Lab book content) in the site tools rail.
export async function pagePanel(page,name){
 await page.getByRole('navigation',{name:'Site tools',exact:true}).getByRole('button',{name,exact:true}).click();
}
