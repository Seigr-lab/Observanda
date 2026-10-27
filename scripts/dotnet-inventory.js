import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SaxesParser} from 'saxes';
import {credentialNativeAotReleases,credentialNativeAotSource} from './github-runtime.js';

// Microsoft.NET.HostModel's version-six single-file manifest. Inspect metadata,
// never execute the bundle, extract assemblies or infer a runtime from strings.
// https://github.com/dotnet/runtime/tree/v10.0.0/src/installer/managed/Microsoft.NET.HostModel/Bundle
const marker=Buffer.from('8b1202b96a612038727b930214d7a03213f5b9e6efae3318ee3b2dce24b36aae','hex');
const chunkSize=1024*1024,maxBinary=512*1024*1024,maxConfig=65536,maxDependencies=8*1024*1024;
const numericVersion=value=>typeof value==='string'&&/^\d{1,3}\.\d{1,3}\.\d{1,4}(?:\.\d{1,4})?$/.test(value);
const invalid=()=>{throw Error('Unreviewed .NET runtime metadata.');};

async function readAt(file,size,offset,length){
 if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(length)||offset<0||length<1||offset+length>size)invalid();
 const buffer=Buffer.alloc(length);let used=0;
 while(used<length){const {bytesRead}=await file.read(buffer,used,length-used,offset+used);if(!bytesRead)invalid();used+=bytesRead;}
 return buffer;
}
function integer(buffer,offset){const value=buffer.readBigInt64LE(offset);if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))invalid();return Number(value);}
async function scan(file,size,{findMarker=false}={}){
 const hash=createHash('sha256'),matches=new Set();let tail=Buffer.alloc(0);
 for(let offset=0;offset<size;offset+=chunkSize){
  const part=await readAt(file,size,offset,Math.min(chunkSize,size-offset));hash.update(part);
  if(findMarker){const window=Buffer.concat([tail,part]);let at=-1;
   while((at=window.indexOf(marker,at+1))!==-1){matches.add(offset-tail.length+at);if(matches.size>1)invalid();}
   tail=window.subarray(Math.max(0,window.length-marker.length+1));
  }
 }
 return {sha256:hash.digest('hex'),matches:[...matches]};
}
function frameworkRequirement(xml){
 const stack=[],found=[],parser=new SaxesParser();
 parser.on('doctype',invalid);
 parser.on('error',invalid);
 parser.on('opentag',node=>{stack.push(node.name);if(stack.join('/')==='configuration/startup/supportedRuntime')found.push(node.attributes);});
 parser.on('closetag',()=>stack.pop());parser.write(xml).close();
 if(found.length!==1||found[0].version!=='v4.0')invalid();
 const minimumVersion=/^\.NETFramework,Version=v(\d+\.\d+\.\d+)$/.exec(found[0].sku??'')?.[1];
 if(!numericVersion(minimumVersion))invalid();return minimumVersion;
}

export async function inspectDotnetRuntime(executable,{platform,expectedSha256,nativeAotReleases=credentialNativeAotReleases}={}){
 let file;
 try{
  const native=nativeAotReleases[platform];
  if(native&&expectedSha256===native.sha256){
   if(!numericVersion(native.version))invalid();
   file=await open(executable,'r');const before=await file.stat();if(!before.isFile()||before.size<64||before.size>maxBinary)invalid();
   const first=await scan(file,before.size),second=await scan(file,before.size),after=await file.stat();
   if(first.sha256!==native.sha256||second.sha256!==first.sha256||after.size!==before.size||after.mtimeMs!==before.mtimeMs)invalid();
   return {kind:'bundled',name:'.NET',version:native.version,sha256:first.sha256,metadataFormat:'upstream-native-aot-digest',metadataSource:credentialNativeAotSource};
  }
  if(platform==='win32'){
   file=await open(executable+'.config','r');const {size}=await file.stat();if(size>maxConfig)invalid();
   const bytes=await readAt(file,size,0,size);
   return {kind:'host-requirement',name:'.NET Framework',minimumVersion:frameworkRequirement(bytes.toString('utf8')),configurationSha256:createHash('sha256').update(bytes).digest('hex')};
  }
  if(platform!=='linux')invalid();
  file=await open(executable,'r');const before=await file.stat(),size=before.size;
  if(size<64||size>maxBinary)invalid();
  if(!(await readAt(file,size,0,4)).equals(Buffer.from([0x7f,0x45,0x4c,0x46])))invalid();
  const first=await scan(file,size,{findMarker:true});if(first.matches.length!==1||first.matches[0]<8||expectedSha256&&first.sha256!==expectedSha256)invalid();
  const manifestOffset=integer(await readAt(file,size,first.matches[0]-8,8),0);
  const header=await readAt(file,size,manifestOffset,Math.min(512,size-manifestOffset));
  if(header.length<53||header.readUInt32LE(0)!==6||header.readUInt32LE(4)!==0||header.readInt32LE(8)<1||header.readInt32LE(8)>10000)invalid();
  let cursor=12,length=0,shift=0,byte;
  do{if(shift>28||cursor>=header.length)invalid();byte=header[cursor++];length+=(byte&127)*2**shift;shift+=7;}while(byte&128);
  if(length<1||length>128)invalid();cursor+=length;if(cursor+40>header.length)invalid();
  const dependenciesOffset=integer(header,cursor),dependenciesSize=integer(header,cursor+8),configOffset=integer(header,cursor+16),configSize=integer(header,cursor+24);
  if(dependenciesSize>maxDependencies||configSize>maxConfig||dependenciesOffset+dependenciesSize>manifestOffset||configOffset+configSize>manifestOffset)invalid();
  const config=JSON.parse((await readAt(file,size,configOffset,configSize)).toString('utf8'));
  const dependencies=JSON.parse((await readAt(file,size,dependenciesOffset,dependenciesSize)).toString('utf8'));
  const frameworks=config?.runtimeOptions?.includedFrameworks;
  if(!Array.isArray(frameworks)||frameworks.length!==1||frameworks[0].name!=='Microsoft.NETCore.App'||!numericVersion(frameworks[0].version))invalid();
  const runtimeVersion=frameworks[0].version,shortVersion=runtimeVersion.split('.').slice(0,2).join('.');
  if(config.runtimeOptions.tfm!=='net'+shortVersion||dependencies?.runtimeTarget?.name!=='.NETCoreApp,Version=v'+shortVersion+'/linux-x64')invalid();
  const runtimePacks=Object.keys(dependencies.libraries??{}).filter(key=>key.startsWith('runtimepack.Microsoft.NETCore.App.'));
  if(runtimePacks.length!==1||runtimePacks[0]!=='runtimepack.Microsoft.NETCore.App.Runtime.linux-x64/'+runtimeVersion)invalid();
  const second=await scan(file,size),after=await file.stat();
  if(second.sha256!==first.sha256||after.size!==size||after.mtimeMs!==before.mtimeMs)invalid();
  return {kind:'bundled',name:'.NET',version:runtimeVersion,sha256:first.sha256,metadataFormat:'dotnet-single-file-6.0'};
 }catch{throw Error('Could not identify credential helper .NET runtime.');}
 finally{await file?.close();}
}
