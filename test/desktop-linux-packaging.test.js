import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {assertDesktopBuildTarget,desktopNodeHashes,linuxPostgresBuildLayout} from '../scripts/desktop-payload.js';
import {prepareGithubRuntime,verifyLinuxGitRuntime,verifyLinuxRuntime,githubRuntimeReleases,githubRuntimeFiles} from '../scripts/github-runtime.js';
import {pdfValidationRuntimeFiles} from '../scripts/pdf-validation-runtime.js';
import {pdfJavaArtifacts} from '../src/pdf-validation-dependencies.js';
import configuration from '../electron-builder.config.js';
import FpmTargetModule from 'app-builder-lib/out/targets/FpmTarget.js';

const write=async(root,name,value)=>{const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,value,{mode:0o755});return file;};
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-linux-packaging-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const git=path.join(directory,'git'),elf=Buffer.alloc(64);elf.set([127,69,76,70,2,1]);elf.writeUInt16LE(62,18);
 for(const name of ['bin/git','bin/git-remote-http','bin/git-remote-https'])await write(git,name,elf);
 await write(git,'LICENSE','Synthetic redistributable license');await write(git,'share/git-core/templates/description','Synthetic relocated template');
 const calls=[];
 const execute=async(file,args,options)=>{
  calls.push({file,args,options});
  assert.equal(options.env.GIT_CONFIG_GLOBAL===undefined||options.env.GIT_CONFIG_GLOBAL==='/dev/null',true);
  assert.equal(options.env.LD_LIBRARY_PATH,undefined);
  if(file==='/usr/bin/readelf')return {stdout:'Dynamic section contains no imported libraries\n (RUNPATH) Library runpath: [$ORIGIN/../lib]'};
  assert.equal(file,path.join(git,'bin/git'));
  if(args[0]==='--exec-path')return {stdout:path.join(git,'bin')+'\n'};
  if(args[0]==='init'){
   assert.equal(options.env.PATH,path.join(git,'bin'));assert.equal(options.env.GIT_EXEC_PATH,path.join(git,'bin'));
   await write(args[2],'.git/description',await readFile(path.join(git,'share/git-core/templates/description')));return {stdout:''};
  }
  assert.deepEqual(args.slice(2),['status','--porcelain']);return {stdout:''};
 };
 return {directory,git,elf,calls,execute};
}

test('Ubuntu packaging admits only its declared host and preserves the Windows target',()=>{
 assertDesktopBuildTarget({platform:'linux',arch:'x64',osRelease:'ID=ubuntu\nVERSION_ID="24.04"\n'});
 for(const target of [{platform:'linux',arch:'arm64',osRelease:'ID=ubuntu\nVERSION_ID=24.04\n'},{platform:'linux',arch:'x64',osRelease:'ID=ubuntu\nVERSION_ID="22.04"\n'},{platform:'linux',arch:'x64',osRelease:'ID=debian\nVERSION_ID="24.04"\n'}])assert.throws(()=>assertDesktopBuildTarget(target),/Supported build hosts/);
 assertDesktopBuildTarget({platform:'win32',arch:'x64'});assertDesktopBuildTarget({platform:'darwin',arch:'arm64'});
 assert.equal(desktopNodeHashes['linux-x64'],'eb6728e77c576a35162c122c45ccadf224d89ff00abc8dae46cc2897c6002d7c');
 assert.deepEqual(configuration.win.target,[{target:'nsis',arch:['x64']}]);assert.deepEqual(configuration.linux.target,[{target:'deb',arch:['x64']}]);
 assert.ok(configuration.extraMetadata.homepage);assert.ok(configuration.linux.maintainer);
 assert.ok(pdfJavaArtifacts['linux-x64']);assert.ok(pdfValidationRuntimeFiles('linux').includes('pdf-validation/java/bin/java'));
 for(const dependency of FpmTargetModule.default.prototype.getDefaultDepends('deb'))assert.ok(configuration.deb.depends.includes(dependency),'Explicit runtime dependencies must preserve electron-builder default '+dependency);
});

test('Linux PostgreSQL configures a public prefix and installs through a disposable DESTDIR',()=>{
 const layout=linuxPostgresBuildLayout('/tmp/observanda-postgresql-Synthetic'),prefix=layout.configure.find(arg=>arg.startsWith('--prefix=')).slice('--prefix='.length);
 assert.equal(prefix,'/usr/local/observanda/postgresql');assert.equal(layout.installed,layout.stage+prefix);
 assert.deepEqual(layout.install,['install','DESTDIR='+layout.stage]);assert.ok(layout.configure.includes('CFLAGS=-O2 -ffile-prefix-map=/tmp/observanda-postgresql-Synthetic=/usr/src/observanda'));
 assert.deepEqual(Object.keys(layout.environment).sort(),['HOME','LANG','LC_ALL','PATH','TMPDIR']);assert.equal(layout.environment.PATH,'/usr/bin:/bin');assert.equal(layout.environment.HOME,'/tmp/observanda-postgresql-Synthetic');
 for(const privatePath of ['/home/synthetic/private-checkout','/tmp/observanda-postgresql-A/../../home/synthetic','C:/Users/synthetic/checkout'])assert.throws(()=>linuxPostgresBuildLayout(privatePath),/Invalid Linux PostgreSQL build directory/);
 assert.ok(layout.source.startsWith('/tmp/observanda-postgresql-Synthetic/'));assert.ok(!layout.configure.join(' ').includes('dist/desktop-resources'));
});

test('Git preparation requires a complete supplied Linux tree and verifies its copied location',async t=>{
 const f=await fixture(t),out=path.join(f.directory,'output'),downloads=[];let verified;
 await assert.rejects(prepareGithubRuntime({out,platform:'linux',arch:'x64',download:()=>assert.fail('must reject before downloads'),run:()=>assert.fail('must reject before extraction')}),/--git-runtime/);
 const download=async(name,url,sha256)=>{downloads.push({name,url,sha256});return write(f.directory,'downloads/'+name,'Synthetic pinned download');};
 await prepareGithubRuntime({out,platform:'linux',arch:'x64',gitRuntime:f.git,download,run:async(command,args)=>{
  assert.equal(command,'/usr/bin/tar');assert.equal(path.basename(args[1]),githubRuntimeReleases['linux-x64'].file);await write(args[3],'git-credential-manager','Synthetic GCM');
 },verifyGit:async directory=>{verified=directory;assert.notEqual(directory,f.git);assert.equal(await readFile(path.join(directory,'LICENSE'),'utf8'),'Synthetic redistributable license');}});
 assert.equal(verified,path.join(out,'github/git'));
 assert.equal(downloads[0].sha256,'b8e59e22a830006ca4d93e34513effbb2d9fc0c45d9ccf40395eaab7c4c1b97e');
 assert.equal(downloads[0].url,'https://github.com/git-ecosystem/git-credential-manager/releases/download/v3.0.2/'+githubRuntimeReleases['linux-x64'].file);
 for(const file of githubRuntimeFiles('linux'))await readFile(path.join(out,file));
});

test('Windows Git preparation retains its pinned GCM and MinGit executable layout',async t=>{
 const f=await fixture(t),out=path.join(f.directory,'windows'),downloads=[];
 await prepareGithubRuntime({out,platform:'win32',arch:'x64',
  download:async(name,url,sha256)=>{downloads.push({name,url,sha256});return write(f.directory,'downloads/'+name,'Synthetic pinned download');},
  run:async(command,args)=>{assert.equal(command,'tar.exe');if(path.basename(args[1]).startsWith('gcm-'))await write(args[3],'git-credential-manager.exe','Synthetic GCM');else{await write(args[3],'cmd/git.exe','Synthetic MinGit');await write(args[3],'LICENSE.txt','Synthetic Git license');}},
  verifyGit:()=>assert.fail('Windows must retain its existing runtime path')
 });
 assert.equal(downloads[0].sha256,githubRuntimeReleases['win32-x64'].sha256);assert.equal(downloads[2].sha256,githubRuntimeReleases.minGit.sha256);
 for(const file of githubRuntimeFiles('win32'))await readFile(path.join(out,file));
});

test('relocated Git uses its own helpers and templates without the developer PATH or configuration',async t=>{
 const f=await fixture(t);await verifyLinuxGitRuntime(f.git,{execute:f.execute});
 assert.equal(f.calls.filter(call=>call.file==='/usr/bin/readelf').length,3);
 const gitCalls=f.calls.filter(call=>call.file===path.join(f.git,'bin/git'));assert.equal(gitCalls.length,3);
 for(const {options} of gitCalls){assert.notEqual(options.env.HOME,process.env.HOME);assert.equal(options.env.GIT_CONFIG_NOSYSTEM,'1');}
 await assert.rejects(readFile(path.join(gitCalls[0].options.cwd,'repository/.git/description')),{code:'ENOENT'});
});

test('Linux Git admission rejects missing helpers, executable wrappers and foreign ELF architectures',async t=>{
 const f=await fixture(t),helper=path.join(f.git,'bin/git-remote-https');await rm(helper);
 await assert.rejects(verifyLinuxGitRuntime(f.git,{execute:()=>assert.fail('incomplete tree must not run')}),{code:'ENOENT'});
 await write(f.git,'bin/git-remote-https',f.elf);await write(f.git,'bin/git','#!/bin/sh\nexec /usr/bin/git "$@"\n');
 await assert.rejects(verifyLinuxGitRuntime(f.git,{execute:()=>assert.fail('system wrapper must not run')}),/bundled ELF/);
 const foreign=Buffer.from(f.elf);foreign.writeUInt16LE(183,18);await write(f.git,'bin/git',foreign);
 await assert.rejects(verifyLinuxGitRuntime(f.git,{execute:()=>assert.fail('foreign architecture must not run')}),/x64 ELF/);
});

test('Linux Git admission refuses old build paths, missing libraries and external non-system libraries',async t=>{
 const f=await fixture(t),external=await write(f.directory,'external/libcurl.so.4','Synthetic external library');
 for(const variant of ['absolute','escape','missing','external','exec-path'])await assert.rejects(verifyLinuxGitRuntime(f.git,{execute:async(file,args,options)=>{
  if(file==='/usr/bin/readelf')return {stdout:variant==='absolute'?'(RUNPATH) Library runpath: [/old/build/lib]':variant==='escape'?'(RUNPATH) Library runpath: [$ORIGIN/../../outside]':['missing','external'].includes(variant)?'(NEEDED) Shared library: [libcurl.so.4]': ''};
  if(file==='/usr/bin/ldd')return {stdout:variant==='missing'?'libcurl.so.4 => not found':'libcurl.so.4 => '+external+' (0x1000)'};
  if(variant==='exec-path'&&args[0]==='--exec-path')return {stdout:f.directory+'\n'};
  return f.execute(file,args,options);
 }}),/Non-relocatable|Missing Linux shared|Unbundled Linux shared|exec path escapes/);
});

test('Git runtime links cannot escape the supplied tree before any executable is inspected',async t=>{
 const f=await fixture(t),external=path.join(f.directory,'external');await mkdir(external);
 await symlink(external,path.join(f.git,'outside'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(verifyLinuxGitRuntime(f.git,{execute:()=>assert.fail('escaping tree must not execute')}),/Unbundled Linux runtime link/);
});

test('Linux runtime verification admits relocated PostgreSQL libraries and the OS C baseline',async t=>{
 const f=await fixture(t),runtime=path.join(f.directory,'postgresql'),library=await write(runtime,'lib/libpq.so.5',f.elf),libc=await write(f.directory,'system/libc.so.6',f.elf);
 await write(runtime,'bin/postgres',f.elf);await write(runtime,'lib/postgresql/extension.so',f.elf);let inspected=0;
 await verifyLinuxRuntime(runtime,{executables:['bin/postgres'],execute:async(file,args)=>{
  if(file==='/usr/bin/readelf'){inspected++;const relative=path.relative(path.dirname(args[1]),path.join(runtime,'lib')).split(path.sep).join('/');return {stdout:'(NEEDED) Shared library: [libpq.so.5]\n(RUNPATH) Library runpath: [$ORIGIN/'+(relative||'.')+']'};}
  assert.equal(file,'/usr/bin/ldd');return {stdout:'libpq.so.5 => '+library+' (0x1000)\nlibc.so.6 => '+libc+' (0x2000)'};
 }});assert.equal(inspected,3);
});

test('Linux media admission accepts static FFmpeg and requires both bundled executable programs',async t=>{
 const f=await fixture(t),media=path.join(f.directory,'media');await write(media,'bin/ffmpeg',f.elf);await write(media,'bin/ffprobe',f.elf);await write(media,'LICENSE','Synthetic media license');let inspected=0;
 const execute=async(command)=>{assert.equal(command,'/usr/bin/readelf','Static media must not require a shared-library lookup');inspected++;return {stdout:'There is no dynamic section in this file.'};};
 await verifyLinuxRuntime(media,{executables:['bin/ffmpeg','bin/ffprobe'],execute});assert.equal(inspected,2);
 await rm(path.join(media,'bin/ffprobe'));await assert.rejects(verifyLinuxRuntime(media,{executables:['bin/ffmpeg','bin/ffprobe'],execute:()=>assert.fail('An incomplete media tree must fail before execution')}),{code:'ENOENT'});
 await write(media,'bin/ffprobe','#!/bin/sh\nexec /usr/bin/ffprobe "$@"\n');await assert.rejects(verifyLinuxRuntime(media,{executables:['bin/ffmpeg','bin/ffprobe'],execute:()=>assert.fail('A host-program wrapper must not run')}),/bundled ELF/);
});

test('Linux Git preparation preserves and admits an internal relative HTTPS-helper link',async t=>{
 const f=await fixture(t);await rm(path.join(f.git,'bin/git-remote-https'));
 try{await symlink('git-remote-http',path.join(f.git,'bin/git-remote-https'),'file');}catch(error){if(error.code==='EPERM'){t.skip('File symlink creation is unavailable on this host');return;}throw error;}
 await verifyLinuxGitRuntime(f.git,{execute:f.execute});
 const out=path.join(f.directory,'linked-output');
 await prepareGithubRuntime({out,platform:'linux',arch:'x64',gitRuntime:f.git,
  download:async name=>write(f.directory,'download/'+name,'Synthetic download'),
  run:async(_command,args)=>write(args[3],'git-credential-manager','Synthetic GCM'),
  verifyGit:async directory=>assert.equal(await readFile(path.join(directory,'bin/git-remote-https')).then(bytes=>bytes.equals(f.elf)),true)
 });assert.deepEqual(await readFile(path.join(out,'github/git/bin/git-remote-https')),f.elf);
});
