import {test,expect} from '@playwright/test';
import {desktopFixture} from './fixture.js';

// A desktop window whose session has ended (here its stored session is replaced by an
// unknown one) reconnects itself through a fresh launch from the desktop app: it never
// stops at a page asking the owner for a link.
test('a desktop window whose session ended reconnects itself',async()=>{
 const fixture=await desktopFixture('observanda-desktop-reconnect-');let application;
 try{
  application=await fixture.start();const page=await application.firstWindow();
  await expect(page.locator('html')).toHaveAttribute('data-app-mode','setup',{timeout:60000});
  const renew=()=>page.evaluate(async()=>{
   const session=await new Promise((resolve,reject)=>{const open=indexedDB.open('observanda-browser-session',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const request=open.result.transaction('session').objectStore('session').get('current');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);};});
   return (await fetch('/api/session/renew',{method:'POST',headers:{'Content-Type':'application/json','X-Observanda-Session':session},body:'{}'})).status;
  });
  expect(await renew()).toBe(200);
  await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('observanda-browser-session',1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const transaction=open.result.transaction('session','readwrite');transaction.objectStore('session').put('0'.repeat(64),'current');transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);};}));
  expect(await renew()).toBe(401);
  // Returning to the window notices the ended session; the desktop app answers with a fresh launch.
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(renew,{timeout:30000}).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('data-app-mode','setup',{timeout:60000});
  expect(new URL(page.url()).searchParams.has('observanda-reconnect')).toBe(false);
  await expect(page.getByRole('heading',{name:'This window is no longer connected',exact:true})).toHaveCount(0);
 }finally{await fixture.dispose(application);}
});
