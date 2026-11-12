import {SENTINEL} from '@electron/fuses/dist/constants.js';
import {createHash} from 'node:crypto';
import {open,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Electron's version-one wire, including the ninth fuse introduced after the
// pinned fuse utility's enum. Retain WASM guard-page bounds checking. A changed
// wire must receive an explicit policy review, rather than inheriting defaults.
const policy=Object.freeze([
 ['runAsNode',false],['cookieEncryption',true],['nodeOptions',false],['nodeCliInspect',false],
 ['embeddedAsarIntegrityValidation',true],['onlyLoadAppFromAsar',true],
 ['loadBrowserProcessSpecificV8Snapshot',false],['grantFileProtocolExtraPrivileges',false],['wasmTrapHandlers',true]
]);
const fuseMarker=Buffer.from(SENTINEL);

export function validateDesktopFuseWire(wire){
 if(!wire||wire.version!=='1'||Object.keys(wire).length!==policy.length+1||Object.keys(wire).some(key=>key!=='version'&&!policy[Number(key)]))throw Error('Unreviewed Electron fuse layout.');
 const fuses={};
 for(const [index,[name,enabled]] of policy.entries()){
  if(wire[index]!== (enabled?49:48))throw Error('Desktop fuse policy failed: '+name);
  fuses[name]=enabled;
 }
 return fuses;
}

function macArchitecture(header){
 if(header.length>=8&&header.readUInt32LE(0)===0xfeedfacf){
  const cpu=header.readUInt32LE(4);
  if(cpu===0x01000007)return 'x64';
  if(cpu===0x0100000c)return 'arm64';
 }
 throw Error('Desktop fuse inspection requires a single-architecture macOS executable.');
}

// Hash and inspect exactly the same bytes, including wires split across reads.
// Only a single-architecture binary with one complete, reviewed wire qualifies.
async function inspectBinary(file,{bundle,readFuses,mac}){
 const resolved=await realpath(file);
 if(bundle){
  const relative=path.relative(bundle,resolved);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Error('Desktop executable or framework is outside its application bundle.');
 }
 const handle=await open(resolved,'r');
 try{
  const before=await handle.stat({bigint:true}),hash=createHash('sha256');
  if(!before.isFile())throw Error('Desktop qualification requires a regular binary.');
  const wireLength=fuseMarker.length+2+policy.length;
  let tail=Buffer.alloc(0),header=Buffer.alloc(0),fuses;
  for await(const chunk of handle.createReadStream({autoClose:false})){
   hash.update(chunk);
   if(mac&&header.length<8)header=Buffer.concat([header,chunk.subarray(0,8-header.length)]);
   if(!readFuses)continue;
   const window=tail.length?Buffer.concat([tail,chunk]):chunk;
   let start=window.indexOf(fuseMarker);
   while(start>=0&&start+wireLength<=window.length){
    if(fuses)throw Error('Desktop qualification found multiple fuse wires in a single-architecture binary.');
    const offset=start+fuseMarker.length;
    if(window[offset+1]!==policy.length)throw Error('Unreviewed Electron fuse layout.');
    fuses=validateDesktopFuseWire({version:String(window[offset]),...window.subarray(offset+2,offset+2+policy.length)});
    start=window.indexOf(fuseMarker,start+fuseMarker.length);
   }
   tail=Buffer.from(window.subarray(Math.max(0,window.length-wireLength+1)));
  }
  if(readFuses&&(!fuses||tail.includes(fuseMarker)))throw Error('Desktop qualification requires a complete fuse wire.');
  const after=await stat(file,{bigint:true});
  if(await realpath(file)!==resolved||['dev','ino','size','ctimeNs','mtimeNs'].some(key=>before[key]!==after[key]))throw Error('Desktop binary changed during fuse inspection.');
  return {sha256:hash.digest('hex'),fuses,arch:mac?macArchitecture(header):undefined};
 }finally{await handle.close();}
}

export async function verifyDesktopHardening(executable,platform){
 if(!['win32','linux','darwin'].includes(platform))throw Error('Unsupported desktop qualification platform.');
 let framework,bundle;
 if(platform==='darwin'){
  const launcher=path.resolve(executable),macos=path.dirname(launcher),contents=path.dirname(macos),app=path.dirname(contents);
  if(path.basename(macos)!=='MacOS'||path.basename(contents)!=='Contents'||!app.endsWith('.app'))throw Error('Desktop fuse inspection requires the launcher in the macOS application bundle.');
  bundle=await realpath(app);
  framework=path.join(contents,'Frameworks','Electron Framework.framework','Electron Framework');
 }
 const launcher=await inspectBinary(executable,{bundle,mac:!!framework,readFuses:!framework});
 const runtime=framework?await inspectBinary(framework,{bundle,mac:true,readFuses:true}):launcher;
 if(framework&&runtime.arch!==launcher.arch)throw Error('Desktop framework architecture differs from the launcher.');
 return {format:1,platform,sha256:launcher.sha256,fuseVersion:'1',fuses:runtime.fuses,
  ...(framework?{arch:runtime.arch,frameworkSha256:runtime.sha256}:{}),
  embeddedAsarIntegritySupported:platform!=='linux',publisherSignatureVerified:false,
  limitation:platform==='linux'?'Electron does not enforce embedded ASAR integrity on Linux. Artifact signature and tamper qualification are separate.':'Fuse inspection does not verify the publisher signature, embedded ASAR hash or tamper behavior.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4)throw Error('Usage: node scripts/desktop-hardening.js <executable> <win32|linux|darwin>');console.log(JSON.stringify(await verifyDesktopHardening(process.argv[2],process.argv[3]),null,2));}
 catch(error){console.error(error?.message?.startsWith('Desktop ')||error?.message?.startsWith('Unreviewed ')||error?.message?.startsWith('Unsupported ')||error?.message?.startsWith('Usage:')?error.message:'Could not inspect desktop executable.');process.exitCode=1;}
}
