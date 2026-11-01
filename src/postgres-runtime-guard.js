import path from 'node:path';
import {nativeDestination} from './native-destination.js';
import {AppError} from './errors.js';

export async function acquirePostgresRuntimeGuard(options){
 const directory=path.resolve(options.directory),scope=nativeDestination(directory);let {parentIdentity,expectedIdentity}=options;
 if(scope)await scope.member(directory,async(parent,name)=>{const current=(await parent.stat(name,{folder:true,missing:true}))?.identity;if(parentIdentity&&parentIdentity!==parent.identity||expectedIdentity&&expectedIdentity!==current)throw new AppError('STORAGE_COPY');parentIdentity=parent.identity;expectedIdentity=current;});
 const admitted={...options,directory,parentIdentity,expectedIdentity};
 if(process.platform==='win32'){const {acquireWindowsPostgresRuntimeGuard}=await import('./windows-postgres-runtime-guard.js');return acquireWindowsPostgresRuntimeGuard(admitted);}
 if(process.platform==='linux'||process.platform==='darwin'){const {acquirePosixPostgresRuntimeGuard}=await import('./posix-postgres-runtime-guard.js');return acquirePosixPostgresRuntimeGuard(admitted);}
 throw new AppError('DATABASE_GUARD_UNAVAILABLE');
}
