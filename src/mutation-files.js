import {AsyncLocalStorage} from 'node:async_hooks';
import {windowsMutationFiles} from './windows-mutation-files.js';
import {posixMutationFiles} from './posix-mutation-files.js';
const active=new AsyncLocalStorage();
export const nativeMutationSupported=['win32','linux','darwin'].includes(process.platform);
export async function withMutationFilesSession(operation){
 if(!nativeMutationSupported)throw new Error('Unsupported filesystem target');
 const existing=active.getStore();if(existing)return operation(existing);
 const service=await (process.platform==='win32'?windowsMutationFiles():posixMutationFiles());
 try{return await active.run(service,()=>operation(service));}finally{await service.close();}
}
