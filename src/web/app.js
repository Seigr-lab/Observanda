import {validTarget,researchId} from './research-reference.js';
import {projectOperationView} from './project-operation-view.js';
import {labBookStorageUI} from './lab-book-storage-ui.js';
import {labBookAccessSettingsUI} from './lab-book-access-settings-ui.js';
import {labBookDirectory} from './lab-book-directory.js';
import {publicationPreviewUrl} from './website-context.js';
import {projectDirectory} from './project-directory.js';
import {projectAccessUI} from './project-access-ui.js';
import {projectContexts,projectApiRoute,projectRoute,ownedRoute,researchContext,researchOwner,ownedAssetURL} from './project-context.js';
import {publicationErrorView} from './publication-error-view.js';
import {startApplication} from './application-startup.js';
import {writerRecoveryUI} from './writer-recovery-ui.js';
import {activityUI} from './activity-ui.js';
import {snapshotWorkspace,draftWorkspace,editableRecord,sameValue} from './workspace-snapshot.js';
import {websiteSelectionDraft} from './website-selection.js';
import {workspaceReader,validateWorkspaceOutline} from './workspace-reader.js';
import {validateRecordScope,validRecordSelection} from './record-scope.js';
import {recordSelectionReader,validateRecordReceipt} from './record-selection-reader.js';
import {recordSelectionLoadUI} from './record-selection-load-ui.js';
import {recordContentUI} from './record-content-ui.js';
import {recordWritingUI} from './record-writing-ui.js';
import {recordValuesUI} from './record-values-ui.js';
import {recordRunCreationUI} from './record-run-creation-ui.js';
import {recordLocationUI} from './record-location-ui.js';
import {recordRemovalUI} from './record-removal-ui.js';
import {loadWorkspaceView} from './workspace-load-ui.js';
import {workspaceRefresh} from './workspace-refresh.js';
import {migrationUI} from './migration-ui.js';
import {migrationProvenanceUI} from './migration-provenance-ui.js';
import {attemptUI} from './attempt-ui.js';
import {resultStatementsUI} from './result-statements-ui.js';
import {saveAnalysisEditionReview,requireAnalysisEditionReview} from './analysis-review-ui.js';
import {readProgressStream} from './progress-stream.js';
import {structureProgress,structureRequestIds} from './structure-progress.js';
import {storageProgress} from './storage-progress.js';
import {recordSaveProgress} from './record-save-progress.js';
const structureRequestId=structureRequestIds();
import {reviewsUI} from './reviews-ui.js';
import {publicationReviewView,publicationText} from './publication-review.js';
import {localExportUI} from './local-export-ui.js';
import {publicationJobsUI} from './publication-jobs-ui.js';
import {publicationSelectionUI} from './publication-selection-ui.js';
import {mediaImportsUI} from './media-imports-ui.js';
import {recordListUI} from './record-list-ui.js';
import {decorateRecordLinks} from './record-links-ui.js';
import {applyRecordPatch} from './record-patch.js';
import {recordUpdateReader} from './record-update-reader.js';
import {recordViewsUI} from './record-views-ui.js';
import {bookReferenceUI} from './book-reference-ui.js';
import {selectorAnchor,selectorExists} from './book-selectors.js';
import {validViewFilter} from './record-view-model.js';
import {recordDateLabel} from './record-date.js';
import {recordDateFields,updateRecordDate} from './record-date-ui.js';
import {recordBrowse,browseActive} from './record-query.js';
import {recordBrowseFields} from './record-query-ui.js';
import {researchMaterialsUI} from './research-materials-ui.js';
import {recordHistoryUI} from './record-history-ui.js';
import {configurationOf,templateFrom} from './notebook-schema.js';
import {availableSections} from './laboratory/catalog.js';
import {locationName} from './workspace-structure.js';
import {recordFields,updateRecordField} from './record-fields-ui.js';
import {documentEditors} from './document-editor.js';
import {recordSectionsUI} from './record-sections-ui.js';
import {figureEditor} from './figure-editor.js';
import {researchTargets,researchReference,parseResearchReference} from './record-model.js';
import {applicationShell} from './application-shell.js';
import {workspaceNavigation} from './workspace-navigation.js';
import {websiteSitesUI} from './website-sites-ui.js';
import {websiteContext,websiteRequest,websitePages} from './website-context.js';
import {moduleLinks} from './module-links.js';
import {operationsUpdates} from './modules/live-updates.js';
import {moduleWorkbench} from './module-workbench.js';
import {recordActivityUI} from './record-activity-ui.js';
import {documentRecord} from './record-activity.js';
import {recordWorkflowUI} from './record-workflow-ui.js';
import {recordRevisionView} from './record-revision-view.js';
import {LIFECYCLE_STATUSES,OUTCOME_SUGGESTIONS} from './record-workflow.js';
import {recordDetailsUI} from './record-details-ui.js';
import {targetRoute} from './record-model.js';
import {expandingText} from './expanding-text.js';
import {recordRecoveryUI} from './record-recovery-ui.js';
import {recordDraftsUI} from './record-drafts-ui.js';
import {recordDraftReviewUI} from './record-draft-review-ui.js';
import {researchRequestCapacity} from './research-capacity.js';
import {researchCapacityMessage} from './research-capacity-message.js';
import {recordDraftTracker,retainPendingEdits} from './research-client.js';
import {recordCreationBase} from './record-creation.js';
import {recordStartersUI} from './record-starters-ui.js';
import {recordCreationUI} from './record-creation-ui.js';
import {recordDestinationUI} from './record-destination-ui.js';
import {t} from './i18n/index.js';
import {workspaceSaveRequest} from './workspace-edits.js';
import {previewSurface} from './preview-surface.js';
import {shellNavigation} from './shell-navigation.js';
import {lazyFeatureUI} from './lazy-feature-ui.js';
import {enabledModule,moduleForPage,moduleDestination} from './feature-modules.js';
import {dashboardUI} from './dashboard-ui.js';
import {helpUI} from './help/ui.js';
import {accessHelpUI} from './help/access-ui.js';
import {languageUI} from './i18n/language-ui.js';
import {preferencePage,preferencesFrame} from './preferences-ui.js';
import {userProfileUI} from './user-profile-ui.js';
import {setupUI} from './setup-ui.js';
import { unsavedChanges, formDrafts } from './unsaved-changes.js';
import {fontLibraryUI} from './font-library-ui.js';
import {installFontPickers,checkFontInputs} from './font-picker.js';
installFontPickers();
import { interfaceUI } from './interface-ui.js';
import { identityFields, identityInput, identityFromForm } from './workspace-identity.js';
import {storageUI} from './storage-ui.js';
import { workspaceUI } from './workspace-ui.js';
import { routeFor as localRouteFor, resolveRoute as resolveNavigationRoute } from './navigation.js';
const routeFor=state=>ownedRoute(localRouteFor(state),state.projectOwner);
const resolveRoute=(hash,book)=>resolveNavigationRoute(projectRoute(hash).hash,book,{contentReading:supportsRecordSelection()});
import { appearanceUI } from './appearance-ui.js';
import {appearancePreview} from './appearance-preview.js';
import {logosFor} from './branding.js';
import {applicationMark} from './app-brand.js';
import {brandingUI} from './branding-ui.js';
import { RECORD_TYPES, recordLabel } from './record-types.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const types = RECORD_TYPES.map(type => type.id);
const titleCase = text => text.charAt(0).toUpperCase() + text.slice(1);
const state = { book: null, etag: null, page: 'workspace', project: null, selected: null, notebook: 'all', dirty: false, search: '', filter: 'all', preview: null };
let previewSurfaces=[],dialogSurface=null;
let noticeTimer, savePromise, savedBook=null,savedRecordRevisions={},savedRecordBases={};
const drafts=formDrafts(),recordChanges=recordDraftTracker();
expandingText();
let uploading = false, fieldSequence = 0;
let changeVersion = 0;
let restoringRoute = false, workspaceOpening=false,routeRestoreVersion=0;
let completingWorkspace=null;
let removingRecord=false;
let routeIndex=Number.isInteger(history.state?.observandaIndex)?history.state.observandaIndex:0;
let travel=null,historyBusy=false;

const icons = {
  dashboard:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  folder:'<path d="M3 6h7l2 3h9v11H3zM3 6V4h7l2 2h9v3"/>',
  records:'<path d="M6 3h10l4 4v14H6zM16 3v5h4M9 12h8M9 16h8M3 6v15"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4zM13 7a3 3 0 0 1 3-3h5v14h-4a4 4 0 0 0-4 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m14 5-7 7 7 7M7 12h14"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  settings: '<path d="m9.5 3-.6 2.2-1.8 1-2.2-.6-2.5 4.3L4 11.5v2l-1.6 1.6 2.5 4.3 2.2-.6 1.8 1 .6 2.2h5l.6-2.2 1.8-1 2.2.6 2.5-4.3-1.6-1.6v-2l1.6-1.6-2.5-4.3-2.2.6-1.8-1L14.5 3z"/><circle cx="12" cy="12.5" r="3"/>',
  palette: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 6l12 12"/>',
  history: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6M12 7v6l4 2"/>',
  leaf: '<path d="M19 3C4 1 1 13 8 18c7 5 15-3 11-15Z M6 21 16 8M9 16l-1-6M12 12l5 1"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  export: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  chart: '<path d="M4 3v18h17M7 15l5-6 4 3 5-7"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const mark = applicationMark;

const navigation=workspaceNavigation({state:new Proxy(state,{get:(target,key)=>key==='book'?labBookDirectoryUI.navigation(projectDirectoryUI.navigation(state.projectOwner?projectOwners.navigation():sites.root())):target[key]}),icon,logosFor});

const websiteSelection=websiteSelectionDraft();
function adoptSnapshot(result){
  if(savedBook?.id!==result.book?.id)websiteSelection.reset();
  state.workspaceOutline=result.outline?{notebookCounts:result.notebookCounts,total:result.total}:null;
  state.recordScope=result.recordScope??null;
  savedBook=snapshotWorkspace(result.book);
  result.book=draftWorkspace(savedBook);
  savedRecordRevisions={...result.recordRevisions};
  savedRecordBases=Object.fromEntries(savedBook.entries.map(record=>[record.id,record]));
  recordChanges.reset(savedBook,savedRecordRevisions);
}
async function api(route, data, {adopt=true,signal,onProgress,metadataOnly=false,view=location.hash,owner=researchOwner(state)}={}) {
  if(route==='/api/notebook'&&data===undefined&&state.websiteId)return api('/api/websites/open',{id:state.websiteId},{adopt,signal});
  if(route==='/api/workspace/read/selection'&&!validRecordSelection(data?.ids)){
    const result=await readRecordSelection(data,{signal});
    if(adopt)adoptSnapshot(result);else result.book=snapshotWorkspace(result.book);return result;
  }
  if(route==='/api/notebook'&&data===undefined){
    if(metadataOnly){
      const result=await newWorkspaceReader().read({metadataOnly:true,signal,onProgress});
      if(adopt){adoptSnapshot(result);state.book=result.book;state.etag=result.etag;}
      return result;
    }
    if(state.recordScope)return api('/api/workspace/read/selection',{workspaceId:state.book.id,ids:state.recordScope.ids},{adopt,signal});
    if(state.workspaceOutline){await ensureCompleteWorkspace();return {book:adopt?draftWorkspace(savedBook):savedBook,etag:state.etag,recordRevisions:{...savedRecordRevisions}};}
    if(savedBook&&state.book?.id===savedBook.id&&state.etag&&state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21){
      return api('/api/workspace/read/changes',{workspaceId:savedBook.id,baseEtag:state.etag},{adopt,signal});
    }
    const result=await newWorkspaceReader().read({signal,onProgress});
    if(adopt&&result.book&&result.etag)adoptSnapshot(result);return result;
  }
  const requestResearch=researchContext(state),requestContext=state.storage?.contextId,requestWebsite=websiteContext(state),scopedWebsite=websiteRequest(route)||route==='/api/websites/save';
  const outlineWrite=Boolean(state.workspaceOutline||state.recordScope)&&['/api/workspace/structure','/api/workspace/notebook','/api/workspace/reorganize','/api/workspace/save'].includes(route);
  const structureSelection=outlineWrite&&state.recordScope?state.recordScope.ids:null;
  if(outlineWrite)data={...data,response:'outline'};
  const structureStream=outlineWrite&&route!=='/api/workspace/save';
  if(structureStream)data={...data,commandId:await structureRequestId(route,data)};
  const scopedWrite=state.recordScope&&['/api/research/records/save','/api/research/records/history/restore'].includes(route);
  // History restore is allowed only with a clean editor; retain just its subject.
  const selectionIds=scopedWrite?(route.endsWith('/history/restore')?[data.recordId]:[...new Set([...state.book.entries.map(e=>e.id),...(data.changes??[]).map(c=>c.id)])]):null;
  const receiptWrite=scopedWrite&&!validRecordSelection(selectionIds);
  if(scopedWrite)data={...data,...(receiptWrite?{receipt:true}:{recordIds:selectionIds})};
  const expectedSelection=route==='/api/workspace/read/selection'?data.ids:route==='/api/research/records/remove'?[data.recordId]:scopedWrite?selectionIds:null;
  const headers={'X-Observanda-Wait':'1','X-Observanda-View':view,...(state.storage?.contextId?{'X-Observanda-Workspace':state.storage.contextId}:{})};
  if(state.websiteId&&websiteRequest(route))headers['X-Observanda-Website']=state.websiteId;
  const stop=structureStream?new AbortController():null;
  if(stop)signal=signal?AbortSignal.any([signal,stop.signal]):stop.signal;
  const storageOperation=/^\/api\/projects\/[a-f0-9-]{36}\/(?:settings\/save|directory\/reparent)$/.test(route)||['/api/storage/rename','/api/storage/delete','/api/storage/delete/finish','/api/storage/open','/api/storage/copy/preview','/api/storage/copy','/api/storage/move','/api/storage/move/finish','/api/storage/encrypt','/api/storage/portable/preview','/api/storage/portable'].includes(route);
  const recordOperation=['/api/research/records/remove','/api/research/records/location','/api/research/records/runs/create','/api/research/records/save','/api/research/records/writing/save','/api/research/records/values/save','/api/research/records/sections','/api/research/records/media','/api/research/records/figures','/api/research/records/tags','/api/research/records/history/restore','/api/research/drafts/review/prepare','/api/research/drafts/review/apply'].includes(route);
  let result;const progress=onProgress?null:structureStream?structureProgress({cancel:()=>stop.abort()}):storageOperation?storageProgress():recordOperation?recordSaveProgress():null;
  if(progress?.element)progress.element.dataset.operationKind=route;
  const operationStream=route.startsWith('/api/sharing/')||route.startsWith('/api/workspaces/delete/')||storageOperation||recordOperation;
  try{
   const capacity=researchRequestCapacity(route,data);
   if(capacity)throw {...capacity,message:researchCapacityMessage(capacity)};
   const body=data===undefined?undefined:JSON.stringify(data);
   const response=await fetch(projectApiRoute(route,owner),data===undefined?{headers,signal}:{signal,method:'POST',headers:{...headers,...(structureStream||operationStream?{Accept:'application/x-ndjson'}:{}),'Content-Type':'application/json'},body});
   if(!response.ok){const error=await response.json();const explicitProject=/^\/api\/projects\/([a-f0-9-]{36})\//.exec(route);if(explicitProject||projectApiRoute(route,owner)!==route)error.projectId??=explicitProject?.[1]??(typeof owner==='object'?owner?.projectId:owner);throw error;}
   if(['application/zip','application/vnd.observanda.template'].some(type=>response.headers.get('content-type')?.includes(type))){const blob=await response.blob();if(requestContext!==state.storage?.contextId||requestResearch!==researchContext(state))throw {code:'WORKSPACE_CHANGED',message:t('recordDrafts','workspaceChanged')};return blob;}
   result=onProgress||response.headers.get('content-type')?.includes('application/x-ndjson')?await readProgressStream(response,onProgress??progress?.update??(()=>{})):await response.json();
  }catch(error){const explicitProject=/^\/api\/projects\/([a-f0-9-]{36})\//.exec(route);if(explicitProject||projectApiRoute(route,owner)!==route)error.projectId??=explicitProject?.[1]??(typeof owner==='object'?owner?.projectId:owner);if(stop?.signal.aborted)throw {code:'STRUCTURE_CANCELLED',message:t('structureProgress','stopped')};const message=researchCapacityMessage(error);if(message)throw {...error,message};throw error;}
  finally{progress?.close();}
  // An explicit project command can finish after its page has been left. Its
  // owner receives the result; it does not adopt research into the current view.
  if(!adopt&&route.startsWith('/api/projects/')){if(requestContext!==state.storage?.contextId)throw {code:'WORKSPACE_CHANGED',message:t('recordDrafts','workspaceChanged')};return result;}
  if(scopedWebsite&&requestWebsite!==websiteContext(state))throw {name:'AbortError',message:t('websiteSites','changed')};
  if(requestContext!==state.storage?.contextId||requestResearch!==researchContext(state))throw {code:'WORKSPACE_CHANGED',message:t('recordDrafts','workspaceChanged')};
  if(result.recordUpdate){
    const reader=recordUpdateReader((route,data,options)=>api(route,data,{...options,adopt:false}),result);
    const {recordUpdate,...receipt}=result;void recordUpdate;
    result={...receipt,...await recordUpdatesLoading.load(reader,{signal,committed:!route.startsWith('/api/workspace/read/')&&!route.endsWith('/open')})};
  }
  if(receiptWrite){
    const receipt=validateRecordReceipt(result,data.workspaceId);
    result=await readRecordSelection({workspaceId:receipt.workspaceId,ids:selectionIds,snapshotId:receipt.etag},{signal,committed:true});
  }
  if(requestContext!==state.storage?.contextId||requestResearch!==researchContext(state))throw {code:'WORKSPACE_CHANGED',message:t('recordDrafts','workspaceChanged')};if(expectedSelection||result.recordScope)validateRecordScope(result,{workspaceId:data?.workspaceId,ids:expectedSelection});if(result.data?.entities&&result.data.workspaceId&&(!state.moduleData||state.moduleData.workspaceId!==result.data.workspaceId||state.moduleData.revision<=result.data.revision))state.moduleData=result.data;if(result.recordPatch){
    const patched=applyRecordPatch(savedBook,state.etag,savedRecordRevisions,result);
    result.book=patched.book;result.recordRevisions=patched.recordRevisions;
  }
  if(result.outline||outlineWrite)validateWorkspaceOutline(result,{workspaceId:state.book?.id});
  if(structureSelection){
    const {outline,notebookCounts,total,...receipt}=result;void outline;void notebookCounts;void total;
    result={...receipt,...await readRecordSelection({workspaceId:result.book.id,ids:structureSelection,snapshotId:result.etag},{signal,committed:true})};
  }
  if(result.book&&result.etag){if(adopt)adoptSnapshot(result);else result.book=snapshotWorkspace(result.book);}return result;
}
const recordSelectionLoading=recordSelectionLoadUI({esc});
const recordUpdatesLoading=recordSelectionLoadUI({esc,namespace:'recordUpdates'});
async function readRecordSelection(command,{signal,committed=false}={}){
  const context=researchContext(state);
  const reader=recordSelectionReader(async(route,data,options)=>{
    if(context!==researchContext(state))throw {code:'WORKSPACE_CHANGED',message:t('recordDrafts','workspaceChanged')};
    return api(route,data,{...options,adopt:false});
  },command);
  try{
    const result=await recordSelectionLoading.load(reader,{signal,committed});
    if(context!==researchContext(state))throw {code:'WORKSPACE_CHANGED',message:t('recordDrafts','workspaceChanged')};
    return result;
  }catch(error){if(error.code==='ACCESS_LOCKED')report(error);throw error;}
}
function newWorkspaceReader({snapshotId=null}={}){
  const context=researchContext(state);
  const check=()=>{if(context!==researchContext(state))throw {code:'WORKSPACE_CHANGED',message:t('workspaceRead','changed')};};
  return workspaceReader(async(route,data,options)=>{check();if(snapshotId&&route.endsWith('/start'))data={...data,snapshotId,workspaceId:state.book.id};const result=await api(route,data,{...options,adopt:false});check();return result;});
}
async function ensureCompleteWorkspace(){
  if(completingWorkspace)return completingWorkspace;
  if(!state.workspaceOutline&&!state.recordScope)return;
  const requestedRoute=location.hash;
  completingWorkspace=(async()=>{
    workspaceOpening=true;
    try{
      const scoped=state.recordScope,previous=savedBook,draft=state.book,wasDirty=state.dirty;
      const result=await loadWorkspaceView({reader:newWorkspaceReader({snapshotId:scoped?state.etag:null}),show:content=>appShell.showLoading(content)});
      adoptSnapshot(result);state.book=scoped&&wasDirty?retainPendingEdits(previous,draft,result.book):result.book;state.etag=result.etag;
      if(scoped&&wasDirty)state.dirty=recordChanges.inspect(state.book);
    }finally{workspaceOpening=false;}
    // A later navigation owns the outlet; do not replace its URL with this view.
    if(location.hash===requestedRoute)render();
  })();
  try{await completingWorkspace;}finally{completingWorkspace=null;}
}
function notify(message, error = false) {
  clearTimeout(noticeTimer);
  const notice = $('#notice'); notice.textContent = message; notice.className = `notice${error ? ' error' : ''}`; notice.hidden = false;
  const close = document.createElement('button'); close.textContent = 'Dismiss'; close.onclick = () => { notice.hidden = true; }; notice.append(close);
  if (!error) noticeTimer = setTimeout(() => { notice.hidden = true; }, 5000);
}
function report(error) {
  if(error?.name==='AbortError')return;
  if(error?.code==='LEGACY_WRITE_LOCK'){void writerRecovery.check({force:true}).catch(error=>notify(error.message,true));return;}
  if(error?.code==='RECORD_REVIEW'){notify(error.message);return;}
  if(error?.code==='RECORD_REVIEW_CANCELLED')return;
  if(error?.projectId&&['ACCESS_LOCKED','ACCESS_DENIED','AUTH'].includes(error.code)){notify(error.message??'Unlock this project to continue.',true);return;}
  if(error?.code==='ACCESS_LOCKED'){state.access={...state.access,locked:true};render();return;}
  const message = error?.message ?? 'Connection interrupted. Your unsaved draft is still on screen.';
  const publicationIssue=publicationErrorView(error,esc);
  if(publicationIssue){showDialog(publicationIssue+'<div class="dialog-actions"><button class="button" data-action="close-dialog">'+esc(publicationText('closeIssues'))+'</button></div>');return;}
  if (error?.code === 'PRIVACY' || error?.code === 'INVALID') {
    showDialog(`<h2 id="dialog-title">${error.code === 'PRIVACY' ? 'Publication checks' : 'Check these fields'}</h2><p>${esc(message)}</p><ul class="privacy-details">${(error.details ?? []).map(issue => `<li>${esc(issue.field)} ${issue.recordId ? `<button class="button subtle" data-action="open-issue" data-id="${esc(issue.recordId)}">Open record</button>` : ''}</li>`).join('')}</ul><div class="dialog-actions"><button class="button" data-action="close-dialog">Back to workspace</button></div>`);
  } else notify(message, true);
}
function updateSaveStatus(){
  const changed=state.dirty||state.page==='appearance'&&textControls.isDirty();
  const label=$('#save-status');if(label)label.textContent=changed?'Unsaved changes':'Saved';
  recordDrafts.update();
  for(const button of document.querySelectorAll('.section-save [data-action="save"],.section-save [data-action="discard-section"]'))button.disabled=!changed||uploading||Boolean(savePromise)||figures.isBusy()||recordDrafts.isRecovering();
}
function sectionActions(){
  if(state.page==='editor'&&state.recordReading)return '';
  const label={editor:'Save record',website:'Save website',branding:t('branding','save'),appearance:t('appearance','saveAppearance')}[state.page];
  if(!label)return '';
  return `<footer class="section-save" aria-label="${label}"><div><span id="save-status" role="status"></span>${state.page==='editor'?recordDrafts.statusView():''}</div><div class="inline-actions"><button class="button" data-action="discard-section">Discard changes</button><button class="button primary" data-action="save">${label}</button>${state.page==='website'?`<button class="button" data-action="preview">${icon('eye')}Preview &amp; export</button>${state.storage?.encrypted?'<button class="button" data-action="publication-jobs-list">Website preparations</button>':''}`:''}</div></footer>`;
}
function changed(dirtyState){
  changeVersion++;state.dirty=dirtyState;state.preview=null;updateSaveStatus();
  if(recordChanges.command())recordDrafts.schedule();else if(!state.dirty)void recordDrafts.clear();else recordDrafts.pause();
}
function dirty(){changed(recordChanges.inspect(state.book)||websiteSelection.isDirty());}
function dirtyRecord(id=state.selected){changed(recordChanges.updateRecord(state.book,id));}
async function save() {
  checkFontInputs();
  if(savePromise){await savePromise;return save();}
  if(!state.dirty)return;
  // Wait for a checkpoint already in flight before acquiring the workspace
  // write lock. Draft writes and record commits use the same durable adapter.
  savePromise=saveRecords();
  try{return await savePromise;}finally{savePromise=null;updateSaveStatus();}
}
async function saveRecords(){
  if(state.websiteId){
    const version=changeVersion,submitted=draftWorkspace(state.book),command=workspaceSaveRequest(savedBook,submitted,savedRecordRevisions);
    if(!command)throw {code:'INVALID',message:t('websiteSites','changed')};
    const result=await api('/api/websites/save',{id:state.websiteId,command:{...command,baseEtag:state.etag,selection:websiteSelection.snapshot()}});
    state.website=result.site;state.etag=result.etag;
    if(version===changeVersion){state.book=result.book;websiteSelection.load(result.site.selection,result.selectionProjects);state.dirty=false;}
    else{state.book=retainPendingEdits(submitted,state.book,result.book);state.dirty=true;}
    return;
  }
  figures.validate();
  await recordDrafts.flush();
  const version=changeVersion,{book:submitted,command:recordCommand}=recordChanges.submission(state.book),previousRevisions={...savedRecordRevisions},previousBases={...savedRecordBases};
  const selection=websiteSelection.isDirty()?websiteSelection.snapshot():null,command=selection?null:recordCommand;
  const indexed=state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21;
  const workspaceCommand=!command&&indexed?workspaceSaveRequest(savedBook,submitted,previousRevisions):null;
  if(workspaceCommand&&selection)workspaceCommand.selection=selection;
  try {
    if(!command&&indexed&&!workspaceCommand)throw {code:'INVALID',message:'These changes need their dedicated project or lab-book settings. Your draft is retained.'};
    const result=command?await api('/api/research/records/save',{...command,baseEtag:state.etag}):
      workspaceCommand?await api('/api/workspace/save',{...workspaceCommand,baseEtag:state.etag}):await api('/api/notebook/save',{book:submitted,etag:state.etag});
    if(selection)websiteSelection.acknowledge(selection);
    if(!command&&!workspaceCommand&&state.storage?.researchStorage==='catalogue')state.storage.researchFormatVersion=submitted.formatVersion;
    if(changeVersion===version){state.book=result.book;state.dirty=false;}
    else{
      const pending=state.book;
      state.book=retainPendingEdits(submitted,pending,result.book);
      for(const record of pending.entries){
        const sent=submitted.entries.find(item=>item.id===record.id);
        if(!sameValue(sent,record)&&!(command??workspaceCommand)?.changes.some(change=>change.id===record.id)&&previousRevisions[record.id]){
          savedRecordRevisions[record.id]=previousRevisions[record.id];
          savedRecordBases[record.id]=previousBases[record.id];
        }
      }
      state.dirty=recordChanges.inspect(state.book)||websiteSelection.isDirty();
    }
    state.etag=result.etag;
    if(state.dirty)recordDrafts.schedule();else await recordDrafts.clear();
  }catch(error){
    if(!command||error.code!=='RECORD_CHANGED')throw error;
    const changes=recordCheckpoint();
    if(!changes)throw error;
    const latest=await api('/api/notebook',undefined,{adopt:false});
    if(latest.book?.id!==state.book.id)throw {code:'WORKSPACE_CHANGED',message:'The workspace changed. Keep this window open to recover your draft.'};
    const entries=await recordRecovery.review({changes,book:latest.book});
    if(!entries)throw {code:'RECORD_REVIEW_CANCELLED',message:'Your unsaved record is still in the editor. Choose Stay here to return to it.'};
    adoptSnapshot(latest);state.book={...latest.book,entries};state.etag=latest.etag;
    dirty();render();await recordDrafts.flush();
    throw {code:'RECORD_REVIEW',message:state.dirty?'Combined changes are ready in the editor. Review them, then save the record.':'The saved record already contains these changes.'};
  }
}
function recordCheckpoint(){
  if(!state.book||!state.dirty||state.access?.locked)return null;
  return recordChanges.checkpoint(savedRecordBases);
}
const recordRecovery=recordRecoveryUI({esc});
const recordDraftReview=recordDraftReviewUI({state,api,esc,field,notify,destinations:recordLinkDestinations,figures:()=>[],onSaved:async result=>{await workspaceLive.check();if(result.absent){state.page='entries';state.selected=null;render();}else await openRecordReading(result.recordId);}});
const recordDrafts=recordDraftsUI({api,esc,snapshot:recordCheckpoint,compact:()=>state.storage?.researchStorage==='catalogue',onReset:()=>recordDraftReview.close(),onChange:()=>{recordDrafts.update();updateSaveStatus();},notify,recoverWriting:header=>recordWriting.recover(header),recoverValue:header=>recordValues.recover(header),recoverDocument:async(header,options)=>{let accepted=false;await leave.run(async()=>{accepted=await recordDraftReview(header,options);});return accepted;},recover:async draft=>{
  let applied=false;
  await leave.run(async()=>{
    const ids=draft.changes.map(change=>change.record.id);
    const latest=state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21?await api('/api/workspace/read/selection',{workspaceId:draft.workspaceId,ids},{adopt:false}):await newWorkspaceReader().read();
    if(latest.book?.id!==draft.workspaceId)throw {code:'WORKSPACE_CHANGED',message:t('recordDrafts','workspaceChanged')};
    const entries=await recordRecovery.review({changes:draft.changes,book:latest.book,recovering:true});
    if(!entries)return;
    adoptSnapshot(latest);state.book={...latest.book,entries};state.etag=latest.etag;
    const selected=entries.find(record=>draft.changes.some(change=>change.record.id===record.id));
    if(selected){state.selected=selected.id;state.page='editor';state.notebook=selected.notebookId;state.project=state.book.notebooks.find(n=>n.id===selected.notebookId)?.projectId??null;}
    dirty();render();applied=true;notify(t('recordDrafts','recovered'));
  });
  return applied;
}});

function showDialog(html) { dialogSurface?.destroy(); const dialog = $('#dialog'); dialog.innerHTML = html; if (!dialog.open) dialog.showModal(); const frame=dialog.querySelector(".expanded-preview iframe");dialogSurface=frame?previewSurface(frame):null;dialog.addEventListener("close",()=>{dialogSurface?.destroy();dialogSurface=null;},{once:true}); drafts.track(); }
function field(label, content) {
  if(content.startsWith('<font-picker>'))return `<div class="field"><label>${label}</label>${content.replace('<select ',`<select aria-label="${esc(label)}" `)}</div>`;
  const controlTag = /^<(input|textarea|select)\b[^>]*>/.exec(content)?.[0] ?? '';
  const existing = /\bid="([^"]+)"/.exec(controlTag)?.[1];
  const id = existing ?? `field-${++fieldSequence}`;
  const control = existing ? content : content.replace(/^<(input|textarea|select)\b/, `<$1 id="${id}"`);
  return `<div class="field"><label for="${id}">${label}</label>${control}</div>`;
}
const entry = () => editableRecord(state.book,state.selected);
async function navigateResearch(target){
  const sourceReturn=['editor','record-reader'].includes(state.page)?state.recordReturn:{bookReading:!!state.bookReading,page:state.page,project:state.project,notebook:state.notebook,search:state.search,filter:state.filter,recordBrowse:recordBrowse(state.recordBrowse),filterWorkspaceId:state.book.id,owner:structuredClone(state.projectOwner??null)};
  if(target.workspaceId!==state.book.id){
    if(target.workspaceId===projectOwners.root()?.id)await projectOwners.enter(null);
    else{
      const location=await withProjectAccess(()=>api('/api/projects/reference-location',target,{adopt:false}));
      if(!location.registered){state.pendingResearchLink=target;await storageControls.action({dataset:{action:'storage-workspaces'}});return;}
      if(target.revision)return materials.openRevision(target,{owner:location.labBookId?{projectId:location.projectId,labBookId:location.labBookId}:location.projectId});
      await projectOwners.enter(location.projectId,location.labBookId??null);
    }
  }
  if(target.revision){await materials.openRevision(target);return;}
  const origin=state.page==='editor'?state.recordReturn:{bookReading:!!state.bookReading,page:state.page,project:state.project,notebook:state.notebook,search:state.search,filter:state.filter,recordBrowse:recordBrowse(state.recordBrowse),filterWorkspaceId:state.book.id};
  if(target.kind==='record'&&supportsRecordSelection()){const opened=await openRecordReading(target.id,target.selector?selectorAnchor(target.selector):null);if(opened&&sourceReturn)state.recordReturn=sourceReturn;return;}
  const route=targetRoute(target,state.book);
  if(!route){notify('The linked item is unavailable. Its reference has been kept.',true);return;}
  const reading=target.kind==='record';
  if(reading)state.recordReturn=origin;
  Object.assign(state,resolveRoute(route+(reading?'/read'+(target.selector?'/'+selectorAnchor(target.selector):''):''),state.book));render();
  if(target.selector&&!selectorExists(entry(),target.selector))notify(t('book','unavailable'),true);
  else if(!target.selector)window.scrollTo(0,0);
}
const displayedRecord=()=>state.page==='record-reader'?recordContent.current():entry();
const recordActivity=recordActivityUI({getRecord:displayedRecord,state,api,esc,field,showDialog,notify,render,dirty:()=>dirtyRecord(),revisions:()=>state.page==='record-reader'?{[state.selected]:recordContent.savedRevision()}:savedRecordRevisions,create:addEntry});
const recordStarters=recordStartersUI({state,api,esc,showDialog,notify,sourceRecord:()=>state.page==='record-reader'?recordContent.captureTarget():null,openRecord:id=>rawAction({dataset:{action:'edit-entry',id}})});
const workflow=recordWorkflowUI({getRecord:displayedRecord,state,api,esc,notify,revisions:()=>savedRecordRevisions,create:openCreatedRecord});
const recordDetails=recordDetailsUI({state,esc,field,dirty:()=>dirtyRecord(),render,showDialog,notify,navigate:navigateResearch,api});
const bookReferences=bookReferenceUI({state,api,esc,showDialog,notify,revisions:()=>savedRecordRevisions});
async function recordLinkDestinations({query='',cursor=null,signal}={}){
 const book=state.book,context=state.storage?.contextId;
 if(state.storage?.researchStorage!=='catalogue'||state.storage.researchFormatVersion!==21)return researchTargets(book).map(t=>({href:researchReference(t),label:t.title,context:t.context}));
 const result=await api('/api/research/records/query',{workspaceId:book.id,query:{projectId:null,notebookId:null,filter:'all',search:query,browse:recordBrowse()},cursor,limit:25},{adopt:false,signal});
 if(book.id!==state.book?.id||context!==state.storage?.contextId)throw {name:'AbortError'};
 const structure=cursor?[]:researchTargets({...book,entries:[]}).filter(t=>(t.title+' '+t.context).toLocaleLowerCase().includes(query));
 return {items:[...structure.map(t=>({href:researchReference(t),label:t.title,context:t.context})),...result.records.map(r=>({href:researchReference({workspaceId:book.id,kind:'record',id:r.id}),label:r.title,context:book.notebooks.find(n=>n.id===r.notebookId)?.title??'Record'}))],nextCursor:result.nextCursor,previousCursor:result.previousCursor};
}
function openEditorLink(href){const target=parseResearchReference(href);if(target)void leave.run(()=>navigateResearch(target));else if(/^(https?:|mailto:|tel:)/.test(href))window.open(href,'_blank','noopener,noreferrer');}
const documents=documentEditors({book:()=>state.book,figures:()=>entry()?[...entry().figures,...entry().attachments.filter(a=>a.kind==='image')]:[],context:()=>state.access?.locked?null:state.book?.id,destinations:recordLinkDestinations,onError:message=>notify(message,true),onOpenLink:openEditorLink});
const recordWriting=recordWritingUI({state,api,esc,field,destinations:recordLinkDestinations,figures:()=>displayedRecord()?[...displayedRecord().figures,...displayedRecord().attachments.filter(a=>a.kind==='image')]:[],notify,onOpenLink:openEditorLink,onSaved:()=>workspaceLive.check(),onClosed:()=>recordDrafts.refresh()});
const recordValues=recordValuesUI({state,api,esc,field,notify,onSaved:async(result,target)=>{await workspaceLive.check();if(target?.field?.startsWith('figure:'))await recordContent.revealFigure(target,result.position);},onClosed:()=>recordDrafts.refresh()});
const runCreation=recordRunCreationUI({state,api,esc,notify,onCreated:async result=>{await workspaceLive.check();await openRecordReading(result.recordId);}});
const recordLocation=recordLocationUI({state,api,esc,notify,target:()=>recordContent.locationTarget(),refresh:()=>workspaceLive.check()});
const recordRemoval=recordRemovalUI({state,api,esc,notify,target:()=>recordContent.removalTarget(),refresh:()=>workspaceLive.check(),onRemoved:result=>{adoptSnapshot(result);state.book=result.book;state.etag=result.etag;state.selected=null;state.page='entries';state.preview=null;render();}});
const recordSections=recordSectionsUI({state,documents,esc,field,icon,dirty:dirtyRecord,render});
const materials=researchMaterialsUI({refreshReader:()=>workspaceLive.check(),getRecord:displayedRecord,state,api,esc,field,showDialog,notify,dirty,render,revisions:()=>savedRecordRevisions,create:openCreatedRecord,editRetainedFigure:({recordId,figure})=>recordValues.open({recordId,field:'figure:'+figure.id,retainedFigure:figure})});
const attempts=attemptUI({getRecord:displayedRecord,state,api,esc,field,showDialog,notify,dirty:()=>dirtyRecord(),render,revisions:()=>savedRecordRevisions,openReference:ref=>materials.openReference(ref),requestClose:()=>action({dataset:{action:'close-dialog'}})});
const results=resultStatementsUI({state,api,esc,field,showDialog,notify,dirty:()=>dirtyRecord(),render,openReference:ref=>materials.openReference(ref)});
const localExport=localExportUI({state,api,esc,field,showDialog,notify});
const publicationJobs=publicationJobsUI({state,api,esc,showDialog,notify,showReview});
const editionSelection=publicationSelectionUI({state,api,esc,showDialog});
const mediaImports=mediaImportsUI({state,api,esc,showDialog,notify,apply:applyMedia,busy:value=>{uploading=value;updateSaveStatus();}});
const recordHistory=recordHistoryUI({state,api,esc,showDialog,notify,revisions:()=>savedRecordRevisions,onRestore:async result=>{
  if(result.historyReceipt){$('#dialog').close();await workspaceLive.check();return;}
  state.book=result.book;state.etag=result.etag;state.dirty=false;state.preview=null;changeVersion++;
  await recordDrafts.clear();$('#dialog').close();render();
}});
const recordViews=recordViewsUI({state,api,esc,field,showDialog,notify,snapshot:()=>recordList.snapshot(),apply:q=>{
  Object.assign(state,{page:'entries',selected:null,project:q.notebookId?state.book.notebooks.find(n=>n.id===q.notebookId).projectId:q.projectId,notebook:q.notebookId??'all',filter:q.filter,search:q.search,recordBrowse:q.browse});
  render();rememberFilters();$('#search')?.focus();
}});
const figures=figureEditor({getFigures:()=>entry()?.figures??[],getResults:()=>entry()?.results,setResults:value=>{entry().results=value;results.refresh();},prepareCopies:items=>materials.pinFigureSources(items),busyChanged:updateSaveStatus,changed:()=>dirtyRecord(),notify,context:()=>state.book?.id??null});

const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
const branding=brandingUI({state,api,esc,field,option,showDialog,render,dirty,leave:{run:fn=>leave.run(fn)},report,uploading:()=>uploading});
const labUI=lazyFeatureUI({enabled:()=>enabledModule(state.dashboardSettings,'laboratory'),handles:name=>name==='laboratory-samples'||name.startsWith('lab-'),load:()=>import('./laboratory-ui.js').then(m=>m.laboratoryUI({state,api,esc,field,option,showDialog,render,notify}))});
const publishUI=lazyFeatureUI({enabled:()=>enabledModule(state.dashboardSettings,'publishing'),handles:name=>name==='publishing'||(name.startsWith('publish-')||name.startsWith('publication-links-')),load:()=>import('./publishing-ui.js').then(m=>m.publishingUI({state,api,esc,field,option,render,notify,showDialog,onChange:updateSaveStatus}))});
const help=helpUI({state,esc,render});
const accessHelp=accessHelpUI({api,esc});
const languageControls=languageUI({api,esc,render,beforeChange:task=>leave.run(task).catch(report)});
const projectDirectoryUI=projectDirectory({state,api,esc,changed:()=>render()});
const labBookDirectoryUI=labBookDirectory({state,api,esc,changed:()=>render(),access:operation=>withProjectAccess(operation)});
const structureUI = workspaceUI({state,api,esc,field,option,icon,dirty,save,render,showDialog,notify,recordsTable:renderRecordTable,logosFor,isUploading:()=>uploading,projectDirectory:projectDirectoryUI,labBookDirectory:labBookDirectoryUI,accessProject:(operation,options)=>withProjectAccess(operation,options),enterProject:(id,bookId)=>projectOwners.enter(id,bookId),rootBook:()=>projectOwners.root(),renameWorkspace:name=>storageControls.rename(name)});
let recordOpenRequest=0;
const recordContent=recordContentUI({state,api,esc,field,render,report,refresh:()=>workspaceLive.check(),editWriting:target=>recordWriting.open(target),tools:()=>bookReferences.button()+recordHistory.button({saved:true})+reviews.button()+migrationProvenance.button()+recordStarters.button()+recordLocation.button(),before:()=>recordActivity.view({readonly:true})+workflow.view({readonly:true}),after:()=>materials.view(displayedRecord())+connectedWork.view()+recordRemoval.view(),links:record=>recordDetails.relations(record,{readonly:true,selectedEdits:true}),attemptReference:attempts.reference,resultReference:results.reference});
const recordList=recordListUI({state,api,esc,showDialog,render,access:operation=>withProjectAccess(operation),decorate:root=>decorateRecordLinks(root,state.book),chooseType:value=>{state.filter=value;refreshRecordResults();},table:rows=>renderRecordTable(rows,{action:'browse-record'})});
const ownerOperation=projectOperationView({state,esc,projectDirectory:projectDirectoryUI,restore:restoreRoute,render});
const activity=activityUI({onChange:snapshot=>{
 void ownerOperation.activity(snapshot).catch(report);
 void projectDirectoryUI.activity(snapshot).catch(report);
 if(snapshot.busy||workspaceLoadTask)return;
 if(state.waitingForOperation){state.waitingForOperation=false;void loadWorkspace().catch(report);}
 else if(state.storage?.contextId&&snapshot.contextId!==state.storage.contextId){if(!uploading&&!savePromise&&!pendingChanges('all').labels.length)void loadWorkspace().catch(report);}
 else if(state.storageBusy){state.storageBusy=false;if(state.page==='storage')void storageControls.action({dataset:{action:'storage'}}).catch(report);}
}});
const writerRecovery=writerRecoveryUI({api,esc});
const storageControls=storageUI({state,api,accessOwners:(operation,options)=>withProjectAccess(operation,options),activity,writerRecovery,esc,field,save,render,showDialog,notify,reload:loadWorkspace,resetInterface:async()=>{savedBook=null;recordChanges.reset(null);await languageControls.load();await textControls.load();await dashboard.load();},isUploading:()=>uploading});
const userProfile=userProfileUI({state,api,esc,field,render,notify});
const setupControls=setupUI({state,esc,field,option,mark,storageControls,notify});
const textControls=interfaceUI({api,field,showDialog,notify,onChange:updateSaveStatus});
const shellMenu=shellNavigation();
const appShell=applicationShell({root:$('#app'),mark,navigation,applyLayout:textControls.applyLayout});
const website=lazyFeatureUI({enabled:()=>enabledModule(state.dashboardSettings,'publishing'),handles:name=>name==='website'||name.startsWith('website-'),load:()=>import('./website-ui.js').then(m=>m.websiteUI({state,api,esc,field,option,icon,dirty,render,notify,showDialog,selection:websiteSelection,access:operation=>withProjectAccess(operation),bindMedia:()=>mediaImports.bind(),previewDraft:book=>{
  const command=state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21?workspaceSaveRequest(savedBook,book,savedRecordRevisions):null;
  return command?{draft:{...command,baseEtag:state.etag,...(websiteSelection.isDirty()?{selection:websiteSelection.snapshot()}: {})}}:{book};
 }}))});
const connectedWork=moduleLinks({state,api,esc});
const sites=websiteSitesUI({state,api,esc,field,showDialog,render,selection:websiteSelection,access:operation=>withProjectAccess(operation),enterOwner:(id,bookId)=>projectOwners.enter(id,bookId),
 rootSnapshot:()=>newWorkspaceReader().read({metadataOnly:true}),
 adopt:result=>{adoptSnapshot(result);state.book=result.book;state.etag=result.etag;state.dirty=false;},
 ready:async page=>{if(page==='website')await website.ready();if(['publishing','integrations'].includes(page))await publishUI.load();}
});
const bookStorage=labBookStorageUI({state,api,esc,field,showDialog,access:operation=>withProjectAccess(operation),moved:async(result,view,entry)=>{await labBookDirectoryUI.refresh(entry.projectId);await labBookDirectoryUI.refresh(result.projectId);if(location.hash===view)location.hash=ownedRoute('#/notebooks/'+result.book.labBookId,{projectId:result.projectId,labBookId:result.book.labBookId});}});
const bookAccessSettings=labBookAccessSettingsUI({state,api,esc,field,enterProject:id=>projectOwners.enter(id),render});
const projectAccess=projectAccessUI({state,api,esc,field,showDialog});
async function withProjectAccess(operation,options={}){
 const authorized=new Set();
 for(;;)try{return await operation();}catch(error){
  if(error.code==='LAB_BOOK_MOVED'&&error.projectId&&projectRoute(location.hash).labBookId===error.labBookId){location.hash=ownedRoute(projectRoute(location.hash).hash,{projectId:error.projectId,labBookId:error.labBookId});throw {name:'AbortError'};}
  const owner=(error.destinationWorkspaceId??'source')+':'+error.projectId+':'+(error.labBookId??'');
  if(!error.projectId||!['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN'].includes(error.code)||authorized.has(owner))throw error;
  const context=researchContext(state);await projectAccess.open(error.projectId,error.labBookId,error.labBookName??error.projectName,typeof options==='function'?options(error):options);
  if(context!==researchContext(state))throw {name:'AbortError'};authorized.add(owner);
 }
}
const projectOwners=projectContexts({state,api,bookOwner:id=>labBookDirectoryUI.owner(id),isOwned:id=>projectDirectoryUI.entries().some(entry=>entry.projectId===id),access:withProjectAccess,adopt:result=>{adoptSnapshot(result);state.book=result.book;state.etag=result.etag;state.dirty=false;state.selected=null;state.preview=null;},afterEnter:async result=>{await Promise.all([fontLibrary.load(),api('/api/media-policy').then(value=>{state.mediaPolicy=value;}),recordDrafts.start(result.book.id)]);}});
const migration=migrationUI({state,api,esc,field,render,showDialog});
const migrationProvenance=migrationProvenanceUI({state,api,esc});
const reviews=reviewsUI({getRecord:displayedRecord,state,api,esc,showDialog,notify,render});
const modules=moduleWorkbench({state,api,esc,field,option,icon,render,notify,showDialog,documents,reviews,recordsTable:renderRecordTable,access:operation=>withProjectAccess(operation)});
const operationsLive=operationsUpdates({state,api,isEditing:()=>state.dirty||modules.isDirty()||Boolean(document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')),onChange:()=>{if(state.page==='workspace')dashboard.refreshData();else if(state.page==='module'&&['planning','resources'].includes(state.moduleId))void modules.refreshVisible().catch(report);else if(['projects','project'].includes(state.page))render();}});
const dashboard=dashboardUI({state,api,esc,field,option,render,notify,onChange:updateSaveStatus,access:operation=>withProjectAccess(operation)});
const fontLibrary=fontLibraryUI({state,api,esc,render,notify});
const designPreview=appearancePreview({state,api,option});
const designUI = appearanceUI({fontLibrary,textControls,state,esc,field,option,dirty,save,render,showDialog,notify,preview:designPreview.schedule,previewPages:designPreview.pages});


const saveableForms=new Set(['starter-edit-form','starter-details-form','starter-field-form','starter-tag-form','record-view-form','notebook-config-form','structure-project-form','project-template-form','workspace-name-form','theme-name-form','lab-sample-form','lab-analysis-form','lab-result-form','storage-access-form','media-policy-form']);
function pendingChanges(scope='all'){
  const forms=drafts.changed(scope),labels=forms.map(form=>form.closest('dialog')?.querySelector('h2')?.textContent??({'workspace-name-form':'Workspace details','storage-access-form':'Local access settings','create-form':'Workspace setup','publish-token-form':'Unsubmitted connection details'}[form.id]??'Unsubmitted form'));
  if(structureUI.notebooks.isDirty())labels.push($('#dialog #project-template-form')?'Lab-book template':'Project or lab book settings');
  if(scope==='all'&&state.dirty)labels.push(state.page==='editor'?'Record: '+(entry()?.title??'New record'):(document.querySelector('main h1')?.textContent??'Workspace')+' edits');
  if(scope==='all'&&state.publishing?.dirty)labels.push('Publishing destination');
  if(scope==='all'&&modules.needsNavigationGuard())labels.push('Module edits');
  if(scope==='all'&&dashboard.isDirty())labels.push('Module and dashboard settings');
  if(scope==='all'&&userProfile.isDirty())labels.push(t('userProfile','title'));
  if(textControls.isDirty()&&(scope==='all'||$('#dialog[open] [data-interface]')))labels.push('App text and layout settings');
  if(attempts.isDirty())labels.push(t('attempts','title'));
  return {forms,labels:[...new Set(labels)],canSave:!attempts.isDirty()&&forms.every(form=>saveableForms.has(form.id))};
}
async function savePending(scope='all',forms=drafts.changed(scope),{requireClean=true}={}){
 if(figures.isBusy())throw Error(t('figureProvenance','checking'));
  if(forms.some(form=>!saveableForms.has(form.id)))throw new Error('Complete this action using its own form, or discard the unfinished form.');
  for(const form of forms)if(!form.checkValidity())throw new Error('Complete the required fields before saving. Choose Stay here to return to the form.');
  for(const form of forms){
    const previous=draftWorkspace(state.book),etag=state.etag;
    try{await submitForm(form);}catch(error){if(state.etag===etag){state.book=previous;dirty();}throw error;}
    if(form.isConnected&&(!form.closest('dialog')||form.closest('dialog').open)&&drafts.changed(scope).includes(form))throw new Error('The form has not been saved. Choose Stay here to check its fields.');
  }
  if(structureUI.notebooks.isDirty())await structureUI.notebooks.save();
  if(textControls.isDirty()&&(scope==='all'||$('#dialog[open] [data-interface]')))await textControls.save();
  if(scope==='all'&&state.publishing?.dirty)await publishUI.save();
  if(scope==='all'&&modules.isDirty())await modules.save();
  if(scope==='all'&&dashboard.isDirty())await dashboard.save();
  if(scope==='all'&&userProfile.isDirty())await userProfile.save();
  if(state.page==='website'&&scope==='all'){website.validate();for(const el of document.querySelectorAll('.website-controls input,.website-controls textarea'))if(!el.reportValidity())throw new Error('Complete the required website fields before saving.');}
  if(scope==='all'&&state.page==='editor')recordDetails.validate();
  if(scope==='all'||forms.length)await save();
  const complete=pendingChanges(scope).labels.length===0;
  if(!complete&&requireClean)throw new Error('Newer changes still need saving. Save again or stay on this screen.');
  return complete;
}
async function discardPending(scope='all',forms=drafts.changed(scope)){
  if(savePromise)await savePromise;
  drafts.reset(forms);
  attempts.stop();
  structureUI.notebooks.discard();
  if(scope==='all'){
    if(state.dirty&&savedBook){const latest=await api('/api/notebook',undefined,{metadataOnly:Boolean(state.workspaceOutline)});state.book=latest.book;state.etag=latest.etag;if(latest.site)websiteSelection.load(latest.site.selection,latest.selectionProjects);else websiteSelection.reset();state.dirty=false;changeVersion++;state.preview=null;designUI.resetUndo();await recordDrafts.clear();}
    if(state.publishing?.dirty)await publishUI.discard();
    if(modules.isDirty())await modules.discard();
    if(dashboard.isDirty())await dashboard.discard();
    if(userProfile.isDirty())await userProfile.discard();
  }
  if(textControls.isDirty()&&(scope==='all'||$('#dialog[open] [data-interface]')))await textControls.discard();
  updateSaveStatus();
  if(scope==='all'){const previous=restoringRoute;restoringRoute=true;try{render();}finally{restoringRoute=previous;}}
}
const leave=unsavedChanges({esc,changes:pendingChanges,save:savePending,discard:discardPending,busy:()=>removingRecord||uploading||fontLibrary.busy()||figures.isBusy()||materials.isBusy()||recordHistory.isBusy()||reviews.isBusy()||Boolean(document.querySelector('form[data-busy]:not([data-navigation-ready])')),notify});
const workspaceLive=workspaceRefresh({state,api,notify,onAccessError:report,
 blocked:()=>Boolean(workspaceOpening||completingWorkspace||savePromise||restoringRoute||uploading||removingRecord||fontLibrary.busy()||figures.isBusy()||materials.isBusy()||recordHistory.isBusy()||reviews.isBusy()||pendingChanges().labels.length||document.querySelector('dialog[open],form[data-busy]')||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')),
 read:({signal})=>state.websiteId?api('/api/websites/open',{id:state.websiteId},{adopt:false,signal}):state.recordScope?api('/api/workspace/read/selection',{workspaceId:state.book.id,ids:state.recordScope.ids},{adopt:false,signal}):newWorkspaceReader().read({requireOutline:Boolean(state.workspaceOutline),signal}),
 apply:result=>{
  const scroll={x:window.scrollX,y:window.scrollY},sidebar=document.querySelector('#main-navigation'),sideScroll=sidebar?.scrollTop;
  adoptSnapshot(result);state.book=result.book;state.etag=result.etag;
  if(result.site){state.website=result.site;websiteSelection.load(result.site.selection,result.selectionProjects);}
  if(state.project&&!state.book.projects.some(p=>p.id===state.project)||state.notebook!=='all'&&!state.book.notebooks.some(n=>n.id===state.notebook)||state.page==='editor'&&!state.book.entries.some(r=>r.id===state.selected))Object.assign(state,resolveRoute(location.hash,state.book));
  recordList.stop({clear:true});dashboard.refreshData();render();
  window.scrollTo(scroll.x,scroll.y);if(sidebar)sidebar.scrollTop=sideScroll;
 }
});
window.addEventListener('pagehide',()=>workspaceLive.stop(),{once:true});
const navigationActions=new Set(['laboratory-open-owned','module-open-owned','research-open-owned','help','help-open','record-activity-inspect','record-activity-create','migration-open','review-witnesses','publication-jobs-open-review','record-views','record-view-back','record-view-open','record-read','record-edit','record-read-linked','record-section-jump','workflow-new-run','configure-lab-notebook','specialize-notebook','attach-lab-notebook','module-open','laboratory-samples','preferences','dashboard-settings','integrations','workspace','workspaces','projects','entries','appearance','website','laboratory','publishing','storage','storage-workspaces','branding','branding-back','open-project','project-records','filter-notebook','browse-record','edit-entry','open-issue','back-to-records','new-entry','new-project','new-notebook','edit-project','edit-project-template','edit-notebook','rename-notebook','workspace-reorganize','record-history-open','preview','storage-new','storage-open-dialog','storage-copy-dialog','storage-move-dialog','storage-portable-dialog','storage-encrypt-dialog','storage-open-recent','storage-cancel-new','storage-lock','storage-reset-dialog','publish-disconnect','record-link-open','record-backlink-open']);
async function action(button){
  if(removingRecord)return;
  if(accessHelp.action(button))return;
  if(shellMenu.action(button))return;
  shellMenu.beforeAction(button);
  const name=button.dataset.action;
  if(name==='user-profile')return leave.run(()=>rawAction(button));
  if(name?.startsWith('starter-')&&!['starter-add','starter-remove','starter-up','starter-down'].includes(name))return leave.run(()=>rawAction(button));
  if(name?.startsWith('site-'))return leave.run(async()=>{await projectOwners.beforeAction(button);return sites.action(button);});
  if(['material-home','material-close','material-draft-back'].includes(name))return leave.run(()=>rawAction(button),{scope:'dialog'});
  if(name==='close-dialog')return leave.run(async()=>await localExport.close()||($('#dialog[open] .folder-browser')?storageControls.action({dataset:{action:'storage-browse-cancel'}}):rawAction(button)),{scope:'dialog'});
  if((['preferences','dashboard-settings','integrations','workspace','projects','appearance','website','publishing','storage'].includes(name)&&state.page===name&&!state.newWorkspace&&!state.projectOwner&&!state.websiteId)||(['edit-entry','open-issue'].includes(name)&&state.page==='editor'&&state.selected===button.dataset.id)){if(name==='open-issue')$('#dialog').close();return;}
  if(name==='preview'||name==='website'&&state.page==='review')return rawAction(button);
  if(navigationActions.has(name)){if(dashboard.isDirty())try{await dashboard.flushAutosave();}catch{/* Failed autosave remains protected by the leave guard. */}return leave.run(()=>rawAction(button));}
  return rawAction(button);
}
$('#dialog').addEventListener('cancel',event=>{event.preventDefault();action({dataset:{action:'close-dialog'}}).catch(report);});

function renderAccess(content){help.stop();appShell.showStandalone(content);accessHelp.fromRoute();}
function renderOnboarding() { renderAccess(setupControls.view()); }

const supportsRecordSelection=()=>state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21;
const outlineViewSupported=(page=state.page,moduleId=state.moduleId)=>['record-reader','user-profile','websites','help','entries','projects','project','preferences','dashboard-settings','workspaces','branding','appearance','laboratory','website','publishing','integrations','review','storage','migration'].includes(page)||page==='workspace'&&dashboard.supportsOutline()||page==='module'&&modules.supportsOutline(moduleId);
async function openRecordReading(id,anchor=null,reading=true){
 const sameRecord=state.page==='record-reader'&&state.selected===id;
 if(!sameRecord&&!await selectRecord(id,{metadataOnly:true}))return false;
 if(!['editor','record-reader'].includes(state.page))state.recordReturn={bookReading:!!state.bookReading,page:state.page,project:state.project,notebook:state.notebook,search:state.search,filter:state.filter,recordBrowse:recordBrowse(state.recordBrowse),filterWorkspaceId:state.book.id};
 if(!sameRecord)recordContent.clear();state.selected=id;state.page='record-reader';state.recordReading=reading;if(!sameRecord||anchor)state.recordSection=anchor;render();return true;
}
async function selectRecord(id,{metadataOnly=false}={}){
 const request=++recordOpenRequest,context=state.storage?.contextId,workspaceId=state.book?.id,route=location.hash,etag=state.etag;
 const main=document.querySelector('#main'),status=document.createElement('p');
 status.setAttribute('role','status');status.textContent='Opening record...';
 if(main){main.inert=true;main.setAttribute('aria-busy','true');main.before(status);}
 recordActivity.stop();
 try{
  const result=metadataOnly?await newWorkspaceReader().read({requireOutline:true}):await api('/api/workspace/read/selection',{workspaceId,ids:[id]},{adopt:false});
  if(request!==recordOpenRequest||state.storage?.contextId!==context||state.book?.id!==workspaceId||state.etag!==etag||location.hash!==route||state.dirty)return false;
  if(metadataOnly&&!result.outline)throw Error('The workspace no longer supports record editing in sections. Reload the workspace.');
  if(!metadataOnly&&result.recordScope.missing.includes(id)){notify('The record is no longer available. Its reference is retained.',true);return false;}
  adoptSnapshot(result);state.book=result.book;state.etag=result.etag;return true;
 }finally{status.remove();if(main&&request===recordOpenRequest){main.inert=false;main.removeAttribute('aria-busy');}}
}
function releaseCompleteWorkspace(){
 if(state.workspaceOutline||!savedBook||state.dirty||savePromise||completingWorkspace||state.storage?.researchStorage!=='catalogue'||state.storage.researchFormatVersion!==21||!outlineViewSupported())return;
 const notebookCounts=state.recordScope?.notebookCounts??Object.fromEntries(savedBook.notebooks.map(n=>[n.id,0]));if(!state.recordScope)for(const record of savedBook.entries)notebookCounts[record.notebookId]++;
 const result={outline:true,book:{...savedBook,entries:[]},etag:state.etag,recordRevisions:{},notebookCounts,total:state.recordScope?.total??savedBook.entries.length};adoptSnapshot(result);state.book=result.book;
}
function render() {
  runCreation.checkContext();
  recordLocation.checkContext();
  recordRemoval.checkContext();
  if(workspaceOpening)return;
  if(state.page!=='record-reader'||state.access?.locked||state.storageUnavailable)recordContent.clear();
  bookReferences.checkContext();
  if(state.access?.locked){userProfile.release();activity.hide();}
  workspaceLive.bind();
  if(state.page!=='workspaces')storageControls.workspaces.bind();
  releaseCompleteWorkspace();structureUI.bind();recordDetails.sync();branding.sync();if(!['editor','record-reader'].includes(state.page)||state.access?.locked||state.storageUnavailable||state.newWorkspace){recordActivity.stop();workflow.stop();}
  if((state.workspaceOutline||state.recordScope&&state.page!=='editor')&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace&&!outlineViewSupported()){
    void ensureCompleteWorkspace().then(render).catch(report);return;
  }
  migration.bind();attempts.bind();reviews.release();migrationProvenance.release();
  if(state.page!=='appearance'||state.access?.locked||state.storageUnavailable||state.newWorkspace)designPreview.stop();
  if(state.page!=='entries'||state.access?.locked||state.newWorkspace)recordList.stop();
  figures.release();
  documents.release();
  previewSurfaces.forEach(surface=>surface.destroy());previewSurfaces=[];
  document.documentElement.dataset.appMode=state.access?.locked||state.storageUnavailable&&!state.newWorkspace?'access':!state.book||state.newWorkspace?'setup':'workspace';
  designUI.applyToApp();
  if(document.documentElement.dataset.appMode!=='workspace')shellMenu.apply(null);
  if(state.access?.locked){recordWriting.locked();recordValues.locked();dashboard.releaseData();recordList.stop({clear:true});fontLibrary.clear();recordSelectionLoading.close();recordUpdatesLoading.close();recordRecovery.close();recordDrafts.close();$('#dialog').close();$('#notice').hidden=true;renderAccess(storageControls.lockView());return;}
  if(state.page==='workspaces'&&!state.newWorkspace&&(state.storageUnavailable||!state.book)){renderAccess(storageControls.workspaces.view({standalone:true}));storageControls.workspaces.bind();syncRoute();return;}
  if(state.storageUnavailable&&!state.newWorkspace){renderAccess(storageControls.unavailable());return;}
  if (!state.book || state.newWorkspace) { renderOnboarding(); drafts.track(); return; }
  accessHelp.close();appShell.showWorkspace(renderPage);structureUI.projectStorage.bind();projectDirectoryUI.bind();labBookDirectoryUI.bind();bookAccessSettings.bind();bookStorage.bind();structureUI.projectCreation.bind();structureUI.projectMoves.bind();structureUI.projectOpening.bind();structureUI.projectDeletion.bind();
  workspaceLive.bind();
  fontLibrary.decorate();drafts.track();shellMenu.apply(state.page);updateSaveStatus();dashboard.bind();operationsLive.bind();sites.bind();website.bind();modules.bind();connectedWork.bind();documents.bind();figures.bind();mediaImports.bind();branding.bind();
  previewSurfaces=[...document.querySelectorAll('#design-preview,iframe[title="Publication preview"]')].map(frame=>previewSurface(frame));
  const reviewFrame=document.querySelector('iframe[title="Publication preview"]');
  reviewFrame?.addEventListener('load',()=>{try{const prefix=publicationPreviewUrl(state,state.preview.id),url=new URL(reviewFrame.contentWindow.location.href),path=url.pathname.slice(prefix.length);if(url.origin===location.origin&&url.pathname.startsWith(prefix)&&state.preview.pages.some(p=>p.path===path)){state.preview.currentPage=path;state.preview.url=url.pathname;$('#preview-page').value=path;$('#full-public-preview').href=url.pathname;}}catch{/* A visitor link may lead outside the reviewed site. */}});
  syncRoute();storageControls.workspaces.bind();activity.bind();recordContent.bind();help.bind();workflow.focusSection();recordSections.bind();workflow.bind();recordList.bind();recordActivity.bind();labUI.bind();decorateRecordLinks(document,state.book);
  userProfile.bind();
  if (state.page === 'appearance') void designPreview.update();
}

function renderGeneralPreferences(){return structureUI.generalPreferences();}

function renderPage(){
 if(state.ownerOperation)return ownerOperation.view();
 const module=moduleForPage(state.page);
 if(module&&!enabledModule(state.dashboardSettings,module.id))return '<section class="panel"><h1>'+esc(module.label)+' is turned off</h1><p>Your data and settings are retained.</p><button class="button" data-action="dashboard-settings">Manage modules</button></section>';
 let content;
 switch(state.page){
 case 'migration':content=migration.view();break;
 case 'module':content=modules.view();break;
 case 'workspace':content=dashboard.view();break;
 case 'preferences':content=languageControls.view()+renderGeneralPreferences();break;
 case 'user-profile':content=userProfile.view();break;
 case 'help':content=languageControls.view()+help.view();break;
 case 'dashboard-settings':content=dashboard.preferences();break;
 case 'workspaces':content=storageControls.workspaces.view();break;
 case 'integrations':content=publishUI.view(true);break;
 case 'storage':content=storageControls.view()+renderMediaPolicy();break;
 case 'project':content=structureUI.projectView();break;
 case 'laboratory':content=labUI.view();break;
 case 'publishing':content=publishUI.view();break;
 case 'branding':content=branding.view();break;
 case 'projects':content=structureUI.overview();break;
 case 'website':content=website.view();break;
 case 'websites':content=sites.view();break;
 case 'record-reader':content=recordContent.view();break;
 case 'editor':content=renderEditor();break;
 case 'appearance':content=renderAppearance();break;
 case 'review':content=renderReview();break;
 default:content=renderEntries();
 }
 if(['entries','editor','record-reader'].includes(state.page))content=structureUI.recordContext()+content;
 if(state.page==='project'||state.page==='entries'&&state.notebook!=='all')content+='<button class="button" data-action="research-copy-context">Copy '+(state.page==='project'?'project':'lab book')+' reference</button>';
 if(['workspace','entries','editor','record-reader'].includes(state.page))content=recordDrafts.banner()+content;
 content=sites.header()+content+sectionActions();if(state.websiteId)return content;if(state.page==='branding'&&(!state.brandReturn||state.brandReturn.startsWith('#/preferences')))return preferencesFrame('appearance',content,state.dashboardSettings);return preferencePage(state.page)?preferencesFrame(state.page,content,state.dashboardSettings):content;
}

function renderEntries() {
  const notebook=state.book.notebooks.find(n=>n.id===state.notebook), project=state.book.projects.find(p=>p.id===state.project);
  return `<div class="page-heading"><div><span class="scope-kicker">${notebook?'Lab book':project?'Project records':'Workspace records'}</span><h1>${esc(notebook?.title??(project?project.title+' / All records':'All records'))}</h1><p class="subtitle">${notebook?`${esc(locationName(projectDirectoryUI.navigation(state.book),project.id))}`:'Search research records across the selected scope.'}</p></div>${notebook?`<div class="inline-actions"><button class="button" data-action="edit-notebook" data-id="${notebook.id}">Lab book settings</button></div>`:''}</div><div class="section-bar record-list-bar"><h2>Records <span id="record-count" class="badge">${recordList.count()}</span></h2><div class="filters"><button class="button" data-action="record-views">${esc(t('recordViews','title'))}</button><input id="search" maxlength="512" class="search-input" type="search" value="${esc(state.search)}" placeholder="Search records..." aria-label="Search records">${recordList.typeFilter()}<button class="button primary" data-action="new-entry">${icon('plus')}New record</button></div></div>${recordList.modes()}${recordBrowseFields(state,structureUI.notebooks.generalRecords(state.project),{esc,field,option,domains:recordList.domains()})}<div id="entry-results" aria-live="polite">${renderEntryResults()}</div>${bookStorage.view()}${bookAccessSettings.view()}`;
}
function renderEntryResults() { return recordList.view(); }

function renderRecordTable(entries,{action='edit-entry'}={}) {
 if(!entries.length)return '<section class="workspace-empty"><h3>No records in this view</h3><p>Open a lab book to add records.</p></section>';
 return `<div class="table-scroll"><table class="records-table"><thead><tr><th>Record</th><th>Type</th><th>Location / lab book</th><th>Date</th><th>Progress / outcome</th><th>Website</th></tr></thead><tbody>${entries.map(e=>{
  const n=state.book.notebooks.find(n=>n.id===e.notebookId);
  if(e.owner){const owner=e.owner,recordLink=researchReference({workspaceId:owner.workspaceId,kind:'record',id:e.id}),bookLink=researchReference({workspaceId:owner.workspaceId,kind:'notebook',id:e.notebookId});return `<tr><td><a class="text-button" href="${esc(recordLink)}">${esc(e.title)}</a></td><td>${esc(e.template?.label??recordLabel(e.type))}</td><td class="record-location">${owner.projectId?`<button class="text-button" data-action="open-project" data-id="${owner.projectId}">${esc(owner.projectTitle)}</button>`:esc(owner.projectTitle)}<a class="text-button" href="${esc(bookLink)}">${esc(owner.notebookTitle)}</a></td><td>${esc(recordDateLabel(e.occurredOn))}</td><td>${esc(titleCase(e.status))}${e.outcome?'<small class="record-outcome">'+esc(e.outcome)+'</small>':''}</td><td>${e.share?'Included':'Private'}</td></tr>`;}
  return `<tr><td><button class="text-button" data-action="${action}" data-id="${e.id}">${esc(e.title)}</button></td><td>${esc(e.template?.label??recordLabel(e.type))}</td><td class="record-location"><button class="text-button" data-action="open-project" data-id="${n?.projectId}">${esc(locationName(projectDirectoryUI.navigation(state.book),n?.projectId))}</button><button class="text-button" data-action="filter-notebook" data-id="${n?.id}">${esc(n?.title)}</button></td><td>${esc(recordDateLabel(e.occurredOn))}</td><td>${esc(titleCase(e.status))}${e.outcome?'<small class="record-outcome">'+esc(e.outcome)+'</small>':''}</td><td>${e.share?'Included':'Private'}</td></tr>`;
 }).join('')}</tbody></table></div>`;
}

function renderEditor() {
  const e=entry();
  if(!e){state.page='entries';return renderEntries();}
  if(state.recordReading)return `<div class="record-toolbar"><button class="button" data-action="back-to-records">Back to records</button><button class="button" data-action="record-edit">Edit record</button>${bookReferences.button()}${recordHistory.button()}${reviews.button()}${migrationProvenance.button()}${recordStarters.button()}</div>
   <article class="record-reader"><h1>${esc(e.title)}</h1>${recordActivity.view({readonly:true})}${workflow.view({readonly:true})}${recordRevisionView(e,esc,{assetUrl:id=>ownedAssetURL(state,'/api/media/'+id),relations:false,anchors:true,sectionsHtml:figure=>recordSections.view(e,{readonly:true,figure}),attemptReference:attempts.reference,resultReference:results.reference})}${materials.view()}${recordDetails.relations(e,{readonly:true})}</article>`;
  const notebook=state.book.notebooks.find(n=>n.id===e.notebookId);
  const notebookOptions=state.book.projects.map(project=>`<optgroup label="Project: ${esc(project.title)}">${state.book.notebooks.filter(n=>n.projectId===project.id).map(n=>option(n.id,n.title,e.notebookId)).join('')}</optgroup>`).join('');
  return `<div class="record-toolbar"><button class="button subtle back-button" data-action="back-to-records">${icon('arrow')}Back to records</button><button class="button" data-action="record-read">Read record</button>${bookReferences.button()}${recordHistory.button()}${reviews.button()}${migrationProvenance.button()}${recordStarters.button()}</div>
    <div class="editor-layout"><section class="editor-paper" aria-label="Entry editor">
      ${field('Record title',`<textarea rows="1" class="title-input" data-entry="title" maxlength="180" placeholder="Give this record a name">${esc(e.title)}</textarea>`)}
      ${documents.field({key:e.id+':body',label:'Summary / context',value:e.body,set:value=>{editableRecord(state.book,e.id).body=value;dirtyRecord(e.id);}})}
      ${field('Tags <small>Separated by commas</small>',`<input data-entry="tags" value="${esc(e.tags.join(', '))}" placeholder="e.g. garden, first attempt">`)}
      ${recordActivity.view()}${workflow.view()}${attempts.view()}<div data-result-statements>${results.view()}</div>${recordFields(e,{field,option,esc})}${renderSections(e)}${renderMedia(e)}${figures.view()}${materials.view()}
      ${recordDetails.contributors(e)}${recordDetails.relations(e)}${connectedWork.view()}
    </section><aside class="editor-side"><section class="panel"><h3>About this record</h3>
      ${e.template?'<p class="scope-kicker">'+esc(e.template.label)+'</p>':field('Record type',`<select data-entry="type">${types.map(t=>option(t,recordLabel(t),e.type)).join('')}</select>`)}
      ${field('Progress',`<select data-entry="status">${[...LIFECYCLE_STATUSES,...(LIFECYCLE_STATUSES.includes(e.status)?[]:[e.status])].map(status=>option(status,titleCase(status)+(LIFECYCLE_STATUSES.includes(status)?'':' (legacy status)'),e.status)).join('')}</select>`)}
      ${field('Outcome <small>Optional</small>',`<input data-entry="outcome" maxlength="500" value="${esc(e.outcome??'')}" list="record-outcomes" placeholder="Describe the result in your own words"><datalist id="record-outcomes">${OUTCOME_SUGGESTIONS.map(v=>`<option value="${esc(v)}"></option>`).join('')}</datalist>`)}
      <p class="muted">Progress and outcome are separate. A completed run can have negative or inconclusive results.</p>
      ${recordDateFields(e.occurredOn,{field,option,esc})}
      ${field('Lab book',`<select data-entry="notebookId">${notebook?'':option(e.notebookId,'Choose a lab book (previous lab book removed)',e.notebookId)}${notebookOptions}</select>`)}
      <p class="muted">Location: ${esc(locationName(projectDirectoryUI.navigation(state.book),notebook?.projectId))}</p>
    </section><section class="panel"><h3>Sharing</h3><label class="checkbox"><input type="checkbox" data-entry="share" ${e.share?'checked':''}><span>Include in website<small>${esc(t('attempts','sharing'))}</small></span></label></section>
    <section class="panel danger-zone"><button class="button danger full-width" data-action="delete-entry">${icon('trash')}${esc(t('recordAuthoring','remove'))}</button></section></aside></div>`;
}



function renderAppearance() { return designUI.view(); }
function restoreEditorScroll(){
  const frame=$('#website-draft-preview'),top=state.editorReturnScroll??0;let restored=false;
  const restore=()=>{const doc=frame?.contentDocument;if(restored||!frame?.isConnected||!doc?.querySelector('main'))return;restored=true;doc.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{if(frame.isConnected&&state.page==='website')window.scrollTo(0,top);})));};
  frame?.addEventListener('load',restore,{once:true});restore();
}
function showReview(preview){
 const path=state.page==='website'?website.currentPath():null;preview.returnTo=state.page==='website'?'website':'publishing';preview.currentPage=preview.pages.some(p=>p.path===path)?path:preview.pages[0]?.path;preview.url=publicationPreviewUrl(state,preview.id,preview.currentPage);state.preview=preview;state.page='review';render();window.scrollTo(0,0);
}
function renderReview() {
  return state.preview?publicationReviewView(state.preview,{esc,field,option,icon}):publishUI.view();
}

function addEntry(type, notebookId,section=null,subject=null) {
  const local = new Date(), now = local.toISOString();
  const occurredOn = [local.getFullYear(), String(local.getMonth() + 1).padStart(2, '0'), String(local.getDate()).padStart(2, '0')].join('-');
  const template = RECORD_TYPES.find(item => item.id === type);
  if (!template || !state.book.notebooks.some(n => n.id === notebookId)) return;
  const e = { id: crypto.randomUUID(), notebookId, type, title: t('recordAuthoring','untitled',{type:(section?.label??template.label).toLowerCase()}), body: '', contributors: [], relations: [], tags: [], occurredOn, createdAt: now, updatedAt: now, share: false, figures: [], status: 'draft', sections: template.sections.map(title => ({ id: crypto.randomUUID(), title, body: '' })), attachments: [] };
  if(section)e.template=templateFrom(section);
  if(subject){documentRecord(state.book.id,e,subject);e.title=t('recordAuthoring','subjectTitle',{type:section?.label??template.label,subject:subject.title,date:occurredOn}).slice(0,180);}
  openCreatedRecord(e);
}
function openCreatedRecord(e){
  const notebookId=e.notebookId;
  if(supportsRecordSelection()){
    const scoped=recordCreationBase({book:savedBook,etag:state.etag,recordRevisions:savedRecordRevisions,recordScope:state.recordScope,outline:Boolean(state.workspaceOutline),...state.workspaceOutline},e.id);
    adoptSnapshot(scoped);state.book=scoped.book;
  }
  state.recordReturn = {bookReading:!!state.bookReading,page:['editor','record-reader'].includes(state.page)?'entries':state.page,project:state.project,notebook:state.notebook,search:state.search,filter:state.filter,recordBrowse:recordBrowse(state.recordBrowse),filterWorkspaceId:state.book.id}; state.book.entries.push(e); state.notebook=notebookId; state.project=state.book.notebooks.find(n=>n.id===notebookId).projectId; state.selected = e.id; state.page = 'editor'; state.recordReading=false;state.recordSection=null; dirty(); render();
  $('[data-entry=title]').focus(); $('[data-entry=title]').select();
}

const structureActions=new Set(['new-project','edit-project','edit-project-template','project-template-command','new-notebook','edit-notebook','rename-notebook','configure-lab-notebook','specialize-notebook','notebook-config-command','lab-book-delete','lab-book-delete-cancel','workspace-reorganize','location-counts-retry']);
const recordCreationActions=new Set(['new-entry','choose-notebook','choose-template','choose-type']);
const scopedRecordAction=name=>name?.startsWith('starter-')||name?.startsWith('record-content-')||name?.startsWith('result-')||name?.startsWith('attempt-')||name?.startsWith('workflow-')||name?.startsWith('material-')||name?.startsWith('media-import-')||recordCreationActions.has(name)||name==='delete-entry'||name==='save'||name==='discard-section'||name==='back-to-records'||name==='record-read'||name==='record-edit'||name==='record-section-jump'||name==='record-copy-reference'||name==='record-workflow-link'||name?.startsWith('record-link-')||name?.startsWith('research-target-')||name==='record-backlink-open'||name?.startsWith('record-history-')||name?.startsWith('record-activity-')||name?.startsWith('record-contributor-')||name?.startsWith('section-')||name?.startsWith('figure-')||name==='remove-media';
async function rawAction(button) {
  if(state.websiteId&&button.closest?.('#main-navigation')&&['website','publishing','integrations'].includes(button.dataset.action))await sites.exit();
  try{await projectOwners.beforeAction(button);}catch(error){
   if(error.code==='STORAGE_RENAMING'&&error.requestedOwner?.projectId){const owner=error.requestedOwner,route=ownedRoute(owner.labBookId?'#/notebooks/'+owner.labBookId:'#/projects/'+owner.projectId,owner);history.pushState({observandaIndex:++routeIndex},'',route);if(ownerOperation.show(error,owner,route))return;}throw error;
  }
  if(navigationActions.has(button.dataset.action))ownerOperation.clear();
  if(help.action(button))return;
  const name = button.dataset.action;
  if(name==='laboratory-open-owned'){
    const {workspaceId,projectId,labBookId,kind,id}=button.dataset;
    if(!researchId(workspaceId)||projectId&&!researchId(projectId)||labBookId&&(!projectId||!researchId(labBookId))||!['sample','analysis','event'].includes(kind)||!researchId(id))throw {code:'INVALID'};
    await projectOwners.enter(projectId||null,labBookId||null);if(state.book.id!==workspaceId)throw {code:'WORKSPACE_CHANGED'};
    await labUI.action({dataset:{action:'laboratory-samples'}});
    if(kind!=='event')await labUI.action({dataset:{action:kind==='sample'?'lab-sample':'lab-open',id}});return;
  }
  if(name==='module-open-owned'){
    const {workspaceId,projectId,labBookId,moduleId,modulePath}=button.dataset;
    if(!researchId(workspaceId)||projectId&&!researchId(projectId)||labBookId&&(!projectId||!researchId(labBookId))||!['planning','resources'].includes(moduleId)||typeof modulePath!=='string')throw {code:'INVALID'};
    await projectOwners.enter(projectId||null,labBookId||null);if(state.book.id!==workspaceId)throw {code:'WORKSPACE_CHANGED'};
    return modules.action({dataset:{action:'module-open',moduleId,modulePath}});
  }
  if(name==='research-open-owned'){const target={workspaceId:button.dataset.workspaceId,kind:button.dataset.kind??'record',id:button.dataset.id};if(!validTarget(target))throw {code:'INVALID'};return navigateResearch(target);}
  if(name?.startsWith('project-deletion-'))return structureUI.projectDeletion.action(button);
  if(await structureUI.projectMoves.action(button))return;
  if(name==='project-open-folder'||name?.startsWith('project-opening-'))return structureUI.projectOpening.action(button);
  if(name?.startsWith('project-creation-'))return structureUI.projectCreation.action(button);
  if(await recordDestination.action(button))return;
  if(await structureUI.projectStorage.choiceAction(button))return;
  if(await bookStorage.choiceAction(button))return;
  if(name?.startsWith('lab-book-storage-'))return bookStorage.action(button);
  if(name==='lab-book-access-lock')return bookAccessSettings.action(button);
  if(name?.startsWith('lab-book-directory-'))return labBookDirectoryUI.action(button);
  if(name?.startsWith('project-directory-'))return projectDirectoryUI.action(button);
  if(name?.startsWith('project-storage-'))return structureUI.projectStorage.action(button);
  if(['workflow-new-run','material-repeat'].includes(name)&&state.storage?.researchStorage==='catalogue'&&state.storage.researchFormatVersion===21){await runCreation.open(state.selected);return;}
  if(await recordContent.action(button))return;
  if(button.dataset.action==='record-value-edit')return recordValues.open({recordId:state.selected,field:button.dataset.valueField??document.querySelector('[data-record-detail-field]').value});
  if(button.dataset.action==='record-value-add-contributor')return recordValues.open({recordId:state.selected,field:'contributor:'+crypto.randomUUID()});
  if(button.dataset.action==='record-value-add-relation')return recordValues.open({recordId:state.selected,field:'relation:'+crypto.randomUUID()});
  if(button.dataset.action==='record-value-add-figure')return recordValues.open({recordId:state.selected,field:'figure:'+crypto.randomUUID(),create:button.dataset.kind==='panels'?'panels':'plot'});
  if(button.dataset.action==='record-value-add-attempt')return recordValues.open({recordId:state.selected,field:'attempt:'+button.dataset.kind+':'+crypto.randomUUID(),prior:button.dataset.prior});
  if(button.dataset.action==='record-value-add-result')return recordValues.open({recordId:state.selected,field:'result:'+crypto.randomUUID()});
  if(button.dataset.action==='writing-edit')return recordWriting.open({recordId:state.selected,sectionId:button.dataset.section??null});
  if(state.page==='record-reader'){
   if(name==='record-location-open'){recordLocation.open();return;}
   if(name?.startsWith('workflow-')){await workflow.action(button);return;}
   if(name==='record-removal-open'){if(uploading||figures.isBusy()||materials.isBusy())return notify(t('recordAuthoring','operationBusy'),true);recordRemoval.open();return;}
   if(name?.startsWith('record-activity-')&&name!=='record-activity-subjects'){await recordActivity.action(button);return;}
   if(name?.startsWith('migration-provenance-')){await migrationProvenance.action(button);return;}
   if(name?.startsWith('review-')){await reviews.action(button);return;}
   if(name==='record-content-reference'){await bookReferences.action(button);return;}
   if(name==='record-copy-reference'){await recordDetails.action(button);return;}
   if(name?.startsWith('media-import-')){await mediaImports.action(button);return;}
   if(name?.startsWith('record-history-')){await recordHistory.action(button);return;}
   // Inspect the pinned reference directly from the reading projection. Its
   // dialog navigation must not hydrate an editable copy of the whole record.
   if(name==='attempt-open-ref'){await attempts.action(button);return;}
   if(name==='result-reference'){await results.action(button);return;}
   if(name?.startsWith('material-')&&name!=='material-repeat'){await materials.action(button);return;}
  }
  if(state.page==='record-reader'&&name==='record-link-open'){const link=recordContent.current()?.relations.find(link=>link.id===button.dataset.id);if(link)await navigateResearch(link.target);return;}
  if(supportsRecordSelection()&&['browse-record','record-read-linked','record-read','record-edit','edit-entry','open-issue'].includes(name)){
   const id=button.dataset.id??state.selected,unsaved=state.page==='editor'&&state.book.entries.some(record=>record.id===id)&&!savedRecordRevisions[id];
   if(!unsaved){if(state.websiteId)await sites.exit();$('#dialog').close();return openRecordReading(id,null,['browse-record','record-read-linked','record-read'].includes(name)||name==='edit-entry'&&button.dataset.reading==='true');}
  }
  if(name==='user-profile'||name?.startsWith('user-profile-')){
    if(state.websiteId)await sites.exit();
    if(await userProfile.action(button))return;
  }
  if(name==='workspace-refresh'){await workspaceLive.check({manual:true});return;}
  if(state.websiteId&&navigationActions.has(name)&&!['website','publishing','integrations','preview','branding','branding-back','publication-jobs-open-review'].includes(name))await sites.exit();
  const readingAction=state.page==='record-reader'&&name==='back-to-records';
  const brandingAction=name==='branding'||state.page==='branding'&&(['branding-back','save','discard-section'].includes(name)||['brand-','research-target-','media-import-'].some(prefix=>name?.startsWith(prefix)));
  const appearanceAction=name==='appearance'||name?.startsWith('interface-')||state.page==='appearance'&&(['save','discard-section'].includes(name)||name?.startsWith('theme-'));
  const outlineModuleAction=name==='laboratory-samples'||state.page==='laboratory'&&name?.startsWith('lab-')||name?.startsWith('review-')||name==='module-open'&&modules.supportsOutline(button.dataset.moduleId)||state.page==='module'&&modules.supportsOutline(state.moduleId)&&(name==='module-command'||['module-reference-','module-choice-','research-target-'].some(prefix=>name?.startsWith(prefix)));
  const publicationAction=['publishing','integrations','preview','export','website','analysis-review-save'].includes(name)||state.page==='website'&&(['save','discard-section','include-project-entries','delete-page','branding'].includes(name)||name?.startsWith('website-')||name?.startsWith('media-import-')||name?.startsWith('menu-'))||name?.startsWith('publish-')||name?.startsWith('publication-jobs-')||name?.startsWith('local-export-')||state.page==='review'&&name?.startsWith('storage-browse');
  const administrationAction=name==='storage'||name==='activity-show'||['storage-','security-','migration-','inventory-'].some(prefix=>name?.startsWith(prefix));
  if((state.workspaceOutline||state.recordScope&&!scopedRecordAction(name))&&!readingAction&&!administrationAction&&!brandingAction&&!appearanceAction&&!publicationAction&&!name?.startsWith('edition-')&&!outlineModuleAction&&!recordCreationActions.has(name)&&!structureActions.has(name)&&!state.access?.locked&&!state.storageUnavailable&&!state.newWorkspace&&!['browse-record','edit-entry','open-issue','record-read-linked','storage-lock','workspace','entries','projects','open-project','project-records','project-recent-retry','project-recent-collection-retry','research-copy-context','filter-notebook','clear-record-filters','close-dialog','preferences','workspace-discard'].includes(name)&&!(state.page==='entries'&&name?.startsWith('record-type-'))&&!name?.startsWith('record-list-')&&!name?.startsWith('record-view')&&!name?.startsWith('starter-')&&!name?.startsWith('dashboard-')&&!name?.startsWith('module-settings-')){const route=location.hash;await ensureCompleteWorkspace();if(location.hash!==route){await restoreRoute();return;}}
  const module=moduleForPage(name);
  if(module&&!enabledModule(state.dashboardSettings,module.id)){notify('Enable '+module.label+' in Preferences > Modules & dashboard.');return;}
  if(name==='website'||name==='preview'&&state.page==='website')await website.ready();

  if(name==='preferences'){state.page='preferences';render();return;}
  if(await branding.action(button))return;
  if(await editionSelection.action(button))return;
  if(name==='storage')return storageControls.action(button);
  if(name==='integrations'){if(!state.publishing?.dirty)await publishUI.load();state.page='integrations';render();return;}
  if(await structureUI.notebooks.action(button))return;
  if(name==='module-open'&&moduleDestination(button.dataset.moduleId)){state.page=moduleDestination(button.dataset.moduleId);state.project=null;state.notebook='all';render();return;}
  if(name==='module-open')document.querySelector('#dialog').close();
  if(await recordStarters.action(button)||await bookReferences.action(button)||await results.action(button)||await attempts.action(button)||await migrationProvenance.action(button)||await localExport.action(button)||await migration.action(button)||await reviews.action(button)||await publicationJobs.action(button)||await mediaImports.action(button)||await recordList.action(button)||await recordViews.action(button)||await recordActivity.action(button)||await workflow.action(button)||await recordHistory.action(button)||await materials.action(button)||await figures.action(button)||await modules.action(button)||await recordDetails.action(button)||await dashboard.action(button)||await website.action(button))return;
  if (await setupControls.action(button) || await textControls.action(button) || await storageControls.action(button) || await structureUI.action(button) || await designUI.action(button) || await labUI.action(button) || await publishUI.action(button) || await extendedAction(button)) return;
  if (name === 'close-dialog') { recordDestination.reset();structureUI.notebooks.close();state.pendingResearchLink=null; $('#dialog').close(); return; }
  if (name === 'discard-section') { await discardPending(); return; }
  if (name === 'save') { button.disabled = true; try { const complete=await savePending('all',undefined,{requireClean:state.page!=='editor'}); if(state.page==='website')website.saved(); notify(complete?'Changes saved.':t('recordSaveProgress','newerEdits')); } finally { updateSaveStatus(); } return; }
  if(name==='clear-record-filters'){state.search='';state.filter='all';state.recordBrowse=null;rememberFilters();render();$('#search')?.focus();return;}
  if (name === 'entries') { state.search='';state.filter='all';state.recordBrowse=null;state.page = 'entries'; state.project = null; state.notebook = 'all'; render(); }
  if (name === 'projects' || name === 'website') { $('#dialog').close(); const returning=state.page==='review'&&name==='website';state.page = name; state.project = null; state.notebook = 'all'; render();if(returning)restoreEditorScroll(); }
  if (name === 'open-project') { state.project = button.dataset.id; state.notebook = 'all'; state.page = 'entries'; render(); }
  if (name === 'filter-notebook') {
    state.bookReading=false;state.notebook = button.dataset.id; state.project = state.book.notebooks.find(n => n.id === state.notebook)?.projectId; state.search = ''; state.filter = 'all';state.recordBrowse=null; state.page = 'entries'; render(); }
  if (name === 'new-entry') { chooseEntry(button.dataset.notebook); }
  if(name==='choose-notebook'){$('#dialog').close();chooseEntry(button.dataset.id);return;}
  if(name==='choose-template'){const n=state.book.notebooks.find(n=>n.id===button.dataset.notebook),section=availableSections(configurationOf(n)).find(s=>s.id===button.dataset.id);if(section){$('#dialog').close();addEntry('note',n.id,section);}return;}
  if (name === 'choose-type') { const notebookId = $('#entry-notebook').value; $('#dialog').close(); addEntry(button.dataset.type, notebookId); }
  if(name==='record-read'||name==='record-edit'){state.recordReading=name==='record-read';state.recordSection=null;render();return;}
  if(name==='record-section-jump'){state.recordSection=button.dataset.id;render();return;}
  if(name==='record-read-linked'){if(supportsRecordSelection()&&!await selectRecord(button.dataset.id))return;const target=state.book.entries.find(e=>e.id===button.dataset.id);if(target){state.selected=target.id;state.runSeries=button.dataset.runSeries==='true'?target.id:null;const n=state.book.notebooks.find(n=>n.id===target.notebookId);state.notebook=n.id;state.project=n.projectId;state.recordReading=true;state.recordSection=null;render();window.scrollTo(0,0);}return;}
  if(name==='browse-record'){
    if(supportsRecordSelection()){button.disabled=true;try{if(!await selectRecord(button.dataset.id))return;}finally{button.disabled=false;}return rawAction({dataset:{action:'edit-entry',id:button.dataset.id,reading:'true'}});}
    const request=++recordOpenRequest,etag=state.etag,route=location.hash;button.disabled=true;
    try{
      const result=await api('/api/research/records/open',{workspaceId:state.book.id,recordId:button.dataset.id,baseEtag:etag},{adopt:false});
      if(request!==recordOpenRequest||state.page!=='entries'||location.hash!==route||state.etag!==etag||state.dirty)return;
      adoptSnapshot(result);state.book=result.book;state.etag=result.etag;
    }finally{button.disabled=false;}
    return rawAction({dataset:{action:'edit-entry',id:button.dataset.id,reading:'true'}});
  }
  if (name === 'edit-entry' || name === 'open-issue') { if(supportsRecordSelection()&&(!state.recordScope||!state.book.entries.some(e=>e.id===button.dataset.id))&&!await selectRecord(button.dataset.id))return;$('#dialog').close(); if (state.book.entries.some(e => e.id === button.dataset.id)) { state.recordReturn = {bookReading:!!state.bookReading,page:state.page,project:state.project,notebook:state.notebook,search:state.search,filter:state.filter,recordBrowse:recordBrowse(state.recordBrowse),filterWorkspaceId:state.book.id}; state.selected = button.dataset.id; state.recordReading=button.dataset.reading==='true';state.recordSection=null; const n=state.book.notebooks.find(n=>n.id===entry().notebookId); state.project=n.projectId; state.notebook=n.id; state.page = 'editor'; render(); } else { state.page = 'website'; render(); } }
  if (name === 'back-to-records') { if(state.recordReturn){const {owner,...origin}=state.recordReturn;if(owner!==undefined)await projectOwners.enter(owner?.projectId??null,owner?.labBookId??null);Object.assign(state,origin);}else{state.page='entries';state.search='';state.filter='all';state.recordBrowse=null;} render(); }
  if (name === 'appearance') { state.page = 'appearance'; render(); }

  if (name === 'delete-entry') {
    if(uploading||figures.isBusy()||materials.isBusy())return notify(t('recordAuthoring','operationBusy'),true);
    if (!confirm(t('recordAuthoring','confirmRemove'))) return;
    if(supportsRecordSelection())return removeSelectedRecord();
    const previous=draftWorkspace(state.book);
    try{state.book.entries=state.book.entries.filter(e=>e.id!==state.selected);state.book.branding=state.book.branding.filter(b=>b.target!=='entry:'+state.selected);state.book.website.layouts=state.book.website.layouts.filter(l=>l.target!=='entry:'+state.selected);dirty();await save();}
    catch(error){state.book=previous;dirty();throw error;}
    state.selected=null;state.page='entries';render();
  }
  if (name === 'preview') {
    if(state.page!=='website'){
      button.disabled=true;
      try{
        const command={workspaceId:state.book.id,etag:state.etag},context=state.storage.contextId,route=location.hash;
        await editionSelection.open(command,async selected=>{
          if(state.storage.encrypted)await publicationJobs.start(selected);
          else{const preview=await api('/api/preview',selected,{adopt:false});if(context===state.storage?.contextId&&route===location.hash)showReview(preview);}
        });
      }finally{button.disabled=false;}
      return;
    }
    if(!website.summary().canPublish){if(state.page!=='website'){state.page='website';render();}website.focusEmpty();return;}
    if (uploading) return notify(publicationText('waitForMedia'), true);
    designPreview.stop();
    button.disabled = true;
    try {
      website.validate();
      const revision=changeVersion,book=draftWorkspace(state.book);state.editorReturnScroll=window.scrollY;
      const command=state.workspaceOutline?workspaceSaveRequest(savedBook,book,savedRecordRevisions):null;
      const source=command?{etag:state.etag,draft:{...command,baseEtag:state.etag,...(websiteSelection.isDirty()?{selection:websiteSelection.snapshot()}: {})}}:{etag:state.etag,book};
      const context=state.storage?.contextId,route=location.hash;
      await editionSelection.open(source,async selected=>{
        if(state.storage.encrypted){await publicationJobs.start(selected);return;}
        const preview=await api('/api/preview',selected);
        if(context!==state.storage?.contextId||route!==location.hash)return;
        if(revision!==changeVersion){notify(publicationText('draftChanged'),true);return;}
        showReview(preview);
      });
    } finally { button.disabled=false; }
  }
  if (name === 'export') {
    requireAnalysisEditionReview(state.preview);
    if (!$('#review-confirm').checked) return notify(publicationText('confirmRequired'), true);
    button.disabled = true;
    try { const a=document.createElement('a');a.href=projectApiRoute('/api/export/'+state.preview.id,researchOwner(state))+(state.preview.rollback?'?rollbackReview='+state.preview.rollback.id:'');a.download='observanda-site.zip';a.click(); } finally { button.disabled = false; }
  }
  if(name==='analysis-review-save'){button.disabled=true;try{await saveAnalysisEditionReview(state,api);render();}finally{if(button.isConnected)button.disabled=false;}}

}

document.addEventListener('click', event => {
  const href=event.target.closest('.record-reader a[href], .lab-book-reading a[href], .records-table a[href]')?.getAttribute('href'),target=href&&parseResearchReference(href);
  if(target){event.preventDefault();leave.run(()=>navigateResearch(target)).catch(report);return;}
  if(href?.startsWith('#')&&!href.startsWith('#/')){
    event.preventDefault();const anchor=document.getElementById(href.slice(1));
    if(anchor){anchor.setAttribute('tabindex','-1');anchor.focus();anchor.scrollIntoView({block:'start'});}else notify(t('book','unavailable'),true);return;
  }
  const button = event.target.closest('[data-action]');
  if (button) { event.preventDefault(); const previous = `${state.page}/${state.project}/${state.notebook}`; action(button).then(() => { if (`${state.page}/${state.project}/${state.notebook}` !== previous) window.scrollTo(0,0); }).catch(report); }
});
document.addEventListener('input', event => {
  if(recordDestination.input(event.target))return;
  if(bookStorage.input(event.target))return;
  if(editionSelection.input(event.target)||localExport.input(event.target)||languageControls.input(event.target)||help.input(event.target))return;
  if(event.target.id==='preferences-section'){const next=event.target.value;event.target.value=state.page;action({dataset:{action:next}}).catch(report);return;}
  if(structureUI.projectStorage.input(event.target))return;
  if(structureUI.notebooks.input(event.target))return;
  if(updateRecordDate(event.target,entry(),{field,option,esc})){dirtyRecord();return;}
  if(updateRecordField(event.target,entry())){dirtyRecord();return;}
  if(sites.input(event.target)||migration.input(event.target)||reviews.input(event.target)||figures.input(event.target)||modules.input(event.target)||recordDetails.input(event.target)||recordActivity.input(event.target)||dashboard.input(event.target)||website.input(event.target))return;
  if(storageControls.input(event.target))return;
  if(userProfile.input(event.target))return;
  const el = event.target;
  if(el.closest('main #workspace-name-form')){
    const form=el.form,changed=drafts.changed('all').includes(form);
    for(const button of form.querySelectorAll('button'))button.disabled=!changed;
    form.querySelector('[data-workspace-status]').textContent=changed?'Unsaved changes':'Saved';
  }
  if(branding.input(el)||recordList.input(el))return;
  if(['storagePath','storageParent'].includes(el.name)||el.name==='title'&&el.closest('#create-form')){const result=el.closest('form')?.querySelector('.storage-check-result');if(result)result.textContent='';}
  if (setupControls.input(el) || textControls.input(el) || identityInput(el) || designUI.input(el) || publishUI.input(el) || extendedInput(el)) return;
  if(labUI.input(el))return;
  if(el.dataset.recordBrowse){state.recordBrowse={...recordBrowse(state.recordBrowse),[el.dataset.recordBrowse]:el.value};refreshRecordResults();return;}
  if (el.id === 'search') { state.search = el.value;refreshRecordResults();return; }
  if (el.dataset.entry) {
    const record=entry(),previousNotebook=record.notebookId;
    record[el.dataset.entry] = el.type === 'checkbox' ? el.checked : el.dataset.entry === 'tags' ? el.value.split(',').map(t => t.trim()).filter(Boolean) : el.value;
    if(el.dataset.entry==='notebookId'&&previousNotebook!==record.notebookId){
      record.share=false;state.notebook=record.notebookId;
      state.project=state.book.notebooks.find(n=>n.id===record.notebookId)?.projectId??null;
      dirtyRecord();render();$('[data-entry="notebookId"]')?.focus({preventScroll:true});
    }else dirtyRecord();
  }
  if (el.dataset.book) { state.book[el.dataset.book] = el.value; dirty(); }

});
document.addEventListener('change', event => { if (event.target.id === 'type-filter') { state.filter = event.target.value;refreshRecordResults(); } });
async function submitForm(form){
  if(form.id==='lab-book-storage-form')return bookStorage.submit(form);
  if(form.id==='lab-book-access-form')return bookAccessSettings.submit(form);
  if(form.id==='user-profile-form'){await userProfile.save();return;}
  if(await recordStarters.submit(form))return;
  if(await attempts.submit(form))return;
  if(await localExport.submit(form,new FormData(form)))return;
  if(form.id==='inventory-form'||form.id.startsWith('migration-import-'))return migration.submit(form);
  if(form.id.startsWith('review-'))return reviews.submit(form);
  if(form.dataset.busy)return;
  if(form.id==='website-site-form')return sites.submit(form,new FormData(form));
  if(['project-deletion-form','project-deletion-resume-form'].includes(form.id))return structureUI.projectDeletion.submit(form);
  if(await structureUI.projectMoves.submit(form))return;
  if(form.id==='project-opening-form')return structureUI.projectOpening.submit(form);
  if(form.hasAttribute('data-book-creation-resume')||form.hasAttribute('data-book-import-form'))return labBookDirectoryUI.submit(form);
  if(form.id==='project-creation-resume-form')return structureUI.projectCreation.submit(form);
  if(['project-storage-form','project-storage-access-form','project-placement-form'].includes(form.id))return structureUI.projectStorage.submit(form);
  if(['structure-project-form','project-template-form'].includes(form.id))return structureUI.notebooks.submit(form,new FormData(form));
  if(['record-view-form','record-view-remove-form'].includes(form.id)){form.dataset.busy='true';form.setAttribute('aria-busy','true');try{await recordViews.submit(form,new FormData(form));}finally{delete form.dataset.busy;form.removeAttribute('aria-busy');}return;}
  if(form.id==='create-form'&&!setupControls.prepare())return;
  const data=new FormData(form),beforeBook=draftWorkspace(state.book),beforeEtag=state.etag,locationBefore={page:state.page,project:state.project,notebook:state.notebook,selected:state.selected};
  form.dataset.busy='true';form.setAttribute('aria-busy','true');
  try {
    if(await modules.submit(form,data)||await structureUI.notebooks.submit(form,data))return;
    if(form.id==='media-policy-form'){const policy={};for(const [key,,unit] of mediaPolicyFields)policy[key]=Math.round(Number(data.get(key))*unit);state.mediaPolicy=await api('/api/media-policy',{policy,etag:state.mediaPolicy.etag});render();notify('Media limits saved.');return;}
    if(form.id.startsWith('storage-')||form.id.startsWith('security-')){form.dataset.busy='true';form.setAttribute('aria-busy','true');const submit=form.querySelector('button[type="submit"]'),label=submit?.textContent,busyLabel=t('access',form.id==='storage-copy-form'?'copyProgress':form.id==='storage-move-form'?'moveProgress':'workingProgress');if(submit){submit.disabled=true;submit.textContent=busyLabel;}try{await storageControls.submit(form,data);return;}finally{delete form.dataset.busy;form.removeAttribute('aria-busy');if(submit){submit.disabled=false;if(submit.textContent===busyLabel)submit.textContent=label;}}}
    if (['workspace-name-form','workspace-organize-form','workspace-organize-confirm'].includes(form.id)) { form.dataset.busy='true'; try { await structureUI.submit(form,data); return; } finally { delete form.dataset.busy; } }
    if (form.id === 'theme-name-form') { form.dataset.busy = 'true'; try { await designUI.submit(form,data); return; } finally { delete form.dataset.busy; } }
    if (form.id.startsWith('lab-') || form.id === 'publish-token-form') { form.dataset.busy = 'true'; try { if (await labUI.submit(form,data) || await publishUI.submit(form,data)) return; } finally { delete form.dataset.busy; } }
    if (form.id === 'create-form') {
      if((data.get('password')??'')!==(data.get('confirmPassword')??'')){notify('The passwords do not match.',true);return;}
      form.dataset.busy = 'true';setupControls.busy(true);
      const result = await api('/api/notebook/create', { createNew:state.newWorkspace===true, labBookTypes:data.getAll('labBookTypes'), identity:identityFromForm(data), title: data.get('title'), description: data.get('description'), storageParent:data.get('storageParent'),password:data.get('password')??'' }); state.book = result.book; state.etag = result.etag;state.storage=result.storage;state.access=result.access;state.newWorkspace=false;state.storageUnavailable=false;state.dirty=false;state.preview=null;state.laboratory=null;state.publishing=null;state.publishOutcome=null;state.selected=null;state.project=null;state.notebook='all';state.search='';state.filter='all';state.recordBrowse=null;state.designSource='auto';state.designPage=null;state.designResult=null;state.page='workspace';history.replaceState(null,'','#/workspace'); await dashboard.load(); await recordDrafts.start(state.book.id);render();notify('Workspace created in the selected folder.');
    }


  }catch(error){if(beforeBook&&state.etag===beforeEtag){state.book=beforeBook;Object.assign(state,locationBefore);dirty();}throw error;}finally{delete form.dataset.busy;form.removeAttribute('aria-busy');if(form.id==='create-form')setupControls.busy(false);}
}
document.addEventListener('submit',event=>{event.preventDefault();const form=event.target;submitForm(form).catch(error=>{if(form.id==='create-form'&&form.isConnected)setupControls.error(error.message??'Could not create this workspace. Your settings are still here.');else if(form.isConnected&&form.closest('dialog')?.open)notify(error.message??'Could not save. Your form is still here.',true);else report(error);});});
window.addEventListener('beforeunload', event => { if (pendingChanges().labels.length || uploading || figures.isBusy() || materials.isBusy()) { event.preventDefault(); event.returnValue = ''; } });
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && state.book) { event.preventDefault(); savePending().then(() => notify('Changes saved.')).catch(report); } });



const recordCreation=recordCreationUI({state,notebooks:structureUI.notebooks,esc,showDialog,locationName:(book,id)=>locationName(projectDirectoryUI.navigation(book),id)});
const recordDestination=recordDestinationUI({state,api,esc,field,showDialog,access:operation=>withProjectAccess(operation),rootBook:()=>projectOwners.root(),selected:async(projectId,bookId,legacy)=>{await projectOwners.enter(legacy?null:projectId,legacy?null:bookId);state.project=projectId;state.notebook=bookId;state.page='entries';state.search='';state.filter='all';state.recordBrowse=null;render();recordCreation.choose(bookId);}});
const chooseEntry=preferredNotebook=>{const id=preferredNotebook??(state.notebook!=='all'?state.notebook:null);if(id&&state.book.notebooks.some(book=>book.id===id))return recordCreation.choose(id);recordDestination.open();};

async function removeSelectedRecord(){
 if(savePromise)await savePromise;
 const id=state.selected,changes=recordCheckpoint();
 if(state.dirty&&(!changes||changes.some(change=>change.record.id!==id)))throw Error(t('recordAuthoring','otherDrafts'));
 const main=$('#main');removingRecord=true;if(main)main.inert=true;
 try{
  await recordDrafts.flush();
  const expectedRevision=savedRecordRevisions[id];
  const result=expectedRevision?await api('/api/research/records/remove',{workspaceId:state.book.id,recordId:id,expectedRevision},{adopt:false}):
   {book:savedBook,etag:state.etag,recordRevisions:savedRecordRevisions,recordScope:state.recordScope};
  if(expectedRevision&&(!result.recordScope.missing.includes(id)||result.book.entries.length))throw Error(t('recordAuthoring','invalidRemoval'));
  adoptSnapshot(result);state.book=result.book;state.etag=result.etag;state.dirty=false;changeVersion++;state.preview=null;
  await recordDrafts.clear();state.selected=null;state.page='entries';render();
 }catch(error){
  if(error.code==='RECORD_CHANGED')throw {...error,message:t('recordAuthoring','removeConflict')};
  throw error;
 }finally{removingRecord=false;if(main)main.inert=false;}
}

function renderSections(e) { return recordSections.view(e); }
function mediaPlayer(a) {
  return a.kind === 'image' ? `<img src="${esc(ownedAssetURL(state,'/api/media/'+a.id))}" alt="${esc(a.alt || a.caption)}">` : `<${a.kind} src="${esc(ownedAssetURL(state,'/api/media/'+a.id))}" controls preload="metadata" aria-label="${esc(a.caption || a.kind)}"></${a.kind}>`;
}
function uploadField(label, purpose, projectId = '') {
  const accept = purpose === 'attachment' ? 'image/svg+xml,.svg,image/png,image/jpeg,image/webp,image/bmp,image/tiff,audio/*,video/*,image/gif' : 'image/svg+xml,.svg,image/png,image/jpeg,image/webp,image/bmp,image/tiff';
  return field(label, `<input type="file" data-upload="${purpose}" data-project-id="${projectId}" accept="${accept}" ${uploading ? 'disabled' : ''}>`);
}
function renderMedia(e) {
  return `<section class="media-editor"><h3>Images, audio & video</h3><p class="muted">Original files are kept intact. Choose which prepared copies to publish.</p>${uploadField('Add media', 'attachment')}<p id="media-progress" class="muted" role="status">${uploading ? 'Preparing media...' : ''}</p>${e.attachments.map((a,index) => `<div class="media-item">${mediaPlayer(a)}${field('Caption', `<input data-attachment="${index}" data-column="caption" value="${esc(a.caption)}" maxlength="1500">`)}${field(a.kind === 'image' ? 'Alternative text' : 'Accessible description', `<textarea rows="2" data-attachment="${index}" data-column="alt" maxlength="1500">${esc(a.alt)}</textarea>`)}${a.kind !== 'image' ? field('Transcript / extended description', `<textarea rows="4" data-attachment="${index}" data-column="transcript" maxlength="60000">${esc(a.transcript)}</textarea>`) : ''}<label class="checkbox"><input type="checkbox" data-attachment="${index}" data-column="share" ${a.share ? 'checked' : ''}><span>Include this media in website<small>Check its visible and audible content before sharing.</small></span></label><button class="button subtle" data-action="remove-media" data-index="${index}">Remove from entry</button></div>`).join('')}</section>`;
}
async function uploadMedia(input) { await mediaImports.upload(input); }
async function applyMedia(intent,asset) {
  const {purpose,recordId,projectId,brandTarget}=intent;
  if(purpose==='record-attachment'){await recordContent.attachMedia(intent,asset);notify(t('recordContent','mediaAttached'));return;}
  if (purpose === 'attachment') {
    const current=editableRecord(state.book,recordId);if(!current)throw Error('Open the destination record again.');
    if(!current.attachments.some(a=>a.id===asset.id))current.attachments.push({...asset,caption:'',alt:'',transcript:'',share:false});
  } else if(['website','website-library','website-file','website-file-library'].includes(purpose)){website.acceptAsset(asset,brandTarget);}
  else if(purpose==='branding'){
    branding.acceptAsset(brandTarget,asset);
  } else if(purpose==='site-logo'){
    state.book.website.logoId=asset.id;const b=state.book.branding.find(item=>item.target==='home');
    if(b){if(b.logos.length)b.logos[0]={id:asset.id,alt:state.book.website.logoAlt};else b.logos.push({id:asset.id,alt:state.book.website.logoAlt});}
  } else {const project=state.book.projects.find(p=>p.id===projectId);if(!project)throw Error('Open the destination project again.');project.logoId=asset.id;}
  dirty();notify(purpose.startsWith('website-file')?t('websiteMedia','fileAdded'):'Media added. Save your changes when ready.');render();
}
function extendedInput(el) {
  if(recordContent.input(el))return true;
  if(recordSections.input(el))return true;
  if (el.dataset.attachment !== undefined) { entry().attachments[Number(el.dataset.attachment)][el.dataset.column] = el.type === 'checkbox' ? el.checked : el.value; dirtyRecord(); return true; }
  if (el.dataset.site) { state.book.website[el.dataset.site] = el.value; if (el.dataset.site === 'logoAlt' && state.book.branding.some(b => b.target === 'home') && editableLogos('home').length) editableLogos('home')[0].alt = el.value; dirty(); return true; }
  return false;
}
async function extendedAction(button) {
  const name = button.dataset.action, id = button.dataset.id, index = Number(button.dataset.index);
  if(name==='branding-back'){location.hash=state.brandReturn??'#/preferences/appearance';return true;}
  if(name==='workspace-discard'){drafts.reset([document.querySelector('main #workspace-name-form')]);render();return true;}
  if (name === 'branding') { state.brandReturn=routeFor(state); state.brandTarget = button.dataset.target ?? 'home'; state.page = 'branding'; $('#dialog').close(); render(); return true; }
  if(recordSections.action(button))return true;
  if (name === 'remove-media') { if (confirm('Remove this media from the entry? The stored original and saved revisions are kept.')) { entry().attachments.splice(index,1); dirtyRecord(); render(); } return true; }
  if (name === 'delete-page') { if (confirm('Remove this page? Saved versions remain in history.')) { state.book.pages = state.book.pages.filter(p => p.id !== id); state.book.branding = state.book.branding.filter(b => b.target !== 'page:' + id); state.book.website.layouts=state.book.website.layouts.filter(l=>l.target!=='page:'+id); state.book.website.navigation = state.book.website.navigation.filter(item => item.target !== 'page:' + id).map(item=>item.parent==='page:'+id?{...item,parent:null}:item); dirty(); render(); } return true; }
  if (name === 'remove-project-logo') { state.book.projects.find(p => p.id === id).logoId = null; dirty(); $('#dialog').close(); render(); return true; }
  if (name === 'remove-logo') { state.book.website.logoId = null; const b = state.book.branding.find(item => item.target === 'home'); if (b) b.logos.splice(0,1); dirty(); render(); return true; }
  return false;
}
document.addEventListener('change', event => {
  if (event.target.dataset.upload) uploadMedia(event.target).catch(report);
  if(event.target.dataset.mediaResume)mediaImports.resume(event.target).catch(report);
  if (event.target.id === 'preview-page' && state.preview) {state.preview.currentPage=event.target.value;const url=publicationPreviewUrl(state,state.preview.id,event.target.value);$('iframe.preview-frame').src=url;$('#full-public-preview').href=url;}
});

const mediaPolicyFields=[['maxUploadBytes','Maximum original file (MiB)',1048576],['maxPreparedBytes','Maximum website copy (MiB)',1048576],['maxDurationSeconds','Maximum recording length (minutes)',60],['reserveBytes','Keep disk space free (GiB)',1073741824],['maxImagePixels','Maximum image size (megapixels)',1000000],['maxAudioChannels','Maximum audio channels',1],['maxSampleRate','Maximum audio sample rate (Hz)',1],['processingTimeoutSeconds','Processing time limit (minutes)',60]];
function renderMediaPolicy(){
 if(!state.mediaPolicy)return '';
 return `<form id="media-policy-form" class="panel media-policy"><h2>Media limits</h2><p class="muted">Blank fields impose no app limit. Available disk space and hosting limits still apply.</p><div class="form-grid">${mediaPolicyFields.slice(0,4).map(mediaPolicyField).join('')}</div><details><summary>Processing limits</summary><div class="form-grid">${mediaPolicyFields.slice(4).map(mediaPolicyField).join('')}</div></details><div class="section-save"><button class="button primary" type="submit">Save media limits</button></div></form>`;
}
function mediaPolicyField([key,label,unit]){const value=state.mediaPolicy.policy[key];return field(label,`<input type="number" min="0" step="any" name="${key}" value="${value?value/unit:''}" placeholder="No limit">`);}

let workspaceLoadTask=null;
function loadWorkspace(){return workspaceLoadTask??=loadWorkspaceOwned().finally(()=>{workspaceLoadTask=null;});}
async function loadWorkspaceOwned(){
  recordDestination.reset();
  projectOwners.reset();
  fontLibrary.clear();
  state.access=await api('/api/access/status');
  if(state.access.locked){activity.hide();await recordDrafts.start(null);render();return;}
  const activityStatus=await activity.refresh();
  if(activityStatus.busy&&!activityStatus.readable){
   state.waitingForOperation=true;
   appShell.showStandalone(`<main id="main" class="loading"><h1>${esc(t('activity','busy'))}</h1><p>${esc(t('activity','busyDetail'))}</p><div data-owned-activity data-all-activity="true"></div></main>`);
   activity.bind();return;
  }
  state.storage=await api('/api/storage');state.storageUnavailable=state.storage.expectedExisting&&!state.storage.available;
  if(state.storageUnavailable){if(location.hash==='#/workspaces')state.page='workspaces';render();return;}
  let result;
  document.querySelector('#dialog').close();
  workspaceOpening=true;
  try{
    const reader=newWorkspaceReader();
    result=await loadWorkspaceView({reader:{read:options=>reader.read({...options,metadataOnly:true}),reset:()=>reader.reset()},show:content=>appShell.showStandalone(content)});
  }
  catch(error){workspaceOpening=false;if(error.code==='ACCESS_LOCKED'){state.access={...state.access,locked:true};render();return;}throw error;}
  finally{workspaceOpening=false;}
  if(result.book&&result.etag)adoptSnapshot(result);else state.workspaceOutline=null;
  state.book=result.book;state.etag=result.etag;await fontLibrary.load();await dashboard.load();if(state.book)state.mediaPolicy=await api('/api/media-policy');await recordDrafts.start(state.book?.id);
  if(state.pendingResearchLink&&state.book&&state.pendingResearchLink.workspaceId===state.book.id){
    const target=state.pendingResearchLink,route=target.kind==='record'&&supportsRecordSelection()?'#/records/'+target.id+'/read'+(target.selector?'/'+selectorAnchor(target.selector):''):targetRoute(target,state.book);
    state.pendingResearchLink=null;
    if(route)history.replaceState(null,'',route);else notify('The workspace opened, but the linked item is unavailable.',true);
  }
  await restoreRoute();
}

await startApplication({api,esc,show:content=>appShell.showStandalone(content),load:async()=>{
  await languageControls.load();
  await textControls.load();
  await writerRecovery.check();
  activity.start();
  await loadWorkspace();
}});

function editableLogos(target) {
  return branding.editableLogos(target);
}


function markHistory(){history.replaceState({...history.state,observandaIndex:routeIndex},'',location.href);}
function refreshRecordResults(){
 rememberFilters();$('#entry-results').innerHTML=renderEntryResults();$('#record-count').textContent=recordList.count();recordList.bind({delay:150});
 const count=browseActive(recordBrowse(state.recordBrowse));$('#record-filter-summary').textContent='Filters'+(count?' ('+count+')':'');
}
function rememberFilters(){history.replaceState({...history.state,observandaIndex:routeIndex,search:state.search,filter:state.filter,recordBrowse:recordBrowse(state.recordBrowse),filterWorkspaceId:state.book.id},'',location.href);}
function syncRoute(){
  if(!state.book&&state.page!=='workspaces'||state.ownerOperation||restoringRoute||workspaceLoadTask)return;
  const next=routeFor(state);
  if(location.hash!==next){const push=location.hash.startsWith('#/');if(push)routeIndex++;history[push?'pushState':'replaceState']({observandaIndex:routeIndex,search:state.search,filter:state.filter,recordBrowse:recordBrowse(state.recordBrowse),filterWorkspaceId:state.book?.id},'',next);window.scrollTo(0,0);}
  else markHistory();
}
async function restoreRoute(){
  if(!state.access?.locked&&!state.newWorkspace&&(state.storageUnavailable||!state.book))state.page=location.hash==='#/workspaces'?'workspaces':'workspace';
  if(state.access?.locked||state.storageUnavailable&&!state.newWorkspace||!state.book||state.newWorkspace){render();markHistory();return;}
  const request=++routeRestoreVersion,requestedRoute=location.hash,current=()=>request===routeRestoreVersion&&location.hash===requestedRoute;
  restoringRoute=true;
  try{
    if(state.websiteId)await sites.exit();
    if(!current())return;
    try{await projectOwners.restore(requestedRoute);}catch(error){if(ownerOperation.show(error,projectRoute(location.hash),location.hash))return;throw error;}
    if(!current())return;ownerOperation.clear();
    await sites.restore(projectRoute(requestedRoute).hash);if(!current())return;
    const recordRoute=/^#\/records\/([a-f0-9-]{36})(?:\/read(?:\/[a-f0-9-]{36})?)?$/.exec(projectRoute(location.hash).hash);
    const destination=resolveRoute(location.hash,state.book);
    if(destination.page==='record-reader'&&!await selectRecord(destination.selected,{metadataOnly:true}))return;
    if((state.workspaceOutline||state.recordScope)&&!recordRoute&&location.hash.startsWith('#/')&&!outlineViewSupported(destination.page,destination.moduleId))await ensureCompleteWorkspace();
    if(!current())return;
    if(state.book){Object.assign(state,resolveRoute(requestedRoute,state.book));state.recordReturn=null;

      if(state.page==='module'&&moduleDestination(state.moduleId)){state.page=moduleDestination(state.moduleId);state.project=null;state.notebook='all';history.replaceState(history.state,'',routeFor(state));}
      if(state.page==='module')await modules.ready(state.moduleId);
      if(state.page==='entries'){const saved=history.state?.filterWorkspaceId===state.book.id?history.state:{};
       state.search=typeof saved.search==='string'?saved.search:'';state.filter=validViewFilter(saved.filter)?saved.filter:'all';state.recordBrowse=recordBrowse(saved.recordBrowse);}
      if(moduleForPage(state.page)&&!enabledModule(state.dashboardSettings,moduleForPage(state.page).id)){render();return;}
      if(state.page==='website')await website.ready();
      if(state.page==='review'&&state.reviewId)state.preview=await publicationJobs.read(state.reviewId);
      if(state.page==='laboratory'){if(state.labSampleRoute){await labUI.action({dataset:{action:'laboratory-samples'}});return;}state.page=moduleDestination('laboratory');history.replaceState(history.state,'',routeFor(state));}
      if(state.page==='integrations')await publishUI.load();
      if(state.page==='publishing'){await publishUI.action({dataset:{action:'publishing'}});return;}
    }
    render();
  }finally{if(request===routeRestoreVersion){restoringRoute=false;if(state.book&&!location.hash.startsWith('#/'))history.replaceState(null,'',routeFor(state));markHistory();}}
}
function travelHistory(delta){return new Promise(resolve=>{travel=resolve;history.go(delta);});}
window.addEventListener('popstate',event=>{
  if(workspaceOpening)return;
  if(travel){const done=travel;travel=null;done();return;}
  (async()=>{
    const targetIndex=Number.isInteger(event.state?.observandaIndex)?event.state.observandaIndex:routeIndex+1;
    if(!Number.isInteger(event.state?.observandaIndex))history.replaceState({...history.state,observandaIndex:targetIndex},'',location.href);
    const delta=targetIndex-routeIndex;
    if(!delta)return;
    if(state.page==='review'&&location.hash==='#/website'){routeIndex=targetIndex;await restoreRoute();restoreEditorScroll();return;}
    if(!historyBusy&&leave.canLeaveImmediately()){routeIndex=targetIndex;await restoreRoute();return;}
    // Return to the original URL only when an editing decision is needed.
    await travelHistory(-delta);
    if(historyBusy||leave.isActive())return;
    historyBusy=true;
    try{if(dashboard.isDirty())try{await dashboard.flushAutosave();}catch{}await leave.run(async()=>{const remaining=targetIndex-routeIndex;if(remaining)await travelHistory(remaining);routeIndex=targetIndex;await restoreRoute();});}finally{historyBusy=false;}
  })().catch(report);
});
