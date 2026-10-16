import {readdir,lstat,readFile,readlink,realpath} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {githubRuntimeFiles} from './github-runtime.js';
export async function payloadFiles(root){
 const files=[],base=await realpath(root);async function walk(relative){for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){const name=path.posix.join(relative,entry.name),full=path.join(root,name),stat=await lstat(full);if(stat.isSymbolicLink()){const target=await readlink(full),resolved=await realpath(full);if(path.isAbsolute(target)||!resolved.startsWith(base+path.sep)||(await lstat(resolved)).isDirectory())throw Error('Unsafe payload symlink: '+name);files.push({path:name,target});}else if(stat.isDirectory())await walk(name);else if(stat.isFile()&&name!=='payload.json'){const hash=createHash('sha256');for await(const chunk of createReadStream(full))hash.update(chunk);files.push({path:name,bytes:stat.size,sha256:hash.digest('hex')});}else if(!stat.isFile())throw Error('Unsupported payload entry');}}await walk('');return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function verifyDesktopPayload(root,{sourceRoot}={}){
 const manifest=JSON.parse(await readFile(path.join(root,'payload.json'),'utf8'));
 if(manifest.format!==1||manifest.platform!==process.platform||manifest.arch!==process.arch)throw Error('Build the payload on the matching target architecture first.');
 if(JSON.stringify(await payloadFiles(root))!==JSON.stringify(manifest.files))throw Error('Desktop payload changed after preparation.');
 for(const name of githubRuntimeFiles())if(!manifest.files.some(f=>f.path===name))throw Error('Missing desktop dependency: '+name);
 for(const name of ['service/src/desktop-service.js','service/node_modules/pg/package.json',process.platform==='win32'?'runtime/node.exe':'runtime/bin/node','postgresql/bin/postgres'+(process.platform==='win32'?'.exe':''),'media/bin/ffmpeg'+(process.platform==='win32'?'.exe':''),'media/bin/ffprobe'+(process.platform==='win32'?'.exe':''),'media/LICENSE'])if(!manifest.files.some(f=>f.path===name))throw Error('Missing desktop dependency: '+name);
 if(sourceRoot){
  const sourceFiles=(await payloadFiles(path.join(sourceRoot,'src'))).map(f=>({...f,path:'service/src/'+f.path}));
  const applicationAssets=['package.json','package-lock.json','desktop/icon_black.svg','desktop/icon_white.svg'];
  for(const relative of applicationAssets){
   const bytes=await readFile(path.join(sourceRoot,relative));sourceFiles.push({path:'service/'+relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const order=(a,b)=>a.path.localeCompare(b.path,'en'),same=(a,b)=>a.length===b.length&&a.every((f,i)=>f.path===b[i].path&&f.bytes===b[i].bytes&&f.sha256===b[i].sha256&&f.target===b[i].target);
  const bundled=manifest.files.filter(f=>f.path.startsWith('service/src/')||applicationAssets.some(name=>f.path==='service/'+name));
  if(!same(sourceFiles.sort(order),bundled.sort(order)))throw Error('Desktop payload is stale. Run npm run prepare:desktop with the media bundle before packaging.');
  const application=JSON.parse(await readFile(path.join(sourceRoot,'package.json'),'utf8')),desktop=JSON.parse(await readFile(path.join(sourceRoot,'desktop/package.json'),'utf8'));
  if(application.version!==desktop.version)throw Error('Desktop and application versions must match before packaging.');
 }
 return manifest;
}
