import {moduleReferenceFactory} from './module-reference-access.js';
import {workspaceRenameAccess,workspaceRenameRecovery} from './workspace-rename-recovery.js';
import {publicationRevisionCurrent} from './publication-freshness.js';
import {publicationSourceFactory} from './project-publication-sources.js';
import {PublicationSourceAccess} from './publication-source-access.js';
import {withWorkspaceDeletionSession} from './workspace-deletion-session.js';
import {publicationDesignPreview} from './publication-design-preview.js';
import {projectContentHttp} from './project-content-http.js';
import {withWorkspaceMoveSession} from './workspace-move-session.js';
import {checkWorkspaceMoveDestination,finishWorkspaceProjectMove} from './workspace-project-move.js';
import {withWorkspaceRenameSession} from './workspace-rename-session.js';
import {withWorkspaceCopySession,checkWorkspaceCopyDestination} from './workspace-copy-session.js';
import {materialHttp} from './material-http.js';
import {materialRequest,executeMaterialRequest} from './material-requests.js';
import {workspaceRename,renameScope} from './workspace-rename-state.js';
import {WorkspaceRenames} from './workspace-rename.js';
import {WorkspaceDirectory} from './workspace-directory.js';
import {synchronizeWorkspaceName,requireCurrentWorkspaceName} from './workspace-name-state.js';
import {workspaceFolderName,workspaceCreationPath} from './workspace-names.js';
import {projectModuleRequest} from './project-module-requests.js';
import {moduleDomainRoute} from './module-domain-context.js';
import {ProjectApplication,projectRequest} from './project-application.js';
import {researchRequest,executeResearchRequest} from './research-requests.js';
import {LiveConnections} from './collaboration/live-connections.js';
import {WorkspaceDeletions} from './workspace-deletion.js';
import {SavedWorkspaceDeletion} from './saved-workspace-deletion.js';
import {workspaceDeletion} from './workspace-delete-state.js';
import {forgetWorkspace} from './preferences.js';
import {operationStage} from './operation-progress.js';
import {UserProfile} from './user-profile.js';
import {rememberWorkspaceLocation,rememberAuthenticatedLocation} from './workspace-reconnection.js';
import {verifyPortableAccess} from './workspace-portability.js';
import {organizationCommand,organizationErrorStatus} from './collaboration/local-commands.js';
import {CollaborationRecovery} from './collaboration/identity-recovery.js';
import {identityRecoveryCommand,identityRecoveryStatus} from './collaboration/identity-recovery-command.js';
import {identitySession} from './collaboration/identity-sessions.js';
import {sharingCommand} from './collaboration/commands.js';
import {ResearchExchange} from './collaboration/research-exchange.js';
import {ChangeReview} from './collaboration/change-review.js';
import {httpDrain} from './http-drain.js';
import {storageResponse} from './storage-response.js';
import {moveWorkspaceTo,workspaceMoveStatus,readMoveReceipt} from './workspace-move.js';
import {moveSource} from './workspace-move-state.js';
import {operationTransfer} from './operation-progress.js';
import {operationResponse} from './operation-response.js';
import {startupAssets} from './startup-assets.js';
import {PublicationVerificationJobs} from './publication-verification-jobs.js';
import {readBOMSource} from './bom-import.js';
import {DesignCandidates} from './design-candidates.js';
import {AppearancePreviewSessions} from './appearance-preview-sessions.js';
import {WorkspaceReader} from './workspace-reader.js';
import {RecordContent} from './record-content.js';
import {RecordSelectors} from './record-selectors.js';
import {RetainedRecordDocuments} from './retained-record-documents.js';
import {AnalysisPublicationReview} from './analysis-publication-review.js';
import {inspectSource} from './migration/runner.js';
import {MigrationImport} from './migration/import-service.js';
import {intakeCommand} from './intake/commands.js';
import {executeReviewRequest} from './review-requests.js';
import {DeploymentJobs} from './deployment-jobs.js';
import {PublicationJobs} from './publication-jobs.js';
import {PublicationRollback} from './publication-rollback.js';
import {PublicationLinks} from './publication-links.js';
import {publicationReferences} from './publication-revisions.js';
import {publicationSelection} from './publication-selection.js';
import {LocalExport} from './local-export.js';
import {GithubRepositorySetup} from './github-repository.js';
import {MediaImports} from './media-imports.js';
import {TimelineQuery} from './timeline-query.js';
import {RecordQuery} from './record-query.js';
import {RecordRuns} from './record-runs.js';
import {DashboardRecords} from './dashboard-records.js';
import {DashboardTypeQuery} from './dashboard-type-query.js';
import {RecordTypeQuery} from './record-type-query.js';
import {DashboardDiscovery} from './dashboard-discovery.js';
import {workspaceJobs,websitePublisher} from './workspace-jobs.js';
import {WebsiteSites} from './website-sites.js';
import {websiteWorkspace,websiteJobQueue,websiteRequest} from './website-workspace.js';
import {jobSummary} from './jobs.js';
import {databaseStatus,databaseCapacity} from './postgres.js';
import {databaseProvider} from './workspace-database-context.js';
import {recordStarterRequest,executeRecordStarterRequest} from './record-starter-requests.js';
import {ResearchMaterials} from './research-materials.js';
import {RecordHistory} from './record-history.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from './security/dashboard-storage.js';
import {DeviceStore,defaultDeviceStore} from './security/device-store.js';
import {workspaceAccess,updateWorkspaceAccess} from './security/workspace-access.js';
import {createWorkspaceAccess,isEncryptedAccess,requiresAccess,accessSummary} from './access.js';
import {ModuleDrafts} from './modules/drafts.js';
import {ModuleDraftTransfer} from './modules/draft-transfer.js';
import {workspaceModules} from './modules/index.js';
import {ModuleHistory} from './modules/history.js';
import {ModuleReader} from './modules/reader.js';
import {PlanningDashboard} from './modules/dashboard.js';
import {InventoryReader} from './modules/inventory-reader.js';
import {ResearchRecords,recordRevisions} from './research.js';
import {RecordWriting} from './record-writing.js';
import {RecordSectionCommands} from './record-section-commands.js';
import {RecordMediaCommands} from './record-media-commands.js';
import {RecordFigureCommands} from './record-figure-commands.js';
import {RecordTagCommands} from './record-tag-commands.js';
import {RecordValues} from './record-values.js';
import {figureCopyChoices,figureCopySource} from './record-figure-copy-values.js';
import {RecordLocation} from './record-location.js';
import {RecordRunCreation} from './record-run-creation.js';
import {validSections} from './web/website-model.js';
import {assertPublicFields} from './privacy.js';
import {validDashboard,defaultDashboard} from './web/dashboard-model.js';
import {validLabBookTypeSelection} from './web/feature-modules.js';
import {MediaPolicy} from './media-policy.js';
import {serveContent,diskSpace} from './file-content.js';
import {zipStream} from './zip-stream.js';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createFolderPicker} from './native-folder-picker.js';
import {preferencesSnapshot,resetPreferences,dashboardSnapshot,saveDashboard,rememberLanguage} from './preferences.js';
import {defaultLocation} from './locations.js';
import {CalendarSources} from './calendar/service.js';
import {calendarPage} from './calendar/pages.js';
import {cloneVault,clearVault} from './encryption.js';
import { identityLabel } from './web/workspace-identity.js';
import { validInterface } from './web/interface-ui.js';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readAccess,verifyAccess,changeAccess,takeCreatedVault} from './access.js';
import {resolveLocation,inspectLocation,probeLocation,browseFolders,createFolder,storageMap,initializeLocation,namedWorkspaceLocation,encryptedCopy,readPreferences,rememberInterface} from './locations.js';
import { buildDesignExamples } from './design-preview.js';
import {appearancePreviewSource} from './appearance-preview.js';
import {OperationActivity} from './operation-activity.js';
import {reviewWriterRecovery,recoverWriter} from './writer-recovery.js';
import {DashboardEdits} from './dashboard-edits.js';
import {requestWriterWait,waitForWriter,withoutWriterWait} from './writer-wait.js';
import {WorkspaceReadAdmission,workspaceSnapshotRequest} from './workspace-read-admission.js';
import {StructureCommands} from './structure-commands.js';
import {WorkspaceEdits} from './workspace-edits.js';
import {WebsiteResearch} from './website-research.js';
import { Laboratory } from './laboratory.js';
import {SampleAnalysisReader} from './sample-analysis-reader.js';
import { Publisher } from './publishing.js';
import {githubSerializedRequest} from './github/request-policy.js';
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import { Workspace, workspaceFile, assertRegular } from './storage.js';
import { createNotebook, upgradeNotebook, MAX_BYTES } from './model.js';
import {MAX_RECORD_COMMAND_BYTES} from './web/research-capacity.js';
import {admitResearchBytes} from './research-capacity.js';
import {MODULE_BYTES,MODULE_CHECKPOINT_BYTES} from './modules/capacity.js';
import {verifyPublication} from './publication.js';
import { AppError, safeError } from './errors.js';
import { MediaStore, mediaCapabilities } from './media.js';
import { bundledFonts,bundledFontCSS } from './fonts.js';
import {WorkspaceFonts} from './workspace-fonts.js';
import {MAX_FONT_BYTES} from './font-inspector.js';

// Discover only packaged browser assets. New feature files need no server list edit.
async function browserAssets(directory=new URL('./web/',import.meta.url),prefix=''){
 const entries=await readdir(directory,{withFileTypes:true});
 return (await Promise.all(entries.map(async entry=>{
  const name=prefix+entry.name,url=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
  if(entry.isDirectory())return browserAssets(url,name+'/');
  if(!entry.isFile()||!/[.](?:js|css|html|txt|json)$/.test(entry.name))return [];
  return [[name,await readFile(url)]];
 }))).flat();
}
const assets=new Map(await browserAssets());
startupAssets(assets);
// The app and desktop package use the same source artwork.
for(const variant of ['black','white'])assets.set('observanda-'+variant+'.svg',await readFile(new URL('../desktop/icon_'+variant+'.svg',import.meta.url)));
assets.set('observanda.svg',assets.get('observanda-black.svg'));
for (const [name, bytes] of bundledFonts) assets.set(name, bytes);
assets.set('bundled-fonts.css',bundledFontCSS);
const mime = name => name.endsWith('.bin') ? 'application/octet-stream' : name.endsWith('.csv') ? 'text/csv; charset=utf-8' : name.endsWith('.png') ? 'image/png' : name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.wav') ? 'audio/wav' : name.endsWith('.ttf') ? 'font/ttf' : name.endsWith('.otf') ? 'font/otf' : name.endsWith('.woff2') ? 'font/woff2' : name.endsWith('.woff') ? 'font/woff' : name.endsWith('.txt') ? 'text/plain; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8';
const equal = (a, b) => typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function body(req,limit=MAX_BYTES,capacityOwner=null) {
  const chunks = []; let size = 0;
  if (req.headers['content-type'] !== 'application/json') throw new AppError('INVALID');
  const declared=Number(req.headers['content-length']);
  if(capacityOwner&&Number.isSafeInteger(declared)&&declared>=0)admitResearchBytes(capacityOwner,declared);
  for await (const chunk of req) { size += chunk.length; if (size > limit) {if(capacityOwner)admitResearchBytes(capacityOwner,size);throw new AppError('LIMIT');} chunks.push(chunk); }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AppError('INVALID');
    return data;
  } catch { throw new AppError('INVALID'); }
}

export async function startServer({ root=null, port = 4173, publishingOptions, githubConnections, preferencesFile, expectedExisting=false, headless=false, folderPicker, folderBrowser=browseFolders, deviceStore=preferencesFile?new DeviceStore({file:preferencesFile+'.device-key'}):defaultDeviceStore } = {}) {
  const {GithubConnections}=await import('./github/connections.js');
  const github=githubConnections??(preferencesFile?new GithubConnections({file:preferencesFile+'.github.json',request:publishingOptions?.request}):null);
  const picker=folderPicker??createFolderPicker({headless}),folderRequests=new Set(),inventoryRequests=new Set();
  const cancelFolderRequests=()=>{for(const controller of [...folderRequests,...inventoryRequests])controller.abort();};
  const responseBook = result => {const book=upgradeNotebook(result.book);return {...result,book,recordRevisions:recordRevisions(book)};};
  const makeContext=(location,required=false,vault={id:null,key:null})=>({readers:new WorkspaceReadAdmission(),calendarSources:new CalendarSources(),vault,id:randomBytes(24).toString('hex'),root:location,expectedExisting:!!location&&required,workspace:location?new Workspace(location,vault):null,media:location?new MediaStore(location,vault):null,laboratory:location?new Laboratory(location,vault):null,publisher:location?new Publisher(location,{...publishingOptions,connection:github?.forWorkspace(location)},vault):null,candidates:new Map(),designCandidates:new DesignCandidates(),appearancePreviews:new AppearancePreviewSessions()});
  const activities=new OperationActivity();
  const dashboardEdits=new DashboardEdits((preferencesFile??deviceStore.file)+'.pending-settings');
  const workspaceDirectory=new WorkspaceDirectory((preferencesFile??deviceStore.file)+'.workspace-directory.json',{seed:async()=>preferencesFile?(await readPreferences(preferencesFile)).recent.map(item=>item.path):[]});
  const renames=new WorkspaceRenames((preferencesFile??deviceStore.file)+'.workspace-renames',{relocate:async(source,destination,target)=>{
   if(target.vault?.key)await dashboardEdits.relocate(new Workspace(source,target.vault),target);
   await rememberWorkspaceLocation(preferencesFile,destination,{title:workspaceFolderName(destination),label:'Workspace'},{github,movingFrom:source});
  }});
  if(root)root=await renames.resolvedRoot(root);
  const ensureWorkspaceIdentity=async ctx=>{
   if(!ctx.workspace)return;
   ctx.identityPrepared??=(async()=>{
    await renames.clearCompleted(ctx.root).catch(async error=>{if(error.code!=='STORAGE_RENAME_STATE'||!await renames.pending(ctx.root))throw error;});
    let pending=await renames.pending(ctx.root);
    if(pending?.phase==='prepared'&&!await workspaceRename(pending.source)){await renames.resume(ctx.root,ctx.vault);pending=null;}
    if(pending){
     const result=await workspaceDirectory.using(pending.destination,{replacing:pending.source},()=>renames.resume(ctx.root,ctx.vault));
     if(result.destination!==ctx.root)Object.assign(ctx,makeContext(result.destination,true,ctx.vault));
    }
    if(!await assertRegular(await workspaceFile(ctx.root),{missing:true}))return;
    await workspaceDirectory.using(ctx.root,{allowExisting:true,replacing:await renames.completedSource(ctx.root)},async()=>{
     try{await synchronizeWorkspaceName(ctx.workspace);}catch(error){if(!['MISSING','CATALOGUE_UNAVAILABLE'].includes(error.code))throw error;}
    });
   })().catch(async error=>{
    ctx.identityPrepared=null;
    // Authentication has already succeeded. An interrupted rename remains
    // usable as a recovery screen even if the startup attempt cannot finish.
    const recovery=await renames.recovery(ctx.root).catch(()=>null);
    if(recovery){ctx.renameAccessRoot=recovery.root;return;}
    throw error;
   });
   return ctx.identityPrepared;
  };
  const dashboardTasks=new Set();
  const readDashboardPending=async ctx=>{
    const pending=await dashboardEdits.read(ctx.workspace),failure=ctx.dashboardFailure;
    return pending&&failure?.id===pending.id&&!pending.error?{...pending,state:'failed',error:failure.code}:pending;
  };
  const startDashboardEdits=ctx=>{
    if(ctx.dashboardTask||!ctx.workspace||!ctx.vault.key||ctx.manualLock||shuttingDown)return;
    let commandId=null;
    const task=(async()=>{
      while(context===ctx&&!ctx.manualLock&&ctx.vault.key&&!shuttingDown){
        commandId=null;
        const pending=await readDashboardPending(ctx);if(!pending||pending.error)return;
        commandId=pending.id;
        if(!changing&&!loginBusy){
          activeWrites++;
          try{await withoutWriterWait(()=>dashboardEdits.apply(ctx.workspace));}
          finally{activeWrites--;}
        }
        await new Promise(resolve=>setTimeout(resolve,250));
      }
    })().catch(async error=>{
      if(!commandId||ctx.manualLock||context!==ctx||shuttingDown)return;
      const failure={id:commandId,code:error.code??'IO'};ctx.dashboardFailure=failure;
      // Preserve the failure across restarts when possible. If the intent file
      // itself cannot be written, its owning panel still receives this error.
      try{await dashboardEdits.recordFailure(ctx.workspace,failure.id,failure.code);}catch{}
    }).finally(()=>{ctx.dashboardTask=null;dashboardTasks.delete(task);});
    ctx.dashboardTask=task;dashboardTasks.add(task);
  };
  const startJobs=ctx=>{if(ctx.workspace&&ctx.vault.key&&!ctx.manualLock&&!shuttingDown&&!changing){ctx.publicationSourceAccess??=new PublicationSourceAccess();ctx.jobs??=workspaceJobs(ctx.workspace,ctx.publisher,{sourceAccess:ctx.publicationSourceAccess,observe:job=>activities.job(ctx.id,job)});ctx.jobs.worker.start();startDashboardEdits(ctx);}};
  const stopWorkspaceJobs=async ctx=>{await ctx.live?.close();delete ctx.live;await ctx.jobs?.worker.stop();ctx.publicationSourceAccess?.clear();await ctx.publisher?.connection?.clear();};
  const stopJobs=async ctx=>{await ctx.projects?.close();delete ctx.projects;await stopWorkspaceJobs(ctx);};
  const deletions=new WorkspaceDeletions((preferencesFile??deviceStore.file)+'.workspace-deletions');
  if(root&&(await workspaceDeletion(root)||(await deletions.list()).some(item=>item.source===root&&item.phase!=='prepared')))root=null;
  let context=makeContext(root,expectedExisting), origin, publishing=false, importing=false, changing=false, activeWrites=0, loginBusy=false;
  const assertGithubIdle=async()=>{if(publishing||await context.jobs?.queue.hasActive(['publication.deploy','publication.repository']))throw new AppError('GITHUB_PUBLICATION_BUSY');};
  const sessions=new Map(), plans=new Map(), failures=new Map();
  const launchToken=randomBytes(32).toString('hex');
  let contextRequired=false;
  const localPreferences=await readPreferences(preferencesFile);
  const forgetDeleted=async source=>{
    // Another workspace may now occupy the old location. Its local bindings
    // belong to it, just as its new files do.
    if(await assertRegular(source,{directory:true,missing:true}))return;
    await github?.forgetWorkspace(source);await forgetWorkspace(preferencesFile,source);await workspaceDirectory.forget(source);
    localPreferences.recent=localPreferences.recent.filter(item=>item.path!==source);
    if(localPreferences.workspace===source)localPreferences.workspace=null;
  };
  const detachDeleted=async(source,client)=>{
    if(context.root!==source)return;
    await stopJobs(context);cancelFolderRequests();context.calendarSources.clear();clearVault(context.vault);context=makeContext(null);contextRequired=true;plans.clear();
    for(const session of sessions.values())session.access=null;
    client.access='none';client.expires=Date.now()+8*60*60*1000;
  };
  const setCookie=(res,id)=>res.setHeader('Set-Cookie',`observanda=${id}; HttpOnly; SameSite=Strict; Path=/`);
  const contextAccess=()=>workspaceRenameAccess(context,renames);
  const status=async client=>{const access=await contextAccess();if(context.protectedOnce&&access.etag==='none')throw new AppError('ACCESS_FORMAT');context.protectedOnce ||= requiresAccess(access.value);return {access,locked:!!context.manualLock||requiresAccess(access.value)&&(client.access!==access.etag||client.expires<Date.now()||(isEncryptedAccess(access.value)&&!context.vault.key))};};
  const authenticate=async(root,access,username,password,recovery='')=>{
    const attempts=failures.get(root)??{count:0,until:0};if(attempts.count>=5&&Date.now()<attempts.until)throw new AppError('ACCESS_WAIT');
    try{const vault=await verifyAccess(access,username,password,{deviceStore,recovery});failures.delete(root);return vault;}catch(e){if(e.code==='ACCESS_DENIED')failures.set(root,{count:Date.now()>attempts.until?1:attempts.count+1,until:Date.now()+60000});throw e;}
  };
  const savedDeletion=new SavedWorkspaceDeletion({deletions,deviceStore,locations:()=>workspaceDirectory.list(),protectedPaths:[preferencesFile,deviceStore.file,fileURLToPath(new URL('..',import.meta.url))],authenticate,activeRoot:()=>context.root,forget:forgetDeleted});
  const activate=async(location,client,vault=null,{movingFrom,followSettings=false}={})=>operationStage('activate',{},async()=>{
    savedDeletion.assertAvailable(location);
    if(context.workspace&&context.root!==location){
      try{const prior=(await context.workspace.outline()).metadata,detail=await rememberWorkspaceLocation(preferencesFile,context.root,{title:context.vault.id?'':prior.title,label:context.vault.id?'Encrypted workspace':identityLabel(prior.identity)},{github});localPreferences.recent=[detail,...localPreferences.recent.filter(item=>item.path!==context.root)].slice(0,30);}catch(e){if(!['MISSING','CATALOGUE_UNAVAILABLE',...(movingFrom===context.root?['STORAGE_MOVED']:[])].includes(e.code))throw e;}
    }
    const opened=(await synchronizeWorkspaceName(new Workspace(location,vault))).metadata;
    const detail=await rememberWorkspaceLocation(preferencesFile,location,{title:vault?.id?'':opened.title,label:vault?.id?'Encrypted workspace':identityLabel(opened.identity)},{github,movingFrom});
    const priorContextId=context.id;
    const priorContext=context;priorContext.adopting=true;
    try{
    savedDeletion.assertAvailable(location);
    priorContext.concurrentReads=false;await priorContext.readers.close();
    await Promise.all(priorContext.settingsWrites??[]);
    cancelFolderRequests();await stopJobs(context);
    if(followSettings&&context.workspace&&context.vault.key&&vault?.key)await dashboardEdits.relocate(context.workspace,new Workspace(location,vault));
    if(context.root&&context.root!==location)await databaseProvider()?.closeWorkspace(context.root);
    savedDeletion.assertAvailable(location);
    localPreferences.recent=[detail,...localPreferences.recent.filter(item=>item.path!==location&&item.path!==movingFrom)].slice(0,30);if(context.publisher)context.publisher.token=null;context.calendarSources.clear();clearVault(context.vault);context=makeContext(location,true,vault??{id:null,key:null});contextRequired=true;plans.clear();const access=await readAccess(location);context.protectedOnce=requiresAccess(access.value);client.access=access.etag;client.expires=Date.now()+8*60*60*1000;activities.relocate(priorContextId,context.id);startJobs(context);
    }finally{priorContext.adopting=false;if(context===priorContext)priorContext.readers.open();}
  });
  const metadata=async()=>{
    const rename=await workspaceRenameRecovery(renames,context.root);
    if(rename)return {root:context.root,contextId:context.id,rename,locations:[],database:{ready:false},preferencesFile:preferencesFile??null,folderPicker:await picker.capabilities(),available:false,expectedExisting:true,encrypted:!!context.vault.id,unavailableReason:'workspace-renaming'};
    const provider=databaseProvider(),moving=context.root?await moveSource(context.root):null;let status;
    try{status=await databaseStatus(provider&&context.vault.key&&!moving?await provider.environment(context.root,{vault:context.vault}):undefined);}catch(error){status={engine:'PostgreSQL',ready:false,code:error.code??'DATABASE_UNAVAILABLE'};}
    const database={...status,...(provider?await provider.details(context.workspace):{placement:'external',path:null}),message:status.ready?'PostgreSQL is connected.':safeError(new AppError(status.code)).message};
    if(!context.workspace){const pending=await deletions.list();return {database,root:null,locations:[],preferencesFile:preferencesFile??null,suggestedLocation:defaultLocation(),workspaceParent:path.dirname(defaultLocation()),applicationRoot:fileURLToPath(new URL('..',import.meta.url)),contextId:context.id,folderPicker:await picker.capabilities(),available:false,unavailableReason:pending.length?'workspace-deleting':null,encrypted:false,expectedExisting:!!pending.length,deletions:pending};}
    let available=true,unavailableReason=null,researchFormatVersion=null;
    try{researchFormatVersion=(await context.workspace.outline()).metadata.formatVersion;}catch(e){
      if(!['MISSING','CATALOGUE_UNAVAILABLE','STORAGE_MOVED'].includes(e.code))throw e;
      available=false;
      unavailableReason=e.code==='STORAGE_MOVED'?'workspace-moved':e.code==='CATALOGUE_UNAVAILABLE'?'database-missing':await assertRegular(context.root,{directory:true,missing:true})?'record-missing':'folder-missing';
    }
    const researchStorage=available?await context.workspace.storageKind():null;
    return {database,nameConflict:(await workspaceDirectory.list()).find(item=>item.path===context.root)?.conflict??false,researchStorage,researchFormatVersion,workspaceParent:path.dirname(context.root),movedTo:moving?.destination??null,move:available?await workspaceMoveStatus(context.root):null,...storageMap(context.root,preferencesFile,path.basename(await workspaceFile(context.root)),{catalogue:researchStorage==='catalogue'}),applicationRoot:fileURLToPath(new URL('..',import.meta.url)),contextId:context.id,folderPicker:await picker.capabilities(),available,unavailableReason,encrypted:!!context.vault.id,expectedExisting:context.expectedExisting||!!moving};
  };
  let shuttingDown=false,closePromise,githubMutation=false,collaborationSession;const pending=new Set(),drained=[];
  const server = http.createServer((req, res) => requestWriterWait(req,res,async()=>{
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'");
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    let countedWrite=false,ownsGithubMutation=false,releaseRead;const request={};pending.add(request);
    try {
      if(shuttingDown)throw new AppError('SERVER_CLOSING');
      if (req.headers.host !== new URL(origin).host) throw new AppError('ORIGIN');
      if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin)) throw new AppError('ORIGIN');
      if (!['GET', 'POST'].includes(req.method)) throw new AppError('ORIGIN');
      if (req.method === 'POST' && req.headers.origin !== origin) throw new AppError('ORIGIN');
      const url = new URL(req.url, origin);
      if (req.method === 'POST' && url.pathname === '/api/session') {
        const data = await body(req);
        if (!equal(data?.token, launchToken)) throw new AppError('AUTH');
        if(changing||loginBusy){
          const prior=req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith('observanda='))?.slice(11),client=sessions.get(prior);
          if(client&&!(await status(client)).locked)return json({ok:true});
          throw new AppError('LOCKED');
        }
        const sessionContext=context,session=randomBytes(32).toString('hex'),access=await contextAccess();
        if(sessions.size>=128)sessions.delete(sessions.keys().next().value);
        const local={access:requiresAccess(access.value)?null:access.etag,expires:Date.now()+8*60*60*1000};
        if(access.value.formatVersion===3&&!context.manualLock){
         try{
          const vault=await verifyAccess(access,'','',{deviceStore});
          const latest=await contextAccess();
          if(context!==sessionContext){clearVault(vault);throw new AppError('WORKSPACE_CHANGED');}
          if(context.manualLock||latest.etag!==access.etag){clearVault(vault);}
          else if(context.vault.key&&context.vault.id===vault.id&&context.vault.key.equals(vault.key)){clearVault(vault);local.access=access.etag;}
          else{await stopJobs(sessionContext);if(context!==sessionContext){clearVault(vault);throw new AppError('WORKSPACE_CHANGED');}if(context.manualLock||changing||loginBusy){clearVault(vault);throw new AppError('LOCKED');}context.calendarSources.clear();clearVault(context.vault);Object.assign(context.vault,vault);local.access=access.etag;}
         }
         catch(error){if(!['DEVICE_UNKNOWN','DEVICE_UNAVAILABLE','DEVICE_INVALID','LEGACY_WRITE_LOCK'].includes(error.code))throw error;}
        }
        if(local.access){await ensureWorkspaceIdentity(sessionContext);}
        if(local.access)try{await rememberAuthenticatedLocation(preferencesFile,sessionContext.root);}catch(error){if(error.code!=='LEGACY_WRITE_LOCK')throw error;}
        if(context!==sessionContext)throw new AppError('WORKSPACE_CHANGED');sessions.set(session,local);setCookie(res,session);if(local.access)startJobs(context);
        return json({ ok: true });
      }
      const asset = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (req.method === 'GET' && assets.has(asset)) { res.writeHead(200, { 'Content-Type': mime(asset) }); res.end(assets.get(asset)); return; }
      const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('observanda='))?.slice(11);
      const client=sessions.get(cookie);if(!client)throw new AppError('AUTH');
      if(req.method==='GET'&&url.pathname==='/api/health'){
       const database=await databaseStatus();return json({service:'local-authoring',ready:database.ready,database,capacity:databaseCapacity()},database.ready?200:503);
      }
      const selectedContext=context;
      const snapshotRead=workspaceSnapshotRequest(req.method,url.pathname);
      if(!snapshotRead)req.operationActivity=()=>req.activity??=activities.begin(selectedContext.id,url.pathname,{view:req.headers['x-observanda-view'],recoveryKey:req.activityRecoveryKey});
      req.waitForWriter=req.headers['x-observanda-wait']==='1'&&(snapshotRead||req.method==='POST'&&!['/api/storage/','/api/access/','/api/security/','/api/writer-recovery','/api/preferences/reset','/api/notebook/create'].some(prefix=>url.pathname.startsWith(prefix)));
      req.checkWriter=async()=>{if(shuttingDown)throw new AppError('SERVER_CLOSING');if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');if((await status(client)).locked)throw new AppError('ACCESS_LOCKED');};
      let {workspace,publisher}=selectedContext;
      const {media,laboratory,candidates,designCandidates,appearancePreviews}=selectedContext;
      if(req.method==='POST'&&url.pathname.startsWith('/api/workspaces/delete/')){
        const operation=url.pathname.slice('/api/workspaces/delete/'.length),data=await body(req,16384);
        req.waitForWriter=false;req.checkWriter=async()=>{if(shuttingDown)throw new AppError('SERVER_CLOSING');};
        if(operation==='preview')return json(await savedDeletion.review(client,data));
        if(operation==='unlock')return json(await savedDeletion.unlock(client,data));
        if(operation==='cancel')return json(await savedDeletion.cancel(client,data));
        if(operation==='confirm')return await operationResponse(req,res,()=>savedDeletion.confirm(client,data),json);
        if(operation==='finish')return await operationResponse(req,res,()=>savedDeletion.finish(data),json);
        throw new AppError('NOT_FOUND');
      }
      if(url.pathname==='/api/writer-recovery'){
        const paths={workspace:context.root?path.join(context.root,'.observanda','write.lock'):null,preferences:preferencesFile?preferencesFile+'.lock':null,device:deviceStore.file?deviceStore.file+'.lock':null};
        if(req.method==='GET'){
          const locks=[];for(const [kind,file] of Object.entries(paths)){const review=await reviewWriterRecovery(file);if(review)locks.push({kind,...review});}
          return json({contextId:context.id,locks});
        }
        const data=await body(req);if(context!==selectedContext||data.contextId!==context.id)throw new AppError('WORKSPACE_CHANGED');
        if(changing||loginBusy||activeWrites||publishing||importing)throw new AppError('LOCKED');
        if(!Object.hasOwn(paths,data.kind)||!paths[data.kind])throw new AppError('INVALID');
        changing=true;try{return json(await recoverWriter(paths[data.kind],data));}finally{changing=false;}
      }
      const publicationQueue=()=>websiteJobQueue(context.jobs.queue,workspace.websiteId);
      const blockedValues=[selectedContext.root,os.homedir(),os.hostname()].filter(Boolean);
      // Personal display preferences are independent of a workspace's lock and contents.
      if(url.pathname==='/api/language'&&['GET','POST'].includes(req.method)){
        if(req.method==='POST'){
          const data=await body(req);
          if(context!==selectedContext||(contextRequired&&req.headers['x-observanda-workspace']!==context.id))throw new AppError('WORKSPACE_CHANGED');
          if(!data||Object.keys(data).length!==1||typeof data.language!=='string')throw new AppError('INVALID');
          activeWrites++;countedWrite=true;await rememberLanguage(preferencesFile,data.language);localPreferences.language=data.language;
        }
        return json({language:preferencesFile?(await readPreferences(preferencesFile)).language:localPreferences.language});
      }
      if(url.pathname==='/api/interface'){
        if(req.method==='POST'){const settings=await body(req);if(context!==selectedContext||(contextRequired&&req.headers['x-observanda-workspace']!==context.id))throw new AppError('WORKSPACE_CHANGED');activeWrites++;countedWrite=true;if(!validInterface(settings))throw new AppError('INVALID');await rememberInterface(preferencesFile,settings);localPreferences.interface=settings;}
        return json(localPreferences.interface);
      }
      if(req.method==='GET'&&url.pathname==='/api/security/capabilities')return json({deviceAvailable:deviceStore.available()});
      if(req.method==='POST'&&url.pathname==='/api/security/device'){await body(req);return json(await deviceStore.identity());}
      if(req.method==='POST'&&url.pathname.startsWith('/api/security/collaboration-identity/')){
        const data=await body(req,32768),operation=url.pathname.slice('/api/security/collaboration-identity/'.length);
        if(context!==selectedContext||data.contextId!==context.id)throw new AppError('WORKSPACE_CHANGED');
        if(changing||loginBusy||activeWrites||publishing||importing)throw new AppError('LOCKED');
        changing=true;
        try{
          const access=await status(client);
          if(operation==='backup'&&access.locked)throw new AppError('ACCESS_LOCKED');
          const mutate=['restore','activate'].includes(operation);
          if(mutate&&(!context.manualLock||context.vault.key||context.live))throw new AppError('COLLABORATION_IDENTITY_LOCK');
          const run=()=>identityRecoveryCommand(new CollaborationRecovery(deviceStore),operation,data);
          return json(await (mutate?collaborationSession.exclusive(run):run()));
        }finally{changing=false;}
      }
      if(req.method==='GET'&&url.pathname==='/api/access/status'){
        const {access,locked}=await status(client);return json({...await accessSummary(access.value,deviceStore),locked,username:locked?'':access.value.username});
      }
      if(req.method==='POST'&&url.pathname==='/api/access/unlock'){
        if(changing||loginBusy)throw new AppError('LOCKED');
        const data=await body(req);if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');if(changing||loginBusy)throw new AppError('LOCKED');loginBusy=true;
        try{const {access}=await status(client);const vault=await authenticate(context.root,access,data.username??'',data.password??'',data.recovery??'');if(vault){await context.readers.close();await stopJobs(context);context.calendarSources.clear();clearVault(context.vault);Object.assign(context.vault,vault);}await ensureWorkspaceIdentity(context);await rememberAuthenticatedLocation(preferencesFile,context.root);context.manualLock=false;client.access=access.etag;client.expires=Date.now()+8*60*60*1000;startJobs(context);return json({ok:true});}
        finally{selectedContext.readers.open();loginBusy=false;}
      }
      if(req.method==='POST'&&url.pathname==='/api/access/lock'){if(activeWrites||importing||publishing||changing||loginBusy)throw new AppError('LOCKED');cancelFolderRequests();context.manualLock=true;await context.readers.close();await stopJobs(context);if(context.root)await databaseProvider()?.closeWorkspace(context.root);for(const session of sessions.values())session.access=null;context.calendarSources.clear();clearVault(context.vault);if(publisher)publisher.token=null;candidates.clear();designCandidates.clear();appearancePreviews.clear();return json({ok:true});}
      const accessState=await status(client);if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');if(accessState.locked)throw new AppError('ACCESS_LOCKED');
      // Reading observations never opens the catalogue or competes for its lock.
      if(req.method==='GET'&&url.pathname==='/api/activity')return json({contextId:context.id,busy:changing||loginBusy||activeWrites>0,readable:context.readers.accepting&&!loginBusy&&(!changing||!!context.concurrentReads),operations:activities.list(context.id)});
      if(req.method==='POST'&&url.pathname==='/api/activity/clear'){
        await body(req);if(context!==selectedContext||req.headers['x-observanda-workspace']!==context.id)throw new AppError('WORKSPACE_CHANGED');
        activities.clear(context.id);return json({ok:true});
      }
      if(contextRequired&&(req.method==='POST'||['/api/dashboard','/api/dashboard/pending','/api/notebook','/api/media-policy','/api/laboratory','/api/publishing','/api/history','/api/modules/data','/api/modules/version','/api/modules/history','/api/calendars'].includes(url.pathname))&&req.headers['x-observanda-workspace']!==context.id)throw new AppError('WORKSPACE_CHANGED');
      const historyProjects=selectedContext.projects??=new ProjectApplication(workspace,{deviceStore,authenticate,workspaceLocations:()=>workspaceDirectory.list(),publisherOptions:storage=>({...publishingOptions,connection:github?.forWorkspace(storage.root)})});
      const sourceReader=publicationSourceFactory(historyProjects,client,selectedContext.workspace,{check:req.checkWriter});
      return await historyProjects.withSourceHistory(client,async()=>{
      const selectedProject=projectRequest(url.pathname,req.method);
      if(selectedProject&&(req.method==='POST'||(selectedProject.material||selectedProject.publication||selectedProject.asset||selectedProject.sampleAnalysis)&&req.method==='GET')){
        if(!workspace||req.method==='POST'&&req.headers['x-observanda-workspace']!==selectedContext.id)throw new AppError('WORKSPACE_CHANGED');
        if(selectedProject.publication||selectedProject.asset||selectedProject.starter||selectedProject.sampleAnalysis){
          const check=req.checkWriter;await check();if(selectedProject.write){activeWrites++;countedWrite=true;}else req.operationActivity=null;
          return await projectContentHttp(req,res,selectedProject,{body,json,mime,headless,contextId:context.id,execute:(data,options)=>historyProjects.run(client,selectedProject,data,{...options,check,setCheck:next=>{req.checkWriter=next;}})});
        }
        if(selectedProject.material){
          const check=req.checkWriter;await check();
          const projects=selectedContext.projects??=new ProjectApplication(workspace,{deviceStore,authenticate,workspaceLocations:()=>workspaceDirectory.list(),publisherOptions:storage=>({...publishingOptions,connection:github?.forWorkspace(storage.root)})});
          if(selectedProject.write){activeWrites++;countedWrite=true;}else req.operationActivity=null;
          return await materialHttp(req,res,selectedProject,{contextId:selectedContext.id,body,json,execute:(data,options)=>projects.run(client,selectedProject,data,{...options,check,setCheck:next=>{req.checkWriter=next;}})});
        }
        const data=await body(req,selectedProject.limit,selectedProject.capacity),check=req.checkWriter;
        await check();
        const projects=selectedContext.projects??=new ProjectApplication(workspace,{deviceStore,authenticate,workspaceLocations:()=>workspaceDirectory.list(),publisherOptions:storage=>({...publishingOptions,connection:github?.forWorkspace(storage.root)})});
        if(['create','create/resume'].includes(selectedProject.operation))req.activityRecoveryKey='project-create:'+data?.id;
        if(['lab-books/import','lab-books/import/resume','lab-books/import/cancel'].includes(selectedProject.operation))req.activityRecoveryKey='lab-book-import:'+data?.id;
        if(['lab-books/create','lab-books/create/resume'].includes(selectedProject.operation))req.activityRecoveryKey='lab-book-create:'+data?.id;
        if(['lab-books/storage/delete','lab-books/storage/delete/resume'].includes(selectedProject.operation))req.activityRecoveryKey='lab-book-delete:'+data?.id;
        if(/^lab-books\/storage\/(copy|export|move)(?:\/(resume|cancel))?$/.test(selectedProject.operation))req.activityRecoveryKey='lab-book-'+selectedProject.operation.split('/')[2]+':'+data?.id;
        if(['settings/save','directory/reparent'].includes(selectedProject.operation))req.activityRecoveryKey=(selectedProject.operation==='settings/save'?'project-settings':'project-placement')+':'+data?.id;
        if(['open','open/resume','open/cancel'].includes(selectedProject.operation))req.activityRecoveryKey='project-open:'+data?.id;
        if(['storage/delete','storage/delete/resume'].includes(selectedProject.operation))req.activityRecoveryKey='project-delete:'+data?.id;
        if(/^storage\/(copy|export|move)(?:\/(resume|cancel))?$/.test(selectedProject.operation))req.activityRecoveryKey='project-'+selectedProject.operation.split('/')[1]+':'+data?.id;
        if(['lab-books/access/unlock','lab-books/access/lock'].includes(selectedProject.operation)){req.operationActivity=null;return json(await projects.run(client,selectedProject,data,{check}));}
        if(selectedProject.operation==='access/unlock')return json(await projects.unlock(client,selectedProject.projectId,data,{check}));
        if(selectedProject.operation==='access/lock'){if(Object.keys(data).length)throw new AppError('INVALID');return json(await projects.lock(client,selectedProject.projectId));}
        if(selectedProject.write){activeWrites++;countedWrite=true;}
        else req.operationActivity=null;
        const execute=options=>projects.run(client,selectedProject,data,{...options,calendarSources:selectedContext.calendarSources,check,setCheck:next=>{req.checkWriter=next;}});
        if(selectedProject.write)return await operationResponse(req,res,execute,json,{continueAfterDisconnect:['lab-books/import','lab-books/import/resume','lab-books/import/cancel','lab-books/storage/copy','lab-books/storage/move','lab-books/storage/move/resume','lab-books/storage/copy/resume','lab-books/storage/export','lab-books/storage/export/resume','storage/copy','storage/copy/resume','storage/export','storage/export/resume','storage/move','storage/move/resume','create','create/resume','open','open/resume','open/cancel','settings/save','directory/reparent','lab-books/create','lab-books/create/resume','lab-books/storage/rename','lab-books/settings/save','lab-books/storage/delete','lab-books/storage/delete/resume'].includes(selectedProject.operation)});
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{return json(await execute({signal:controller.signal}));}finally{res.off('close',abort);}
      }
      // Device profiles own their identity lock and protected files. They do
      // not acquire the workspace writer or follow its database transition.
      if(url.pathname==='/api/user-profile'&&req.method==='POST'){
        const data=await body(req,70*1024),profiles=new UserProfile(deviceStore);
        if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
        if(data?.operation==='read'&&Object.keys(data).length===1)return json(await profiles.state());
        if(data?.operation==='contact'&&Object.keys(data).length===2)return json(await profiles.contact(data.userId));
        if(data?.operation==='save'&&Object.keys(data).length===2){activeWrites++;countedWrite=true;return json(await profiles.save(data.command));}
        throw new AppError('INVALID');
      }
      if(snapshotRead){
        do{
          await waitForWriter(async()=>{if(loginBusy||changing&&!selectedContext.concurrentReads||!selectedContext.readers.accepting)throw new AppError('LOCKED');});
          if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
          if(!loginBusy&&(!changing||selectedContext.concurrentReads))releaseRead=selectedContext.readers.enter();
        }while(!releaseRead);
      }
      if(url.pathname==='/api/dashboard/pending'){
        if(!workspace?.vault?.key)throw new AppError('ACCESS_LOCKED');
        let accepted=null;
        if(req.method==='POST'){
          const data=await body(req);if(context!==selectedContext||req.headers['x-observanda-workspace']!==context.id)throw new AppError('WORKSPACE_CHANGED');
          if(context.adopting)throw new AppError('WORKSPACE_CHANGED');
          if(context.settingsClosed)throw new AppError('STORAGE_DELETING');
          activeWrites++;countedWrite=true;
          const task=(async()=>{
            if(data.action==='discard'||data.action==='retry'){
              const before=await readDashboardPending(selectedContext);
              if(before?.id===data.id&&before.error)await selectedContext.dashboardTask;
              if(data.action==='discard')await dashboardEdits.discard(workspace,data.id);
              else await dashboardEdits.retry(workspace,data.id);
              if(selectedContext.dashboardFailure?.id===data.id)selectedContext.dashboardFailure=null;
            }
            else if(data.action==='save')accepted=await dashboardEdits.submit(workspace,{id:data.id,settings:data.settings,etag:data.etag});
            else throw new AppError('INVALID');
          })();
          (selectedContext.settingsWrites??=new Set()).add(task);
          try{await task;}finally{selectedContext.settingsWrites.delete(task);}
        }
        const pending=await readDashboardPending(selectedContext);startDashboardEdits(selectedContext);return json({pending,accepted});
      }
      if(url.pathname==='/api/dashboard'&&['GET','POST'].includes(req.method)){
        if(req.method==='GET'&&context.vault.id)return json(await readWorkspaceDashboard(workspace));
        if(req.method==='GET')return json(dashboardSnapshot(preferencesFile?(await readPreferences(preferencesFile)).dashboard:localPreferences.dashboard));
        const data=await body(req);
        if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
        await waitForWriter(async()=>{if(changing||loginBusy)throw new AppError('LOCKED');});
        if(!data||Object.keys(data).length!==2||!validDashboard(data.settings)||typeof data.etag!=='string')throw new AppError('INVALID');
        activeWrites++;countedWrite=true;
        let result;
        if(context.vault.id)result=await writeWorkspaceDashboard(workspace,data.settings,data.etag);
        else if(preferencesFile)result=await saveDashboard(preferencesFile,data.settings,data.etag);
        else {if(dashboardSnapshot(localPreferences.dashboard).etag!==data.etag)throw new AppError('DASHBOARD_CHANGED');result=dashboardSnapshot(data.settings);}
        if(!context.vault.id)localPreferences.dashboard=result.settings;return json(result);
      }
      if(req.method==='GET'&&url.pathname==='/api/preferences'){
        const snapshot=await preferencesSnapshot(preferencesFile);
        return json({file:preferencesFile??null,etag:snapshot.etag});
      }
      if(req.method==='POST'&&url.pathname==='/api/preferences/reset'){
        const data=await body(req);
        if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
        if(data.confirmed!==true)throw new AppError('INVALID');
        if(changing||loginBusy||activeWrites||publishing||importing)throw new AppError('LOCKED');
        changing=true;
        try{
          await selectedContext.readers.close();
          const result=await resetPreferences(preferencesFile,data.etag);
          cancelFolderRequests();
          if(context.publisher)context.publisher.token=null;
          await stopJobs(context);if(context.root)await databaseProvider()?.closeWorkspace(context.root);context.calendarSources.clear();clearVault(context.vault);context.candidates.clear();context.designCandidates.clear();context.appearancePreviews.clear();plans.clear();
          context=makeContext(null);contextRequired=true;Object.assign(localPreferences,result.value);
          for(const session of sessions.values())session.access=null;
          client.access='none';client.expires=Date.now()+8*60*60*1000;
          return json({storage:await metadata(),backup:result.backup});
        }finally{selectedContext.readers.open();changing=false;}
      }
      if(url.pathname==='/api/security/workspace'){
       if(!workspace)throw new AppError('MISSING');
       if(req.method==='GET')return json(await workspaceAccess(context.root,context.vault));
       const data=await body(req);if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
       if(changing||loginBusy||activeWrites||publishing||importing)throw new AppError('LOCKED');
       changing=true;try{
        const result=await updateWorkspaceAccess(context.root,context.vault,data);
        client.access=result.etag;client.expires=Date.now()+8*60*60*1000;return json(result);
       }finally{changing=false;}
      }
      if(req.method==='GET'&&url.pathname==='/api/storage')return json(await metadata());
      if(req.method==='GET'&&url.pathname==='/api/workspaces'){
        let current=null;
        try{if(workspace){const book=(await workspace.outline()).metadata;current={path:workspace.root,title:workspaceFolderName(workspace.root),label:identityLabel(book.identity)};}}catch(e){if(!['MISSING','CATALOGUE_UNAVAILABLE'].includes(e.code))throw e;}
        const recent=(await workspaceDirectory.list()).map(item=>({...item,label:'Workspace'}));
        if(current)current.conflict=recent.find(item=>item.path===current.path)?.conflict??false;
        const pending=await deletions.list();return json({workspaces:[...(current?[current]:[]),...recent.filter(item=>item.path!==selectedContext.root&&!pending.some(p=>p.source===item.path))],active:selectedContext.root,deletions:pending});
      }
      if(req.method==='POST'&&['/api/storage/pick','/api/storage/browse'].includes(url.pathname)){
        const data=await body(req);
        if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
        if(changing||loginBusy)throw new AppError('LOCKED');
        const controller=new AbortController();folderRequests.add(controller);
        const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnected);
        try{
          const selection=url.pathname==='/api/storage/pick'
            ?await picker.choose({initialPath:data.path??'',signal:controller.signal})
            :await folderBrowser(data.path,{search:data.search,offset:data.offset,hidden:data.hidden,signal:controller.signal});
          if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
          if((await status(client)).locked)throw new AppError('ACCESS_LOCKED');
          if(!res.destroyed)return json(selection);
          return;
        }finally{folderRequests.delete(controller);res.off('close',disconnected);}
      }
      if(req.method==='POST'&&url.pathname==='/api/storage/check'){
        const data=await body(req);if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
        if(data.storageParent!==undefined&&data.path!==undefined||data.purpose!==undefined&&!['copy','move'].includes(data.purpose)||data.purpose!==undefined&&(!workspace||data.storageParent!==undefined))throw new AppError('INVALID');
        const input=data.storageParent===undefined?data.path:await namedWorkspaceLocation({parent:data.storageParent,name:data.name});
        const result=data.purpose==='copy'?await checkWorkspaceCopyDestination(workspace,input):data.purpose==='move'?await checkWorkspaceMoveDestination(workspace,input):await probeLocation(input);
        if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');return json(result);
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/storage/')){
        const data=await body(req);if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
        if(changing||loginBusy||activeWrites||publishing||importing)throw new AppError('LOCKED');
        changing=true;
        if(['/api/storage/delete','/api/storage/delete/finish'].includes(url.pathname))selectedContext.settingsClosed=true;
        try{
          selectedContext.concurrentReads=['/api/storage/copy/preview','/api/storage/copy','/api/storage/portable/preview','/api/storage/portable','/api/storage/move'].includes(url.pathname);
          if(!selectedContext.concurrentReads)await selectedContext.readers.close();
          // Independent project workers and grants remain available while a
          // workspace snapshot is copied. Activation revokes the old context.
          if(selectedContext.concurrentReads||['/api/storage/rename','/api/storage/rename/resume','/api/storage/delete/preview','/api/storage/delete'].includes(url.pathname))await stopWorkspaceJobs(selectedContext);else await stopJobs(selectedContext);
          if(['/api/storage/rename','/api/storage/delete/preview','/api/storage/delete','/api/storage/delete/finish','/api/storage/copy/preview','/api/storage/copy','/api/storage/encrypt','/api/storage/portable/preview','/api/storage/portable','/api/storage/move','/api/storage/move/finish'].includes(url.pathname)&&await context.jobs?.queue.hasActive())throw new AppError('JOB_BUSY');
          if(url.pathname==='/api/storage/delete/finish'){
            if(data.confirmed!==true)throw new AppError('INVALID');
            return await storageResponse(req,res,async()=>{
              const receipt=await deletions.read(data.id);let vault;
              try{
                const retired=path.join(path.dirname(receipt.source),'.observanda-delete-'+receipt.id);
                if(receipt.phase!=='complete'&&!await assertRegular(retired,{directory:true,missing:true})&&receipt.phase!=='retired'&&receipt.binding?.placement==='workspace')vault=await authenticate(receipt.source,await readAccess(receipt.source),data.username??'',data.password??'',data.recovery??'');
                const result=await deletions.finish(data.id,{vault});
                if(result.complete){await forgetDeleted(result.source);await deletions.acknowledge(data.id);}
                return {result,storage:await metadata()};
              }finally{clearVault(vault);}
            },json);
          }
          if(url.pathname==='/api/storage/rename'){
           const current=await workspace.outline();req.activityRecoveryKey='workspace-rename:'+current.metadata.id;
           if(Object.keys(data).sort().join()!=='etag,name'||typeof data.name!=='string'||current.etag!==data.etag)throw new AppError('CONFLICT');
           return await storageResponse(req,res,async()=>{
            const source=context.root,target=workspaceCreationPath(path.dirname(source),data.name);if(target===source)return metadata();
            const vault=cloneVault(context.vault);
            try{
             return await withWorkspaceRenameSession(historyProjects,client,async rename=>{
              const result=await workspaceDirectory.using(target,{replacing:source},async()=>{return rename.begin(renames,data.name,{checkpoint:async stage=>{if(stage==='renamed')selectedContext.renameAccessRoot=target;},protectedPaths:[preferencesFile,deviceStore.file,fileURLToPath(new URL('..',import.meta.url)),...(await workspaceDirectory.list()).filter(item=>item.path!==source).map(item=>item.path)]});});
              await activate(result.destination,client,vault,{movingFrom:source});
              await rename.install(context.projects??=new ProjectApplication(context.workspace,{deviceStore,authenticate,workspaceLocations:()=>workspaceDirectory.list(),publisherOptions:storage=>({...publishingOptions,connection:github?.forWorkspace(storage.root)})}));return metadata();
             });
            }catch(error){clearVault(vault);throw error;}
           },json);
          }
          if(url.pathname==='/api/storage/rename/resume'){
           if(Object.keys(data).join()!=='id'||typeof data.id!=='string')throw new AppError('INVALID');
           const recovery=await renames.recovery(context.root);if(!recovery||recovery.value.id!==data.id)throw new AppError('STORAGE_RENAME_STATE');
           const receipt=recovery.value;req.activityRecoveryKey='workspace-rename:'+receipt.workspaceId;
           return await storageResponse(req,res,async()=>{
            const vault=cloneVault(context.vault);
            try{return await withWorkspaceRenameSession(historyProjects,client,async rename=>{
             const result=await workspaceDirectory.using(receipt.destination,{replacing:receipt.source,allowExisting:true},async()=>rename.resume(renames,data.id,{checkpoint:async stage=>{if(stage==='renamed')selectedContext.renameAccessRoot=receipt.destination;},protectedPaths:[preferencesFile,deviceStore.file,fileURLToPath(new URL('..',import.meta.url)),...(await workspaceDirectory.list()).filter(item=>item.path!==receipt.source).map(item=>item.path)]}));
             await activate(result.destination,client,vault,{movingFrom:receipt.source});
             await rename.install(context.projects??=new ProjectApplication(context.workspace,{deviceStore,authenticate,workspaceLocations:()=>workspaceDirectory.list(),publisherOptions:storage=>({...publishingOptions,connection:github?.forWorkspace(storage.root)})}));return metadata();
            });}catch(error){clearVault(vault);throw error;}
           },json);
          }
          if(url.pathname==='/api/storage/folder')return json(await createFolder(data.parent,data.name),201);
          if(url.pathname==='/api/storage/open'){
           return await storageResponse(req,res,async()=>{
            const location=await renames.resolvedRoot(data.path);await renames.clearCompleted(location).catch(async error=>{if(error.code!=='STORAGE_RENAME_STATE'||!await renames.pending(location))throw error;});
            const renamePending=await renames.pending(location),info=await (renamePending?renameScope(renamePending.id,()=>inspectLocation(location)):inspectLocation(location));if(info.kind!=='workspace')throw new AppError('MISSING');
            const vault=await authenticate(info.root,await readAccess(info.root),data.username??'',data.password??'',data.recovery??'');
            const moved=context.root?await moveSource(context.root):null,receipt=moved?.destination===info.root?await readMoveReceipt(info.root):null;
            const movingFrom=receipt?.id===moved?.id&&receipt?.source===context.root?context.root:undefined;
            try{let pending=await renames.pending(info.root);if(pending?.phase==='prepared'&&!await workspaceRename(pending.source)){await renames.resume(info.root,vault);pending=null;}await workspaceDirectory.using(pending?.destination??info.root,{replacing:pending?.source??movingFrom??null,allowExisting:true},async()=>{const result=await renames.resume(info.root,vault);await activate(result.destination,client,vault,{movingFrom:pending?.source??movingFrom,followSettings:!!movingFrom});});}catch(error){clearVault(vault);throw error;};return metadata();
           },json);
          }
          if(!workspace)throw new AppError('MISSING');
          if(url.pathname==='/api/storage/delete/preview'){
            if(workspace.vault?.key&&await dashboardEdits.read(workspace))throw new AppError('DASHBOARD_PENDING');
            const plan=await deletions.review(workspace,{protectedPaths:[preferencesFile,deviceStore.file,fileURLToPath(new URL('..',import.meta.url))],recent:preferencesFile?(await readPreferences(preferencesFile)).recent:localPreferences.recent});
            const id=randomBytes(24).toString('hex');plans.set(id,{deletion:true,plan,expires:Date.now()+10*60*1000});while(plans.size>5)plans.delete(plans.keys().next().value);
            return json({id,source:plan.source,title:plan.title,database:plan.binding?.placement==='workspace'?'workspace':plan.binding?'catalogue':'files'});
          }
          if(url.pathname==='/api/storage/delete'){
            if(workspace.vault?.key&&await dashboardEdits.read(workspace))throw new AppError('DASHBOARD_PENDING');
            const plan=plans.get(data.id);if(!plan?.deletion||plan.expires<Date.now())throw new AppError('STALE');
            if(data.confirmed!==true||data.title!==plan.plan.title||data.path!==plan.plan.source)throw new AppError('STORAGE_DELETE_CONFIRM');
            const vault=cloneVault(context.vault),target=new Workspace(context.root,vault);
            return await storageResponse(req,res,async()=>{
              try{
                const result=await withWorkspaceDeletionSession(historyProjects,client,owners=>deletions.begin(target,plan.plan,{...owners,onFrozen:receipt=>detachDeleted(receipt.source,client)}));
                await forgetDeleted(result.source);await deletions.acknowledge(result.id);return {result,storage:await metadata()};
              }finally{
                try{if(await workspaceDeletion(target.root))await detachDeleted(target.root,client);}finally{clearVault(vault);}
              }
            },json);
          }
          if(['/api/storage/copy/preview','/api/storage/portable/preview'].includes(url.pathname)){
           return await storageResponse(req,res,async()=>{
            const portable=url.pathname==='/api/storage/portable/preview';
            if(portable)await verifyPortableAccess(context.root,data);
            const plan=await withWorkspaceCopySession(historyProjects,client,copy=>copy.plan(data.path,{portable})),id=randomBytes(24).toString('hex');
            plans.set(id,{...plan,portable,expires:Date.now()+10*60*1000});while(plans.size>5)plans.delete(plans.keys().next().value);
            return {id,source:plan.source,destination:plan.destination,files:plan.fileCount,bytes:plan.bytes,fileBytes:plan.fileBytes,transferFiles:plan.transferFiles,databaseBytes:plan.databaseBytes,resume:!!plan.resume};
           },json);
          }
          if(url.pathname==='/api/storage/portable'){
            if(data.path!==undefined){
             if(data.confirmed!==true||data.id!==undefined)throw new AppError('INVALID');
             return await storageResponse(req,res,async()=>{await verifyPortableAccess(context.root,data);const destination=await withWorkspaceCopySession(historyProjects,client,copy=>copy.exportPortable(data.path));return {destination,portable:true};},json);
            }
            const plan=plans.get(data.id);if(!plan?.portable||plan.expires<Date.now()||data.reviewed!==true)throw new AppError('STALE');
            return await storageResponse(req,res,async()=>{
             // Retain the verified receipt for a lost response. Opening the
             // destination here would consume its portable database archive.
             if(!plan.completed){const destination=await withWorkspaceCopySession(historyProjects,client,copy=>copy.portable(plan));plan.completed={destination,files:plan.fileCount,bytes:plan.bytes,portable:true};plan.expires=Date.now()+10*60*1000;}
             return plan.completed;
            },json);
          }
          if(url.pathname==='/api/storage/encrypt'){
            const plan=plans.get(data.id);if(!plan||plan.portable||plan.expires<Date.now()||data.reviewed!==true)throw new AppError('STALE');
           return await storageResponse(req,res,async()=>{
            const access=await createWorkspaceAccess(data.username??'',data.password??'',deviceStore),vault=takeCreatedVault(access);
            try{return await workspaceDirectory.using(plan.destination,{},async()=>{const location=await encryptedCopy(plan,access,vault,context.vault);plans.delete(data.id);await activate(location,client,vault);return metadata();});}catch(error){clearVault(vault);throw error;}
           },json);
          }
          if(url.pathname==='/api/storage/copy'){
            if(data.path!==undefined){
              if(data.confirmed!==true||data.id!==undefined||data.catalogue!==undefined)throw new AppError('INVALID');
              return await storageResponse(req,res,async()=>workspaceDirectory.using(await resolveLocation(data.path),{},()=>withWorkspaceCopySession(historyProjects,client,async copy=>{
                const location=await copy.copy(await copy.plan(data.path,{inspect:false}));operationTransfer({phase:'opening'});
                await activate(location,client,cloneVault(context.vault),{followSettings:true});
                await copy.install(context.projects??=new ProjectApplication(context.workspace,{deviceStore,authenticate,workspaceLocations:()=>workspaceDirectory.list(),publisherOptions:storage=>({...publishingOptions,connection:github?.forWorkspace(storage.root)})}));return metadata();
              })),json);
            }
            const plan=plans.get(data.id);if(!plan||plan.portable||plan.expires<Date.now()||data.reviewed!==true)throw new AppError('STALE');
            if(data.catalogue!==undefined)throw new AppError('INVALID');
            return await storageResponse(req,res,()=>workspaceDirectory.using(plan.destination,{},()=>withWorkspaceCopySession(historyProjects,client,async copy=>{
              const location=await copy.copy(plan);plans.delete(data.id);operationTransfer({phase:'opening'});
              await activate(location,client,cloneVault(context.vault),{followSettings:true});
              await copy.install(context.projects??=new ProjectApplication(context.workspace,{deviceStore,authenticate,workspaceLocations:()=>workspaceDirectory.list(),publisherOptions:storage=>({...publishingOptions,connection:github?.forWorkspace(storage.root)})}));return metadata();
            })),json);
          }
          if(url.pathname==='/api/storage/move'){
            if(data.confirmed!==true||data.id!==undefined)throw new AppError('INVALID');
            return await storageResponse(req,res,async()=>{return workspaceDirectory.using(await resolveLocation(data.path),{replacing:context.root},async()=>{const projects=await (await historyProjects.registry()).read();
              if(projects.value.projects.length)await withWorkspaceMoveSession(historyProjects,client,async move=>{
                await move.move(data.path,{activate:async(destination,movingFrom)=>{await activate(destination,client,cloneVault(context.vault),{movingFrom,followSettings:true});await move.install(context.projects??=new ProjectApplication(context.workspace,{deviceStore,authenticate,workspaceLocations:()=>workspaceDirectory.list(),publisherOptions:storage=>({...publishingOptions,connection:github?.forWorkspace(storage.root)})}));}});
              });else await moveWorkspaceTo(context.root,data.path,{vault:context.vault,activate:(destination,movingFrom)=>activate(destination,client,cloneVault(context.vault),{movingFrom,followSettings:true})});return metadata();});},json);
          }
          if(url.pathname==='/api/storage/move/finish'){
            if(data.reviewed!==true)throw new AppError('INVALID');
            return await storageResponse(req,res,async()=>{await finishWorkspaceProjectMove(context.workspace);return metadata();},json);
          }
          throw new AppError('NOT_FOUND');
        }finally{selectedContext.settingsClosed=false;selectedContext.concurrentReads=false;selectedContext.readers.open();changing=false;startJobs(context);}
      }
      if(req.method==='POST'&&url.pathname==='/api/access/change'){
        if(!workspace)throw new AppError('MISSING');
        if(changing||loginBusy||activeWrites)throw new AppError('LOCKED');changing=true;
        try{const data=await body(req);if(accessState.access.value.formatVersion!==3){const verified=await authenticate(context.root,accessState.access,accessState.access.value.username,data.currentPassword??'');clearVault(verified);}const next=await changeAccess(context.root,data,accessState.access.etag,{deviceStore,vault:context.vault});context.protectedOnce ||= requiresAccess(next.value);client.access=next.etag;client.expires=Date.now()+8*60*60*1000;return json({...await accessSummary(next.value,deviceStore),locked:false});}
        finally{changing=false;}
      }
      if(!releaseRead)await waitForWriter(async()=>{if(changing||loginBusy)throw new AppError('LOCKED');});
      if(githubSerializedRequest(req.method,url.pathname)){if(githubMutation)throw new AppError('GITHUB_PUBLICATION_BUSY');githubMutation=true;ownsGithubMutation=true;}
      // Peer requests affect the remote host; local shutdown aborts and drains
      // them. Polling must not prevent locking or opening another workspace.
      if(req.method==='POST'&&!snapshotRead&&!['/api/live/request','/api/live/state','/api/live/drafts','/api/migration/inventory'].includes(url.pathname)){activeWrites++;countedWrite=true;}
      const requiredWorkspaceMissing=context.expectedExisting&&!await assertRegular(await workspaceFile(context.root),{missing:true});
      // An unavailable prior location blocks operations on it, but must not block an
      // explicit request to create a workspace in a folder selected by the user.
      if(requiredWorkspaceMissing&&!(req.method==='POST'&&url.pathname==='/api/notebook/create'))throw new AppError('STORAGE_UNAVAILABLE');
      if(req.headers['x-observanda-website']&&websiteRequest(url.pathname)){
        workspace=websiteWorkspace(workspace,req.headers['x-observanda-website']);await workspace.website();publisher=websitePublisher(publisher,workspace);
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/websites/')){
        const data=await body(req);if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');const sites=new WebsiteSites(workspace),operation=url.pathname.slice('/api/websites/'.length);
        if(operation==='list')return json(await sites.list());
        if(operation==='open')return json(await sites.read(data.id));
        if(operation==='change')return json(await sites.change(data));
        if(operation==='save')return json(await sites.save(data.id,data.command));
        throw new AppError('NOT_FOUND');
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/v1/intake/')){
        const data=await body(req),controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{
          if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');startJobs(context);
          const result=await intakeCommand(workspace,context.jobs.queue,url.pathname.slice('/api/v1/intake/'.length),data,{signal:controller.signal});
          if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');if((await status(client)).locked)throw new AppError('ACCESS_LOCKED');
          context.jobs.worker.wake();return json(result);
        }finally{res.removeListener('close',abort);}
      }
      if(req.method==='POST'&&['/api/workspace/read/version','/api/workspace/read/start','/api/workspace/read/page','/api/workspace/read/changes','/api/workspace/read/change-page','/api/workspace/read/selection','/api/workspace/read/labels','/api/workspace/read/dashboard','/api/workspace/read/dashboard-types','/api/workspace/read/record-types','/api/workspace/read/discovery','/api/workspace/read/timeline','/api/workspace/read/record-content','/api/workspace/read/record-selectors'].includes(url.pathname)){
        const data=await body(req),reader=new WorkspaceReader(workspace),controller=new AbortController();
        if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
        const abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{
          const result=url.pathname.endsWith('/record-selectors')?await new RecordSelectors(workspace).read(data,{signal:controller.signal}):url.pathname.endsWith('/record-content')?await new RecordContent(workspace).read(data,{signal:controller.signal}):url.pathname.endsWith('/version')?await reader.version(data,{signal:controller.signal}):url.pathname.endsWith('/record-types')?await new RecordTypeQuery(workspace).read(data,{signal:controller.signal}):url.pathname.endsWith('/dashboard-types')?await new DashboardTypeQuery(workspace).read(data,{signal:controller.signal}):url.pathname.endsWith('/timeline')?await new TimelineQuery(workspace).list(data,{signal:controller.signal}):url.pathname.endsWith('/labels')?await reader.labels(data,{signal:controller.signal}):url.pathname.endsWith('/discovery')?await new DashboardDiscovery(workspace).read(data,{signal:controller.signal}):url.pathname.endsWith('/dashboard')?await new DashboardRecords(workspace).read(data,{signal:controller.signal}):url.pathname.endsWith('/selection')?await reader.selection(data,{signal:controller.signal}):url.pathname.endsWith('/start')?await reader.start({...data,signal:controller.signal}):url.pathname.endsWith('/change-page')?await reader.changePage(data,{signal:controller.signal}):url.pathname.endsWith('/changes')?await reader.changes(data,{signal:controller.signal}):await reader.page(data,{signal:controller.signal});
          if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
          if((await status(client)).locked)throw new AppError('ACCESS_LOCKED');
          if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
          return json(result);
        }finally{res.removeListener('close',abort);}
      }
      if (req.method === 'GET' && url.pathname === '/api/notebook') {
        if(!workspace)return json({book:null});
        try { return json(responseBook(await workspace.read())); } catch (error) { if (error.code === 'MISSING') return json({ book: null }); throw error; }
      }
      if (req.method === 'POST' && url.pathname === '/api/notebook/create') {
        if(activeWrites>1)throw new AppError('LOCKED');changing=true;
        try{
        const data = await body(req);
        if(requiredWorkspaceMissing&&(data.createNew!==true||typeof (data.storageParent??data.storagePath)!=='string'||!(data.storageParent??data.storagePath).trim()))throw new AppError('STORAGE_UNAVAILABLE');
        const selectedTypes=data.labBookTypes===undefined?[]:data.labBookTypes;if(!validLabBookTypeSelection(selectedTypes))throw new AppError('INVALID');
        const dashboard=defaultDashboard();dashboard.enabledModules=[...new Set([...dashboard.enabledModules,...selectedTypes])];
        if(data.storageParent!==undefined&&data.storagePath!==undefined)throw new AppError('INVALID');
        const locationInput=await namedWorkspaceLocation({parent:data.storageParent,root:data.storagePath??workspace?.root,name:data.title});
        const book=createNotebook(data.title,data.description??'',data.startingTheme??'research');
        if(data.identity!==undefined)book.identity=data.identity;
        const access=await createWorkspaceAccess(data.username??'',data.password??'',deviceStore),vault=takeCreatedVault(access);
        await workspaceDirectory.using(locationInput,{},async()=>{const location=await initializeLocation(locationInput,book,access,vault,{dashboard});await activate(location,client,vault);});
        return json({...responseBook(await context.workspace.read()),storage:await metadata(),access:{...await accessSummary(access,deviceStore),locked:false}},201);
        }finally{changing=false;startJobs(context);}
      }
      if(!workspace)throw new AppError('MISSING');
      const starter=recordStarterRequest(url.pathname,req.method);
      if(starter){
        if(!starter.write)req.operationActivity=null;
        return await projectContentHttp(req,res,starter,{body,json,mime,headless,contextId:context.id,execute:(data,options)=>executeRecordStarterRequest(workspace,starter,data,options)});
      }
      const moduleRequest=req.method==='POST'?projectModuleRequest(url.pathname):null;
      if(moduleRequest&&(moduleRequest.references||await moduleDomainRoute(workspace)!==null)){
        const data=await body(req,moduleRequest.limit),controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{const result=await moduleRequest.run(workspace,data,{signal:controller.signal,check:req.checkWriter,referenceAccess:moduleReferenceFactory(historyProjects,client,{check:req.checkWriter})});
          if(url.pathname==='/api/modules/command')selectedContext.calendarSources.reconcile(result.entities,{partial:true});
          return json(result);
        }finally{res.off('close',abort);}
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/modules/drafts/')){
        const drafts=new ModuleDrafts(workspace),data=await body(req,url.pathname==='/api/modules/drafts/write'?MODULE_CHECKPOINT_BYTES:MAX_BYTES);
        if(url.pathname.startsWith('/api/modules/drafts/transfer/')){
          const operation=url.pathname.slice('/api/modules/drafts/transfer/'.length);if(!['start','part','finish'].includes(operation))throw new AppError('NOT_FOUND');
          const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
          try{return json(await new ModuleDraftTransfer(workspace)[operation]((({moduleId,...command})=>command)(data),{signal:controller.signal}));}finally{res.removeListener('close',abort);}
        }
        if(url.pathname==='/api/modules/drafts/list'){
          const {moduleId,...options}=data,controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
          try{return json(await drafts.list(moduleId,options,{signal:controller.signal}));}finally{res.removeListener('close',abort);}
        }
        if(url.pathname==='/api/modules/drafts/read')return json(await drafts.read(data.id));
        if(url.pathname==='/api/modules/drafts/write'){const saved=await drafts.write(data);return json({etag:saved.etag});}
      }
      if(req.method==='POST'&&url.pathname==='/api/calendars/page'){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{const result=await calendarPage(workspace,selectedContext.calendarSources,await body(req),{signal:controller.signal});
          if(context!==selectedContext||(await status(client)).locked)throw new AppError('ACCESS_LOCKED');return json(result);
        }finally{res.removeListener('close',abort);}
      }
      if(req.method==='POST'&&url.pathname==='/api/calendars/event'){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{const result=await selectedContext.calendarSources.detail(workspace,await body(req),{signal:controller.signal});
          if(context!==selectedContext||(await status(client)).locked)throw new AppError('ACCESS_LOCKED');return json(result);
        }finally{res.removeListener('close',abort);}
      }
      if(req.method==='POST'&&url.pathname==='/api/calendars/unlock'){
        const data=await body(req),{metadata:book}=await workspace.outline(),{entity}=await new ModuleReader(workspace).selected({workspaceId:book.id,id:data.id});
        if(entity.type!=='calendar-connection'||!entity.data.enabled)throw new AppError('NOT_FOUND');
        if(path.resolve(entity.data.path)===path.resolve(workspace.root))throw new AppError('CALENDAR_SELF');
        const title=await selectedContext.calendarSources.unlock(entity,data,authenticate);
        return json({title});
      }
      const migrationOriginal=/^\/api\/migration\/original\/([a-f0-9-]{36})\/(\d+)\/(\d+)$/.exec(url.pathname);
      if(req.method==='GET'&&migrationOriginal){
        if(url.searchParams.get('context')!==context.id)throw new AppError('WORKSPACE_CHANGED');
        const {metadata}=await workspace.outline(),{name,content}=await new MigrationImport(workspace).download({workspaceId:metadata.id,id:migrationOriginal[1],index:Number(migrationOriginal[2]),file:Number(migrationOriginal[3])});
        res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(name));return await serveContent(req,res,content,'application/octet-stream');
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/migration/import/')){
        const data=await body(req),operation=url.pathname.slice('/api/migration/import/'.length);
        if(context!==selectedContext||!workspace||req.headers['x-observanda-workspace']!==context.id)throw new AppError('WORKSPACE_CHANGED');
        if((await status(client)).locked)throw new AppError('ACCESS_LOCKED');
        if(changing||loginBusy||inventoryRequests.size>=2)throw new AppError('LOCKED');
        const controller=new AbortController();inventoryRequests.add(controller);
        const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnected);
        const send=value=>{if(!res.destroyed&&!controller.signal.aborted)res.write(JSON.stringify(value)+'\n');};
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});
        try{
          const result=await new MigrationImport(workspace).run(operation,data,{signal:controller.signal,onProgress:progress=>send({progress})});
          if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
          if((await status(client)).locked)throw new AppError('ACCESS_LOCKED');send({result});
        }catch(error){send({error:safeError(error)});}
        finally{inventoryRequests.delete(controller);res.off('close',disconnected);res.end();}return;
      }
      if(req.method==='POST'&&url.pathname==='/api/migration/inventory'){
        const data=await body(req);if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
        if(!workspace||req.headers['x-observanda-workspace']!==context.id)throw new AppError('WORKSPACE_CHANGED');
        if((await status(client)).locked)throw new AppError('ACCESS_LOCKED');
        if(changing||loginBusy)throw new AppError('LOCKED');
        if(inventoryRequests.size>=2)throw new AppError('LOCKED');
        const controller=new AbortController();inventoryRequests.add(controller);
        const disconnected=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnected);
        const send=value=>{if(!res.destroyed&&!controller.signal.aborted)res.write(JSON.stringify(value)+'\n');};
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});
        try{
          const result=await inspectSource(data,{signal:controller.signal,onProgress:progress=>send({progress})});
          if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');
          if((await status(client)).locked)throw new AppError('ACCESS_LOCKED');
          send({result});
        }catch(error){send({error:safeError(error)});}
        finally{inventoryRequests.delete(controller);res.off('close',disconnected);res.end();}
        return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/live/')){
        const data=await body(req,2*1024*1024);if(data.workspaceId!==(await workspace.outline()).metadata.id)throw new AppError('WORKSPACE_CHANGED');
        if(context!==selectedContext||changing||selectedContext.manualLock||(await status(client)).locked)throw new AppError('ACCESS_LOCKED');
        const manager=selectedContext.live??=new LiveConnections(workspace,deviceStore),result=await manager.command(url.pathname.slice('/api/live/'.length),data);
        if(context!==selectedContext||(await status(client)).locked)throw new AppError('ACCESS_LOCKED');return json(result);
      }
      const liveFile=/^\/api\/live\/files\/([a-f0-9-]{36})\/([a-f0-9-]{36})\/(media|artifact)\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(req.method==='GET'&&liveFile){
        if(url.searchParams.get('context')!==context.id)throw new AppError('WORKSPACE_CHANGED');activeWrites++;countedWrite=true;
        const manager=selectedContext.live??=new LiveConnections(workspace,deviceStore),controller=new AbortController(),abort=()=>controller.abort();res.once('close',abort);
        try{const remote=await (await manager.client(liveFile[1])).call('file',{recordId:liveFile[2],kind:liveFile[3],id:liveFile[4],...(url.searchParams.has('link')?{linkId:url.searchParams.get('link'),revision:url.searchParams.get('revision')}:{}),...(url.searchParams.has('artifactRevision')?{artifactRevision:url.searchParams.get('artifactRevision')}:{}),...(url.searchParams.has('evidenceKind')?{evidenceRef:{kind:url.searchParams.get('evidenceKind'),id:url.searchParams.get('evidenceId'),revision:url.searchParams.get('evidenceRevision')},evidenceTrail:JSON.parse(url.searchParams.get('evidenceTrail')??'[]')}:{}),...(url.searchParams.has('attemptKind')?{attemptRef:{kind:url.searchParams.get('attemptKind'),id:url.searchParams.get('attemptId'),revision:url.searchParams.get('attemptRevision')},attemptTrail:JSON.parse(url.searchParams.get('attemptTrail')??'[]')}:{})},{stream:true,signal:controller.signal});res.writeHead(200,{'Content-Type':remote.headers['content-type'],'Content-Length':remote.headers['content-length'],...(liveFile[3]==='artifact'?{'Content-Disposition':remote.headers['content-disposition']}:{})});await pipeline(remote,res);}finally{res.off('close',abort);}
        return;
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/organizations/')){
        const data=await body(req,100000),operation=url.pathname.slice('/api/organizations/'.length);
        const result=await organizationCommand(workspace,deviceStore,operation,data);
        if(context!==selectedContext||(await status(client)).locked)throw new AppError('ACCESS_LOCKED');return json(result);
      }
      const sharedDownload=/^\/api\/sharing\/download\/([a-f0-9-]{36})$/.exec(url.pathname);
      const sharedFile=/^\/api\/sharing\/reviews\/([a-f0-9-]{36})\/(base|incoming|current)\/([a-f0-9-]{36})\/(media|artifact|font)\/([a-f0-9-]{36}|custom-[a-f0-9]{64})$/.exec(url.pathname);
      if(req.method==='GET'&&sharedFile){
        if(url.searchParams.get('context')!==context.id)throw new AppError('WORKSPACE_CHANGED');
        const file=await new ChangeReview(new ResearchExchange(workspace,deviceStore)).file(sharedFile[1],sharedFile[3],sharedFile[2],sharedFile[4],sharedFile[5]);
        if(sharedFile[4]==='artifact')res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.name));
        return await serveContent(req,res,file.content,file.mime);
      }
      if(req.method==='GET'&&sharedDownload){
        if(url.searchParams.get('context')!==context.id)throw new AppError('WORKSPACE_CHANGED');
        activeWrites++;countedWrite=true;
        return await workspace.withLock(async()=>{
          const stream=await new ResearchExchange(workspace,deviceStore).outgoing(sharedDownload[1]);
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="research.observanda-share"'});
          await pipeline(Readable.from(stream),res);
        });
      }
      if(req.method==='POST'&&url.pathname==='/api/sharing/receive'){
        if(req.headers['content-type']!=='application/octet-stream')throw new AppError('INVALID');
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        const timeout=req.socket.timeout;res.setTimeout(0);
        try{const result=await new ResearchExchange(workspace,deviceStore).receive(req,{signal:controller.signal});if(context!==selectedContext)throw new AppError('WORKSPACE_CHANGED');return json(result);}
        finally{res.removeListener('close',abort);if(!req.socket.destroyed)req.socket.setTimeout(timeout??60000);}
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/sharing/')){
        const data=await body(req,16*1024*1024),operation=url.pathname.slice('/api/sharing/'.length);
        return await storageResponse(req,res,async()=>{const result=await sharingCommand(workspace,deviceStore,operation,data);if(context!==selectedContext||(await status(client)).locked)throw new AppError('ACCESS_LOCKED');return result;},json);
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/reviews/')){
        const data=await body(req),operation=url.pathname.slice('/api/reviews/'.length);
        const result=await executeReviewRequest(workspace,deviceStore,operation,data);if(context!==selectedContext||(await status(client)).locked)throw new AppError('ACCESS_LOCKED');return json(result);
      }
      if(req.method==='GET'&&url.pathname==='/api/modules/data'){
        return json({data:await workspaceModules(workspace).current()});
      }
      if(req.method==='GET'&&url.pathname==='/api/modules/version')return json(await workspaceModules(workspace).version());
      if(req.method==='POST'&&['/api/modules/inventory/dashboard','/api/modules/inventory/discovery','/api/modules/inventory/stock','/api/modules/inventory/ledger'].includes(url.pathname)){
        const controller=new AbortController(),abort=()=>controller.abort();res.on('close',abort);
        try{const reader=new InventoryReader(workspace),method={'/api/modules/inventory/dashboard':'page','/api/modules/inventory/discovery':'discover','/api/modules/inventory/stock':'stock','/api/modules/inventory/ledger':'ledger'}[url.pathname];return json(await reader[method](await body(req),{signal:controller.signal}));}finally{res.removeListener('close',abort);}
      }
      if(req.method==='POST'&&['/api/modules/planning/dashboard','/api/modules/planning/discovery'].includes(url.pathname)){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{const reader=new PlanningDashboard(workspace);return json(await reader[url.pathname.endsWith('/discovery')?'discover':'page'](await body(req),{signal:controller.signal}));}finally{res.removeListener('close',abort);}
      }
      if(req.method==='POST'&&['/api/modules/items','/api/modules/item','/api/modules/labels'].includes(url.pathname)){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{const reader=new ModuleReader(workspace),method={'/api/modules/items':'list','/api/modules/item':'selected','/api/modules/labels':'labels'}[url.pathname];return json(await reader[method](await body(req),{signal:controller.signal}));}finally{res.removeListener('close',abort);}
      }
      if(req.method==='GET'&&url.pathname==='/api/modules/history'){
        const history=new ModuleHistory(workspace),id=url.searchParams.get('id');
        return json(url.searchParams.has('revision')?await history.read({id,revision:Number(url.searchParams.get('revision'))}):await history.page({id,cursor:url.searchParams.get('cursor')}));
      }
      if(req.method==='POST'&&url.pathname==='/api/modules/bom-source'){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{return json(await readBOMSource(workspace,await body(req),{signal:controller.signal}));}finally{res.removeListener('close',abort);}
      }
      if(req.method==='POST'&&url.pathname==='/api/modules/command'){
        const compact=url.searchParams.get('compact')==='1',result=await workspaceModules(workspace).execute(await body(req,MODULE_BYTES),{compact});
        if(result.modulePatch){selectedContext.calendarSources.reconcile(result.modulePatch.entities,{partial:true});return json(result);}
        const {events,...data}=result.data;selectedContext.calendarSources.reconcile(data.entities);return json({...result,data});
      }
      const material=materialRequest(url.pathname);
      if(material&&req.method===material.method)return await materialHttp(req,res,material,{contextId:context.id,body,json,execute:(data,options)=>executeMaterialRequest(workspace,material,data,{...options,jobs:()=>{startJobs(context);return context.jobs;}})});
      const research=researchRequest(url.pathname);
      if(req.method==='POST'&&research){
        const data=await body(req,research.limit,research.capacity);
        if(research.write)return await operationResponse(req,res,options=>executeResearchRequest(workspace,url.pathname,data,options),json);
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{return json(await executeResearchRequest(workspace,url.pathname,data,{signal:controller.signal}));}finally{res.off('close',abort);}
      }
      if(req.method==='POST'&&url.pathname==='/api/workspace/save'){const data=await body(req);requireCurrentWorkspaceName(workspace,data.metadata?.title);return json(await new WorkspaceEdits(workspace,media).save(data));}
      if(req.method==='POST'&&url.pathname.startsWith('/api/website/research/')){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{return json(await new WebsiteResearch(workspace).run(url.pathname.slice('/api/website/research/'.length),await body(req),{signal:controller.signal}));}finally{res.removeListener('close',abort);}
      }
      if (req.method === 'POST' && url.pathname === '/api/notebook/save') {
        const data = await body(req);
        requireCurrentWorkspaceName(workspace,data.book?.title);return json(responseBook(await workspace.save(data.book, data.etag)));
      }
      if(req.method==='POST'&&['/api/workspace/structure','/api/workspace/reorganize/preview','/api/workspace/reorganize','/api/workspace/notebook'].includes(url.pathname)){
        const kind=url.pathname.split('/')[3],preview=url.pathname.endsWith('/preview');
        const data=await body(req);if(kind==='reorganize')requireCurrentWorkspaceName(workspace,data.change?.workspaceTitle);const execute=async options=>{
          const result=await new StructureCommands(workspace).execute(kind,data,{preview,...options});
          return preview||result.recordUpdate||result.recordPatch||result.outline?result:responseBook(result);
        };
        return await operationResponse(req,res,execute,json);
      }
      if (req.method === 'GET' && url.pathname === '/api/laboratory') return json(await laboratory.read());
      if(req.method==='POST'&&['/api/laboratory/read/query','/api/laboratory/read/selected'].includes(url.pathname)){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{const reader=new SampleAnalysisReader(laboratory),data=await body(req);return json(await reader[url.pathname.endsWith('/query')?'query':'selected'](data,{signal:controller.signal}));}finally{res.removeListener('close',abort);}
      }
      if (req.method === 'POST' && url.pathname === '/api/laboratory/change') { await workspace.outline(); const {commandId,...command}=await body(req);return json(await laboratory.change(command,{compact:url.searchParams.get('compact')==='1',commandId:commandId??null,check:req.checkWriter})); }
      const resultSheet = /^\/api\/laboratory\/report\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (req.method === 'GET' && resultSheet) return sendBytes(req, res, await laboratory.report(resultSheet[1], url.searchParams.get('revision'), blockedValues), 'text/html; charset=utf-8');
      const issuedSheet=/^\/api\/laboratory\/issued\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(req.method==='GET'&&issuedSheet)return sendBytes(req,res,await laboratory.report(issuedSheet[1],url.searchParams.get('revision'),blockedValues,{retained:true}),'text/html; charset=utf-8');
      const retainedCandidate=async id=>{
        if(!/^[a-f0-9]{64}$/.test(id??''))return null;
        if(req.method==='GET'&&!req.headers['x-observanda-website']){
          const owner=await selectedContext.workspace.readMetadata('.observanda/website-editions/'+id+'.json',4096);
          if(owner){workspace=websiteWorkspace(selectedContext.workspace,JSON.parse(owner).websiteId);publisher=websitePublisher(selectedContext.publisher,workspace);}
        }
        if(candidates.has(id)){const candidate=candidates.get(id);return (candidate.websiteId??null)===(workspace.websiteId??null)?candidate:null;}
        const candidate=await new PublicationJobs(workspace,{sourceReader}).read(id);if(!candidate)return null;
        // One verified immutable edition serves its page, stylesheet and assets.
        // This private cache is bounded and cleared with the workspace key.
        candidates.set(id,candidate);while(candidates.size>5)candidates.delete(candidates.keys().next().value);return candidate;
      };
      if(req.method==='POST'&&url.pathname.startsWith('/api/local-export/')){
        if(!workspace.vault?.key)throw new AppError('ACCESS_LOCKED');
        const data=await body(req),operation=url.pathname.slice('/api/local-export/'.length),exports=new LocalExport(workspace,{sourceReader});
        if(!['plan','current','page','apply','discard'].includes(operation))throw new AppError('INVALID');
        if(['current','page'].includes(operation))return json(await exports[operation](data));
        if(publishing||changing)throw new AppError('LOCKED');
        publishing=true;
        try{return json(await exports[operation](data));}finally{publishing=false;}
      }
      if(req.method==='POST'&&['/api/publication-links/read','/api/publication-links/save'].includes(url.pathname)){
        const links=new PublicationLinks(workspace),data=await body(req);return json(url.pathname.endsWith('/save')?await links.save(data):await links.read());
      }
      if(req.method==='POST'&&['/api/publication-selection','/api/publication-references'].includes(url.pathname)){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{return json(await (url.pathname==='/api/publication-references'?publicationReferences:publicationSelection)(workspace,await body(req),{signal:controller.signal}));}finally{res.removeListener('close',abort);}
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/publication-jobs/')){
        if(!workspace.vault?.key)throw new AppError('ACCESS_LOCKED');
        startJobs(context);const releases=new PublicationJobs(workspace,{sourceReader}),queue=publicationQueue(),data=await body(req),operation=url.pathname.slice('/api/publication-jobs/'.length);
        if(operation==='start'){const job=await releases.start({...data,blockedValues},queue);context.jobs.worker.wake();return json({job:jobSummary(job)},202);}
        if(operation==='list'){const page=await releases.page(queue,data);return json({...page,items:page.items.map(item=>({...item,job:jobSummary(item.job)}))});}
        if(operation==='open'){const candidate=await retainedCandidate(data.id);if(!candidate)throw new AppError('NOT_FOUND');return json({...releases.summary(candidate),analysisReview:await new AnalysisPublicationReview(workspace,{sourceReader}).status(candidate),stale:!await publicationRevisionCurrent(workspace,candidate.etag)||candidate.configEtag!==(await publisher.read()).etag});}
        if(operation==='rollback-review'){
          const candidate=await retainedCandidate(data.id);if(!candidate)throw new AppError('NOT_FOUND');
          const approval=await new PublicationRollback(workspace,publisher,{sourceReader}).review(data);
          const reviewed=new PublicationRollback(workspace,publisher,{sourceReader}).project(candidate,approval.review);
          return json({...releases.summary(reviewed),destination:approval.destination,configEtag:approval.configEtag,rollback:approval.review,analysisReview:await new AnalysisPublicationReview(workspace,{sourceReader}).status(reviewed),stale:false});
        }
        if(operation==='analysis-review'){let candidate=await retainedCandidate(data.id);if(!candidate)throw new AppError('NOT_FOUND');if(data.rollbackReview){const rollback=new PublicationRollback(workspace,publisher,{sourceReader});candidate=rollback.project(candidate,await rollback.authorize(candidate,data.rollbackReview));}return json(await new AnalysisPublicationReview(workspace,{sourceReader}).save(candidate,data.decisions));}
        const job=await queue.read(data.id);if(!job||job.type!=='publication.prepare')throw new AppError('NOT_FOUND');await queue.authorize(job);
        if(operation==='status')return json({job:jobSummary(job)});
        if(['cancel','retry'].includes(operation)){const next=await queue.control(job.id,operation);if(operation==='cancel')context.jobs.worker.cancel(job.id);else context.jobs.worker.wake();return json({job:jobSummary(next)});}
        throw new AppError('INVALID');
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/deployment-jobs/')){
        if(!workspace.vault?.key)throw new AppError('ACCESS_LOCKED');
        startJobs(context);const queue=publicationQueue(),deployments=new DeploymentJobs(workspace,publisher,queue,{sourceReader,sourceAccess:context.publicationSourceAccess}),data=await body(req),operation=url.pathname.slice('/api/deployment-jobs/'.length);
        if(operation==='start'){const job=await deployments.start(data);context.jobs.worker.wake();return json({job:jobSummary(job)},202);}
        if(operation==='list'){const page=await deployments.page(data);return json({...page,items:page.items.map(item=>({...item,job:jobSummary(item.job)}))});}
        const job=await queue.read(data.id);if(!job||job.type!=='publication.deploy')throw new AppError('NOT_FOUND');await queue.authorize(job);
        if(operation==='status')return json({...deployments.summary(await deployments.read(job.id)),job:jobSummary(job)});
        if(['cancel','retry'].includes(operation)){const next=await deployments.control(job.id,operation);if(operation==='cancel')context.jobs.worker.cancel(job.id);else context.jobs.worker.wake();return json({job:jobSummary(next)});}
        throw new AppError('INVALID');
      }
      if (req.method === 'GET' && url.pathname === '/api/publishing') return json(await publisher.read());
      if(req.method==='POST'&&url.pathname.startsWith('/api/github-connection/')){
        const data=await body(req),operation=url.pathname.slice('/api/github-connection/'.length),connection=publisher.connection;
        if(!connection){if(operation==='status')return json({available:false,accounts:[],selected:null,connected:false,signIn:null,error:null});throw new AppError('GITHUB_HELPER_MISSING');}
        if(operation==='status')return json(await connection.status());
        if(operation==='cancel')return json(await connection.cancel());
        await assertGithubIdle();
        if(operation==='start'){if(headless)throw new AppError('GITHUB_BROWSER_UNAVAILABLE');publisher.token=null;return json(await connection.start(),202);}
        if(operation==='choose'){publisher.token=null;return json(await connection.choose(data.login));}
        if(operation==='disconnect'){publisher.token=null;return json(await connection.disconnect({forget:data.forget===true}));}
        throw new AppError('INVALID');
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/repository-setup/')){
        if(!workspace.vault?.key)throw new AppError('ACCESS_LOCKED');
        startJobs(context);const queue=publicationQueue(),setup=new GithubRepositorySetup(workspace,publisher,queue),data=await body(req),operation=url.pathname.slice('/api/repository-setup/'.length);
        if(operation==='start'){const job=await setup.start(data);context.jobs.worker.wake();return json({job:jobSummary(job)},202);}
        if(operation==='review')return json(await setup.review(data));
        if(operation==='initialize'){const job=await setup.initialize(data);context.jobs.worker.wake();return json({job:jobSummary(job)},202);}
        if(operation==='current')return json({job:jobSummary(await setup.current())});
        const job=await queue.read(data.id);if(!job||job.type!=='publication.repository')throw new AppError('NOT_FOUND');await queue.authorize(job);
        if(operation==='status')return json({job:jobSummary(job)});
        if(['retry','cancel'].includes(operation)){const next=await queue.control(job.id,operation);if(operation==='cancel')context.jobs.worker.cancel(job.id);else context.jobs.worker.wake();return json({job:jobSummary(next)});}
        throw new AppError('INVALID');
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/publishing/')) {
        const data = await body(req);
        if (publishing) throw new AppError('LOCKED');
        if (url.pathname === '/api/publishing/save') { await workspace.outline(); return json(await publisher.save(data.config, data.etag)); }
        if (url.pathname === '/api/publishing/connect') {await assertGithubIdle();await publisher.connection?.cancel();return json(await publisher.connect(data.token));}
        if (url.pathname === '/api/publishing/disconnect') {await assertGithubIdle();publisher.token = null;return json(await publisher.read());}
        if (url.pathname === '/api/publishing/check') return json(await publisher.check({reviewExisting:true}));
        if (url.pathname === '/api/publishing/plan') {
          const candidate=await retainedCandidate(data.id);
          if(!candidate)throw new AppError('PUBLISH_STALE');
          if(data.rollbackReview)await new PublicationRollback(workspace,publisher,{sourceReader}).authorize(candidate,data.rollbackReview);
          else if(candidate.configEtag!==data.configEtag||!await publicationRevisionCurrent(workspace,candidate.etag))throw new AppError('PUBLISH_STALE');
          const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
          try{return json(await publisher.reviewDestination(candidate,data.configEtag,{signal:controller.signal}));}
          finally{res.removeListener('close',abort);}
        }
        if(['/api/publishing/verify','/api/publishing/verification','/api/publishing/verification-cancel','/api/publishing/verification-retry'].includes(url.pathname)){
          if(await workspace.storageKind()!=='catalogue'){if(url.pathname==='/api/publishing/verify')return json(await publisher.verifyLive(data));return json({job:null});}
          startJobs(context);const queue=publicationQueue(),checks=new PublicationVerificationJobs(workspace,publisher,queue);
          if(url.pathname==='/api/publishing/verify'){const job=await checks.start(data);context.jobs.worker.wake();return json({job:jobSummary(job)},202);}
          const job=await checks.current();if(url.pathname==='/api/publishing/verification')return json({job:jobSummary(job),receipt:(await publisher.read()).receipt});
          if(!job||job.id!==data.id)throw new AppError('PUBLISH_STALE');
          const cancel=url.pathname.endsWith('-cancel'),next=await queue.control(job.id,cancel?'cancel':'retry');if(cancel)context.jobs.worker.cancel(job.id);else context.jobs.worker.wake();return json({job:jobSummary(next)});
        }
        if (url.pathname === '/api/publishing/deploy') {
          let candidate = await retainedCandidate(data.id);
          if (!candidate || data.reviewed !== true || !data.rollbackReview&&candidate.configEtag !== data.configEtag) throw new AppError('PUBLISH_STALE');
          if(data.rollbackReview){const rollback=new PublicationRollback(workspace,publisher,{sourceReader});candidate=rollback.project(candidate,await rollback.authorize(candidate,data.rollbackReview));}
          await new AnalysisPublicationReview(workspace,{sourceReader}).assert(candidate);
          if(workspace.vault?.key){
            startJobs(context);const job=await new DeploymentJobs(workspace,publisher,publicationQueue(),{sourceReader,sourceAccess:context.publicationSourceAccess}).start(data);context.jobs.worker.wake();return json({job:jobSummary(job)},202);
          }
          publishing = true;
          try { return json(await publisher.deploy(candidate, data.configEtag, (await workspace.outline()).metadata.id, data)); }
          finally { publishing = false; }
        }
      }
      const mediaOriginal=/^\/api\/media-imports\/original\/([a-f0-9-]{36})$/.exec(url.pathname);
      if(req.method==='GET'&&mediaOriginal){
        if(url.searchParams.get('context')!==context.id)throw new AppError('WORKSPACE_CHANGED');
        const {session,content}=await new MediaImports(workspace).original(mediaOriginal[1]);
        res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(session.name));
        return await serveContent(req,res,content,'application/octet-stream');
      }
      if(req.method==='POST'&&url.pathname.startsWith('/api/media-imports/')){
        if(!workspace.vault?.key)throw new AppError('ACCESS_LOCKED');
        const imports=new MediaImports(workspace),operation=url.pathname.slice('/api/media-imports/'.length);
        const receive=/^receive\/([a-f0-9-]{36})$/.exec(operation);
        if(receive){
          if(importing)throw new AppError('LOCKED');
          if(req.headers['content-type']!=='application/octet-stream')throw new AppError('INVALID');
          importing=true;const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
          try{return json(await imports.receive(receive[1],req,{signal:controller.signal}));}
          finally{importing=false;res.removeListener('close',abort);}
        }
        const data=await body(req);
        if(operation==='start')return json(await imports.start(data),201);
        if(operation==='list'){
          const page=await imports.page(data),items=page.items;
          await workspace.catalogue(async()=>{for(const item of items)item.job=context.jobs?jobSummary(await context.jobs.queue.read(item.id)):null;});
          return json({...page,items});
        }
        if(operation==='finish'){
          const session=await imports.read(data.id);if(!session.source)throw new AppError('MATERIAL_INCOMPLETE');
          startJobs(context);if(!context.jobs)throw new AppError('ACCESS_LOCKED');
          const job=await context.jobs.queue.enqueue({id:session.id,type:'media.prepare',scope:session.workspaceId,input:{importId:session.id,size:session.size}});context.jobs.worker.wake();
          return json({job:jobSummary(job)},202);
        }
        if(['job','cancel','retry'].includes(operation)){
          const job=await context.jobs?.queue.read(data.id);if(!job||job.type!=='media.prepare')throw new AppError('NOT_FOUND');await context.jobs.queue.authorize(job);
          if(operation==='job')return json({job:jobSummary(job)});
          const result=await context.jobs.queue.control(data.id,operation);
          if(operation==='cancel')context.jobs.worker.cancel(data.id);else{startJobs(context);context.jobs.worker.wake();}
          return json({job:jobSummary(result)});
        }
        throw new AppError('INVALID');
      }
      if(url.pathname==='/api/media-policy'){const policy=new MediaPolicy(workspace);if(req.method==='GET')return json(await policy.read());if(req.method==='POST'){const data=await body(req);return json(await policy.save(data.policy,data.etag));}}
      if(url.pathname.startsWith('/api/fonts')){
        const fonts=new WorkspaceFonts(workspace);
        if(req.method==='GET'&&url.pathname==='/api/fonts'){if(req.headers['x-observanda-workspace']!==context.id)throw new AppError('WORKSPACE_CHANGED');return json(await fonts.list());}
        const fontRequest=/^\/api\/fonts\/(custom-[a-f0-9]{64})$/.exec(url.pathname);
        if(req.method==='GET'&&fontRequest){if(url.searchParams.get('workspace')!==context.id)throw new AppError('WORKSPACE_CHANGED');const font=await fonts.get(fontRequest[1]);return await serveContent(req,res,font.bytes,'font/'+font.faces[0].file.split('.').at(-1));}
        if(req.method==='POST'&&url.pathname==='/api/fonts/update'){const data=await body(req);return json(await fonts.update(data.id,data));}
        if(req.method==='POST'&&url.pathname==='/api/fonts/import'){
          if(importing)throw new AppError('LOCKED');if(req.headers['content-type']!=='application/octet-stream'||!['true','false'].includes(url.searchParams.get('embed')))throw new AppError('INVALID');
          importing=true;const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
          try{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_FONT_BYTES)throw new AppError('FONT_INVALID');chunks.push(chunk);}return json(await fonts.import(Buffer.concat(chunks),{embed:url.searchParams.get('embed')==='true',signal:controller.signal}),201);}finally{res.removeListener('close',abort);importing=false;}
        }
        throw new AppError('INVALID');
      }
      if (req.method === 'GET' && url.pathname === '/api/media-capabilities') return json(await mediaCapabilities());
      const upload = /^\/api\/media\/(image|audio|video|file)$/.exec(url.pathname);
      if (req.method === 'POST' && upload) {
        if (importing) throw new AppError('LOCKED');
        if (req.headers['content-type'] !== 'application/octet-stream') throw new AppError('INVALID');
        await workspace.outline();
        importing = true;
        try {
          const policy=(await new MediaPolicy(workspace).read()).policy,size=Number(req.headers['content-length']??0);
          if(policy.maxUploadBytes&&size>policy.maxUploadBytes)throw new AppError('MEDIA_LIMIT');
          if(Number.isSafeInteger(size)&&size>0)await diskSpace(workspace.root,size,policy.reserveBytes);
          const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
          try{req.once('end',()=>req.setTimeout(0));return json(await media.import(req,upload[1],{signal:controller.signal,name:url.searchParams.get('name')}),201);}finally{res.removeListener('close',abort);req.setTimeout(60000);}
        } finally { importing = false; }
      }
      const mediaRequest = /^\/api\/media\/([a-f0-9-]{36})$/.exec(url.pathname);
      if (req.method === 'GET' && mediaRequest) {
        if(url.searchParams.has('context')&&url.searchParams.get('context')!==context.id)throw new AppError('WORKSPACE_CHANGED');
        const asset = await media.get(mediaRequest[1],{streamed:true});
        if(asset.kind==='file')res.setHeader('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(asset.name));
        return await serveContent(req, res, asset.bytes, asset.mime);
      }
      if (req.method === 'GET' && url.pathname === '/api/history') return json({ revisions: await workspace.history() });
      if (req.method === 'POST' && url.pathname === '/api/history/restore') {
        const data = await body(req);
        return json(responseBook(await workspace.restore(data.id, data.etag)));
      }
      if (req.method === 'POST' && url.pathname === '/api/preview') {
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{
          const data=await body(req),releases=new PublicationJobs(workspace,{sourceReader}),candidate=await releases.inline({...data,blockedValues},{signal:controller.signal});
          candidates.set(candidate.reviewId,candidate);while(candidates.size>5)candidates.delete(candidates.keys().next().value);
          return json(releases.summary(candidate));
        }finally{res.removeListener('close',abort);}
      }
      if(req.method==='POST'&&url.pathname==='/api/layout-check'){
        const data=await body(req);if(data.format!=='observanda-page-layout'||![1,2].includes(data.version)||typeof data.name!=='string'||!data.name.trim()||data.name.length>80||!validSections(data.sections))throw new AppError('INVALID');
        assertPublicFields([{field:'page layout',value:JSON.stringify(data)}],blockedValues);return json({ok:true});
      }
      if(req.method==='POST'&&url.pathname==='/api/design-preview'){
        const data=await body(req),controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{const result=await publicationDesignPreview(workspace,data,{signal:controller.signal,blockedValues,sourceReader}),id=randomBytes(32).toString('hex');designCandidates.set(id,result.candidate);return json({url:`/preview/${id}/${result.defaultPage}`,baseUrl:`/preview/${id}/`,defaultPage:result.defaultPage,source:result.source,pages:result.candidate.pages,...(result.editor?{editor:result.editor}:{})});}finally{res.off('close',abort);}
      }
      if(req.method==='POST'&&url.pathname==='/api/appearance-preview'){
        const data=await body(req),controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{
          const {book,source}=await appearancePreviewSource(workspace,data,{signal:controller.signal,sourceReader});
          if(source==='website')return json(await appearancePreviews.create(workspace,{...data,mode:'website'},{signal:controller.signal,media,fonts:new WorkspaceFonts(workspace),blockedValues,sourceReader,client}));
          const fontFiles=await new WorkspaceFonts(workspace).files(book.appearance,{preview:true,signal:controller.signal}),result=buildDesignExamples(book.appearance,{blockedValues,fontFiles}),id=randomBytes(32).toString('hex');
          controller.signal.throwIfAborted();designCandidates.set(id,result.candidate);return json({url:`/preview/${id}/${result.defaultPage}`,baseUrl:`/preview/${id}/`,defaultPage:result.defaultPage,source,pages:result.candidate.pages});
        }finally{res.off('close',abort);}
      }
      if (req.method === 'POST' && url.pathname === '/api/export' || req.method==='GET' && /^\/api\/export\/[a-f0-9]{64}$/.test(url.pathname)) {
        const data=req.method==='POST'?await body(req):{id:url.pathname.split('/').at(-1),rollbackReview:url.searchParams.get('rollbackReview')};let candidate=await retainedCandidate(data.id);
        if(!candidate)throw new AppError('STALE');
        if(data.rollbackReview){const rollback=new PublicationRollback(workspace,publisher,{sourceReader});candidate=rollback.project(candidate,await rollback.authorize(candidate,data.rollbackReview));}
        else if(!await publicationRevisionCurrent(workspace,candidate.etag))throw new AppError('STALE');
        await new AnalysisPublicationReview(workspace,{sourceReader}).assert(candidate);
        verifyPublication(candidate);
        res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="observanda-site.zip"'});
        await pipeline(Readable.from(zipStream(candidate.files)),res);return;
      }
      const appearanceChoices=/^\/api\/appearance-preview\/([a-f0-9]{64})\/pages$/.exec(url.pathname),appearanceFile=/^\/appearance-preview\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
      if(req.method==='GET'&&(appearanceChoices||appearanceFile)){
        const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
        try{
          if(appearanceChoices)return json(await appearancePreviews.choices(appearanceChoices[1],{cursor:url.searchParams.get('cursor'),path:url.searchParams.get('path'),signal:controller.signal,client}));
          const file=await appearancePreviews.file(appearanceFile[1],appearanceFile[2]+url.search,{signal:controller.signal,client});
          return await serveContent(req,res,file.content,mime(file.name));
        }finally{res.removeListener('close',abort);}
      }
      const preview = /^\/preview\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
      if (req.method === 'GET' && preview) {
        const candidate = designCandidates.get(preview[1]) ?? await retainedCandidate(preview[1]);
        if (!candidate || !candidate.files.has(preview[2])) throw new AppError('NOT_FOUND');
        verifyPublication(candidate,{allowDesign:designCandidates.get(preview[1])===candidate});
        return await serveContent(req, res, candidate.files.get(preview[2]), mime(preview[2]));
      }
      throw new AppError('NOT_FOUND');
      },{check:()=>req.checkWriter()});
    } catch (error) {
      req.activity?.finish(error);
      const safe = safeError(error);
      const statuses = { RECORD_COMMAND_LIMIT:413, DRAFT_SIZE_LIMIT:413, STARTER_CHANGED:409, STARTER_ARCHIVED:409, RECORD_SELECTION_LIMIT:413, RECORD_SIZE_LIMIT:413, WORKSPACE_METADATA_LIMIT:413, WORKSPACE_READ_LIMIT:413, SERVER_CLOSING:503, DATABASE_BUSY:503, DATABASE_UNAVAILABLE:503, RECORD_VIEW_CHANGED:409, RECORD_VIEW_NAME:409, RECORD_VIEW_FORMAT:500, MODULE_CHANGED:409, MODULE_REPLAY:409, BOOKING_CONFLICT:409, STOCK_UNAVAILABLE:409, DRAFT_CHANGED:409, RECORD_CHANGED:409, DASHBOARD_CHANGED:409, FOLDER_PICKER_BUSY:409, PREFERENCES_CHANGED:409, ACCESS_LOCKED:401, ACCESS_DENIED:401, ACCESS_WAIT:429, WORKSPACE_CHANGED:409, AUTH: 401, ORIGIN: 403, CONFLICT: 409, EXISTS: 409, STALE: 409, LOCKED: 423, MISSING: 404, NOT_FOUND: 404, LIMIT: 413, IO: 500 };
      if (!res.headersSent) json(safe, identityRecoveryStatus[safe.code] ?? organizationErrorStatus[safe.code] ?? statuses[safe.code] ?? 422); else res.destroy();
    } finally {releaseRead?.();req.activity?.finish();if(ownsGithubMutation)githubMutation=false;if(countedWrite)activeWrites--;pending.delete(request);if(!pending.size)for(const resolve of drained.splice(0))resolve();}
  }));
  const connections=httpDrain(server);
  server.maxConnections=128;server.maxRequestsPerSocket=256;
  server.requestTimeout = 0; server.headersTimeout = 10000; server.setTimeout(60000,socket=>socket.destroy());
  collaborationSession=await identitySession(deviceStore);
  try{await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });}
  catch(error){await collaborationSession.close();throw error;}
  origin = `http://127.0.0.1:${server.address().port}`;
  const expiry=setInterval(()=>{
   context.projects?.expire();
   if(shuttingDown||loginBusy||pending.size||activeWrites||importing||publishing||changing||![context.vault.key,context.calendarSources.connections.size,context.calendarSources.cache.size].some(Boolean)||[...sessions.values()].some(s=>s.access&&s.expires>Date.now()))return;
   loginBusy=true;const expiring=context;
   void stopJobs(expiring).then(async()=>{if(expiring.root)await databaseProvider()?.closeWorkspace(expiring.root);expiring.calendarSources.clear();clearVault(expiring.vault);expiring.candidates.clear();expiring.designCandidates.clear();expiring.appearancePreviews.clear();if(expiring.publisher)expiring.publisher.token=null;}).catch(()=>{/* Retry on the next expiry tick; never abandon an active worker's key. */}).finally(()=>{loginBusy=false;});
  },30000);expiry.unref();
  const shutdownStatus=()=>{
   const operations=activities.list(context.id);
   return {busy:!!(activeWrites||changing||importing||publishing||loginBusy||context.dashboardTask||context.jobs?.worker.active||operations.some(item=>['running','queued'].includes(item.state))),failure:activities.failureSequence};
  };
  return {server,origin,launchToken,url:origin+'/#'+launchToken,shutdownStatus,close:()=>closePromise??=(async()=>{
   shuttingDown=true;clearInterval(expiry);cancelFolderRequests();const stoppedJobs=stopJobs(context);
   const disconnected=connections.close();
   const timeout=setTimeout(()=>server.closeAllConnections(),60000);timeout.unref();
   try{await Promise.all([stoppedJobs,...dashboardTasks,disconnected,pending.size?new Promise(resolve=>drained.push(resolve)):Promise.resolve()]);}
    finally{clearTimeout(timeout);await savedDeletion.close();if(context.root)await databaseProvider()?.closeWorkspace(context.root);context.calendarSources.clear();clearVault(context.vault);sessions.clear();if(context.publisher)context.publisher.token=null;await collaborationSession.close();}
  })()};
}


function sendBytes(req, res, content, type) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
  res.setHeader('Content-Type', type); res.setHeader('Accept-Ranges', 'bytes');
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    let start = match?.[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match?.[2]));
    let end = match?.[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= bytes.length) {
      res.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` }); res.end(); return;
    }
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 }); res.end(bytes.subarray(start, end + 1)); return;
  }
  res.writeHead(200, { 'Content-Length': bytes.length }); res.end(bytes);
}
