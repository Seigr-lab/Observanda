export async function preferences(page, tab) {
 const select=page.getByLabel('Preferences section',{exact:true});if(await select.isVisible()){await select.selectOption({label:tab});return;}
 const target=page.locator('.preferences-tabs').getByRole('button',{name:tab,exact:true});
 if(!await target.isVisible())await navigate(page,'Preferences');
 await page.locator('.preferences-heading').waitFor({state:'visible'});
 if(await select.isVisible())await select.selectOption({label:tab});else await target.click();
}
export async function editWorkspace(page){await preferences(page,'General');}

export async function navigate(page,name){
 if(name==='All records'){
  const records=page.locator('main').getByRole('button',{name,exact:true});
  if(!await records.isVisible())await navigate(page,'Dashboard');
  await records.click();return;
 }
 await page.getByRole('button',{name:'Menu',exact:true}).waitFor({state:'visible'});
 const target=page.locator('#main-navigation').getByRole('button',{name,exact:true});
 if(!await target.isVisible())await page.getByRole('button',{name:'Menu',exact:true}).click();
 await target.click();
}
