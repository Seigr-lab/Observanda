export const task=async(page,name)=>{if(await page.getByRole('button',{name:'Back to page',exact:true}).isVisible())await page.getByRole('button',{name:'Back to page',exact:true}).click();await page.getByRole('navigation',{name:'Editing tools',exact:true}).getByRole('button',{name:{Add:'Page',Content:'Content'}[name]??name,exact:true}).click();};
export async function editorTab(page,name){
 if(await page.getByRole('button',{name:'Back to page',exact:true}).isVisible())await page.getByRole('button',{name:'Back to page',exact:true}).click();
 if(name==='Content'){await task(page,'Content');return;}
 if(name==='Homepage'){await page.getByRole('combobox',{name:'Page',exact:true}).selectOption('index.html');await task(page,'Page');return;}
 if(name==='Pages'){await task(page,'Page');return;}
 await task(page,'Site');await page.locator('.site-tools').getByRole('button',{name:{Content:'Research content',Media:'Media library',Layout:'Layout & branding'}[name]??name,exact:true}).click();
}
export async function openPageSettings(page){await task(page,'Page');await page.getByRole('button',{name:'Settings',exact:true}).click();}
export async function openBlock(page,index){await task(page,'Page');await page.locator('#website-outline [data-action="website-edit-section"]').nth(index).click();return page.locator('#website-section-order>li').first();}
export async function addSection(page,kind='text'){await task(page,'Add');const library=page.locator('[data-disclosure="website-elements"]');if(!await library.evaluate(node=>node.open))await library.locator('summary').click();await page.locator(`.insert-grid [data-kind="${kind}"]`).click();await task(page,'Page');await page.locator('#website-outline li').filter({has:page.locator('.section-select[aria-pressed=true]')}).getByRole('button',{name:/^Edit /}).click();}
export async function openLayouts(page){await task(page,'Page');await page.getByRole('button',{name:'Page layouts',exact:true}).click();if(!await page.locator('.layout-library').evaluate(el=>el.open))await page.locator('.layout-library>summary').click();}
export async function sectionTools(page,name){await page.getByRole('navigation',{name:'Section tools',exact:true}).getByRole('button',{name,exact:true}).click();}
export async function typeTools(page,name){await page.getByRole('navigation',{name:'Typography tools',exact:true}).getByRole('button',{name:{Add:'Page',Content:'Content'}[name]??name,exact:true}).click();}

export async function chooseWebsitePage(page,path,{search}={}){
 const select=page.getByLabel('Page',{exact:true});
 if(await select.locator('option[value="'+path+'"]').count()){await select.selectOption(path);return;}
 await select.selectOption('find');
 const kind=path==='index.html'||path.startsWith('pages/')?'site':path.startsWith('entries/')?'entry':path.startsWith('notebooks/')?'notebook':'project';
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Page type',{exact:true}).selectOption(kind);if(search!==undefined)await dialog.locator('#website-page-search').fill(search);
 for(let n=0;n<100;n++){
  const item=dialog.locator('[data-page-path="'+path+'"]');
  await dialog.locator('[data-page-results][aria-busy="false"]').waitFor();
  if(await item.count()){await item.click();return;}
  const next=dialog.getByRole('button',{name:'Next',exact:true});
  if(await next.isDisabled())throw Error('Page missing from picker: '+path);
  await next.click();
 }
 throw Error('Page search exceeded test traversal budget');
}
