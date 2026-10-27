import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectDotnetRuntime} from './dotnet-inventory.js';
import {githubRuntimeReleases} from './github-runtime.js';

const executeFile=promisify(execFile);
const version=value=>typeof value==='string'&&/^[0-9][0-9A-Za-z.+_-]{0,99}$/.test(value);
const packageName=value=>typeof value==='string'&&/^(?:@[a-zA-Z0-9_.-]+\/)?[a-zA-Z0-9_.-]+$/.test(value);
const fileHash=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};

// Only package names, versions, package-relative locations and digests enter the
// public inventory. Registry credentials, local resolved URLs and probe output
// never do. The payload manifest separately covers every file, including native
// libraries that do not have a runnable version command.
export function dependencyInventory(lock,{productionOnly=false}={}){
 if(lock.lockfileVersion!==3||!lock.packages||typeof lock.packages!=='object')throw Error('A version-three dependency lockfile is required.');
 const components=[];
 for(const [location,pkg] of Object.entries(lock.packages)){
  if(!location||productionOnly&&pkg.dev)continue;
  const name=pkg.name??location.split('node_modules/').at(-1);
  if(!packageName(name)||!version(pkg.version)||!/^node_modules\/(?:[a-zA-Z0-9_.@-]+\/)*[a-zA-Z0-9_.-]+$/.test(location)||pkg.link)throw Error('Unreviewed dependency identity in lockfile.');
  const component={type:'library',name,version:pkg.version,'bom-ref':'npm:'+location+'@'+pkg.version,purl:'pkg:npm/'+name.replace('@','%40')+'@'+pkg.version,properties:[{name:'observanda:scope',value:pkg.dev?'build':'runtime'},{name:'observanda:location',value:location}]};
  const integrity=/^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(pkg.integrity??'');
  if(!integrity||Buffer.from(integrity[1],'base64').length!==64)throw Error('Dependency lacks a SHA-512 integrity digest.');
  component.hashes=[{alg:'SHA-512',content:Buffer.from(integrity[1],'base64').toString('hex')}];components.push(component);
 }
 return {bomFormat:'CycloneDX',specVersion:'1.6',version:1,components:components.sort((a,b)=>a['bom-ref'].localeCompare(b['bom-ref'],'en'))};
}

export async function collectRuntimeInventory(root,{platform=process.platform,execute=executeFile,nodeVersion,credentialVersion=githubRuntimeReleases.gcmVersion,read=readFile,digest=fileHash,inspectDotnet=inspectDotnetRuntime}={}){
 const suffix=platform==='win32'?'.exe':'',components=[],hostRequirements=[];
 const binary=async(name,relative,args,parse)=>{
  const file=path.join(root,relative);
  let result;
  try{result=await execute(file,args,{cwd:root,windowsHide:true,timeout:30000,maxBuffer:65536,env:{...process.env,NODE_OPTIONS:'',ELECTRON_RUN_AS_NODE:'',JAVA_TOOL_OPTIONS:'',_JAVA_OPTIONS:'',JDK_JAVA_OPTIONS:'',GIT_CONFIG_NOSYSTEM:'1'}});}
  catch{throw Error('Runtime version probe failed: '+name);}
  let detected;try{detected=parse(String(result.stdout??'')+'\n'+String(result.stderr??''));}catch{}
  if(!version(detected))throw Error('Runtime version is not identifiable: '+name);
  const component={name,version:detected,path:relative,sha256:await digest(file)};components.push(component);return component;
 };
 let nodeVersions;
 const node=await binary('Node.js',platform==='win32'?'runtime/node.exe':'runtime/bin/node',['-p','JSON.stringify(process.versions)'],output=>{nodeVersions=JSON.parse(output);return nodeVersions.node;});
 if(nodeVersion&&node.version!==nodeVersion)throw Error('Bundled Node version differs from the pinned release.');
 for(const name of ['undici','openssl','uv','v8','zlib']){
  if(!version(nodeVersions[name]))throw Error('Bundled Node component version missing: '+name);
  components.push({name:'Node.js/'+name,version:nodeVersions[name],includedIn:node.path,sha256:node.sha256});
 }
 await binary('PostgreSQL','postgresql/bin/postgres'+suffix,['--version'],output=>/PostgreSQL\)\s+(\S+)/.exec(output)?.[1]);
 for(const name of ['ffmpeg','ffprobe'])await binary(name,'media/bin/'+name+suffix,['-version'],output=>new RegExp('^'+name+' version ([0-9][0-9A-Za-z.+_-]*)','m').exec(output)?.[1]);
 const git=await binary('Git','github/git/'+(platform==='win32'?'cmd/git.exe':'bin/git'),['--version'],output=>/^git version (\S+)/m.exec(output)?.[1]);
 if(platform==='win32'&&git.version!==githubRuntimeReleases.gitVersion.replace(/\.(\d+)$/,'.windows.$1'))throw Error('Bundled Windows Git differs from the pinned release.');
 const credential=await binary('Git Credential Manager','github/credential-manager/git-credential-manager'+suffix,['--version'],output=>/^([0-9][0-9A-Za-z.+_-]*)/m.exec(output)?.[1]);
 if(credential.version.split('+')[0]!==credentialVersion)throw Error('Bundled credential helper differs from the pinned release.');
 const dotnet=await inspectDotnet(path.join(root,credential.path),{platform,expectedSha256:credential.sha256});
 if(dotnet.kind==='host-requirement')hostRequirements.push({name:dotnet.name,minimumVersion:dotnet.minimumVersion,requiredBy:credential.path,configurationSha256:dotnet.configurationSha256});
 else if(dotnet.kind==='bundled'&&dotnet.sha256===credential.sha256)components.push({name:dotnet.name,version:dotnet.version,includedIn:credential.path,sha256:dotnet.sha256,metadataFormat:dotnet.metadataFormat,...(dotnet.metadataSource?{metadataSource:dotnet.metadataSource}:{})});
 else throw Error('Credential helper runtime inventory is inconsistent.');
 await binary('Java','pdf-validation/java/bin/java'+suffix,['-version'],output=>/version "([0-9][0-9A-Za-z.+_-]*)"/.exec(output)?.[1]);
 const validator=JSON.parse(await read(path.join(root,'pdf-validation/runtime.json'),'utf8'));
 if(!version(validator.validatorVersion))throw Error('PDF validator version missing.');
 const jar='pdf-validation/verapdf-cli.jar',jarHash=await digest(path.join(root,jar));
 if(jarHash!==validator.validatorSha256)throw Error('PDF validator digest differs from its pinned release.');
 components.push({name:'veraPDF',version:validator.validatorVersion,path:jar,sha256:jarHash});
 return {format:2,platform,components,hostRequirements};
}
