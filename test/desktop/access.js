import {expect} from '@playwright/test';

// Exercise the desktop's advertised protection capability. Passwords remain
// local to this disposable fixture and are never written to research metadata.
export function desktopAccess(){
 const credentials={username:'',password:''};
 return {credentials,
  async setup(page){
   const device=page.getByLabel('Use this device',{exact:false});
   if(await device.isEnabled()){await device.check();return;}
   credentials.password='Disposable desktop owner password 123!';
   await page.getByLabel('Use a password',{exact:false}).check();
   await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByLabel('Confirm password',{exact:true}).fill(credentials.password);
  },
  async unlock(page){
   await expect(page.getByRole('heading',{name:'Unlock workspace',exact:true})).toBeVisible({timeout:60000});
   if(credentials.password)await page.getByLabel('Password',{exact:true}).fill(credentials.password);
   await page.getByRole('button',{name:'Unlock workspace',exact:true}).click();
  }
 };
}
