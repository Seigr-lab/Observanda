// Opens a section of the website editor's site tools sidebar (Add, Layers, Lab book content or a site tool):
// expands a collapsed sidebar first, and leaves a section that is already open as it is.
export async function pagePanel(page,name){
 const sidebar=page.getByRole('complementary',{name:'Site tools',exact:true});
 const expand=sidebar.getByRole('button',{name:'Expand site tools',exact:true});
 if(await expand.isVisible())await expand.click();
 // A nested match is written from the page; Playwright looks for it inside each toggle.
 const toggle=sidebar.locator('.website-sidebar-toggle').filter({has:page.getByText(name,{exact:true})}).first();
 if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
}
