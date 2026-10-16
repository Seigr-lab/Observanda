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
import intakeMessages from './web/locales/en/localIntake.json' with {type:'json'};

const help = `Observanda — a lab book for the curious

  npm start
  npm start -- --setup
  npm start -- --headless
  node src/cli.js open --workspace <directory> [--port 4173] [--no-browser] [--preferences <file>]
  node src/cli.js init --workspace "<parent>/Research Workspace 1" [--password-stdin]
  node src/cli.js inventory --source <export-directory> [--manifest inventory.observanda-source.json] [--expect-pin <sha256>] [--json]
  node src/cli.js validate --workspace <directory>
  node src/cli.js build --workspace <directory> --out <new-directory>

Without --workspace, reopen the last chosen location. With no saved location, start setup.
--headless uses server-side folder navigation and does not launch a browser.
--setup opens the wizard without opening a workspace or changing saved preferences.
For init, the workspace name is the folder name. An optional --title must match it exactly.
--preferences selects the app preferences file; workspace files are stored separately.
Without OBSERVANDA_DATABASE_URL, each workspace owns its private PostgreSQL database files.
Windows downloads a checksum-pinned runtime; Linux/macOS use installed tools or apt/dnf/Homebrew.
macOS also uses its system Perl for the database process lock.
Package managers may ask for system administrator permission. OBSERVANDA_POSTGRES_BIN selects existing tools.
Set OBSERVANDA_DATABASE_URL to use an organization-managed PostgreSQL database instead.
Use an ordinary database owner; a superuser is not required. For remote databases,
set OBSERVANDA_DATABASE_TLS=verify-full and optionally OBSERVANDA_DATABASE_CA to a CA certificate file.
Managed database credentials are encrypted with the workspace key. External connection credentials
stay in the service environment and are never included in portable workspace exports.
New workspaces are always encrypted. Windows supports OS-protected device keys.\n--password-stdin reads an encryption password from standard input for init, validate or build.\nBuild exports only entries explicitly selected for sharing. Existing output is never overwritten.
No command creates a GitHub repository, commits, pushes, or publishes to a server.
`;

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); child.unref();
}

let runtime,app;const startup=new AbortController();
let stopping;
const stop=()=>{startup.abort();if(!app)return Promise.resolve();return stopping??=(async()=>{await app.close();await runtime?.close();})().catch(error=>{console.error(safeError(error).message);process.exitCode=1;});};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    source:{type:'string'}, manifest:{type:'string'}, 'expect-pin':{type:'string'}, json:{type:'boolean'},
    action:{type:'string'}, 'workspace-id':{type:'string'}, 'record-id':{type:'string'}, id:{type:'string'}, pin:{type:'string'}, wait:{type:'boolean'},
    workspace: { type: 'string' }, title: { type: 'string' }, out: { type: 'string' }, port: { type: 'string' },
    'password-stdin': {type:'boolean'}, 'no-browser': { type: 'boolean' }, headless: {type:'boolean'}, setup: {type:'boolean'}, preferences: {type:'string'}, help: { type: 'boolean', short: 'h' }
  } });
  const command = positionals[0] ?? 'open';
  if (values.help || !['open', 'init', 'validate', 'build','inventory','intake'].includes(command) || positionals.length > 1) {
    console.log(help+'\n'+intakeMessages.cliHelp); if (!values.help) process.exitCode = 1;
  } else if(command==='inventory') {
    if(!values.source||Object.keys(values).some(k=>!['source','manifest','expect-pin','json'].includes(k)))throw new AppError('INVENTORY_INVALID');
    const report=await inspectSource({source:path.resolve(values.source),...(values.manifest?{manifest:values.manifest}:{}),...(values['expect-pin']?{expectedPin:values['expect-pin']}:{})},{signal:startup.signal});
    if(values.json)console.log(JSON.stringify(report));
    else console.log((report.complete?'Inventory fully accounted for.':'Inventory needs resolution.')+' No records were imported.\n'+report.counts.objects+' objects; '+report.counts.files+' files; '+report.counts.bytes+' bytes.\nSource pin: '+report.source.pin+'\nUse --json to inspect private declarations and individual issues.');
    if(!report.complete)process.exitCode=2;
  } else {
    if(values.setup&&(command!=='open'||values.workspace))throw new AppError('INVALID');
    const preferencesFile=values.preferences?path.resolve(values.preferences):preferencesLocation();
    let previousStage='',previousPercent=-10;
    runtime=await startWorkspaceDatabases({directory:path.join(path.dirname(preferencesFile),'postgresql'),signal:startup.signal,onProgress:({stage,percent})=>{
     const log=command==='intake'?console.error:console.log;
     if(stage==='download'){if(percent>=previousPercent+10){log('Downloading PostgreSQL: '+percent+'%');previousPercent=percent;}}
     else if(stage!==previousStage){log(({install:'Installing PostgreSQL with the system package manager.',extract:'Verifying and installing PostgreSQL.',initialize:'Preparing your private database.',start:'Starting PostgreSQL.'})[stage]);previousStage=stage;}
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
    if (command === 'init') { const access=await createWorkspaceAccess('',password,deviceStore);vault=takeCreatedVault(access);try{await new WorkspaceDirectory(preferencesFile+'.workspace-directory.json',{seed:async()=>(await readPreferences(preferencesFile)).recent.map(item=>item.path)}).using(root,{},()=>initializeLocation(root,createNotebook(creationName),access,vault));}finally{clearVault(vault);} console.log('Workspace created. Open Observanda to begin recording.'); }
    if (command === 'validate') {
     const outline=await withConsoleProgress(async()=>{
      const outline=await workspace.outline();
      if(await workspace.storageKind()==='catalogue')await workspace.catalogue(store=>store.verify(catalogueDescriptor(outline.metadata)));
      return outline;
     });
     console.log(`Workspace valid. ${outline.recordCount} entries; revision ${outline.metadata.revision}.`);
    }
    if (command === 'build') {
      if (!values.out) { console.log('Choose a new output directory with --out.'); process.exitCode = 1; }
      else {
        const outline=await workspace.outline();
        const candidate=await new PublicationJobs(workspace).inline({workspaceId:outline.metadata.id,etag:outline.etag,blockedValues:[root,os.homedir(),os.hostname()]},{signal:startup.signal});
        await writePublication(candidate, values.out);
        console.log(`Website exported: ${candidate.entries.length} entries, ${candidate.files.size} files. Release ${candidate.id.slice(0, 12)}.`);
      }
    }
    clearVault(vault);password='';
    if (command === 'open') {
      const port = values.port === undefined ? 4173 : Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
      const { startServer } = await import('./server.js');
      app = await startServer({ root, port, preferencesFile, expectedExisting:!!remembered,headless:values.headless===true,deviceStore });
      console.log(`Observanda is ready. Open this local launch link:\n${app.url}\nPress Ctrl+C to stop.`);
      if (!values['no-browser']&&!values.headless) openBrowser(app.url);
      if(startup.signal.aborted)await stop();
    }
  }
} catch (error) {
  const safe = safeError(error);
  if(process.argv[2]==='intake')console.log(JSON.stringify({version:1,ok:false,error:safe}));
  else{console.error(`${safe.code}: ${safe.message}`);
  for (const issue of safe.details) console.error(`Check ${issue.field}${issue.recordId ? ` in record ${issue.recordId}` : ''}.`);}
  process.exitCode = 1;
} finally {
 if(!app){await runtime?.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
