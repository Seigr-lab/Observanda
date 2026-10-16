import {app,BrowserWindow,Menu,dialog,shell,session,safeStorage,nativeTheme} from 'electron';
import {fork} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {windowPreferences,localUrl,externalUrl,launchUrl} from './policy.js';
import {windowIcon,followWindowTheme} from './branding.js';
import {closeGuard} from './close-guard.js';
const closeText=JSON.parse(readFileSync(new URL('./locales/en/close.json',import.meta.url),'utf8'));

app.setName('Observanda');app.setAppUserModelId('org.observanda.desktop');app.enableSandbox();
const development=!app.isPackaged,here=path.dirname(fileURLToPath(import.meta.url));
const profile=development&&process.env.OBSERVANDA_DESKTOP_TEST_HOME?path.resolve(process.env.OBSERVANDA_DESKTOP_TEST_HOME):null;
// Keep the window profile beside the existing application preferences. This
// also avoids depending on Windows shell-folder registration at startup.
app.setPath('userData',path.join(profile??path.join(os.homedir(),'.observanda'),'window'));
let main=null,child=null,origin=null,quitting=false,stopping=null,childExited,resolveExit,progress='Starting Observanda…';
const stateRequests=new Map();let stateSequence=0,closingGuard;
function serviceState(){
  if(!child?.connected)return Promise.resolve({busy:false,failure:0});
  return new Promise((resolve,reject)=>{
    const id=++stateSequence,timer=setTimeout(()=>{stateRequests.delete(id);reject(Error('Service status unavailable'));},5000);
    stateRequests.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
    child.send({type:'shutdown-status',id},error=>{if(error){stateRequests.delete(id);clearTimeout(timer);reject(error);}});
  });
}
const startupPage='data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>Observanda</title><style>body{font:18px system-ui;color:#263349;background:#f5f6fa;margin:12vh 10vw}h1{font-size:28px}p{line-height:1.6}</style><h1>Observanda</h1><p id="status" role="status">Starting your private workspace…</p></html>');
function showProgress(text){progress=text;if(main&&!main.isDestroyed()&&!origin)void main.webContents.executeJavaScript('document.getElementById("status").textContent='+JSON.stringify(progress)).catch(()=>{});}
async function openExternal(value){const url=externalUrl(value);if(!url)return;const result=await dialog.showMessageBox({type:'question',title:'Open external website',message:'Open this link in your browser?',detail:url,buttons:['Cancel','Open website'],defaultId:0,cancelId:0});if(result.response===1)await shell.openExternal(url);}
function guardWindow(win){
  followWindowTheme(win,nativeTheme,here);
  win.webContents.on('will-navigate',(event,url)=>{if(!localUrl(url,origin)){event.preventDefault();void openExternal(url);}});
  win.webContents.on('will-redirect',(event,url)=>{if(!localUrl(url,origin))event.preventDefault();});
  win.webContents.on('will-attach-webview',event=>event.preventDefault());
  win.webContents.setWindowOpenHandler(({url})=>{
    if(localUrl(url,origin))return {action:'allow',overrideBrowserWindowOptions:{title:'Observanda preview',webPreferences:{...windowPreferences,session:win.webContents.session}}};
    void openExternal(url);return {action:'deny'};
  });
  win.webContents.on('did-create-window',guardWindow);
  win.webContents.on('will-prevent-unload',event=>{
    if(dialog.showMessageBoxSync(win,{type:'question',title:'Unsaved work',message:'Leave this window with unsaved work?',detail:'Return to Observanda to save your changes first.',buttons:['Keep working','Leave without saving'],defaultId:0,cancelId:0})===1)event.preventDefault();
  });
}
function stopService(){
  return stopping??=(async()=>{
    if(child?.connected)child.send({type:'stop'});
    if(childExited)await childExited;
    quitting=true;app.quit();
  })();
}
if(!app.requestSingleInstanceLock()){app.quit();}
else{
  app.on('second-instance',()=>{if(main){if(main.isMinimized())main.restore();if(!profile)main.maximize();main.show();main.focus();}});
  app.on('before-quit',event=>{if(quitting)return;event.preventDefault();if(main&&!main.isDestroyed())main.close();else void stopService();});
  app.on('window-all-closed',()=>void stopService());
  void app.whenReady().then(async()=>{
  const isolated=session.fromPartition('observanda-desktop');
  isolated.setPermissionRequestHandler((contents,permission,callback)=>callback(permission==='clipboard-sanitized-write'&&contents===main?.webContents&&localUrl(contents.getURL(),origin)));
  isolated.setPermissionCheckHandler((contents,permission)=>permission==='clipboard-sanitized-write'&&contents===main?.webContents&&localUrl(contents.getURL(),origin));
  isolated.on('will-download',(_event,item)=>{const url=item.getURL();if(!localUrl(url,origin)&&!url.startsWith('blob:'+origin+'/'))item.cancel();});
  main=new BrowserWindow({title:'Observanda',show:false,width:1320,height:900,minWidth:390,minHeight:480,backgroundColor:'#f5f6fa',icon:windowIcon(here,nativeTheme.shouldUseDarkColors),webPreferences:{...windowPreferences,session:isolated}});
  // Let the window manager fit the current display before showing the window.
  main.once('ready-to-show',()=>{if(main&&!profile){main.maximize();main.show();}});
  guardWindow(main);main.on('closed',()=>{main=null;for(const win of BrowserWindow.getAllWindows())win.close();if(!BrowserWindow.getAllWindows().length)void stopService();});
  closingGuard=closeGuard({status:serviceState,close:()=>main?.close(),
    ask:async()=>((await dialog.showMessageBox(main,{type:'question',title:closeText.busyTitle,message:closeText.busyMessage,detail:closeText.busyDetail,buttons:[closeText.keepOpen,closeText.whenFinished],defaultId:0,cancelId:0})).response===1),
    waiting:value=>{if(main&&!main.isDestroyed())main.setTitle(value?closeText.waitingTitle:'Observanda');const item=Menu.getApplicationMenu()?.getMenuItemById('cancel-scheduled-close');if(item)item.enabled=value;},
    failed:()=>dialog.showMessageBox(main,{type:'warning',title:closeText.failedTitle,message:closeText.failedMessage,detail:closeText.failedDetail}),
    unavailable:()=>dialog.showMessageBox(main,{type:'warning',title:closeText.unavailableTitle,message:closeText.unavailableMessage,detail:closeText.unavailableDetail})});
  main.on('close',event=>{if(quitting||stopping||closingGuard.allowed)return;event.preventDefault();void closingGuard.request();});
  main.on('closed',()=>closingGuard.dispose());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{role:'appMenu',label:'Observanda'}]:[]),
    {label:'File',submenu:[{label:'Quit Observanda',accelerator:'CmdOrCtrl+Q',click:()=>app.quit()},{id:'cancel-scheduled-close',label:closeText.cancel,enabled:false,click:()=>closingGuard.cancel()}]},
    {role:'editMenu'},{label:'View',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
    {label:'Help',submenu:[{label:'About Observanda',click:()=>dialog.showMessageBox({title:'Observanda',message:'Observanda '+app.getVersion(),detail:'Your workspace is stored separately from the application. Closing Observanda stops its local service.'})}]}
  ]));
  await main.loadURL(startupPage);showProgress(progress);
  const resources=development?path.resolve(here,'../dist/desktop-resources'):process.resourcesPath;
  const service=development?path.resolve(here,'../src/desktop-service.js'):path.join(resources,'service/src/desktop-service.js');
  const executable=development?(process.env.OBSERVANDA_DESKTOP_NODE??'node'):path.join(resources,'runtime',process.platform==='win32'?'node.exe':'bin/node');
  const preferencesFile=path.join(profile??path.join(os.homedir(),'.observanda'),'preferences.json');
  const env={...process.env};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
  if(!development){env.OBSERVANDA_POSTGRES_BIN=path.join(resources,'postgresql/bin');env.PATH=path.join(resources,'media/bin')+path.delimiter+(env.PATH??'');}
  env.OBSERVANDA_GITHUB_HELPER=path.join(resources,'github/credential-manager/git-credential-manager'+(process.platform==='win32'?'.exe':''));
  env.OBSERVANDA_GITHUB_GIT=path.join(resources,'github/git',process.platform==='win32'?'cmd/git.exe':'bin/git');
  childExited=new Promise(resolve=>{resolveExit=resolve;});
  child=fork(service,[],{execPath:executable,windowsHide:true,silent:true,env,execArgv:[]});
  child.stdout.resume();child.stderr.resume();
  const failed=async message=>{if(stopping)return;await dialog.showMessageBox({type:'error',title:'Observanda could not start',message,detail:'Your saved work has not been removed. Close this window and try again.'});main?.close();};
  child.on('error',()=>{resolveExit();void failed('The bundled application service could not start. Reinstall or repair Observanda.');});
  child.on('exit',code=>{resolveExit();for(const request of stateRequests.values())request.reject(Error('Service stopped'));stateRequests.clear();if(!stopping&&code!==0)void failed('The local service stopped unexpectedly. Saved changes remain in your workspace.');});
  child.on('message',async message=>{
    if(!message||typeof message!=='object')return;
    if(message.type==='shutdown-status'&&Number.isSafeInteger(message.id)&&typeof message.busy==='boolean'&&Number.isFinite(message.failure)){const request=stateRequests.get(message.id);stateRequests.delete(message.id);request?.resolve({busy:message.busy,failure:message.failure});return;}
    if(message.type==='ready'&&launchUrl(message.url)&&main&&!stopping){origin=new URL(message.url).origin;await main.loadURL(message.url);}
    if(message.type==='progress'&&typeof message.message==='string')showProgress(message.message.slice(0,500));
    if(message.type==='failed'&&typeof message.message==='string')void failed(message.message.slice(0,1000));
    if(message.type==='protect'&&process.platform==='darwin'&&Number.isSafeInteger(message.id)){
      let result;try{if(!safeStorage.isEncryptionAvailable()||typeof message.value!=='string'||message.value.length>32768)throw Error();result=message.operation==='encrypt'?safeStorage.encryptString(message.value).toString('base64'):message.operation==='decrypt'?safeStorage.decryptString(Buffer.from(message.value,'base64')):null;}catch{}
      if(child.connected)child.send({type:'protected',id:message.id,...(typeof result==='string'?{value:result}:{error:true})});
    }
  });
  child.send({type:'start',preferencesFile,deviceProtection:process.platform==='darwin'&&safeStorage.isEncryptionAvailable()});
  }).catch(async()=>{await dialog.showMessageBox({type:'error',title:'Observanda could not start',message:'The desktop window could not initialize. Your saved work has not been changed.'});main?.destroy();await stopService();});
}
