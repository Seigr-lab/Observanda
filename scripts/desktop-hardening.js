import {getCurrentFuseWire} from '@electron/fuses';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
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
const digest=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};

export function validateDesktopFuseWire(wire){
 if(!wire||wire.version!=='1'||Object.keys(wire).length!==policy.length+1||Object.keys(wire).some(key=>key!=='version'&&!policy[Number(key)]))throw Error('Unreviewed Electron fuse layout.');
 const fuses={};
 for(const [index,[name,enabled]] of policy.entries()){
  if(wire[index]!== (enabled?49:48))throw Error('Desktop fuse policy failed: '+name);
  fuses[name]=enabled;
 }
 return fuses;
}

export async function verifyDesktopHardening(executable,platform){
 if(!['win32','linux'].includes(platform))throw Error('Unsupported desktop qualification platform.');
 const before=await digest(executable),fuses=validateDesktopFuseWire(await getCurrentFuseWire(executable)),after=await digest(executable);
 if(before!==after)throw Error('Desktop executable changed during fuse inspection.');
 return {format:1,platform,sha256:after,fuseVersion:'1',fuses,
  embeddedAsarIntegritySupported:platform==='win32',publisherSignatureVerified:false,
  limitation:platform==='linux'?'Electron does not enforce embedded ASAR integrity on Linux. Artifact signature and tamper qualification are separate.':'Fuse inspection does not verify the publisher signature, embedded ASAR hash or tamper behavior.'};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4)throw Error('Usage: node scripts/desktop-hardening.js <executable> <win32|linux>');console.log(JSON.stringify(await verifyDesktopHardening(process.argv[2],process.argv[3]),null,2));}
 catch(error){console.error(error?.message?.startsWith('Desktop ')||error?.message?.startsWith('Unreviewed ')||error?.message?.startsWith('Unsupported ')||error?.message?.startsWith('Usage:')?error.message:'Could not inspect desktop executable.');process.exitCode=1;}
}
