import {mkdtemp,rm,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {runtimeFileDigest,sealPreparedRuntime,admitReviewedRuntime,admitMatchingRuntime,copyAdmittedRuntime} from './runtime-input-trust.js';
import {withRuntimeProbeEnvironment} from './runtime-probe-environment.js';

const executeFile=promisify(execFile);
// Published upstream SHA-256, not a hash first learned from --media.
export const mediaRuntimeRelease=Object.freeze({
 name:'ffmpeg-9.0.2-full_build.7z',root:'ffmpeg-9.0.2-full_build',
 url:'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-full_build.7z',
 sha256:'f0e46253c70dfe902bac915dfb4224f0cf1b7c6eeab9da2ccc9a5581f9a71b13'
});
export async function prepareMediaRuntime({out,cache,media,download,platform=process.platform,arch=process.arch,execute=executeFile,release=mediaRuntimeRelease}){
 const destination=path.join(out,'media');
 if(platform!=='win32'||arch!=='x64'){
  if(!media)throw Error('Supply --media with a reviewed complete media runtime.');
  return copyAdmittedRuntime(media,destination,await admitReviewedRuntime(media,'media',{platform,arch}));
 }
 const archive=await download(release.name,release.url,release.sha256);
 if(!/^[a-f0-9]{64}$/.test(release.sha256)||await runtimeFileDigest(archive)!==release.sha256)throw Error('Media runtime archive checksum mismatch.');
 const scratch=await mkdtemp(path.join(path.resolve(cache),'media-reviewed-'));
 try{
  const tar=path.win32.join(process.env.SystemRoot??'C:\\Windows','System32','tar.exe');
  await withRuntimeProbeEnvironment(async options=>{
   const {stdout}=await execute(tar,['-tf',archive],{...options,maxBuffer:1024*1024});
   const names=stdout.trim().split(/\r?\n/);
   if(names.length>10000||names.some(name=>name.length>512||/[\\:\0]/.test(name)||!name.startsWith(release.root+'/')||name.replace(/\/$/,'').split('/').some(part=>!part||part==='.'||part==='..')))throw Error('Unsafe media runtime archive.');
   await execute(tar,['-xf',archive,'-C',scratch],options);
  },{platform});
  const reference=path.join(scratch,release.root);
  for(const name of ['bin/ffmpeg.exe','bin/ffprobe.exe','LICENSE'])if(!(await lstat(path.join(reference,name))).isFile())throw Error('Incomplete pinned media runtime.');
  const trusted=await sealPreparedRuntime(reference);
  const source=media?path.resolve(media):reference,admission=media?await admitMatchingRuntime(source,reference,trusted):trusted;
  return await copyAdmittedRuntime(source,destination,admission);
 }finally{await rm(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
