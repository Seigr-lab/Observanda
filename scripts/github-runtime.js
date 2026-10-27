import {mkdir,mkdtemp,cp,copyFile,lstat,readFile,readdir,readlink,realpath,open,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
const executeFile=promisify(execFile);

// Official upstream releases, pinned by SHA-256. No global Git configuration
// or credential-helper registration is changed by preparing this payload.
export const githubRuntimeReleases=Object.freeze({
 gcmVersion:'3.0.2',gitVersion:'2.56.0.4',
 'win32-x64':{file:'gcm-win-x64-3.0.2.zip',sha256:'9d2bef6e42a37654ea7ef33172bbcf1b6a1df6191fcf6a57dfbf39e1cbc27a0f'},
 'darwin-arm64':{file:'gcm-osx-arm64-3.0.2.tar.gz',sha256:'2031e8f81683ff0bd835a762e6cfd0831e9d28cdd5a55b10135c73e9498750cc'},
 'darwin-x64':{file:'gcm-osx-x64-3.0.2.tar.gz',sha256:'a59672ed02fd5e785a4ff89a70890955a958015867995c1079023d3fbc6643b1'},
 'linux-x64':{file:'gcm-linux-x64-3.0.2.tar.gz',sha256:'b8e59e22a830006ca4d93e34513effbb2d9fc0c45d9ccf40395eaab7c4c1b97e'},
 minGit:{file:'MinGit-2.56.0.4-64-bit.zip',sha256:'e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877'}
});
// NativeAOT does not carry the single-file runtimeconfig/deps manifest. Bind
// upstream build metadata to the exact executable extracted from the verified
// official release archive; never infer a runtime from arbitrary binary text.
export const credentialNativeAotReleases=Object.freeze({
 win32:Object.freeze({version:'10.0.14',sha256:'a139dbb2db5238266b53d6596fa02880a25cdb27d709da547147c28159d40cf0'}),
 linux:Object.freeze({version:'10.0.14',sha256:'a89acb85ba32a7a7c370408c316a5b9ce6442c78970aad8af4bfa6dbf05f3a94'})
});
export const credentialNativeAotSource='https://github.com/git-ecosystem/git-credential-manager/releases/tag/v3.0.2';
export const githubRuntimeFiles=(platform=process.platform)=>[
 'github/credential-manager/git-credential-manager'+(platform==='win32'?'.exe':''),
 'github/git/'+(platform==='win32'?'cmd/git.exe':'bin/git'),
 'github/credential-manager/LICENSE','github/git/'+(platform==='win32'?'LICENSE.txt':'LICENSE'),
 ...(platform==='linux'?['github/git/bin/git-remote-http','github/git/bin/git-remote-https','github/git/share/git-core/templates/description']:[])
];
// Ubuntu supplies the C/C++ baseline. Other ELF dependencies must remain in
// their own relocatable runtime tree rather than leaking build-host packages.
export async function verifyLinuxRuntime(directory,{executables=[],execute=executeFile}={}){
 const base=await realpath(directory),inside=file=>file===base||file.startsWith(base+path.sep),binaries=[];
 for(const name of executables){const file=path.join(base,name);if(!inside(await realpath(file))||!(await lstat(await realpath(file))).isFile())throw Error('Incomplete Linux runtime: '+name);}
 async function walk(folder){for(const entry of await readdir(folder,{withFileTypes:true})){
  const file=path.join(folder,entry.name),stat=await lstat(file);
  if(stat.isSymbolicLink()){
   const target=await readlink(file),resolved=await realpath(file);
   if(path.isAbsolute(target)||!inside(resolved)||!(await lstat(resolved)).isFile())throw Error('Unbundled Linux runtime link: '+file);
   continue;
  }
  if(stat.isDirectory()){await walk(file);continue;}
  if(!stat.isFile())throw Error('Unsupported Linux runtime entry: '+file);
  const handle=await open(file,'r'),header=Buffer.alloc(20);let bytesRead;try{({bytesRead}=await handle.read(header,0,20,0));}finally{await handle.close();}
  if(bytesRead>=4&&header.subarray(0,4).equals(Buffer.from([127,69,76,70]))){
   if(bytesRead<20||header[4]!==2||header[5]!==1||header.readUInt16LE(18)!==62)throw Error('Linux runtime must contain x64 ELF binaries: '+file);
   binaries.push(file);
  }else if(executables.includes(path.relative(base,file).split(path.sep).join('/')))throw Error('Linux executable must be bundled ELF, not a system-program wrapper: '+file);
 }}await walk(base);
 for(const name of executables){
  const file=await realpath(path.join(base,name));if(!binaries.includes(file)||process.platform==='linux'&&((await lstat(file)).mode&0o111)===0)throw Error('Missing executable Linux binary: '+name);
 }
 const env={PATH:'/usr/bin:/bin',LC_ALL:'C'},options={env,timeout:30000,maxBuffer:1024*1024,windowsHide:true};
 const systemLibrary=/^(?:ld-linux-x86-64\.so\.2|lib(?:c|m|pthread|dl|rt|resolv|util)\.so\.[0-9]+|libgcc_s\.so\.1|libstdc\+\+\.so\.6)$/;
 for(const file of binaries){
  const {stdout:dynamic}=await execute('/usr/bin/readelf',['-d',file],options);
  for(const match of dynamic.matchAll(/\((?:RPATH|RUNPATH)\)[^\n]*\[([^\]]*)\]/g))for(const search of match[1].split(':')){
   if(!/^\$ORIGIN(?:\/|$)/.test(search)||!inside(path.resolve(path.dirname(file),search.slice(8)||'.')))throw Error('Non-relocatable Linux library path: '+file);
  }
  if(!dynamic.includes('(NEEDED)'))continue;
  const {stdout}=await execute('/usr/bin/ldd',[file],options);
  if(/=>\s*not found/.test(stdout))throw Error('Missing Linux shared library: '+file);
  for(const line of stdout.split('\n')){
   const dependency=/=>\s*(.+?)\s+\(0x[0-9a-f]+\)/i.exec(line)?.[1]??/^\s*(.+?)\s+\(0x[0-9a-f]+\)/i.exec(line)?.[1];if(!dependency||!path.isAbsolute(dependency))continue;
   if(!inside(await realpath(dependency))&&!systemLibrary.test(path.basename(dependency)))throw Error('Unbundled Linux shared library: '+dependency);
  }
 }
 return base;
}
// The application sets GIT_EXEC_PATH to bin/, so HTTPS helpers must be present
// there. Supply Git built with RUNTIME_PREFIX=YesPlease and its complete runtime
// tree, templates and license; copying /usr/bin/git alone is not sufficient.
export async function verifyLinuxGitRuntime(directory,{execute=executeFile}={}){
 for(const name of ['share/git-core/templates/description','LICENSE'])if(!(await lstat(await realpath(path.join(directory,name)))).isFile())throw Error('Incomplete Linux Git runtime: '+name);
 const base=await verifyLinuxRuntime(directory,{executables:['bin/git','bin/git-remote-http','bin/git-remote-https'],execute}),inside=file=>file===base||file.startsWith(base+path.sep);
 const options={timeout:30000,maxBuffer:1024*1024,windowsHide:true},scratch=await mkdtemp(path.join(os.tmpdir(),'observanda-git-runtime-'));
 try{
  const git=path.join(base,'bin/git'),isolated={...options,cwd:scratch,env:{PATH:path.join(base,'bin'),HOME:scratch,XDG_CONFIG_HOME:scratch,LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0'}};
  const {stdout:execPath}=await execute(git,['--exec-path'],isolated);
  if(!path.isAbsolute(execPath.trim())||!inside(await realpath(execPath.trim())))throw Error('Linux Git exec path escapes the relocated runtime.');
  isolated.env.GIT_EXEC_PATH=path.join(base,'bin');
  const repository=path.join(scratch,'repository');await execute(git,['init','--quiet',repository],isolated);
  if(!(await readFile(path.join(repository,'.git/description'))).equals(await readFile(path.join(base,'share/git-core/templates/description'))))throw Error('Linux Git templates were not resolved from its relocated runtime.');
  const {stdout:status}=await execute(git,['-C',repository,'status','--porcelain'],isolated);if(status.trim())throw Error('Linux Git runtime verification did not create an empty repository.');
 }finally{await rm(scratch,{recursive:true,force:true});}
}
export async function prepareGithubRuntime({out,download,run,gitRuntime,platform=process.platform,arch=process.arch,verifyGit=verifyLinuxGitRuntime}){
 const release=githubRuntimeReleases[platform+'-'+arch];if(!release)throw Error('Unsupported GitHub sign-in platform.');
 if(platform==='linux'&&!gitRuntime)throw Error('Supply --git-runtime with a complete relocatable Ubuntu 24.04 x64 Git runtime.');
 const base=path.join(out,'github'),helper=path.join(base,'credential-manager');await mkdir(helper,{recursive:true});
 const archive=await download(release.file,'https://github.com/git-ecosystem/git-credential-manager/releases/download/v'+githubRuntimeReleases.gcmVersion+'/'+release.file,release.sha256);
 await run(platform==='win32'?'tar.exe':'/usr/bin/tar',['-xf',archive,'-C',helper]);
 const license=await download('gcm-'+githubRuntimeReleases.gcmVersion+'-LICENSE','https://raw.githubusercontent.com/git-ecosystem/git-credential-manager/v'+githubRuntimeReleases.gcmVersion+'/LICENSE','b47f1a8a744ecdc7a3da35804f88552805d33f51a726b87a2105acdfae406b07');await copyFile(license,path.join(helper,'LICENSE'));
 const git=path.join(base,'git');
 if(platform==='win32'){
  await mkdir(git,{recursive:true});const source=githubRuntimeReleases.minGit;
  const zip=await download(source.file,'https://github.com/git-for-windows/git/releases/download/v'+githubRuntimeReleases.gitVersion.replace(/\.(\d+)$/,'.windows.$1')+'/'+source.file,source.sha256);
  await run('tar.exe',['-xf',zip,'-C',git]);
 }else{
  if(!gitRuntime)throw Error('Supply --git-runtime with a redistributable macOS Git runtime containing bin/git and LICENSE. Browser sign-in cannot depend on developer tools on the user’s computer.');
  await cp(path.resolve(gitRuntime),git,{recursive:true,...(platform==='linux'?{verbatimSymlinks:true}:{})});
  if(platform==='linux')await verifyGit(git);
 }
 const root=platform==='linux'?await realpath(out):null;
 for(const file of githubRuntimeFiles(platform)){
  const full=path.join(out,file),resolved=platform==='linux'?await realpath(full):full;
  if(platform==='linux'&&!resolved.startsWith(root+path.sep)||!(await lstat(resolved)).isFile())throw Error('Missing GitHub sign-in runtime: '+file);
 }
}
