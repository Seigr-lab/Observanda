import {readFile,readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const execute=promisify(execFile);

// Qualification instrumentation only. Sum process RSS (shared pages may be
// counted more than once), not a claim of private bytes or enforced OS limits.
// Include detached postmasters explicitly; ancestry alone misses pg_ctl exits.
export async function processTreeResources(rootPids){
 const roots=[...new Set(rootPids)];if(!roots.length||roots.some(id=>!Number.isSafeInteger(id)||id<1))throw Error('Invalid process roots.');
 if(process.platform==='win32'){
  const shell=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const {stdout}=await execute(shell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./process-tree-resources.ps1',import.meta.url)),'-Roots',roots.join(',')],{windowsHide:true,timeout:30000,maxBuffer:65536});
  return {...JSON.parse(stdout),sampleScope:'process-tree-rss',availableMemoryBytes:process.availableMemory(),machineMemoryBytes:os.totalmem()};
 }
 if(process.platform!=='linux')throw Error('Process qualification supports Windows and Linux.');
 const {stdout}=await execute('/usr/bin/getconf',['CLK_TCK'],{timeout:5000,maxBuffer:1024}),ticks=Number(stdout.trim());if(!Number.isSafeInteger(ticks)||ticks<1)throw Error('Invalid clock tick rate.');
 const rows=[];
 for(const pid of (await readdir('/proc')).filter(name=>/^\d+$/.test(name))){
  try{const [raw,status]=await Promise.all([readFile('/proc/'+pid+'/stat','utf8'),readFile('/proc/'+pid+'/status','utf8')]),fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);
   rows.push({pid:Number(pid),parent:Number(fields[1]),rss:Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]??0)*1024,cpuUserUs:Math.round(Number(fields[11])*1e6/ticks),cpuSystemUs:Math.round(Number(fields[12])*1e6/ticks)});
  }catch(error){if(!['ENOENT','ESRCH','EACCES'].includes(error.code))throw error;}
 }
 const selected=new Set(roots);let changed=true;while(changed){changed=false;for(const row of rows)if(selected.has(row.parent)&&!selected.has(row.pid)){selected.add(row.pid);changed=true;}}
 const included=rows.filter(row=>selected.has(row.pid));
 return {sampleScope:'process-tree-rss',processes:included.length,rssBytes:included.reduce((sum,row)=>sum+row.rss,0),cpuUserUs:included.reduce((sum,row)=>sum+row.cpuUserUs,0),cpuSystemUs:included.reduce((sum,row)=>sum+row.cpuSystemUs,0),availableMemoryBytes:process.availableMemory(),machineMemoryBytes:os.totalmem(),machineLoad1m:os.loadavg()[0]};
}
