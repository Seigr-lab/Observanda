import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Sampled sums are observations, not a hard limit or an exact high-water mark.
// Shared pages can be counted more than once; processes between samples can be missed.
export async function startPerformanceProcessMonitor(pid,log){
 if(process.platform!=='win32')return {close:async()=>({supported:false,reason:'platform-not-qualified'})};
 const stop=log+'.stop',intervalMs=1000,child=spawn(path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./performance-process-sampler.ps1',import.meta.url)),'-RootProcessId',String(pid),'-StopFile',stop,'-ResultsFile',log,'-IntervalMs',String(intervalMs)],{windowsHide:true,stdio:'ignore'});
 let failed=false,closing;const exited=new Promise(resolve=>{child.once('error',()=>{failed=true;resolve();});child.once('exit',code=>{failed ||= code!==0;resolve();});});
 return {close:()=>closing??=(async()=>{
  try{await writeFile(stop,'stop\n',{flag:'wx'});}catch(error){failed=true;child.kill();throw error;}const timeout=setTimeout(()=>{failed=true;child.kill();},5000);
  try{await exited;}finally{clearTimeout(timeout);}
  const receipt={supported:true,metric:'sum of observed process working sets',intervalMs,samples:0,errors:0,peakBytes:0,peakProcesses:0,rootObserved:false,monitorFailed:failed,log:path.basename(log),limitations:'Sampling can miss short-lived processes and peaks; shared pages are counted per process; no OS memory enforcement.'};
  try{const lines=createInterface({input:createReadStream(log),crlfDelay:Infinity});for await(const line of lines){const value=JSON.parse(line);if(value.error){receipt.errors++;continue;}receipt.samples++;receipt.rootObserved ||= value.rootSeen;receipt.peakBytes=Math.max(receipt.peakBytes,value.workingSetBytes);receipt.peakProcesses=Math.max(receipt.peakProcesses,value.processes);}}
  catch(error){if(error.code!=='ENOENT')throw error;receipt.monitorFailed=true;}
  return receipt;
 })()};
}
