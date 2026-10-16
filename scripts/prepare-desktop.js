import {mkdir,writeFile,copyFile,cp,rm,readdir,lstat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {updateDesktopIcons} from './update-icons.js';
import {downloadRuntime,windowsRuntime} from '../src/postgres-runtime.js';
import {payloadFiles,verifyDesktopPayload} from './desktop-payload.js';
import {relocateMacLibraries} from './relocate-macos.js';
import {prepareGithubRuntime} from './github-runtime.js';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),out=path.join(root,'dist/desktop-resources'),cache=path.join(root,'dist/runtime-cache');
const {values}=parseArgs({options:{media:{type:'string'},'git-runtime':{type:'string'}}});
if(!values.media)throw Error('Supply --media with a redistributable FFmpeg folder containing bin/ffmpeg, bin/ffprobe and LICENSE. No incomplete installer is produced.');
if(!['win32','darwin'].includes(process.platform)||!['x64','arm64'].includes(process.arch)||process.platform==='win32'&&process.arch!=='x64')throw Error('Supported build targets: Windows x64; macOS x64 and arm64.');
const suffix=process.platform==='win32'?'.exe':'',media=path.resolve(values.media);
for(const name of ['bin/ffmpeg'+suffix,'bin/ffprobe'+suffix,'LICENSE'])if(!(await lstat(path.join(media,name))).isFile())throw Error('Missing media dependency: '+name);
const run=(command,args,cwd=root)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,stdio:'inherit',windowsHide:true,shell:false});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(command+' failed ('+code+')')));});
async function hash(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
async function download(name,url,sha256){
 const file=path.join(cache,name);try{if(await hash(file)===sha256)return file;}catch{}
 const response=await fetch(url,{signal:AbortSignal.timeout(900000)});if(!response.ok||new URL(response.url).protocol!=='https:')throw Error('Runtime download failed');
 const partial=file+'.partial';await pipeline(response.body,createWriteStream(partial));if(await hash(partial)!==sha256){await rm(partial);throw Error('Runtime checksum mismatch');}await copyFile(partial,file);await rm(partial);return file;
}
await mkdir(cache,{recursive:true});
// Only generated payload state is replaced. Workspaces never live here.
if(path.dirname(out)!==path.join(root,'dist'))throw Error('Invalid build path');await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
const version='24.20.0',nodeHashes={x64:'9e5b2644cf107befb6aefca676b96d3296bc10138096f022ed378d6233ed81f4',arm64:'40e5607e5ecb3db9192723776da2d75d966260fc74a7a9e731c1bd67dda96bc8'};
await mkdir(path.join(out,'runtime'),{recursive:true});
if(process.platform==='win32'){
 const file=await download('node-'+version+'-win-x64.exe','https://nodejs.org/dist/v'+version+'/win-x64/node.exe','5c976096e04e5c2c1f091938926234cc9fbebfe9787ddd149351b3b0ecc707b5');await copyFile(file,path.join(out,'runtime/node.exe'));
 const license=await fetch('https://raw.githubusercontent.com/nodejs/node/v'+version+'/LICENSE');if(!license.ok)throw Error('Missing Node license');await writeFile(path.join(out,'runtime/LICENSE'),await license.text());
 const archive=path.join(cache,'postgresql-17.11.zip');try{if(await hash(archive)!==windowsRuntime.sha256)throw Error();}catch{await rm(archive,{force:true});await downloadRuntime(archive);}
 await run('tar.exe',['-xf',archive,'-C',out,'pgsql/bin','pgsql/lib','pgsql/share','pgsql/server_license.txt','pgsql/commandlinetools_3rd_party_licenses.txt']);
 await cp(path.join(out,'pgsql'),path.join(out,'postgresql'),{recursive:true});await rm(path.join(out,'pgsql'),{recursive:true});
}else{
 const name='node-v'+version+'-darwin-'+process.arch+'.tar.gz',archive=await download(name,'https://nodejs.org/dist/v'+version+'/'+name,nodeHashes[process.arch]);
 const prefix='node-v'+version+'-darwin-'+process.arch;
 await run('/usr/bin/tar',['-xzf',archive,'--strip-components=1','-C',path.join(out,'runtime'),prefix+'/bin/node',prefix+'/LICENSE']);
 const pg=await download('postgresql-17.11.tar.bz2','https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2','dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979');
 const build=path.join(cache,'postgresql-17.11');await rm(build,{recursive:true,force:true});await run('/usr/bin/tar',['-xjf',pg,'-C',cache]);
 await run('/bin/sh',['./configure','--prefix='+path.join(out,'postgresql'),'--without-icu','--without-readline','--without-zlib'],build);await run('/usr/bin/make',['-j4'],build);await run('/usr/bin/make',['install'],build);await copyFile(path.join(build,'COPYRIGHT'),path.join(out,'postgresql/LICENSE'));
}
await cp(media,path.join(out,'media'),{recursive:true,filter:source=>!['.git','.DS_Store'].includes(path.basename(source))});
await prepareGithubRuntime({out,download,run,gitRuntime:values['git-runtime']});
if(process.platform==='darwin'){await relocateMacLibraries(path.join(out,'postgresql'));await relocateMacLibraries(path.join(out,'media'));await relocateMacLibraries(path.join(out,'github/git'));}
const service=path.join(out,'service');await mkdir(service);await cp(path.join(root,'src'),path.join(service,'src'),{recursive:true});
await mkdir(path.join(service,'desktop'));
for(const name of ['icon_black.svg','icon_white.svg'])await copyFile(path.join(root,'desktop',name),path.join(service,'desktop',name));
await copyFile(path.join(root,'package.json'),path.join(service,'package.json'));await copyFile(path.join(root,'package-lock.json'),path.join(service,'package-lock.json'));
const npm=process.env.npm_execpath;if(!npm)throw Error('Run with npm run prepare:desktop so the locked dependency installer is available.');
await run(process.execPath,[npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],service);
// npm's executable symlinks are not needed by the running service.
await rm(path.join(service,'node_modules/.bin'),{recursive:true,force:true});await rm(path.join(service,'node_modules/.package-lock.json'),{force:true});
await updateDesktopIcons({png:true});


const manifest={format:1,platform:process.platform,arch:process.arch,node:version,postgresql:'17.11',files:await payloadFiles(out)};await writeFile(path.join(out,'payload.json'),JSON.stringify(manifest,null,2));await verifyDesktopPayload(out);
console.log('Verified desktop payload: '+manifest.files.length+' files. Application sources and dependencies only; workspace data and internal notes are excluded.');
