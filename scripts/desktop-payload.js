import {readdir,lstat,readFile,readlink,realpath,mkdtemp,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {githubRuntimeFiles} from './github-runtime.js';
import {pdfValidationRuntimeFiles} from './pdf-validation-runtime.js';
import {buildBrowser} from './browser-build.js';
import languages from '../src/web/locales/languages.json' with {type:'json'};
// Native UI uses the same source catalogues and interpolation rules as the web
// app; these files are copied by prepare-desktop's complete src payload step.
export const desktopLocalizationFiles=()=>['service/src/desktop-localization.js','service/src/web/i18n/runtime.js','service/src/web/locales/languages.json',...languages.flatMap(({id})=>['desktopShell','errors'].map(name=>'service/src/web/locales/'+id+'/'+name+'.json'))];
// Node's official SHASUMS256.txt pins each complete target archive/executable.
export const desktopNodeVersion='24.22.1';
export const desktopNodeHashes=Object.freeze({
 'win32-x64':'d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5',
 'darwin-x64':'d132557e7ee2b85af08b0c8c34338e65c6430f2238d01f727728ef42dc83b035',
 'darwin-arm64':'89c682593d76cd44233fa53b1563264e7de9cbb189cad169135c5b4fadfbc0a7',
 'linux-x64':'eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c'
});
export function assertDesktopBuildTarget({platform=process.platform,arch=process.arch,osRelease=''}={}){
 if(platform==='win32'&&arch==='x64'||platform==='darwin'&&['x64','arm64'].includes(arch))return;
 if(platform==='linux'&&arch==='x64'&&/^ID=(?:ubuntu|"ubuntu")\r?$/m.test(osRelease)&&/^VERSION_ID=(?:24\.04|"24\.04")\r?$/m.test(osRelease))return;
 throw Error('Supported build hosts: Windows x64; Ubuntu 24.04 x64; macOS x64 and arm64.');
}
export function linuxPostgresBuildLayout(directory){
 // Only a generated, generic temporary path may enter compiler diagnostics or
 // pg_config's recorded flags. Never configure with the private checkout path.
 if(!/^\/tmp\/observanda-postgresql-[a-zA-Z0-9]+$/.test(directory))throw Error('Invalid Linux PostgreSQL build directory.');
 const prefix='/usr/local/observanda/postgresql',source=directory+'/postgresql-17.11',stage=directory+'/install';
 return {source,stage,installed:stage+prefix,environment:{PATH:'/usr/bin:/bin',HOME:directory,TMPDIR:directory,LANG:'C',LC_ALL:'C'},configure:['./configure','--prefix='+prefix,'--without-icu','--without-readline','--without-zlib','CFLAGS=-O2 -ffile-prefix-map='+directory+'=/usr/src/observanda'],install:['install','DESTDIR='+stage]};
}
export async function payloadFiles(root){
 const files=[],base=await realpath(root);async function walk(relative){for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){const name=path.posix.join(relative,entry.name),full=path.join(root,name),stat=await lstat(full);if(stat.isSymbolicLink()){const target=await readlink(full),resolved=await realpath(full);if(path.isAbsolute(target)||!resolved.startsWith(base+path.sep)||(await lstat(resolved)).isDirectory())throw Error('Unsafe payload symlink: '+name);files.push({path:name,target});}else if(stat.isDirectory())await walk(name);else if(stat.isFile()&&name!=='payload.json'){const hash=createHash('sha256');for await(const chunk of createReadStream(full))hash.update(chunk);files.push({path:name,bytes:stat.size,sha256:hash.digest('hex')});}else if(!stat.isFile())throw Error('Unsupported payload entry');}}await walk('');return files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
}
export async function verifyDesktopPayload(root,{sourceRoot}={}){
 const manifest=JSON.parse(await readFile(path.join(root,'payload.json'),'utf8'));
 if(manifest.format!==1||manifest.platform!==process.platform||manifest.arch!==process.arch)throw Error('Build the payload on the matching target architecture first.');
 if(JSON.stringify(await payloadFiles(root))!==JSON.stringify(manifest.files))throw Error('Desktop payload changed after preparation.');
 for(const name of [...githubRuntimeFiles(),...pdfValidationRuntimeFiles(),...desktopLocalizationFiles()])if(!manifest.files.some(f=>f.path===name))throw Error('Missing desktop dependency: '+name);
 for(const name of ['service/src/desktop-service.js','service/node_modules/pg/package.json',process.platform==='win32'?'runtime/node.exe':'runtime/bin/node','postgresql/bin/postgres'+(process.platform==='win32'?'.exe':''),'media/bin/ffmpeg'+(process.platform==='win32'?'.exe':''),'media/bin/ffprobe'+(process.platform==='win32'?'.exe':''),'media/LICENSE'])if(!manifest.files.some(f=>f.path===name))throw Error('Missing desktop dependency: '+name);
 if(sourceRoot){
  const sourceFiles=(await payloadFiles(path.join(sourceRoot,'src'))).map(f=>({...f,path:'service/src/'+f.path}));
  const applicationAssets=['package.json','package-lock.json','desktop/icon_black.svg','desktop/icon_white.svg'];
  for(const relative of applicationAssets){
   const bytes=await readFile(path.join(sourceRoot,relative));sourceFiles.push({path:'service/'+relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const order=(a,b)=>a.path.localeCompare(b.path,'en'),same=(a,b)=>a.length===b.length&&a.every((f,i)=>f.path===b[i].path&&f.bytes===b[i].bytes&&f.sha256===b[i].sha256&&f.target===b[i].target);
  const generated='service/src/web-build/';
  if(sourceFiles.some(file=>file.path.startsWith(generated)))throw Error('Generated browser assets must remain outside the source tree.');
  const bundled=manifest.files.filter(f=>f.path.startsWith('service/src/')&&!f.path.startsWith(generated)||applicationAssets.some(name=>f.path==='service/'+name));
  if(!same(sourceFiles.sort(order),bundled.sort(order)))throw Error('Desktop payload is stale. Run npm run prepare:desktop with the media bundle before packaging.');
  const application=JSON.parse(await readFile(path.join(sourceRoot,'package.json'),'utf8')),desktop=JSON.parse(await readFile(path.join(sourceRoot,'desktop/package.json'),'utf8'));
  if(application.version!==desktop.version)throw Error('Desktop and application versions must match before packaging.');
  // Generated chunks are not source files. Rebuild them independently so a
  // refreshed payload manifest cannot hide stale or substituted browser code.
  const parent=await realpath(os.tmpdir()),temporary=await mkdtemp(path.join(parent,'observanda-browser-verify-'));
  try{
   await buildBrowser({root:path.resolve(sourceRoot),out:temporary});
   const expected=(await payloadFiles(temporary)).map(file=>({...file,path:generated+file.path}));
   if(!same(expected.sort(order),manifest.files.filter(file=>file.path.startsWith(generated)).sort(order)))throw Error('Desktop browser payload is stale. Recreate the compiled browser assets before packaging.');
  }finally{
   if(path.dirname(temporary)!==parent||await realpath(temporary)!==temporary)throw Error('Invalid browser verification cleanup path.');
   await rm(temporary,{recursive:true,force:true});
  }
 }
 return manifest;
}
