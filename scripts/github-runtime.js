import {mkdir,cp,copyFile,lstat} from 'node:fs/promises';
import path from 'node:path';

// Official upstream releases, pinned by SHA-256. No global Git configuration
// or credential-helper registration is changed by preparing this payload.
export const githubRuntimeReleases=Object.freeze({
 gcmVersion:'2.9.1',gitVersion:'2.56.0.2',
 'win32-x64':{file:'gcm-win-x64-2.9.1.zip',sha256:'7dea2afd3b9ea22109d25f95066025d70e57281d96062605304f89fcca41b535'},
 'darwin-arm64':{file:'gcm-osx-arm64-2.9.1.tar.gz',sha256:'2ac8f99258d04acb45cf592eb5b06ec0e0760c329bce40a4d18dabb5e0e37f68'},
 'darwin-x64':{file:'gcm-osx-x64-2.9.1.tar.gz',sha256:'326fc3e1c708ae792b010b2f9f701f3dc4dbaebdf40cafd036254ab0f148c034'},
 minGit:{file:'MinGit-2.56.0.2-64-bit.zip',sha256:'da35e72aa21c005a5a0d298cfbae110bc1609a815730ea0dde84b01a1b3cd3be'}
});
export const githubRuntimeFiles=(platform=process.platform)=>[
 'github/credential-manager/git-credential-manager'+(platform==='win32'?'.exe':''),
 'github/git/'+(platform==='win32'?'cmd/git.exe':'bin/git'),
 'github/credential-manager/LICENSE','github/git/'+(platform==='win32'?'LICENSE.txt':'LICENSE')
];
export async function prepareGithubRuntime({out,download,run,gitRuntime,platform=process.platform,arch=process.arch}){
 const release=githubRuntimeReleases[platform+'-'+arch];if(!release)throw Error('Unsupported GitHub sign-in platform.');
 const base=path.join(out,'github'),helper=path.join(base,'credential-manager');await mkdir(helper,{recursive:true});
 const archive=await download(release.file,'https://github.com/git-ecosystem/git-credential-manager/releases/download/v'+githubRuntimeReleases.gcmVersion+'/'+release.file,release.sha256);
 await run(platform==='win32'?'tar.exe':'/usr/bin/tar',['-xf',archive,'-C',helper]);
 const license=await download('gcm-2.9.1-LICENSE','https://raw.githubusercontent.com/git-ecosystem/git-credential-manager/v2.9.1/LICENSE','b47f1a8a744ecdc7a3da35804f88552805d33f51a726b87a2105acdfae406b07');await copyFile(license,path.join(helper,'LICENSE'));
 const git=path.join(base,'git');
 if(platform==='win32'){
  await mkdir(git,{recursive:true});const source=githubRuntimeReleases.minGit;
  const zip=await download(source.file,'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/'+source.file,source.sha256);
  await run('tar.exe',['-xf',zip,'-C',git]);
 }else{
  if(!gitRuntime)throw Error('Supply --git-runtime with a redistributable macOS Git runtime containing bin/git and LICENSE. Browser sign-in cannot depend on developer tools on the user’s computer.');
  await cp(path.resolve(gitRuntime),git,{recursive:true});
 }
 for(const file of githubRuntimeFiles(platform))if(!(await lstat(path.join(out,file))).isFile())throw Error('Missing GitHub sign-in runtime: '+file);
}
