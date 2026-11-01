#!/usr/bin/env node
import {WorkspaceDirectory} from './workspace-directory.js';
import {readPreferences} from './preferences.js';
import {inspectSource} from './migration/runner.js';
import {withConsoleProgress} from './operation-progress-console.js';
import {startWorkspaceDatabases} from './workspace-databases.js';
import {createWorkspaceAccess,takeCreatedVault,readAccess,verifyAccess} from './access.js';
import {DeviceStore} from './security/device-store.js';
import {clearVault} from './encryption.js';
import {initializeLocation} from './locations.js';
import {defaultLocation,preferencesLocation,readPreference,namedWorkspaceLocation} from './locations.js';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { Workspace } from './storage.js';
import { createNotebook } from './model.js';
import {writePublication} from './publication.js';
import {PublicationJobs} from './publication-jobs.js';
import {catalogueDescriptor} from './research-catalogue.js';
import { AppError, safeError } from './errors.js';
import {intakeCLI} from './intake/cli.js';
import {commandLineLocalization} from './command-line-localization.js';

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); child.unref();
}

let runtime,app,localization=commandLineLocalization(preferencesLocation());const startup=new AbortController();
const text=(key,parameters)=>localization.text(key,parameters);
let stopping;
const stop=()=>{startup.abort();if(!app)return Promise.resolve();return stopping??=(async()=>{await app.close();await runtime?.close();})().catch(error=>{console.error(localization.error(safeError(error)));process.exitCode=1;});};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    source:{type:'string'}, manifest:{type:'string'}, 'expect-pin':{type:'string'}, json:{type:'boolean'},
    action:{type:'string'}, 'workspace-id':{type:'string'}, 'record-id':{type:'string'}, id:{type:'string'}, pin:{type:'string'}, wait:{type:'boolean'},
    workspace: { type: 'string' }, title: { type: 'string' }, out: { type: 'string' }, port: { type: 'string' },
    'password-stdin': {type:'boolean'}, 'no-browser': { type: 'boolean' }, headless: {type:'boolean'}, setup: {type:'boolean'}, preferences: {type:'string'}, help: { type: 'boolean', short: 'h' }
  } });
  const command = positionals[0] ?? 'open';
  const preferencesFile=values.preferences?path.resolve(values.preferences):preferencesLocation();
  localization=commandLineLocalization(preferencesFile);
  if (values.help || !['open', 'init', 'validate', 'build','inventory','intake'].includes(command) || positionals.length > 1) {
    console.log(localization.help()); if (!values.help) process.exitCode = 1;
  } else if(command==='inventory') {
    if(!values.source||Object.keys(values).some(k=>!['source','manifest','expect-pin','json','preferences'].includes(k)))throw new AppError('INVENTORY_INVALID');
    const report=await inspectSource({source:path.resolve(values.source),...(values.manifest?{manifest:values.manifest}:{}),...(values['expect-pin']?{expectedPin:values['expect-pin']}:{})},{signal:startup.signal});
    if(values.json)console.log(JSON.stringify(report));
    else console.log(localization.inventory(report));
    if(!report.complete)process.exitCode=2;
  } else {
    if(values.setup&&(command!=='open'||values.workspace))throw new AppError('INVALID');
    let previousStage='',previousPercent=-10;
    runtime=await startWorkspaceDatabases({directory:path.join(path.dirname(preferencesFile),'postgresql'),signal:startup.signal,onProgress:({stage,percent})=>{
     const log=command==='intake'?console.error:console.log;
     if(stage==='download'){if(percent>=previousPercent+10){log(text('databaseDownload',{percent}));previousPercent=percent;}}
     else if(stage!==previousStage){log(text(({install:'databaseInstall',extract:'databaseExtract',initialize:'databaseInitialize',start:'databaseStart'})[stage]));previousStage=stage;}
    }});
    const remembered=command==='open'&&!values.workspace&&!values.setup?await readPreference(preferencesFile):null;
    const creationName=values.title??(values.workspace?path.basename(path.resolve(values.workspace)):'My field notes');
    const root=command==='open'?(values.setup?null:values.workspace?path.resolve(values.workspace):remembered):command==='init'?await namedWorkspaceLocation({root:values.workspace?path.resolve(values.workspace):undefined,parent:values.workspace?undefined:path.dirname(defaultLocation()),name:creationName}):path.resolve(values.workspace??defaultLocation());
    const deviceStore=new DeviceStore({file:preferencesFile+'.device-key'});
    let password='',vault=null;
    if(values['password-stdin']){
     if(command==='open')throw new AppError('INVALID');
     const chunks=[];let size=0;for await(const bytes of process.stdin){size+=bytes.length;if(size>4096)throw new AppError('ACCESS_INVALID');chunks.push(bytes);}
     password=Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/,'');for(const bytes of chunks)bytes.fill(0);
     if(!password)throw new AppError('ACCESS_INVALID');
    }
    if(root&&['validate','build','intake'].includes(command)){const access=await readAccess(root);vault=await verifyAccess(access,access.value.username,password,{deviceStore});}
    const workspace=root?new Workspace(root,vault):null;
    if(command==='intake'){
      try{const result=await intakeCLI(workspace,values,{signal:startup.signal});console.log(JSON.stringify({version:1,ok:!['failed','cancelled'].includes(result.job?.state),result}));if(['failed','cancelled'].includes(result.job?.state))process.exitCode=2;}
      finally{clearVault(vault);password='';}
    }
    if (command === 'init') { const access=await createWorkspaceAccess('',password,deviceStore);vault=takeCreatedVault(access);try{await new WorkspaceDirectory(preferencesFile+'.workspace-directory.json',{seed:async()=>(await readPreferences(preferencesFile)).recent.map(item=>item.path)}).using(root,{},()=>initializeLocation(root,createNotebook(creationName),access,vault));}finally{clearVault(vault);} console.log(text('created')); }
    if (command === 'validate') {
     const outline=await withConsoleProgress(async()=>{
      const outline=await workspace.outline();
      if(await workspace.storageKind()==='catalogue')await workspace.catalogue(store=>store.verify(catalogueDescriptor(outline.metadata)));
      return outline;
     },{translate:localization.translate});
     console.log(text('validated',{entries:outline.recordCount,revision:outline.metadata.revision}));
    }
    if (command === 'build') {
      if (!values.out) { console.log(text('chooseOutput')); process.exitCode = 1; }
      else {
        const outline=await workspace.outline();
        const candidate=await new PublicationJobs(workspace).inline({workspaceId:outline.metadata.id,etag:outline.etag,blockedValues:[root,os.homedir(),os.hostname()]},{signal:startup.signal});
        await writePublication(candidate, values.out);
        console.log(text('exported',{entries:candidate.entries.length,files:candidate.files.size,release:candidate.id.slice(0,12)}));
      }
    }
    clearVault(vault);password='';
    if (command === 'open') {
      const port = values.port === undefined ? 4173 : Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
      const { startServer } = await import('./server.js');
      app = await startServer({ root, port, preferencesFile, expectedExisting:!!remembered,headless:values.headless===true,deviceStore });
      console.log(text('ready',{url:app.url}));
      if (!values['no-browser']&&!values.headless) openBrowser(app.url);
      if(startup.signal.aborted)await stop();
    }
  }
} catch (error) {
  const safe = safeError(error);
  if(process.argv[2]==='intake')console.log(JSON.stringify({version:1,ok:false,error:safe}));
  else{console.error(`${safe.code}: ${localization.error(safe)}`);
  for (const issue of safe.details) console.error(text(issue.recordId?'checkRecord':'checkField',{field:issue.field,...(issue.recordId?{recordId:issue.recordId}:{})}));}
  process.exitCode = 1;
} finally {
 if(!app){await runtime?.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
