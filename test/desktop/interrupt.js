import assert from 'node:assert/strict';
import {once} from 'node:events';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

// Interrupt only the actual Electron main process for a source desktop fixture.
// Windows Playwright's launcher PID is the command shell. A replacement
// desktop must reopen storage after the former listener has gone away.
export async function interruptDesktop(app,fixture){
 const {profile,packaged,pid}=await app.evaluate(({app})=>({profile:app.getPath('userData'),packaged:app.isPackaged,pid:process.pid}));
 assert.equal(packaged,false);
 assert.equal(path.resolve(profile),path.resolve(fixture.directory,'window'));
 assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid!==process.pid);
 const page=await app.firstWindow(),endpoint=new URL('/api/health',page.url());
 assert.equal(endpoint.protocol,'http:');assert.equal(endpoint.hostname,'127.0.0.1');
 const responding=()=>fetch(endpoint,{signal:AbortSignal.timeout(2000)}).then(async response=>{await response.body?.cancel();return true;},error=>{
  if(error.cause?.code==='ECONNREFUSED'||error.cause?.code==='ECONNRESET')return false;
  throw error;
 });
 assert.ok(await responding(),'The disposable service must respond before terminating its desktop.');
 const exited=once(app.process(),'exit',{signal:AbortSignal.timeout(20000)});
 process.kill(pid,'SIGKILL');await exited;
 const deadline=Date.now()+45000;
 while(await responding()){
  if(Date.now()>=deadline)throw Error('The disposable service continued to accept connections after its desktop process exited.');
  await delay(250);
 }
 return pid;
}
