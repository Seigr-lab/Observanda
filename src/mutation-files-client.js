import path from 'node:path';
import {AppError} from './errors.js';
import {atomicReplace} from './atomic-replace.js';
const missing=(error,allowed)=>{if(allowed&&error.code==='ENOENT')return null;throw error;};
const name=value=>{if(typeof value!=='string'||!value||value==='.'||value==='..'||/[\\/\0]/.test(value))throw new AppError('UNSAFE');return value;};
const binary=value=>Buffer.isBuffer(value)?value:typeof value==='string'?Buffer.from(value,'base64'):Buffer.from(value);
export function mutationFilesClient(call,stop){
 const handles=new Set();let closing;
 class Handle{
  constructor({id,identity}){this.id=id;this.identity=identity;this.closed=false;handles.add(this);}
  request(operation,data={},options){if(this.closed)throw new AppError('IO');return call({operation,directory:this.id,...data},options);}
  async close(){if(this.closed)return;this.closed=true;handles.delete(this);await call({operation:'close',directory:this.id});}
 }
 class File extends Handle{
  async stat({bigint=false}={}){const value=await this.request('file-stat'),result=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,bigint?BigInt(v):Number(v)]));return {...result,isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false};}
  // One frame includes a full 1 MiB encrypted block and its authentication
  // envelope, avoiding a second round trip for a few trailing bytes.
  async read(buffer,offset,length,position){const value=await this.request('file-read',{bytes:Math.min(length,1114112),position}),bytes=binary(value.data);if(bytes.length>length)throw new AppError('IO');bytes.copy(buffer,offset);return {bytesRead:bytes.length,buffer};}
  async write(buffer,offset,length,position){const bytes=buffer.subarray(offset,offset+Math.min(length,1114112));await this.request('file-write',{bytes:bytes.length,position},{stream:[bytes]});return {bytesWritten:bytes.length,buffer};}
  sync(){return this.request('file-sync');}
  truncate(bytes){return this.request('file-truncate',{bytes});}
 }
 class Directory extends Handle{
  async directory(member,{create=false,exclusive=false,missing:optional=false}={}){if(exclusive&&!create)throw new AppError('INVALID');try{return new Directory(await this.request('directory',{name:name(member),create,exclusive}));}catch(error){return missing(error,optional);}}
  async file(member,{mode='read',missing:optional=false}={}){if(!['read','update','exclusive'].includes(mode))throw new AppError('INVALID');try{return new File(await this.request('file-open',{name:name(member),mode}));}catch(error){return missing(error,optional);}}
  async lease(member){return new Handle(await this.request('lease',{name:name(member)}));}
  async stat(member,{folder=false,links=false,missing:optional=false}={}){try{return await this.request('stat',{name:name(member),folder,links});}catch(error){return missing(error,optional);}}
  async hash(member,{links=false,missing:optional=false}={}){try{return await this.request('hash',{name:name(member),links});}catch(error){return missing(error,optional);}}
  async read(member,{limit=16384,missing:optional=false}={}){try{const value=await this.request('read',{name:name(member),limit});return {bytes:binary(value.data),identity:value.identity};}catch(error){return missing(error,optional);}}
  async *entries(){let restart=true;for(;;){const page=await this.request('list',{restart});if(!page||!Array.isArray(page.entries)||typeof page.done!=='boolean')throw new AppError('UNSAFE');for(const entry of page.entries)yield entry;if(page.done)return;restart=false;}}
  write(member,stream,{bytes,sha256,...options}){return this.request('write',{name:name(member),bytes,sha256},{...options,stream});}
  copy(source,sourceName,member,{bytes,sha256,...options}){if(!handles.has(source)||source.closed)throw new AppError('UNSAFE');return this.request('copy',{sourceDirectory:source.id,source:name(sourceName),name:name(member),bytes,sha256},options);}
  move(operation,member,target,targetName,{folder=false,links=false,identity,replace=false}={}){if(!handles.has(target)||target.closed)throw new AppError('UNSAFE');return this.request(operation,{name:name(member),targetDirectory:target.id,target:name(targetName),folder,links,replace,...(identity?{identity}:{})});}
  rename(member,target,targetName,options){return atomicReplace(member,targetName,{replace:()=>this.move('rename',member,target,targetName,options),persist:async()=>{}});}
  link(member,target,targetName,options){return this.move('link',member,target,targetName,options);}
  remove(member,{folder=false,links=false,identity}={}){return this.request('delete',{name:name(member),folder,links,...(identity?{identity}:{})});}
 }
 return {async open(root){if(typeof root!=='string'||!path.isAbsolute(root))throw new AppError('UNSAFE');return new Directory(await call({operation:'root',path:root}));},close:()=>closing??=(async()=>{try{for(const handle of [...handles])await handle.close();}finally{await stop();}})()};
}
