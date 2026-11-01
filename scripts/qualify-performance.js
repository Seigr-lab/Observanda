// Repeatable regression receipts. Generated logs are local audit documents.
// These profiles measure fixture work shape, not laboratory capacity or an
// end-to-end release, and never use an installed workspace or database URL.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,lstat} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {finished} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {startPerformanceProcessMonitor} from './performance-process-monitor.js';

const git=promisify(execFile),root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
export const performanceProfiles=Object.freeze({
 work:Object.freeze([
  'record-collection-date','module-browse-index','module-facet-browse',
  'evaluation-page-cache','dataset-ordinal-cache','disk-capacity',
  'file-content-staging','segmented-file-range','segmented-file-write','media-read-work',
  'content-buffer-admission','content-buffer-budget','native-resource-budget','native-media-admission',
  'request-admission','foreground-capacity','research-job-checkpoints','module-live-updates','website-preview-owner-demand','operational-diagnostics',
  'query-result-sort','pinned-query-result','record-pinned-collection','module-pinned-query','module-dashboard-pinned',
  'project-directory-pinned','project-choice-ancestry','runtime-storage-authority','query-cache-owner-scope',
  'sample-analysis-pinned','sample-analysis-order','query-callback-source','calendar-dashboard-pinned',
  'catalogue-format-read','project-retired-read-proof','staging-reservation-model','dataset-preparation-writes','desktop-packager-dependencies',
  'dataset-window-count','numerical-scheduling','inventory-reconciliation','publication-job-checkpoints','optional-service-libraries','desktop-startup-cancellation'
 ]),
 native:Object.freeze([
  'record-query','record-query-projection','module-facet-browse-native','module-member-index','inventory-projection','inventory-projection-native',
  'dataset-window-native','dataset-paged-reader','module-collection-capacity','module-schema-capacity',
  'workspace-postgres-runtime','workspace-copy-session','publication-input-media',
  'media','dataset-preview-read-work','website-theme-exchange','pdf-document-image-storage',
  'query-cache-files','record-pinned-query-native','record-pinned-session-native','project-directory-pinned-native',
  'inventory-maintenance-native','sample-analysis-scale','sample-analysis-collection-capacity',
  'project-choice-ancestry-native','calendar-dashboard-collection','catalogue-format-read-native',
  'job-checkpoint-connections','dataset-preparation-writes-native','staging-reservation-files','staging-reservations',
  'runtime-proof-cursor','postgres-runtime-upgrade','project-retired-read-proof-native','dataset-cell-prefetch-native'
 ]),
 heavy:Object.freeze([
  'dataset-import-plot-capacity.benchmark.js','module-history-growth','record-history-continuation','desktop-service'
 ]),
 mixed:Object.freeze([
  'combined-owner-workload','intake-growth','analysis-comparison-sustained'
 ])
});

async function fingerprint(){
 const {stdout}=await git('git',['ls-files','-z','--cached','--others','--exclude-standard','--','src','scripts','test','desktop','package.json','package-lock.json','electron-builder.config.js'],{cwd:root,maxBuffer:8*1024*1024});
 const hash=createHash('sha256'),files=[...new Set(stdout.split('\0').filter(Boolean))].sort();
 for(const name of files){hash.update(name+'\0');try{const stat=await lstat(path.join(root,name));if(!stat.isFile()||stat.isSymbolicLink())throw Error('A qualification source is not a regular file.');for await(const chunk of createReadStream(path.join(root,name)))hash.update(chunk);hash.update('\0');}catch(error){if(error.code!=='ENOENT')throw error;hash.update('deleted\0');}}
 const head=(await git('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim(),dirty=!!(await git('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,maxBuffer:8*1024*1024})).stdout;
 return {sha256:hash.digest('hex'),files:files.length,head,dirty};
}

async function run(profile,log,{signal}={}){
 const files=performanceProfiles[profile].map(name=>'test/'+name+(name.endsWith('.js')?'':'.test.js'));
 const args=profile==='work'?['--test','--test-reporter=tap','--test-concurrency=1',...files]:['scripts/test.js','--test-concurrency=1',...files];
 const env={...process.env,OBSERVANDA_DATABASE_URL:'',OBSERVANDA_DATABASE_TLS:'',OBSERVANDA_DATABASE_CA:'',OBSERVANDA_TEST_DATABASE_URL:'',OBSERVANDA_TEST_DATABASE_TLS:'',OBSERVANDA_TEST_DATABASE_CA:''};
 const output=createWriteStream(log,{flags:'wx'}),start=performance.now();let code,interrupted=false,monitor,processTree;
 try{
  code=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   if(child.pid)monitor=startPerformanceProcessMonitor(child.pid,log.replace(/\.log$/,'.processes.jsonl'));
   const abort=()=>{interrupted=true;child.kill('SIGTERM');};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
   child.stdout.pipe(output,{end:false});child.stderr.pipe(output,{end:false});
   output.once('error',error=>{child.kill('SIGTERM');reject(error);});child.once('error',reject);child.once('close',value=>{signal?.removeEventListener('abort',abort);resolve(value);});
  });
 }finally{output.end();try{await finished(output);}finally{processTree=await (await monitor)?.close();}}
 return {profile,tests:files,concurrency:1,elapsedMs:Math.round(performance.now()-start),exitCode:code,interrupted,processTree,log:path.basename(log)};
}

async function main(){
 const {values}=parseArgs({options:{profile:{type:'string',default:'work'},repetitions:{type:'string',default:'1'},'storage-class':{type:'string',default:'unspecified'}}});
 const profiles=values.profile==='all'?Object.keys(performanceProfiles):[values.profile],repetitions=Number(values.repetitions);
 if(profiles.some(name=>!Object.hasOwn(performanceProfiles,name))||!Number.isSafeInteger(repetitions)||repetitions<1||repetitions>100||!['unspecified','local','network'].includes(values['storage-class']))throw Error('Use --profile=work|native|heavy|mixed|all, --repetitions=1..100 and --storage-class=unspecified|local|network.');
 const relative='.local/performance-qualification/'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
 // Refuse to create audit material if the checkout does not keep it ignored.
 await git('git',['check-ignore','-q',relative+'/receipt.json'],{cwd:root});const directory=path.join(root,relative);await mkdir(directory,{recursive:true,mode:0o700});
 const controller=new AbortController(),abort=()=>controller.abort();process.once('SIGINT',abort);process.once('SIGTERM',abort);
 const receipt={format:1,scope:'synthetic and isolated regression fixtures; not end-to-end release qualification',startedAt:new Date().toISOString(),runtime:{node:process.versions.node,platform:process.platform,arch:process.arch,osRelease:os.release(),totalMemoryBytes:os.totalmem()},storageClass:values['storage-class'],filesystemCache:'uncontrolled',repetitions,source:await fingerprint(),runs:[]};
 const save=()=>writeFile(path.join(directory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');await save();
 try{
  repetitions:for(let iteration=1;iteration<=repetitions&&!controller.signal.aborted;iteration++)for(const profile of profiles){
   if(controller.signal.aborted)break;console.log('Qualifying '+profile+' fixtures, repetition '+iteration+'.');
   receipt.runs.push({iteration,...await run(profile,path.join(directory,profile+'-'+iteration+'.log'),{signal:controller.signal})});await save();
   if(receipt.runs.at(-1).exitCode!==0)break repetitions;
  }
  receipt.finalSource=await fingerprint();receipt.finishedAt=new Date().toISOString();
  receipt.sourceChanged=receipt.finalSource.sha256!==receipt.source.sha256;
  receipt.status=controller.signal.aborted?'cancelled':receipt.runs.length!==profiles.length*repetitions||receipt.runs.some(row=>row.exitCode!==0)?'failed':receipt.sourceChanged?'source-changed':'passed';await save();
  console.log('Performance fixture receipt: '+receipt.status+'. Logs retained locally.');if(receipt.status!=='passed')process.exitCode=1;
 }catch(error){receipt.finishedAt=new Date().toISOString();receipt.status=controller.signal.aborted?'cancelled':'failed';receipt.runnerError={code:error.code??error.name};await save();throw error;}
 finally{process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
