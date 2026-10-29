import {test,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {desktopFixture} from './fixture.js';

test('native menus and dialogs follow the persisted interface language without reopening the application',async()=>{
 const fixture=await desktopFixture('observanda-native-language-smoke-');let application;
 const preferencesFile=path.join(fixture.directory,...(fixture.packaged?['.observanda']:[]),'preferences.json');
 await mkdir(path.dirname(preferencesFile),{recursive:true});await writeFile(preferencesFile,JSON.stringify({formatVersion:1,workspace:null,language:'es'}));
 try{
  application=await fixture.start();const page=await application.firstWindow();
  await expect(page.locator('html')).toHaveAttribute('lang','es',{timeout:60000});
  await expect(page.locator('html')).toHaveAttribute('data-app-mode','setup',{timeout:60000});
  for(const locale of ['es','ca','nb','nn','en']){
   const messages=JSON.parse(await readFile(new URL('../../src/web/locales/'+locale+'/desktopShell.json',import.meta.url),'utf8'));
   expect(await page.evaluate(async language=>{const response=await fetch('/api/language',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language})});return response.status;},locale)).toBe(200);
   await expect.poll(()=>application.evaluate(({Menu})=>Menu.getApplicationMenu().items.flatMap(item=>[item.label,...(item.submenu?.items.map(child=>child.label)??[])])),{timeout:10000}).toContain(messages.resetZoom);
   const native=await application.evaluate(({Menu,BrowserWindow,dialog})=>{
    const menu=Menu.getApplicationMenu(),contents=BrowserWindow.getAllWindows()[0].webContents;
    const previous=dialog.showMessageBox,previousSync=dialog.showMessageBoxSync;let external,unsaved;
    try{
     dialog.showMessageBox=async(...args)=>{external=args.at(-1);return {response:0};};
     dialog.showMessageBoxSync=(...args)=>{unsaved=args.at(-1);return 0;};
     contents.emit('will-navigate',{preventDefault(){}},'https://example.invalid/native-language-test');
     contents.emit('will-prevent-unload',{preventDefault(){throw Error('Unsaved work must remain open');}});
    }finally{dialog.showMessageBox=previous;dialog.showMessageBoxSync=previousSync;}
    return {cancel:menu.getMenuItemById('cancel-scheduled-close').label,external,unsaved};
   });
   expect(native.cancel).toBe(messages.cancel);expect(native.external.title).toBe(messages.externalTitle);expect(native.external.buttons).toEqual([messages.cancelAction,messages.externalOpen]);
   expect(native.unsaved.title).toBe(messages.unsavedTitle);expect(native.unsaved.buttons).toEqual([messages.keepWorking,messages.leaveUnsaved]);
  }
 }finally{await fixture.dispose(application);}
});
