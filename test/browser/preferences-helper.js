import {expect} from '@playwright/test';
export async function preferences(page, tab) {
 if(tab==='Appearance')tab='Website design';
 const select=page.getByLabel('Preferences section',{exact:true});if(await select.isVisible()){await select.selectOption({label:tab});return;}
 const target=page.locator('.preferences-tabs').getByRole('button',{name:tab,exact:true});
 if(!await target.isVisible())await navigate(page,'Preferences');
 await page.locator('.preferences-heading').waitFor({state:'visible'});
 if(await select.isVisible())await select.selectOption({label:tab});else await target.click();
}
export async function editWorkspace(page){await preferences(page,'General');}

// Website editor opens the website files editor as its own screen. It opens the
// workspace's default website once saved-website preparation has produced it.
// Returns the opened website's id, or null when the unsaved-changes guard asks first.
export async function openDefaultWebsite(page){
 const guard=page.locator('#leave-dialog[open]'),files=page.locator('#main[data-website-files-app]');
 await expect(files.or(guard)).toBeVisible();if(await guard.isVisible())return null;
 await expect(files.locator('#website-files-canvas')).toBeVisible({timeout:60000});
 await expect(files.locator('[data-website-files-status]')).toHaveText('Website saved.');
 const id=/\/websites\/([a-f0-9-]{36})\/editor/.exec(page.url())?.[1];
 if(!id)throw new Error('The website editor opened without a website route: '+page.url());
 return id;
}

export async function navigate(page,name){
 if(name==='All records'){
  const records=page.locator('main').getByRole('button',{name,exact:true});
  if(!await records.isVisible())await navigate(page,'Dashboard');
  await records.click();return;
 }
 await page.getByRole('button',{name:'Menu',exact:true}).waitFor({state:'visible'});
 const target=page.locator('#main-navigation').getByRole('button',{name:name==='Websites'?'Website editor':name,exact:true});
 if(!await target.isVisible())await page.getByRole('button',{name:'Menu',exact:true}).click();
 await target.click();if(name==='Website editor')await openDefaultWebsite(page);
}
