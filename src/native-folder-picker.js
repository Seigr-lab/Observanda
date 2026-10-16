import path from 'node:path';
import os from 'node:os';
import {access,stat,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {AppError} from './errors.js';

const nativeFile=name=>fileURLToPath(new URL(`./native/${name}`,import.meta.url));
const validPath=value=>typeof value==='string'&&value.length<=4096&&!/[\x00-\x1f]/.test(value)&&(!value||path.isAbsolute(value));

// Arguments are never evaluated by a shell. Paths for PowerShell travel as JSON on stdin.
export function runDialogProcess(command,args,{input='',signal,timeout=15*60*1000}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new AppError('FOLDER_PICKER_CANCELLED'));return;}
    let output='',size=0,failure=null;
    const child=spawn(command,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const stop=code=>{failure??=new AppError(code);child.kill();};
    const abort=()=>stop('FOLDER_PICKER_CANCELLED');
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>stop('FOLDER_PICKER_TIMEOUT'),timeout);timer.unref();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{size+=Buffer.byteLength(chunk);if(size>32768)stop('FOLDER_PICKER_FAILED');else output+=chunk;});
    child.stderr.on('data',chunk=>{size+=chunk.length;if(size>32768)stop('FOLDER_PICKER_FAILED');});
    child.stdin.on('error',()=>{});child.stdin.end(input);
    child.once('error',()=>{failure??=new AppError('FOLDER_PICKER_FAILED');});
    child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure)reject(failure);else resolve({code,stdout:output.replace(/^\uFEFF/,'')});});
  });
}

async function findProgram(name,env) {
  for(const directory of (env.PATH??'').split(path.delimiter).filter(p=>p&&path.isAbsolute(p))) {
    const file=path.join(directory,name);
    try {await access(file,constants.X_OK);if((await stat(file)).isFile())return file;} catch {}
  }
  return null;
}

export async function detectFolderPicker({headless=false,platform=process.platform,env=process.env,run=runDialogProcess,find=findProgram}={}) {
  if(headless||env.SSH_CONNECTION||env.SSH_TTY)return {mode:'server',reason:'headless'};
  if(platform==='win32') {
    const command=path.win32.join(env.SystemRoot??'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const args=['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',nativeFile('folder-dialog.ps1')];
    try {
      const probe=await run(command,[...args,'-Probe'],{timeout:10000});
      if(probe.code!==0)throw new Error();
      if(JSON.parse(probe.stdout).interactive!==true)return {mode:'server',reason:'headless'};
      return {mode:'native',backend:'windows',command,args};
    } catch {return {mode:'unavailable',reason:'native-unavailable'};}
  }
  if(platform==='darwin') {
    try{if((await stat('/dev/console')).uid!==process.getuid())return {mode:'server',reason:'headless'};}catch{return {mode:'unavailable',reason:'native-unavailable'};}
    return {mode:'native',backend:'macos',command:'/usr/bin/osascript',args:[nativeFile('folder-dialog.applescript')]};
  }
  if(platform==='linux') {
    if(!env.DISPLAY&&!env.WAYLAND_DISPLAY)return {mode:'server',reason:'headless'};
    const programs=/kde/i.test(env.XDG_CURRENT_DESKTOP??'')?['kdialog','zenity']:['zenity','kdialog'];
    for(const name of programs){const command=await find(name,env);if(command)return {mode:'native',backend:name,command,args:[]};}
  }
  return {mode:'unavailable',reason:'native-unavailable'};
}

export async function initialFolder(input) {
  if(!validPath(input))throw new AppError('STORAGE_PATH');
  let current=input||os.homedir();
  while(true) {
    try {if((await stat(current)).isDirectory())return await realpath(current);}catch(error){if(!['ENOENT','ENOTDIR'].includes(error.code))throw new AppError('STORAGE_PATH');}
    const parent=path.dirname(current);if(parent===current)return os.homedir();current=parent;
  }
}

export function dialogInvocation(backend,initialPath) {
  if(backend.backend==='windows')return {args:backend.args,input:JSON.stringify({initialPath})};
  if(backend.backend==='macos')return {args:[...backend.args,initialPath]};
  if(backend.backend==='kdialog')return {args:['--title','Observanda - Choose a workspace folder','--getexistingdirectory',initialPath]};
  if(backend.backend==='zenity')return {args:['--file-selection','--directory','--title=Observanda - Choose a workspace folder','--filename='+initialPath+path.sep]};
  throw new AppError('FOLDER_PICKER_UNAVAILABLE');
}

export function dialogResult(backend,result) {
  if(backend==='windows') {
    if(result.code===3)throw new AppError('FOLDER_PICKER_UNAVAILABLE');
    if(result.code!==0)throw new AppError('FOLDER_PICKER_FAILED');
    let value;try{value=JSON.parse(result.stdout);}catch{throw new AppError('FOLDER_PICKER_FAILED');}
    if(value?.cancelled===true&&value.folder===null)return null;
    if(value?.cancelled!==false||typeof value.folder!=='string')throw new AppError('FOLDER_PICKER_FAILED');
    return value.folder;
  }
  const output=result.stdout.replace(/\r?\n$/,'');
  if(backend==='macos') {
    if(result.code!==0)throw new AppError('FOLDER_PICKER_FAILED');
    if(output==='cancelled:')return null;
    if(!output.startsWith('selected:'))throw new AppError('FOLDER_PICKER_FAILED');
    return output.slice(9);
  }
  if(result.code===1&&!output)return null;
  if(result.code!==0||!output)throw new AppError('FOLDER_PICKER_FAILED');
  return output;
}

export function createFolderPicker(options={}) {
  let detection,pending=false;
  const run=options.run??runDialogProcess;
  const detect=()=>detection??=(options.detect??detectFolderPicker)({...options,run});
  return {
    async capabilities(){const {mode,backend,reason}=await detect();return {mode,...(backend?{backend}:{}),...(reason?{reason}:{})};},
    async choose({initialPath='',signal}={}){
      if(pending)throw new AppError('FOLDER_PICKER_BUSY');pending=true;
      try {
        const backend=await detect();if(backend.mode!=='native')throw new AppError('FOLDER_PICKER_UNAVAILABLE');
        const initial=await initialFolder(initialPath),invocation=dialogInvocation(backend,initial);
        const chosen=dialogResult(backend.backend,await run(backend.command,invocation.args,{input:invocation.input,signal}));
        if(chosen===null)return {cancelled:true,folder:null};
        if(!chosen||!validPath(chosen))throw new AppError('FOLDER_PICKER_FAILED');
        try{if(!(await stat(chosen)).isDirectory())throw new Error();return {cancelled:false,folder:await realpath(chosen)};}catch{throw new AppError('STORAGE_PATH');}
      } finally {pending=false;}
    }
  };
}
