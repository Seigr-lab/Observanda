import {_electron as electron} from '@playwright/test';
import {access,mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export async function desktopFixture(prefix='observanda-desktop-test-'){
 const directory=await mkdtemp(path.join(os.tmpdir(),prefix));
 for(const folder of ['roaming','local','Desktop','Downloads'])await mkdir(path.join(directory,folder));
 const packaged=process.env.OBSERVANDA_DESKTOP_EXECUTABLE;
 const screenshots=process.env.OBSERVANDA_DESKTOP_SCREENSHOTS==='1';
 const env={...process.env,OBSERVANDA_DESKTOP_TEST_HOME:directory,OBSERVANDA_DESKTOP_NODE:process.execPath,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN??path.resolve('.local/postgresql/runtime/pgsql/bin'),OBSERVANDA_DATABASE_URL:'',USERPROFILE:directory,HOME:directory,APPDATA:path.join(directory,'roaming'),LOCALAPPDATA:path.join(directory,'local')};
 delete env.ELECTRON_RUN_AS_NODE;
 async function close(app){
  // Preview preparation can still be finishing when a journey closes its
  // window. Make the native decision explicitly, keeping the real service
  // drain and window-close guard in use.
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async(...args)=>{
   const options=args.at(-1);
   if(options.title!=='Work is still running')throw Error('Unexpected close dialog: '+options.title);
   return {response:1};
  };});
  await app.close();
 }
 return {directory,env,packaged,
  close,
  async start(executablePath=packaged){
   // A source-comparison checkout may omit generated desktop assets. Report
   // that in the test runner before launching a window or a native error box.
   if(!executablePath)for(const name of ['icon.png','icon-black.png','icon-white.png','locales/en/close.json']){
    await access(path.resolve('desktop',name)).catch(()=>{throw Error('Desktop test asset is missing: '+name+'. Prepare desktop assets before launching the test.');});
   }
   const app=await electron.launch({...(executablePath?{executablePath}:{}),args:executablePath?[]:[path.resolve('desktop')],env,timeout:30000});
   await app.firstWindow();await app.evaluate(({BrowserWindow},screenshots)=>BrowserWindow.getAllWindows().forEach(window=>{window.webContents.setBackgroundThrottling(false);if(screenshots)window.showInactive();else{window.on('show',()=>window.hide());window.hide();}}),screenshots);return app;
  },
  async screenshot(app,file){
   // Hidden Windows compositors do not reliably produce screenshots. Opt in
   // during a visible review; ordinary automation still asserts the UI and data.
   if(screenshots)await (await app.firstWindow()).screenshot({path:file});
  },
  async download(app,activate){
   const file=path.join(directory,'Downloads',randomUUID());
   // The app owns a partitioned Electron session. Capture that session's native
   // download, setting its destination before Electron can open a Save dialog.
   await app.evaluate(({BrowserWindow},file)=>{
    const contents=BrowserWindow.getAllWindows()[0].webContents,task={session:contents.session};
    task.done=new Promise(resolve=>{
     task.capture=(_event,item)=>{
      item.setSavePath(file);
      item.once('done',(_event,state)=>resolve({state,name:item.getFilename(),bytes:item.getReceivedBytes()}));
     };
     task.session.once('will-download',task.capture);
    });
    globalThis.observandaTestDownload=task;
   },file);
   try{
    await activate();
    const receipt=await app.evaluate(async()=>{
     let timer;try{return await Promise.race([globalThis.observandaTestDownload.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Desktop download did not complete')),45000);})]);}finally{clearTimeout(timer);}
    });
    if(receipt.state!=='completed')throw Error('Desktop download '+receipt.state);return {...receipt,file};
   }finally{
    await app.evaluate(()=>{const task=globalThis.observandaTestDownload;task?.session.removeListener('will-download',task.capture);delete globalThis.observandaTestDownload;}).catch(()=>{});
   }
  },
  async dispose(app){
   if(app){await app.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await close(app);}
   await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
 };
}
