import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {desktopRuntimeVersions} from '../desktop/runtime-inventory.js';

const executeFile=promisify(execFile);
const fileHash=async file=>{const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);return hash.digest('hex');};
export async function collectDesktopRuntimeInventory(executable,{sourceDirectory,expectedElectron,execute=executeFile,digest=fileHash}={}){
 try{
  executable=path.resolve(executable);const before=await digest(executable);
  const args=[...(sourceDirectory?[path.resolve(sourceDirectory)]:[]),'--observanda-runtime-inventory'];
  const env={...process.env};for(const name of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','ELECTRON_ENABLE_LOGGING'])delete env[name];
  const result=await execute(executable,args,{windowsHide:true,timeout:30000,maxBuffer:65536,env});
  const value=JSON.parse(String(result.stdout??'')),versions=desktopRuntimeVersions(value.versions??{});
  if(value.format!==1||!['win32','linux'].includes(value.platform)||value.arch!=='x64'||expectedElectron&&versions.electron!==expectedElectron)throw Error();
  if(await digest(executable)!==before)throw Error();
  return {format:1,platform:value.platform,arch:value.arch,executableSha256:before,versions};
 }catch{throw Error('Could not verify desktop runtime inventory.');}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4)throw Error();console.log(JSON.stringify(await collectDesktopRuntimeInventory(process.argv[2],{expectedElectron:process.argv[3]}),null,2));}
 catch{console.error('Desktop runtime inspection failed. Usage: node scripts/desktop-runtime-inventory.js <executable> <expected-electron-version>');process.exitCode=1;}
}
