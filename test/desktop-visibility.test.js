import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerHooks} from 'node:module';
import os from 'node:os';
import path from 'node:path';

// Execute the real desktop entry point with in-memory Electron and service
// boundaries. A constructor/ready callback that shows a window is observable
// immediately, before any automation could attach a late hide listener.
async function launch({packaged,disposable},check){
 const home=path.join(os.tmpdir(),'observanda-visibility-synthetic'),calls=[],windows=[],dialogs=[],paths=new Map(),app=new EventEmitter(),nativeTheme=new EventEmitter();
 let ready,started,forked,serviceStart,timer;
 const whenReady=new Promise(resolve=>{ready=resolve;}),serviceStarted=new Promise(resolve=>{started=resolve;});
 Object.assign(app,{isPackaged:packaged,setName(){},setAppUserModelId(){},enableSandbox(){},setPath(name,value){paths.set(name,value);},requestSingleInstanceLock:()=>true,whenReady:()=>whenReady,quit(){calls.push('quit');}});
 class BrowserWindow extends EventEmitter{
  constructor(options){super();this.options=options;this.visible=options.show!==false;this.minimized=false;this.webContents=new EventEmitter();Object.assign(this.webContents,{session:options.webPreferences.session,setWindowOpenHandler:handler=>{this.openHandler=handler;},executeJavaScript:async()=>{},getURL:()=>this.url});windows.push(this);calls.push(['create',this.visible]);}
  static getAllWindows(){return windows;}
  isDestroyed(){return false;}
  isMinimized(){return this.minimized;}
  setIcon(){}
  setTitle(){}
  show(){calls.push('show');this.visible=true;}
  showInactive(){calls.push('showInactive');this.visible=true;}
  maximize(){calls.push('maximize');this.visible=true;}
  restore(){calls.push('restore');this.minimized=false;this.visible=true;}
  focus(){calls.push('focus');}
  hide(){assert.fail('Visibility must be decided before show, not corrected by hiding');}
  async loadURL(url){this.url=url;this.emit('ready-to-show');}
  close(){this.emit('close',{preventDefault(){}});}
  destroy(){}
 }
 const isolated=new EventEmitter();Object.assign(isolated,{setPermissionRequestHandler(){},setPermissionCheckHandler(){}});
 const child=new EventEmitter();Object.assign(child,{connected:true,stdout:{resume(){}},stderr:{resume(){}},send(value){if(value.type==='start'){serviceStart=value;started();}}});
 const boundary={app,BrowserWindow,nativeTheme,Menu:{buildFromTemplate:items=>items,setApplicationMenu(){},getApplicationMenu:()=>null},dialog:{async showMessageBox(...args){dialogs.push(args);return {response:0};},showMessageBoxSync(...args){dialogs.push(args);return 0;}},shell:{},session:{fromPartition:()=>isolated},safeStorage:{isEncryptionAvailable:()=>false},fork:(...args)=>{forked=args;return child;},os:{homedir:()=>home}};
 const key='__observandaVisibilityBoundary',prior=globalThis[key],previousHome=process.env.OBSERVANDA_DESKTOP_TEST_HOME,resourceDescriptor=Object.getOwnPropertyDescriptor(process,'resourcesPath'),resources=path.join(home,'application','resources');
 const id=(packaged?'packaged':'source')+(disposable?'-test':'-normal'),exports={electron:['app','BrowserWindow','Menu','dialog','shell','session','safeStorage','nativeTheme'],'node:child_process':['fork'],'node:os':['default']};
 globalThis[key]=boundary;if(disposable)process.env.OBSERVANDA_DESKTOP_TEST_HOME=home;else delete process.env.OBSERVANDA_DESKTOP_TEST_HOME;
 Object.defineProperty(process,'resourcesPath',{value:resources,configurable:true});
 const hooks=registerHooks({
  resolve(specifier,context,next){return Object.hasOwn(exports,specifier)?{url:'visibility:'+id+'/'+specifier,shortCircuit:true}:next(specifier,context);},
  load(url,context,next){if(!url.startsWith('visibility:'+id+'/'))return next(url,context);const name=url.slice(('visibility:'+id+'/').length);return {format:'module',shortCircuit:true,source:exports[name].map(value=>value==='default'?'export default globalThis.'+key+'.os;':'export const '+value+'=globalThis.'+key+'.'+value+';').join('\n')};}
 });
 try{
  await import(new URL('../desktop/main.js?visibility='+id,import.meta.url));
  assert.equal(windows.length,0,'entry point must wait for readiness before creating windows');
  app.emit('second-instance');assert.deepEqual(calls,[]);
  ready();await Promise.race([serviceStarted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Desktop initialization did not reach the simulated service')),5000);})]);clearTimeout(timer);
  await check({home,resources,paths,calls,windows,app,child,dialogs,forked,serviceStart,BrowserWindow});
 }finally{
  clearTimeout(timer);hooks.deregister();if(prior===undefined)delete globalThis[key];else globalThis[key]=prior;
  if(previousHome===undefined)delete process.env.OBSERVANDA_DESKTOP_TEST_HOME;else process.env.OBSERVANDA_DESKTOP_TEST_HOME=previousHome;
  if(resourceDescriptor)Object.defineProperty(process,'resourcesPath',resourceDescriptor);else delete process.resourcesPath;
 }
}

test('real desktop startup keeps disposable source and packaged windows hidden before every show boundary while ordinary launches remain visible',async()=>{
 for(const packaged of [false,true])for(const disposable of [false,true])await launch({packaged,disposable},async({home,resources,paths,calls,windows,app,child,dialogs,forked,serviceStart,BrowserWindow})=>{
  const profile=disposable&&!packaged?home:path.join(home,'.observanda'),main=windows[0];
  assert.equal(paths.get('userData'),path.join(profile,'window'));assert.equal(serviceStart.preferencesFile,path.join(profile,'preferences.json'));
  assert.deepEqual(calls[0],['create',false]);assert.equal(main.visible,!disposable);
  if(packaged){assert.equal(forked[0],path.join(resources,'service/src/desktop-service.js'));assert.equal(forked[2].execPath,path.join(resources,'runtime',process.platform==='win32'?'node.exe':'bin/node'));}
  assert.equal(forked[2].windowsHide,true);assert.equal(dialogs.length,0);
  main.minimized=true;app.emit('second-instance');
  assert.equal(main.visible,!disposable);assert.equal(main.minimized,disposable);
  child.emit('message',{type:'ready',url:'http://127.0.0.1:4173/#'+'a'.repeat(64)});
  for(let depth=0,parent=main;depth<2;depth++){
   const opened=parent.openHandler({url:'http://127.0.0.1:4173/preview/edition/index.html'});
   assert.equal(opened.action,'allow');assert.equal(opened.overrideBrowserWindowOptions.show,!disposable);
   assert.equal(opened.overrideBrowserWindowOptions.webPreferences.session,main.webContents.session);
   assert.equal(opened.overrideBrowserWindowOptions.webPreferences.sandbox,true);
   const preview=new BrowserWindow(opened.overrideBrowserWindowOptions);parent.webContents.emit('did-create-window',preview);preview.emit('ready-to-show');parent=preview;
  }
  if(disposable){assert.ok(windows.every(window=>!window.visible));assert.deepEqual(calls,[['create',false],['create',false],['create',false]]);}
  else{assert.ok(windows.every(window=>window.visible));assert.deepEqual(calls.slice(0,7),[['create',false],'maximize','show','restore','maximize','show','focus']);}
  assert.equal(dialogs.length,0);
 });
});

test('a rejected visible launch is closed before the fixture returns its failure',async()=>{
 const key='__observandaVisibleFixture',previous=globalThis[key],screenshots=process.env.OBSERVANDA_DESKTOP_SCREENSHOTS;let closed=false,fixture;
 const launched=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null});
 const app={process:()=>launched,async firstWindow(){return {};},async evaluate(run,value){return run({BrowserWindow:{getAllWindows:()=>[{webContents:{setBackgroundThrottling(){}},isVisible:()=>true}]},dialog:{}},value);},async close(){closed=true;launched.exitCode=0;launched.emit('exit',0,null);}};
 globalThis[key]={async launch(){return app;}};process.env.OBSERVANDA_DESKTOP_SCREENSHOTS='0';
 const hooks=registerHooks({resolve(specifier,context,next){return specifier==='@playwright/test'?{url:'visibility:fixture',shortCircuit:true}:next(specifier,context);},load(url,context,next){return url==='visibility:fixture'?{format:'module',shortCircuit:true,source:'export const _electron=globalThis.'+key+';'}:next(url,context);}});
 try{
  const {desktopFixture}=await import('./desktop/fixture.js?visibility-cleanup');fixture=await desktopFixture('observanda-visibility-fixture-');
  await assert.rejects(fixture.start('synthetic-executable'),/Desktop test launch unexpectedly showed a window/);assert.equal(closed,true);assert.equal(launched.listenerCount('exit'),0);
 }finally{hooks.deregister();if(fixture)await fixture.dispose();if(previous===undefined)delete globalThis[key];else globalThis[key]=previous;if(screenshots===undefined)delete process.env.OBSERVANDA_DESKTOP_SCREENSHOTS;else process.env.OBSERVANDA_DESKTOP_SCREENSHOTS=screenshots;}
});
