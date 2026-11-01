import {AsyncLocalStorage} from 'node:async_hooks';
import {windowsMutationFiles} from './windows-mutation-files.js';
import {posixMutationFiles} from './posix-mutation-files.js';
import {diagnosticCount} from './operational-diagnostics.js';
const active=new AsyncLocalStorage();
let idle;
async function acquire(){const cached=idle;if(cached){idle=null;clearTimeout(cached.timer);return cached.service;}diagnosticCount('nativeFilesystemStarts');return process.platform==='win32'?windowsMutationFiles():posixMutationFiles();}
function release(service){
 // Only a successful, inactive session is reused. Concurrent operations each
 // own their helper, and cancellation cannot poison another active session.
 const previous=idle;if(previous){clearTimeout(previous.timer);void previous.service.close().catch(()=>{});}
 const cached={service};cached.timer=setTimeout(()=>{if(idle===cached){idle=null;void service.close().catch(()=>{});}},1000);cached.timer.unref();idle=cached;
}
export async function closeIdleMutationFiles(){const cached=idle;if(cached){idle=null;clearTimeout(cached.timer);await cached.service.close();}}
export const nativeMutationSupported=['win32','linux','darwin'].includes(process.platform);
export async function withMutationFilesSession(operation){
 if(!nativeMutationSupported)throw new Error('Unsupported filesystem target');
 const existing=active.getStore();if(existing?.active)return operation(existing.service);
 const service=await acquire(),context={service,active:true};let succeeded=false;
 try{const value=await active.run(context,()=>operation(service));succeeded=true;return value;}finally{context.active=false;if(succeeded)release(service);else await service.close();}
}
