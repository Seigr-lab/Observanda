import path from 'node:path';
import {temporaryWriteName} from './storage-temporary.js';
import {writeFilePart} from './segmented-file-io.js';
import {AppError} from './errors.js';

// Every traversal stays relative to retained directory objects. A substituted
// name can abort cleanup, but cannot redirect it to another tree.
export async function removeNativeRuntimeTree(parent,name,{identity,missing=false}={}){
 const root=await parent?.directory(name,{missing});if(!root)return;
 try{
  if(identity&&root.identity!==identity)throw new AppError('UNSAFE');
  for await(const entry of root.entries()){
   if(entry.directory)await removeNativeRuntimeTree(root,entry.name);
   else{const value=await root.stat(entry.name);await root.remove(entry.name,{identity:value.identity});}
  }
 }finally{await root.close();}
 await parent.remove(name,{folder:true,identity:root.identity});
}

export function postgresRuntimeFiles(guard){
 if(guard.files)return guard.files;
 if(typeof guard.member!=='function')throw new AppError('DATABASE_GUARD_UNAVAILABLE');
 const relative=file=>{const value=path.relative(guard.directory,path.resolve(file));if(!value||value==='..'||value.startsWith('..'+path.sep)||path.isAbsolute(value))throw new AppError('UNSAFE');return value.split(path.sep).join('/');};
 const member=(file,operation,options)=>guard.member(relative(file),operation,options);
 return {
  async stat(file,{directory:folder=false,missing=false}={}){
   relative(file);
   const value=await member(file,(parent,name)=>parent?.stat(name,{folder,missing}),{missing});return value?{...value,size:value.bytes}:null;
  },
  async read(file,{limit=16384,encoding}={}){
   relative(file);const bytes=(await member(file,(parent,name)=>parent.read(name,{limit}))).bytes;
   return encoding?bytes.toString(encoding):bytes;
  },
  async write(file,content){
   relative(file);
   const bytes=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8');
   return member(file,async(parent,name)=>{const temporary=temporaryWriteName();let handle,identity;
    try{handle=await parent.file(temporary,{mode:'exclusive'});identity=handle.identity;await writeFilePart(handle,bytes,0);await handle.sync();await handle.close();handle=null;await parent.rename(temporary,parent,name,{identity,replace:true});identity=null;}
    finally{await handle?.close();if(identity)await parent.remove(temporary,{identity}).catch(error=>{if(error.code!=='ENOENT')throw error;});}
   });
  },
  async removeTree(file){relative(file);return member(file,(parent,name)=>removeNativeRuntimeTree(parent,name,{missing:true}),{missing:true});},
  async rename(source,target){
   relative(source);relative(target);
   return member(source,async(parent,name)=>{const value=await parent.stat(name,{folder:true});return member(target,(destination,member)=>parent.rename(name,destination,member,{folder:true,identity:value.identity}));});
  },
  async unlink(file){
   relative(file);
   return member(file,async(parent,name)=>{const value=await parent?.stat(name,{missing:true});if(value)await parent.remove(name,{identity:value.identity});},{missing:true});
  }
 };
}
