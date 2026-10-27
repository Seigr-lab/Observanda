import path from 'node:path';
import {lstat,unlink,rmdir,opendir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {privateDirectory,assertRegular} from './storage.js';
import {FileContent,writeContent,contentStream,contentSize,contentHash} from './file-content.js';
import {MAX_FONT_BYTES} from './font-inspector.js';
import {researchId} from './web/research-reference.js';
import {WEBSITE_THEME_MAGIC,WEBSITE_THEME_MANIFEST_LIMIT,validWebsiteTheme,themeHash} from './web/website-theme-model.js';
const invalid=()=>{throw new AppError('INVALID');},prefix='.observanda/theme-exchange';
export const themeDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class ThemeReader{
 constructor(source,{signal,check=async()=>{}}={}){this.iterator=source[Symbol.asyncIterator]();this.buffer=Buffer.alloc(0);this.signal=signal;this.check=check;this.ended=false;}
 async more(){this.signal?.throwIfAborted();await this.check();const next=await this.iterator.next();this.ended=Boolean(next.done);this.buffer=next.done?Buffer.alloc(0):Buffer.from(next.value);return !this.ended;}
 async *take(size){if(!Number.isSafeInteger(size)||size<0)invalid();while(size){if(!this.buffer.length&&!await this.more())invalid();const length=Math.min(size,this.buffer.length,1024*1024);yield this.buffer.subarray(0,length);this.buffer=this.buffer.subarray(length);size-=length;}}
 async bytes(size){const parts=[];for await(const p of this.take(size))parts.push(p);return Buffer.concat(parts,size);}
 async line(limit){const parts=[];let length=0;for(;;){if(!this.buffer.length&&!await this.more())invalid();const at=this.buffer.indexOf(10),size=at<0?this.buffer.length:at+1;length+=size;if(length>limit)invalid();parts.push(this.buffer.subarray(0,size));this.buffer=this.buffer.subarray(size);if(at>=0)return Buffer.concat(parts).toString('utf8');}}
 async end(){while(!this.buffer.length&&!this.ended)await this.more();if(this.buffer.length)invalid();}
 async close(){await this.iterator.return?.();}
}
export class WebsiteThemeResources{
 constructor(workspace){this.workspace=workspace;}
 directory(id){if(!researchId(id))invalid();return path.join(this.workspace.root,...prefix.split('/'),id);}
 async create(value,{register}={}){const id=randomUUID(),stage={version:1,id,createdAt:Date.now(),...value,resources:[]};await register?.(stage);await privateDirectory(this.workspace.root,prefix+'/'+id);await this.save(stage);return stage;}
 async save(stage){await this.workspace.writeFile(path.join(this.directory(stage.id),'stage.json'),JSON.stringify(stage));}
 async read(id,sha256){const file=path.join(this.directory(id),'stage.json');await assertRegular(path.dirname(file),{directory:true});const stat=await assertRegular(file);if(stat.size>2*WEBSITE_THEME_MANIFEST_LIMIT+8*1024*1024)invalid();const stage=JSON.parse(await this.workspace.readFile(file,'utf8'));
  if(stage.version!==1||stage.id!==id||!['export','import'].includes(stage.mode)||!Number.isSafeInteger(stage.createdAt)||!Array.isArray(stage.resources)||stage.resources.some(r=>!researchId(r.id)||!Number.isSafeInteger(r.size)||r.size<1||!themeHash(r.sha256))||stage.manifest&&!validWebsiteTheme(stage.manifest)||sha256!==undefined&&themeDigest(stage.manifest)!==sha256)invalid();return stage;
 }
 content(stage,resource){return new FileContent(this.workspace,path.join(this.directory(stage.id),resource.id),resource.size,resource.sha256);}
 async add(stage,id,source,{size,sha256,signal,check,reserveBytes=0}={}){if(!researchId(id)||stage.resources.some(r=>r.id===id))invalid();
  const result=await writeContent(this.workspace,path.join(this.directory(stage.id),id),source,{maxBytes:size,reserveBytes,signal,expected:{size,sha256},beforeCommit:saved=>{if(saved.size!==size||saved.sha256!==sha256)invalid();return check?.();}});
  const descriptor={id,...result};stage.resources.push(descriptor);await this.save(stage);return descriptor;
 }
 async remove(stage,{removeImported=false}={}){
  if(removeImported)for(const value of stage.imported??[]){if(!researchId(value.id)||!['image','audio','video'].includes(value.kind))invalid();const directory=path.join(this.workspace.root,'.observanda','media',value.id);await assertRegular(directory,{directory:true,missing:true});for(const file of ['original','asset.json','public.'+({image:'png',audio:'wav',video:'mp4'}[value.kind])])await unlink(path.join(directory,file)).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  const directory=this.directory(stage.id);await assertRegular(directory,{directory:true,missing:true});
  if(await lstat(directory).catch(e=>{if(e.code==='ENOENT')return null;throw e;})){for await(const entry of await opendir(directory)){if(!researchId(entry.name))continue;const file=path.join(directory,entry.name);await assertRegular(file);await unlink(file);}}await unlink(path.join(directory,'stage.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory).catch(e=>{if(e.code!=='ENOENT')throw e;});
 }
 async receive(source,target,{signal,check,maxResourceBytes=0,reserveBytes=0,register}={}){
  const reader=new ThemeReader(source,{signal,check});let stage;
  try{if(await reader.line(64)!==WEBSITE_THEME_MAGIC)invalid();const line=await reader.line(24);if(!/^[1-9][0-9]*\n$/.test(line))invalid();const size=Number(line);if(!Number.isSafeInteger(size)||size>WEBSITE_THEME_MANIFEST_LIMIT)throw new AppError('LIMIT');
   const raw=await reader.bytes(size),text=raw.toString('utf8');if(!Buffer.from(text).equals(raw))invalid();const manifest=JSON.parse(text);if(!validWebsiteTheme(manifest))invalid();if(manifest.resources.some(r=>r.kind==='font'&&r.size>MAX_FONT_BYTES||r.kind==='font-license'&&r.size>1024*1024||['image','audio','video'].includes(r.kind)&&maxResourceBytes&&r.size>maxResourceBytes))throw new AppError('MEDIA_LIMIT');stage=await this.create({mode:'import',target,manifest},{register});
   for(const r of manifest.resources)await this.add(stage,r.id,reader.take(r.size),{...r,signal,check,reserveBytes});
   await reader.end();await check?.();return stage;
  }catch(error){if(stage)await this.remove(stage);throw error;}finally{await reader.close();}
 }
 async *stream(stage,{signal,check=async()=>{}}={}){
  const raw=Buffer.from(JSON.stringify(stage.manifest));if(raw.length>WEBSITE_THEME_MANIFEST_LIMIT||!validWebsiteTheme(stage.manifest))invalid();await check();yield Buffer.from(WEBSITE_THEME_MAGIC+raw.length+'\n');yield raw;
  for(const r of stage.manifest.resources){const descriptor=stage.resources.find(v=>v.id===r.id);if(!descriptor||descriptor.size!==r.size||descriptor.sha256!==r.sha256)invalid();await check();for await(const bytes of this.content(stage,descriptor).read(0,descriptor.size-1,{signal})){await check();yield bytes;}}
 }
}
