import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {withMutationFilesSession} from './mutation-files.js';
import {nativeMember} from './native-storage-tree.js';
import {temporaryWriteName} from './storage-temporary.js';
import {createHash} from 'node:crypto';
import {writeFilePart} from './segmented-file-io.js';
import {AppError} from './errors.js';

const scopes=new AsyncLocalStorage();
const inside=(root,file)=>{const relative=path.relative(root,path.resolve(file));return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
export const nativeDestination=file=>[...(scopes.getStore()??[])].reverse().find(scope=>scope.active&&inside(scope.root,file));

export async function* nativeFileBlocks(handle,chunkSize,signal,limit=Number.MAX_SAFE_INTEGER){
 const before=await handle.stat({bigint:true});if(before.size>BigInt(limit))throw new AppError('LIMIT');
 for(let position=0;position<Number(before.size);){
  signal?.throwIfAborted();const bytes=Buffer.allocUnsafe(Math.min(chunkSize,Number(before.size)-position));
  const {bytesRead}=await handle.read(bytes,0,bytes.length,position);if(!bytesRead)throw new AppError('CONFLICT');
  position+=bytesRead;yield bytes.subarray(0,bytesRead);
 }
 const after=await handle.stat({bigint:true});
 if(['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key]!==after[key]))throw new AppError('CONFLICT');
}

// A transfer keeps both directory objects until publication. Metadata helpers
// use this scope too; moving a name cannot redirect a later archive or marker.
export function withNativeDestination(root,operation){
 root=path.resolve(root);if(root===path.parse(root).root)throw new AppError('STORAGE_PATH');
 const prior=(scopes.getStore()??[]).find(scope=>scope.active&&scope.root===root);if(prior)return operation(prior);
 return withMutationFilesSession(async service=>{
  let parent,directory,internal,active=true;
  const scope={root,
   get active(){return active;},
   get identity(){return directory?.identity;},get internalIdentity(){return internal?.identity;},get directory(){return directory;},get internalDirectory(){return internal;},
   async admit({prepare=false,createInternal=false,identity,internalIdentity}={}){
    if(!active)throw new AppError('IO');
    if(directory){if(prepare)throw new AppError('EXISTS');if(identity&&identity!==directory.identity||internalIdentity&&internalIdentity!==internal?.identity)throw new AppError('STORAGE_COPY');return;}
    const container=(scopes.getStore()??[]).findLast(value=>value.active&&value!==scope&&inside(value.root,root));
    const open=async(parent,name)=>{directory=await parent.directory(name,{missing:prepare});if(!directory)directory=await parent.directory(name,{create:true,exclusive:true});};
    if(container)await container.member(root,open);
    else{parent=await service.open(path.dirname(root));await open(parent,path.basename(root));}
    if(identity&&directory.identity!==identity)throw new AppError('STORAGE_COPY');
    if(prepare){for await(const _entry of directory.entries())throw new AppError('EXISTS');}
    internal=await directory.directory('.observanda',{create:prepare||createInternal,exclusive:prepare});
    if(internalIdentity&&internal.identity!==internalIdentity)throw new AppError('STORAGE_COPY');
    await scope.assertNamed();
   },
   async assertNamed(){
    if(!active||!directory||!internal)throw new AppError('STORAGE_COPY');let current,child;
    try{current=await service.open(root);if(current.identity!==directory.identity)throw new AppError('STORAGE_COPY');child=await current.directory('.observanda');if(child.identity!==internal.identity)throw new AppError('STORAGE_COPY');}
    finally{await child?.close();await current?.close();}
   },
   async member(file,operation,options={}){
    if(!active||!directory||!internal||!inside(root,file))throw new AppError('STORAGE_COPY');
    const relative=path.relative(root,path.resolve(file)).split(path.sep).join('/');
    return relative.startsWith('.observanda/')?nativeMember(internal,relative.slice('.observanda/'.length),operation,options):nativeMember(directory,relative,operation,options);
   },
   async write(file,content){
    const bytes=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8');
    return scope.member(file,async(parent,name)=>{const temporary=temporaryWriteName();let identity,handle,failed=false;
     try{handle=await parent.file(temporary,{mode:'exclusive'});identity=handle.identity;await writeFilePart(handle,bytes,0);await handle.sync();await handle.close();handle=null;await parent.rename(temporary,parent,name,{identity,replace:true});}
     catch(error){failed=true;throw error;}
     finally{try{await handle?.close();if(identity)await parent.remove(temporary,{identity}).catch(error=>{if(error.code!=='ENOENT')throw error;});}catch(error){if(!failed)throw error;}}
    });
   },
   async stat(file,{missing=false,directory:folder=false}={}){
    if(!active)throw new AppError('IO');
    const target=path.resolve(file);if(target===root||target===path.join(root,'.observanda')){if(!directory||!internal)throw new AppError('STORAGE_COPY');if(!folder)throw new AppError('UNSAFE');return {identity:target===root?directory.identity:internal.identity,isDirectory:()=>true,isFile:()=>false,isSymbolicLink:()=>false};}
    return scope.member(file,async(parent,name)=>{const value=await parent?.stat(name,{folder,missing});return value?{...value,size:value.bytes,nlink:value.links,isDirectory:()=>folder,isFile:()=>!folder,isSymbolicLink:()=>false}:null;},{missing});
   },
   async *stream(file,{signal,chunkSize=1024*1024}={}){
    if(!Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>1114112)throw new AppError('INVALID');
    const handle=await scope.member(file,(parent,name)=>parent.file(name));
    try{yield* nativeFileBlocks(handle,chunkSize,signal);}finally{await handle.close();}
   },
   async read(file,{limit=32*1024*1024,encoding,missing=false}={}){
    if(!Number.isSafeInteger(limit)||limit<0)throw new AppError('INVALID');
    const handle=await scope.member(file,(parent,name)=>parent?.file(name,{missing}),{missing});if(!handle)return null;
    try{
     const parts=[];for await(const bytes of nativeFileBlocks(handle,1024*1024,undefined,limit))parts.push(bytes);
     const value=Buffer.concat(parts);return encoding?value.toString(encoding):value;
    }finally{await handle.close();}
   },
   async hash(file,options){const hash=createHash('sha256');for await(const bytes of scope.stream(file,options))hash.update(bytes);return hash.digest('hex');},
   async remove(file,{missing=false}={}){return scope.member(file,async(parent,name)=>{const stat=await parent?.stat(name,{missing});if(stat)await parent.remove(name,{identity:stat.identity});},{missing});},
   async ensure(relative){
    if(!active)throw new AppError('IO');
    const target=path.resolve(root,relative);if(!inside(root,target))throw new AppError('UNSAFE');if(target===root){if(!directory)throw new AppError('STORAGE_COPY');return target;}
    await scope.member(path.join(target,'.directory-admission'),async()=>{},{create:true});return target;
   }
  };
  try{return await scopes.run([...(scopes.getStore()??[]),scope],()=>operation(scope));}
  finally{active=false;await internal?.close();await directory?.close();await parent?.close();}
 });
}

export async function removeDestinationFile(file,options){
 const scope=nativeDestination(file);if(!scope)throw new AppError('STORAGE_COPY');return scope.remove(file,options);
}
