import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {desktopLocalization,desktopLanguage,desktopProgressMessage,desktopStartupPage,desktopMenuTemplate} from '../src/desktop-localization.js';
import {desktopLocalizationFiles} from '../scripts/desktop-payload.js';
import {validateCatalogue} from '../src/web/i18n/runtime.js';

async function fixture(context){const parent=path.resolve(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-native-language-'));context.after(async()=>{assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('observanda-native-language-'));await rm(root,{recursive:true,force:true});});return root;}
const catalogue=(locale,name='desktopShell')=>readFile(new URL('../src/web/locales/'+locale+'/'+name+'.json',import.meta.url),'utf8').then(JSON.parse);

test('native menus, startup, progress and safe service errors use the persisted language in all five catalogues',async context=>{
 const root=await fixture(context),preferencesFile=path.join(root,'preferences.json'),changed=[];
 const ui=desktopLocalization({preferencesFile,watch:false,onChange:locale=>changed.push(locale)}),english=await catalogue('en');
 assert.equal(ui.language,'en');
 for(const locale of ['en','ca','es','nb','nn']){
  const messages=await catalogue(locale),errors=await catalogue(locale,'errors');validateCatalogue(messages,english);assert.deepEqual(Object.keys(messages).sort(),Object.keys(english).sort());
  const preference=JSON.stringify({formatVersion:1,language:locale,workspace:null});await writeFile(preferencesFile,preference);ui.refresh();assert.equal(ui.language,locale);
  assert.equal(await readFile(preferencesFile,'utf8'),preference);assert.equal(ui.text('busyTitle'),messages.busyTitle);
  assert.equal(ui.progress({stage:'download',percent:42,message:'English service fallback'}),messages.databaseDownload.replace('{percent}','42'));
  for(const[stage,key]of Object.entries({install:'databaseInstall',extract:'databaseExtract',initialize:'databaseInitialize',start:'databaseStart'}))assert.equal(ui.progress({stage}),messages[key]);
  assert.equal(ui.error({code:'DATABASE_UNAVAILABLE',message:'English service fallback'}),errors.DATABASE_UNAVAILABLE);
  assert.equal(ui.error({code:'future-error',message:'Unrecognized message'}),'Unrecognized message');
  const startup=decodeURIComponent(desktopStartupPage(ui.language,ui.text).split(',').slice(1).join(','));
  assert.ok(startup.includes('lang="'+locale+'"'));assert.ok(startup.includes(messages.startingWorkspace));
  let quit=0,cancel=0,about=0;
  for(const platform of ['win32','darwin','linux']){
   const menu=desktopMenuTemplate({text:ui.text,platform,scheduled:true,quit:()=>quit++,cancelClose:()=>cancel++,about:()=>about++});
   const file=menu.find(item=>item.label===messages.fileMenu);file.submenu[0].click();file.submenu[1].click();assert.equal(file.submenu[1].enabled,true);assert.equal(file.submenu[1].id,'cancel-scheduled-close');
   const edit=menu.find(item=>item.role==='editMenu');assert.equal(edit.label,messages.editMenu);assert.equal(edit.submenu.find(item=>item.role==='copy').label,messages.copy);
   menu.find(item=>item.label===messages.helpMenu).submenu[0].click();
   if(platform==='darwin')assert.equal(menu[0].submenu.find(item=>item.role==='hide').label,messages.hide);
  }
  assert.deepEqual({quit,cancel,about},{quit:3,cancel:3,about:3});
 }
 assert.deepEqual(changed,['ca','es','nb','nn']);
 for(const invalid of ['{',JSON.stringify({formatVersion:1,language:'../../es'}),JSON.stringify({formatVersion:2,language:'es'}),'x'.repeat(1048577)]){
  await writeFile(preferencesFile,invalid);assert.equal(desktopLanguage(preferencesFile),null);assert.equal(ui.refresh(),false);assert.equal(ui.language,'nn');assert.equal(await readFile(preferencesFile,'utf8'),invalid);
 }
 assert.equal(desktopProgressMessage({stage:'download',percent:101,message:'Future progress'}),'Future progress');
 const escaped=decodeURIComponent(desktopStartupPage('en',()=>'<b>Private & workspace</b>').split(',').slice(1).join(','));assert.ok(escaped.includes('&lt;b&gt;Private &amp; workspace&lt;/b&gt;'));
 ui.dispose();
});

test('native language refresh observes saved preference changes and stops watching on disposal',async context=>{
 const root=await fixture(context),preferencesFile=path.join(root,'preferences.json');await writeFile(preferencesFile,JSON.stringify({formatVersion:1,language:'en'}));
 let resolve;const changed=new Promise(done=>{resolve=done;}),ui=desktopLocalization({preferencesFile,onChange:resolve});context.after(()=>ui.dispose());
 await writeFile(preferencesFile,JSON.stringify({formatVersion:1,language:'ca'}));
 let timer;try{assert.equal(await Promise.race([changed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Language watcher did not update')),5000);})]),'ca');}finally{clearTimeout(timer);}
 assert.equal(ui.text('unsavedTitle'),(await catalogue('ca')).unsavedTitle);ui.dispose();
});

test('native localization resolves central resources from the packaged service layout',async context=>{
 const root=await fixture(context);
 for(const relative of desktopLocalizationFiles()){
  const destination=path.join(root,relative);await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.resolve(relative.slice('service/'.length)),destination);
 }
 await writeFile(path.join(root,'service/package.json'),JSON.stringify({type:'module'}));
 const preferencesFile=path.join(root,'preferences.json');await writeFile(preferencesFile,JSON.stringify({formatVersion:1,language:'es'}));
 const packaged=await import(pathToFileURL(path.join(root,'service/src/desktop-localization.js')).href),ui=packaged.desktopLocalization({preferencesFile,watch:false});
 assert.equal(ui.language,'es');assert.equal(ui.text('quit'),(await catalogue('es')).quit);assert.equal(ui.error({code:'DATABASE_UNAVAILABLE'}),(await catalogue('es','errors')).DATABASE_UNAVAILABLE);
 ui.dispose();
});
