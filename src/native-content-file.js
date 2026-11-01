import path from 'node:path';
import {withMutationFilesSession} from './mutation-files.js';
import {nativeMember} from './native-storage-tree.js';
import {AppError} from './errors.js';
import {nativeDestination} from './native-destination.js';
// Admission starts at the storage owner, never at an untrusted leaf parent.
// The callback keeps its parent handle for all reads, writes and publication.
export function withNativeContentFile(workspace,file,operation,{create=false}={}){
 const relative=path.relative(workspace.root,file);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new AppError('UNSAFE');
 const admitted=nativeDestination(file);if(admitted)return admitted.member(file,operation,{create});
 return withMutationFilesSession(async service=>{const root=await service.open(workspace.root);try{return await nativeMember(root,relative.split(path.sep).join('/'),operation,{create});}finally{await root.close();}});
}
