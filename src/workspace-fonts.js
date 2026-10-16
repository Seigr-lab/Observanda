import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {customFontId,validCustomFont} from './web/font-catalogue.js';
import {fontContainer,MAX_FONT_BYTES} from './font-inspector.js';
const indexFile='.observanda/fonts/library.json',assetFile=id=>'.observanda/fonts/'+id+'.json';
export async function inspectUploadedFont(bytes,{signal}={}){
 signal?.throwIfAborted();try{fontContainer(bytes);}catch{throw new AppError('FONT_INVALID');}
 return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./font-worker.js',import.meta.url),{workerData:bytes,resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:16}});
  let settled=false;const end=(error,info)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);void worker.terminate();error?reject(error):resolve(info);};
  const timer=setTimeout(()=>end(new AppError('FONT_INVALID')),10000),abort=()=>end(signal.reason);signal?.addEventListener('abort',abort,{once:true});
  worker.once('message',result=>end(result.error?new AppError('FONT_INVALID'):null,result.info));worker.once('error',()=>end(new AppError('FONT_INVALID')));worker.once('exit',()=>{if(!settled)end(new AppError('FONT_INVALID'));});
 });
}
export class WorkspaceFonts{
 constructor(workspace){this.workspace=workspace;}
 async list(){const raw=await this.workspace.readMetadata(indexFile,256*1024);if(raw===null)return [];const fonts=JSON.parse(raw);if(!Array.isArray(fonts)||fonts.length>64||fonts.some(f=>!validCustomFont(f))||new Set(fonts.map(f=>f.id)).size!==fonts.length)throw new AppError('FONT_INVALID');return fonts;}
 async import(bytes,{embed=false,signal}={}){
  if(typeof embed!=='boolean')throw new AppError('INVALID');
  const info=await inspectUploadedFont(bytes,{signal});if(embed&&info.restricted)throw new AppError('FONT_EMBED');
  const id='custom-'+info.sha256,entry={id,label:info.label,embed,restricted:info.restricted,hidden:false,faces:[{file:id+'.'+info.extension,style:info.style,weight:info.weight,axes:info.axes}]};
  if(!validCustomFont(entry))throw new AppError('FONT_INVALID');
  return this.workspace.withLock(async()=>{
   signal?.throwIfAborted();const fonts=await this.list(),existing=fonts.find(f=>f.id===id);
   if(existing){existing.hidden=false;existing.embed=embed;await this.workspace.writeMetadata(indexFile,JSON.stringify(fonts));return existing;}
   if(fonts.length>=64)throw new AppError('FONT_LIMIT');
   await this.workspace.writeMetadata(assetFile(id),JSON.stringify({bytes:bytes.toString('base64')}));
   signal?.throwIfAborted();
   fonts.push(entry);await this.workspace.writeMetadata(indexFile,JSON.stringify(fonts));return entry;
  });
 }
 async update(id,{embed,hidden}){if(!customFontId(id)||typeof embed!=='boolean'||typeof hidden!=='boolean')throw new AppError('INVALID');return this.workspace.withLock(async()=>{const fonts=await this.list(),font=fonts.find(f=>f.id===id);if(!font)throw new AppError('FONT_MISSING');if(embed&&font.restricted)throw new AppError('FONT_EMBED');Object.assign(font,{embed,hidden});await this.workspace.writeMetadata(indexFile,JSON.stringify(fonts));return font;});}
 async get(id,{includeSource=false}={}){if(!customFontId(id))throw new AppError('INVALID');const font=(await this.list()).find(f=>f.id===id);if(!font)throw new AppError('FONT_MISSING');const raw=await this.workspace.readMetadata(assetFile(id),Math.ceil(MAX_FONT_BYTES*4/3)+128);if(!raw)throw new AppError('FONT_MISSING');const bytes=Buffer.from(JSON.parse(raw).bytes,'base64');if(createHash('sha256').update(bytes).digest('hex')!==id.slice(7))throw new AppError('FONT_INVALID');return {...font,bytes,...(includeSource?{sourceText:raw}:{})};}
 async files(value,{preview=false,signal}={}){
  signal?.throwIfAborted();
  const ids=new Set();function visit(v){if(v&&typeof v==='object')for(const [key,part] of Object.entries(v)){if(['font','headingFont'].includes(key)&&customFontId(part))ids.add(part);else visit(part);}}visit(value);
  const files=new Map();for(const id of ids){signal?.throwIfAborted();const font=await this.get(id);signal?.throwIfAborted();files.set(id,preview?{...font,embed:true}:font);}return files;
 }
}
