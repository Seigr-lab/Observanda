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

// Most authoring tests ask for the composer; Websites explicitly asks for its directory.
export async function openDefaultWebsite(page){
 const guard=page.locator('#leave-dialog[open]'),directory=page.locator('[data-website-directory]');
 await expect(directory.or(guard)).toBeVisible();if(await guard.isVisible())return false;
 const status=directory.locator('[data-website-directory-status]');
 await expect(status).toHaveText(/^(?!Loading websites\.\.\.$).+/);
 if(await status.getAttribute('role')==='alert')throw new Error('Website directory failed to load: '+await status.textContent());
 const workspace=(await page.locator('.workspace-name').textContent()).trim();
 const card=directory.locator('[data-website-card$="/default"]').filter({has:page.locator('p.muted').filter({hasText:new RegExp('^'+workspace.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})});
 await expect(card).toHaveCount(1);await card.getByRole('button',{name:'Website editor',exact:true}).click();
 await expect(page.locator('.website-site-context')).toBeVisible();return true;
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
