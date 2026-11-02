import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {access,readFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {desktopFixture} from './fixture.js';
import {payloadFiles} from '../../scripts/desktop-payload.js';

// Packaged Electron intentionally refuses the Node main-process inspector.
// Drive its real renderer over a disposable loopback Chromium debugging port.
export async function websiteDesktopFixture(){
 const fixture=await desktopFixture('observanda-installed-website-');
 if(!fixture.packaged&&!process.env.OBSERVANDA_DESKTOP_PREVIOUS_EXECUTABLE)return fixture;
 // Source Electron normally uses a shorter test profile. During an upgrade it
 // must reopen the very same profile selected by the packaged predecessor.
 if(!fixture.packaged)fixture.env.OBSERVANDA_DESKTOP_TEST_HOME=path.join(fixture.directory,'.observanda');
 const candidateVersion=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8')).version;
 const env={...fixture.env};for(const key of ['NODE_OPTIONS','ELECTRON_RUN_AS_NODE','OBSERVANDA_DESKTOP_NODE','OBSERVANDA_POSTGRES_BIN','OBSERVANDA_TEST_POSTGRES_BIN'])delete env[key];
 const endpoint=path.join(fixture.directory,'.observanda','window','DevToolsActivePort');
 async function close(app){
  if(!app)return;
  if(!app.child)return fixture.close(app);
  let timeout;
  try{
   if(app.child.exitCode===null&&app.child.signalCode===null){
    const session=await app.browser.newBrowserCDPSession();
    void session.send('Browser.close').catch(()=>{});
   }
   const exit=await Promise.race([app.exited,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Installed Observanda did not confirm shutdown')),60000);})]);
   assert.deepEqual(exit,[0,null]);
  }finally{clearTimeout(timeout);await app.browser.close().catch(()=>{});}
 }
 return {...fixture,close,async start(program=fixture.packaged,{website=false,expectedVersion=candidateVersion}={}){
  if(!program)return fixture.start(undefined,{website});
  const executable=await realpath(program);
  const resources=process.platform==='darwin'?path.resolve(path.dirname(executable),'../Resources'):path.join(path.dirname(executable),'resources');
  const installed=JSON.parse(await readFile(path.join(resources,'service/package.json'),'utf8'));
  assert.equal(installed.version,expectedVersion);await access(path.join(resources,'app.asar'));
  if(expectedVersion!==candidateVersion){
   // The installer includes separate uncompressed resources. Reject an
   // incomplete predecessor before its older shell can show a native dialog.
   const manifest=JSON.parse(await readFile(path.join(resources,'payload.json'),'utf8'));
   assert.equal(manifest.format,1);assert.equal(manifest.platform,process.platform);assert.equal(manifest.arch,process.arch);
   const actual=new Map((await payloadFiles(resources)).map(row=>[row.path,row]));
   for(const row of manifest.files)assert.deepEqual(actual.get(row.path),row,'Incomplete previous desktop payload: '+row.path);
  }
  await rm(endpoint,{force:true});
  const child=spawn(executable,['--remote-debugging-port=0','--remote-debugging-address=127.0.0.1','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-backgrounding-occluded-windows',...(website?['--website']:[])],{env,windowsHide:true,stdio:'ignore'});
  const exited=once(child,'exit');exited.catch(()=>{});
  let browser;
  try{
   const until=Date.now()+60000;let port=0;
   while(!port){if(child.exitCode!==null||child.signalCode||Date.now()>until)throw Error('Installed renderer did not open its isolated endpoint');
    try{port=Number((await readFile(endpoint,'utf8')).split('\n')[0]);}catch(error){if(error.code!=='ENOENT')throw error;}if(!port)await delay(100);}
   assert.ok(Number.isInteger(port)&&port>0&&port<=65535);
   browser=await chromium.connectOverCDP('http://127.0.0.1:'+port);const context=browser.contexts()[0];
   const system=await browser.newBrowserCDPSession();try{const {processInfo}=await system.send('SystemInfo.getProcessInfo');assert.ok(processInfo.some(p=>p.type==='browser'&&p.id===child.pid));}finally{await system.detach();}
   const page=context.pages()[0]??await context.waitForEvent('page',{timeout:30000});page.setDefaultTimeout(30000);
   return {browser,child,exited,context:()=>context,firstWindow:async()=>page};
  }catch(error){
   if(browser)await close({browser,child,exited});else if(child.pid&&child.exitCode===null)child.kill();
   throw error;
  }
 },async dispose(app){
  if(!app?.child)return fixture.dispose(app);
  try{await close(app);}
  finally{if(app.child.exitCode!==null||app.child.signalCode!==null)await fixture.dispose(null);}
 }};
}
