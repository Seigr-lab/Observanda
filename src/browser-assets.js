import {readFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {startupAssets} from './startup-assets.js';
import {AppError} from './errors.js';

const limit=8*1024*1024,hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const invalid=()=>{throw new AppError('BROWSER_ASSETS_INVALID');};
// Only explicitly inventoried application files enter this registry. Source
// development stays uncached; only verified content-addressed package chunks
// receive public immutable caching. API and preview responses never enter it.
export class BrowserAssets{
 constructor({cacheBytes=16*1024*1024,cacheEntries=256}={}){Object.assign(this,{cacheBytes,cacheEntries});this.entries=new Map();this.cache=new Map();this.pending=new Map();this.bytes=0;this.reads=0;}
 has(name){return this.entries.has(name);}
 set(name,bytes){this.entries.set(name,{bytes:Buffer.from(bytes)});return this;}
 file(name,url,descriptor={}){this.entries.set(name,{url,...descriptor});return this;}
 remember(name,bytes){
  if(bytes.length>this.cacheBytes)return;
  while(this.cache.size&&(this.cache.size>=this.cacheEntries||this.bytes+bytes.length>this.cacheBytes)){const [key,value]=this.cache.entries().next().value;this.bytes-=value.length;this.cache.delete(key);}
  this.cache.set(name,bytes);this.bytes+=bytes.length;
 }
 async read(name){
  const entry=this.entries.get(name);if(!entry)throw new AppError('NOT_FOUND');if(entry.bytes)return entry.bytes;
  const cached=this.cache.get(name);if(cached){this.cache.delete(name);this.cache.set(name,cached);return cached;}
  if(this.pending.has(name))return this.pending.get(name);if(this.pending.size>=16)throw new AppError('WORKLOAD_BUSY');
  const task=(async()=>{
   const stat=await lstat(entry.url);if(!stat.isFile()||stat.size>limit||entry.size!==undefined&&stat.size!==entry.size)invalid();
   const bytes=await readFile(entry.url);if(bytes.length>limit||entry.sha256&&(bytes.length!==entry.size||hash(bytes)!==entry.sha256))invalid();
   this.reads++;this.remember(name,bytes);return bytes;
  })();this.pending.set(name,task);try{return await task;}finally{this.pending.delete(name);}
 }
 async response(name){const bytes=await this.read(name),entry=this.entries.get(name);return {bytes,cacheControl:entry.immutable?'public, max-age=31536000, immutable':'no-store',etag:entry.immutable?'"'+entry.sha256+'"':null};}
 statistics(){return {files:this.entries.size,reads:this.reads,cached:this.cache.size,cacheBytes:this.bytes,pending:this.pending.size};}
}

export async function createBrowserAssets({directory=new URL('./web/',import.meta.url),builtDirectory=new URL('./web-build/',import.meta.url)}={}){
 const assets=new BrowserAssets();
 async function discover(location,prefix=''){
  for(const entry of await readdir(location,{withFileTypes:true})){
   const name=prefix+entry.name,url=new URL(entry.name+(entry.isDirectory()?'/':''),location);
   if(entry.isDirectory())await discover(url,name+'/');else if(entry.isFile()&&/[.](?:js|css|html|txt|json)$/.test(entry.name))assets.file(name,url);
  }
 }
 await discover(directory);
 let manifest;try{const url=new URL('manifest.json',builtDirectory);if((await lstat(url)).size>1024*1024)invalid();manifest=JSON.parse(await readFile(url,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(manifest!==undefined){
  if(!manifest||manifest.version!==1||!Array.isArray(manifest.files)||manifest.files.length>2048||!/^assets\/app-[A-Z0-9]+\.js$/.test(manifest.entry))invalid();
  const names=new Set();for(const file of manifest.files){
   if(!file||!['index.html',manifest.entry].includes(file.path)&&!/^assets\/[A-Za-z0-9_-]+-[A-Z0-9]+\.(?:js|css)$/.test(file.path)||names.has(file.path)||!Number.isSafeInteger(file.size)||file.size<0||file.size>limit||!/^[a-f0-9]{64}$/.test(file.sha256))invalid();
   names.add(file.path);assets.file(file.path,new URL(file.path,builtDirectory),{size:file.size,sha256:file.sha256,immutable:file.path!=='index.html'});
  }
  if(!names.has('index.html')||!names.has(manifest.entry))invalid();
 }
 const initial=new Map([['index.html',await assets.read('index.html')],['startup.js',await assets.read('startup.js')]]);startupAssets(initial);for(const [name,bytes] of initial)assets.set(name,bytes);
 return assets;
}
