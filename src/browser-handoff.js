import {mkdir,lstat,writeFile,unlink,chmod} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {AppError} from './errors.js';
const execute=promisify(execFile);

export function browserLaunchCommand(url,platform=process.platform){
 if(new URL(url).protocol!=='file:')throw new AppError('INVALID');
 return platform==='win32'?{command:'rundll32.exe',args:['url.dll,FileProtocolHandler',url]}:platform==='darwin'?{command:'open',args:[url]}:{command:'xdg-open',args:[url]};
}

// The browser launcher sees a protected file URL, never a bearer in argv.
// Referrer suppression prevents its local name reaching the loopback service.
export async function browserHandoff(url,preferencesFile,{lifetime=120000}={}){
 if(!/^http:\/\/127\.0\.0\.1:\d+\/#([a-f0-9]{64})$/.test(url)||!Number.isSafeInteger(lifetime)||lifetime<1)throw new AppError('INVALID');
 const directory=path.join(path.dirname(preferencesFile),'browser-launch');await mkdir(directory,{recursive:true,mode:0o700});
 const existing=await lstat(directory);if(!existing.isDirectory()||existing.isSymbolicLink())throw new AppError('UNSAFE');
 if(process.platform==='win32'){
  try{await execute(path.join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./security/private-directory.ps1',import.meta.url)),'-Directory',directory],{windowsHide:true,timeout:15000,maxBuffer:8192});}catch{throw new AppError('IO');}
 }else{if(existing.uid!==process.getuid())throw new AppError('UNSAFE');await chmod(directory,0o700);}
 const file=path.join(directory,randomUUID()+'.html'),script='location.replace('+JSON.stringify(url)+');',hash=createHash('sha256').update(script).digest('base64');
 const html='<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'sha256-'+hash+'\'; base-uri \'none\'"><title>Observanda</title><script>'+script+'</script>';
 await writeFile(file,html,{flag:'wx',mode:0o600});const identity=await lstat(file);let closed=false,timer;
 const close=async()=>{if(closed)return;closed=true;clearTimeout(timer);let current;try{current=await lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}if(current.isSymbolicLink()||!current.isFile()||current.dev!==identity.dev||current.ino!==identity.ino)throw new AppError('UNSAFE');await unlink(file);};
 timer=setTimeout(()=>{void close().catch(()=>{});},lifetime);timer.unref();
 return {url:pathToFileURL(file).href,name:path.basename(file),close};
}
