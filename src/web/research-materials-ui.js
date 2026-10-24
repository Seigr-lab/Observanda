import {clockSynchronizationUI,clockSynchronizationView,clockSynchronizationStatusDisplay,synchronizationText} from './clock-synchronization-ui.js';
import {wireScalarFields} from './measurement-scalar-ui.js';
import {computationLabel} from './measurement-computation.js';
import {scalarPolicyControls,readScalarPolicy,wireScalarPolicies} from './measurement-scalar-ui.js';
import {calculatorRecipeView,calculatorResultActions} from './calculator-result-view.js';
import {defaultDatasetResourcePolicy} from './dataset-resource-policy.js';
import {datasetResourcePolicyControls,readDatasetResourcePolicy,datasetResourcePolicyDescription} from './dataset-resource-policy-ui.js';
import {clockStatusDisplay} from './measurement-clock-operation-ui.js';
import {measurementDomainControls,readMeasurementDomain,wireMeasurementDomains,domainDescription} from './measurement-domain-ui.js';
import {retainedFigureReader} from './retained-figure-reader.js';
import {isRetainedFigure} from './retained-figure-model.js';
import {measurementTransformControls,readMeasurementTransform,wireMeasurementTransforms,measurementTransformDescription} from './measurement-transform-ui.js';
import {datasetColumnPageOffset,loadDatasetColumnWindow,datasetColumnPager} from './dataset-column-picker.js';
import {INTERVAL_FIELDS} from './figure-intervals.js';
import {retainedSourceClient} from './retained-source-client.js';
import {materialReference} from './material-reference.js';
import {materialReferenceReader,materialOriginalRoute,inheritMaterialNamespace} from './material-reference-requests.js';
import {materialReferenceElements} from './material-reference-elements.js';
import {projectApiRoute,researchOwner,sameResearchOwner} from './project-context.js';
import {markerControls,markerMapping} from './figure-marker-area-ui.js';
import {defaultMarkerArea} from './figure-marker-area.js';
import {intervalMappingControls,readIntervalMapping} from './figure-intervals-ui.js';
import {mountHeatmap} from './figure-heatmap-ui.js';
import {recordRevisionView,recordRevisionComparison} from './record-revision-view.js';
import {selectorAnchor} from './book-selectors.js';
import {t as bookTranslate} from './i18n/index.js';
import {evidenceUploadUI,uploadText} from './evidence-upload-ui.js';
import {figurePreviews} from './figure-preview.js';
import {createFigure,FIGURE_TYPES} from './figure-model.js';
import {FIGURE_OPERATIONS} from './figure-import-model.js';
import {editableRecord} from './workspace-snapshot.js';
import {createRun} from './record-workflow.js';
import {materialSourcePicker} from './material-source-picker.js';
import {selectionSize,selectionBatch} from './material-selection-pages.js';
import {evidenceIntakeUI} from './evidence-intake-ui.js';
import {analysisFormView,analysisMethodPicker,analysisText} from './material-analysis-form.js';
import {t} from './i18n/index.js';
import {measurementUI} from './measurement-ui.js';
import {measurementText,provenanceFields,readProvenance,wireProvenance} from './measurement-schema-ui.js';
import {REPRESENTATIONS,isScalarRepresentation} from './measurement-model.js';
import {analysisComparisonUI} from './analysis-comparison-ui.js';
import {atext,analysisMethodFields,readAnalysisMethod,wireAnalysisFields,assertAnalysisFieldsReady,analysisChangesView} from './analysis-fields-ui.js';
import {blankAnalysisMethod,validAnalysisMethod} from './analysis-model.js';
import {localIntakeUI} from './local-intake-ui.js';
import {runReadinessUI} from './run-readiness-ui.js';
import {materialFileSummary,materialSourceLocation} from './material-file-summary.js';
import {datasetPreparationUI,preparationText} from './dataset-preparation-ui.js';
import {datasetCalculationUI,calculationText} from './dataset-calculation-ui.js';
import {datasetAggregationUI,aggregationText} from './dataset-aggregation-ui.js';
import {evidenceReuseUI} from './evidence-reuse-ui.js';
import {evidenceCorrectionsUI} from './evidence-corrections-ui.js';
import {allFigurePlots,withFigureSource} from './figure-provenance.js';
import {retainedRecordUI} from './retained-record-ui.js';

export function researchMaterialsUI({state,api,esc,field,showDialog,notify,dirty,render,revisions,create,getRecord=null,editRetainedFigure=null,refreshReader=null,showFigureResults=null,currentRecordRevision=()=>null,access=run=>run()}){
 const retainedRecords=retainedRecordUI({state,api,esc,showDialog});
 let figureReader=null,referenceContext=false,referenceOrigin=false,readingOverview=false,schemaDispose=null,referenceTrail=[],readerRefreshPending=false;
 const previews=figurePreviews();document.getElementById('dialog')?.addEventListener('close',()=>{referenceContext=false;previews.release();stopWatching();uploader.pause();});
 const endpoint='/api/research/materials/',record=getRecord??(()=>state.book?.entries.find(e=>e.id===state.selected));
 let projectOwner=null,readNamespace=null;
 const route=value=>projectApiRoute(value,projectOwner);
 const call=materialReferenceReader({api,local:(name,data,options)=>api(route(endpoint+name),data,{...options,owner:projectOwner}),onOwner:(result,name)=>{
  guard();if(['read','measurement-inspect'].includes(name)){readNamespace=result.namespaceId;referenceContext=referenceOrigin||!sameResearchOwner(result.labBookId?{projectId:result.projectId,labBookId:result.labBookId}:result.projectId,projectOwner);}
 }}),ref=materialReference;
 const originalRoute=r=>materialOriginalRoute(r)??route(endpoint+'original/'+r.id+'/'+r.revision);
 const button=(label,action,extra='')=>`<button type="button" class="button" data-action="material-${action}" ${extra}>${label}</button>`;
 const option=(v,label,selected)=>`<option value="${esc(v)}"${String(v)===String(selected)?' selected':''}>${esc(label)}</option>`;
 const value=id=>document.getElementById('material-'+id)?.value??'';
 let calculatorIntent=null;
 let items=[],catalog=[],imports=[],opened=null,selectedRef=null,page=0,controller=null,uploading=false,repeating=false,owner=null,workspaceContext=null,schemaRows=[],historical=null;
 let heatmapSettings=null,plotIntent=null,plotBase=null,plotDraft=null,datasetIntent=null,previewController=null,jobTimer=null,jobView=0,datasetJobCursor=null,datasetJobPage={items:[],next:null};
 let columnOffset=0,schemaOffset=0,schemaTotal=0,schemaOriginal=[],schemaDraft=new Map(),schemaExclusions=[],schemaInitialExclusions='[]';
 let referenceIntent=null,referenceDraft=null,draftCursor=null,draftPage={items:[],next:null};
 let sourcePickers={},materialCursor=null,materialPage={next:null},importCursor=null,importsNext=null,homeGeneration=0;
 const stopWatching=()=>{figureReader?.dispose();figureReader=null;schemaDispose?.();schemaDispose=null;intake.stop();reuse.stop();for(const picker of Object.values(sourcePickers))picker.dispose();sourcePickers={};sourceBusy.clear();homeGeneration++;previewController?.abort();previewController=null;clearTimeout(jobTimer);jobTimer=null;jobView++;};
 const saved=()=>!!record()&&(state.page==='record-reader'||!!revisions()[record().id])&&!state.dirty;
 const frame=(title,body,actions=null)=>{
  stopWatching();previews.release();
  actions??=referenceContext?(referenceTrail.length?button(esc(t('figureProvenance','back')),'reference-back'):readingOverview?button('Back to evidence','home'):'')+'<button type="button" class="button" data-action="close-dialog">'+esc(t('attempts','close'))+'</button>':button('Back to evidence','home');
  let n=0;body=body.replace(/<(input|select|textarea)\b(?![^>]*\bname=)/g,(_,tag)=>'<'+tag+' name="material-'+(++n)+'" ');
  showDialog(`<div class="material-workbench"><h2 id="dialog-title">${esc(title)}</h2><form id="material-form">${body}</form><div class="dialog-actions">${actions}</div></div>`);
  const form=document.getElementById('material-form'),reference=selectedRef;
  void materialReferenceElements(form,readNamespace??state.book?.id,{resolve:reference?items=>call('reference-addresses',{ref:reference,items}):undefined}).catch(error=>{if(form.isConnected)notify(error.message,true);});
 };
 const choose=(label,id,choices,selected)=>field(label,`<select id="material-${id}">${choices.map(([v,l])=>option(v,l,selected)).join('')}</select>`);
 const sourceBusy=new Set();
 const sourceMount=(id,label,options={})=>{const picker=materialSourcePicker({root:document.getElementById('material-picker-'+id),call,esc,field,label,id:'material-'+id,recordId:owner,guard,onBusy:busy=>{
  if(busy)sourceBusy.add(id);else sourceBusy.delete(id);
  document.querySelectorAll('[data-action="material-analysis-save"],[data-action="material-draft-save-selection"]').forEach(control=>control.disabled=sourceBusy.size>0);
 },...options});sourcePickers[id]=picker;return picker.ready;};
 const transformText=key=>t('measurementTransform',key),numberText=key=>t('measurementOutput',key);
 const titleField=title=>field('Title',`<input id="material-title" maxlength="300" value="${esc(title)}">`);
 const guard=()=>{if(!sameResearchOwner(projectOwner,researchOwner(state))||workspaceContext!==state.storage?.contextId||owner!==(record()?.id??null))throw Error('The workspace or record changed. Reopen evidence.');};
 const sources=retainedSourceClient({state,api,access,identity:()=>[jobView,owner],active:()=>!!document.getElementById('dialog')?.open});
 const currentView=generation=>{guard();if(generation!==jobView||!document.getElementById('dialog')?.open)throw new DOMException('Evidence view changed','AbortError');};
 async function authorizeSource(reference){
  if(state.storage?.researchStorage!=='catalogue'||!reference?.workspaceId)return;
  const generation=jobView;await sources.resolve(reference,{unlock:true});currentView(generation);
 }
 const measurements=measurementUI({call,frame,esc,field,guard,owner:()=>owner,readOnly:()=>referenceContext,inspect,notify,origin:()=>({ref:selectedRef,page,comparisonView:opened?.content?.comparison?comparisons.snapshot():null}),download:r=>{guard();const a=document.createElement('a');a.href=originalRoute(r)+'?context='+encodeURIComponent(workspaceContext);a.download='';a.click();}});
 const synchronization=clockSynchronizationUI({call,frame,esc,field,guard,owner:()=>owner,inspect});
 document.getElementById('dialog')?.addEventListener('close',()=>synchronization.clean());
 const comparisons=analysisComparisonUI({state,api,call,frame,esc,field,guard,owner:()=>owner,readOnly:()=>referenceContext,inspect:r=>r?inspect(r):referenceContext?document.getElementById('dialog').close():home(),watchJob,measurements,notify,access});
 const calculations=datasetCalculationUI({state,api,call,frame,esc,field,guard,owner:()=>owner,inspect,watchJob,notify});
 const aggregations=datasetAggregationUI({state,api,call,frame,esc,field,guard,owner:()=>owner,inspect,watchJob,notify});
 document.getElementById('dialog')?.addEventListener('close',()=>aggregations.clean());
 document.getElementById('dialog')?.addEventListener('close',()=>calculations.clean());
 document.getElementById('dialog')?.addEventListener('close',()=>comparisons.clean());
 document.getElementById('dialog')?.addEventListener('close',()=>measurements.clean());
 const intake=evidenceIntakeUI({route,call,frame,esc,field,guard,context:()=>workspaceContext,owner:()=>owner});
 const readiness=runReadinessUI({call:(action,data={})=>api(route('/api/v1/intake/'+action),{version:1,workspaceId:state.book.id,recordId:owner,...data},{adopt:false}),frame,esc,field,guard,notify,back:()=>home()});
 const continuing=localIntakeUI({api:(path,data,options)=>api(route(path),data,{...options,owner:projectOwner}),frame,esc,field,guard,owner:()=>owner,workspace:()=>state.book.id,readinessUI:readiness,refreshRecord:async()=>{guard();if(state.page==='record-reader'){readerRefreshPending=true;return;}const latest=await api('/api/workspace/read/selection',{workspaceId:state.book.id,ids:state.recordScope?.ids??[owner]});guard();state.book=latest.book;state.etag=latest.etag;render();}});
 document.getElementById('dialog')?.addEventListener('close',()=>readiness.stop());
 document.getElementById('dialog')?.addEventListener('close',()=>{continuing.stop();if(readerRefreshPending){readerRefreshPending=false;void refreshReader?.();}});
 const uploader=evidenceUploadUI({route,call,frame,esc,field,button,guard,context:()=>workspaceContext,owner:()=>owner,sourceMount,sources:()=>sourcePickers.parent.values(),watchJob});
 const reuse=evidenceReuseUI({route,call,frame,esc,button,guard,owner:()=>owner,context:()=>workspaceContext,sourceMount,sources:()=>sourcePickers.reuse.snapshot(),home,notify});
 const corrections=evidenceCorrectionsUI({state,api,call,frame,esc,field,button,guard,owner:()=>owner,inspect,notify,readOnly:()=>referenceContext});
 function view(subject=record(),{readonly=false}={}){return `<section class="research-links"><header><h3>Evidence &amp; analysis</h3>${button('Open evidence & analysis','open',readonly?'data-readonly="true"':'')}</header><p class="muted">${readonly?'Read original files, datasets and retained analyses associated with this record.':'Original files, datasets and analysis revisions stay private. Figures added to the record follow its sharing setting.'}</p>${!readonly&&subject?.type==='run'?button('Create another run or take','repeat'):''}</section>`;}
 async function readingHome(){
  const generation=++homeGeneration,data=await call('overview',{recordId:owner,cursor:materialCursor});guard();if(generation!==homeGeneration)return;
  items=data.items;catalog=items;materialPage=data;
  frame('Evidence & analysis',`<p>${esc(record()?.title??'')}</p>${items.length?'<ul class="material-list">'+items.map((item,index)=>'<li><div><strong>'+esc(item.title)+'</strong><p>'+esc(item.kind)+' &middot; '+esc(item.revision.slice(0,12))+'</p>'+materialFileSummary(item,{context:workspaceContext,esc,route})+'</div>'+button('Inspect','inspect','data-index="'+index+'"')+'</li>').join('')+'</ul>':'<p>No evidence is associated with this record.</p>'}<div class="inline-actions">${materialCursor?button('Latest evidence','heads-first'):''}${materialPage.next?button('Older evidence','heads-next'):''}</div>`,button('Close','close'));
 }
 async function home({expectedView,fresh=false}={}){
  if(readingOverview){if(fresh)materialCursor=null;return readingHome();}
  if(fresh){materialCursor=null;importCursor=null;draftCursor=null;}
  const generation=++homeGeneration,data=await call('overview',{recordId:owner,cursor:materialCursor,importCursor}),jobs=await call('dataset-jobs',{recordId:owner,cursor:datasetJobCursor}),drafts=await call('drafts',{recordId:owner,cursor:draftCursor}),pendingAssociations=await reuse.pending();guard();if(generation!==homeGeneration||expectedView!==undefined&&expectedView!==jobView)return;
  items=data.items;catalog=items;imports=data.imports;materialPage=data;importsNext=data.importsNext;datasetJobPage=jobs;draftPage=drafts;
  continuing.stop();readiness.stop();frame('Evidence & analysis',`<p>${esc(record().title)} · Imports and revisions are saved when you confirm each action.</p>${button(esc(t('localIntake','open')),'continuing-home')}${button(esc(t('localIntake','readiness')),'readiness-home')}${pendingAssociations}
   <div class="material-actions">${button(esc(uploadText('heading')),'upload-form')}${button(esc(t('materialFiles','reuse')),'reuse-original-form')}${button('Import file set','intake-new')}${button('Unfinished file sets','intake-list')}${button('Create dataset','dataset-form')}</div><details class="material-more"><summary>Analysis, collections &amp; verification</summary><div class="material-actions">${button('Record external analysis','analysis-form')}${button(esc(atext('create')),'comparison-new')}${button('Create collection','collection-form')}${button('Verify stored evidence','verify')}</div></details>
   ${draftPage.items.length?`<details class="material-more" open><summary>Unfinished collections &amp; analyses</summary><ul>${draftPage.items.map(d=>`<li>${esc(d.title)} · ${d.received.inputs} / ${d.totals.inputs} inputs ${button('Continue','draft-open',`data-id="${esc(d.id)}" aria-label="Continue ${esc(d.title)}"`)}</li>`).join('')}</ul></details>`:''}<div class="inline-actions">${draftCursor?button('Recent unfinished selections','drafts-first'):''}${draftPage.next?button('Older unfinished selections','drafts-next'):''}</div>
   ${imports.length?`<h3>Imports in progress</h3><ul>${imports.map((s,i)=>`<li>${esc(s.name)} &middot; ${s.receivedBytes.toLocaleString()} / ${s.size.toLocaleString()} bytes &middot; ${esc(s.job?.state??'Upload paused')} ${button(s.job?'Check verification':s.receivedBytes===s.size?'Verify original':uploadText('resumeUpload'),s.job?'job-open':s.receivedBytes===s.size?'job-start':'resume-form',`data-index="${i}"`)}</li>`).join('')}</ul>`:''}
   <div class="inline-actions">${importCursor?button('Recent imports','imports-first'):''}${importsNext?button('Older imports','imports-next'):''}</div>
   ${datasetJobPage.items.length?`<details class="material-more"><summary>${esc(atext('jobs'))}</summary><ul>${datasetJobPage.items.map(j=>`<li>${esc(j.title)} &middot; ${esc(j.state)} ${button(j.type==='analysis.compare'?atext(j.state==='completed'?'open':'check'):j.state==='completed'?(j.type==='figure.calculate'?'Open figure':'Open dataset'):(j.type==='figure.calculate'?'Check calculation':'Check preparation'),'dataset-job',`data-job="${esc(j.id)}"`)}</li>`).join('')}</ul><div class="inline-actions">${datasetJobCursor?button('Latest preparations','dataset-jobs-first'):''}${datasetJobPage.next?button('Older preparations','dataset-jobs-next'):''}</div></details>`:''}
   ${items.length?`<ul class="material-list">${items.map((m,i)=>`<li><div><strong>${esc(m.title)}</strong><p>${esc(m.kind)} · Revision ${m.revision.slice(0,12)}</p>${materialFileSummary(m,{context:workspaceContext,esc,route})}${m.dependencyStatus==='unavailable'?'<p class="material-review" role="status">'+esc(t('retainedSources','reviewUnavailable'))+'</p>':''}${m.changed.length?'<p class="material-review" role="status">Newer or unavailable inputs — review relevance. Retained results are unchanged.</p>':''}${m.figureState==='edited'?'<p class="material-review">The record figure was edited after calculation. The retained result is unchanged.</p>':''}</div>${button('Inspect','inspect',`data-index="${i}"`)}</li>`).join('')}</ul>`:'<p>No evidence yet. Import an original file, then retain a dataset or document an analysis.</p>'}
   <div class="inline-actions">${button(esc(t('evidenceCorrections','history')),'correction-history')}${materialCursor?button('Latest evidence','heads-first'):''}${materialPage.next?button('Older evidence','heads-next'):''}</div>${materialPage.changed?'<p role="status">Evidence changed since this list was opened. Return to latest evidence to refresh.</p>':''}
   <p class="muted">A hash identifies bytes; it does not establish accuracy or authorship. Use Storage &amp; access to create a verified backup, then verify evidence after restoration.</p>`,button('Close','close'));
 }
 async function watchComparisonJob(job){
  guard();frame(atext('working'),`<p>${esc(atext('jobHelp'))}</p><p data-comparison-progress role="status"></p><div class="inline-actions">${button(esc(atext('cancel')),'job-cancel',`data-job="${job.id}"`)}${button(esc(atext('retry')),'job-retry',`data-job="${job.id}" hidden`)}</div>`);
  const generation=jobView,active=()=>generation===jobView&&document.getElementById('dialog')?.open&&workspaceContext===state.storage?.contextId&&sameResearchOwner(projectOwner,researchOwner(state))&&owner===record()?.id;
  const update=async j=>{if(!active())return;if(j.state==='completed'){await inspect(j.result);return;}document.querySelector('[data-comparison-progress]').textContent=j.message??atext(j.state)+' · '+j.progress.done+' / '+j.progress.total;
   document.querySelector('[data-action="material-job-cancel"]').hidden=['failed','cancelled'].includes(j.state);document.querySelector('[data-action="material-job-retry"]').hidden=!['failed','cancelled'].includes(j.state);
   if(['queued','running'].includes(j.state))jobTimer=setTimeout(()=>{void call('job',{id:j.id},{adopt:false}).then(r=>update(r.job)).catch(e=>{if(active())notify(e.message,true);});},500);
  };await update(job);
 }
 async function watchJob(job){
  guard();
  if(job.type==='analysis.compare')return watchComparisonJob(job);
  const dataset=job.type==='dataset.prepare',figure=job.type==='figure.calculate',material=dataset||figure;
  const verb=figure?'figure calculation':dataset?'dataset preparation':'verification',label=figure?'Figure calculation':dataset?'Dataset preparation':'Verification';
  frame(figure?'Calculate figure':dataset?'Prepare dataset':'Verify original file',`<div id="material-job" data-job="${esc(job.id)}"><p>${figure?'Your inputs and earlier figures stay intact. The complete calculation is saved as a new revision. Retry restarts the same calculation.':dataset?'Your original stays intact. Preparation retains bounded pages, then saves the complete dataset revision. Retry restarts parsing and reuses identical retained pages.':'The uploaded bytes are retained.'} Work continues while this workspace is unlocked. You can close this dialog and return from Evidence &amp; analysis.</p><p id="material-job-status" role="status" aria-live="polite"></p><progress id="material-job-meter" value="0" max="1" aria-label="${label} progress"></progress><div class="inline-actions">${button('Cancel '+verb,'job-cancel',`data-job="${esc(job.id)}"`)}${button('Retry '+verb,'job-retry',`data-job="${esc(job.id)}" hidden`)}${figure?button(esc(transformText('editSettings')),'plot-job-settings',`data-job="${esc(job.id)}" hidden`):''}</div></div>`);
  const generation=jobView,current=()=>generation===jobView&&document.getElementById('dialog')?.open&&document.getElementById('material-job')?.dataset.job===job.id&&workspaceContext===state.storage?.contextId&&sameResearchOwner(projectOwner,researchOwner(state))&&owner===record()?.id;
  const update=async result=>{
   if(!current())return;
   if(result.state==='completed'){stopWatching();if(material){await inspect(result.result,{atPage:result.result.id===selectedRef?.id?page:0});notify(figure?'Calculated figure retained.':'Dataset revision retained.');}else{await home({expectedView:jobView,fresh:true});notify('Original file retained.');}return;}
   const status=document.getElementById('material-job-status'),meter=document.getElementById('material-job-meter');
   const done=result.progress.done.toLocaleString(),total=result.progress.total.toLocaleString(),unit=figure?(result.progress.stage.includes('median')?' values':' rows'):dataset&&result.progress.stage==='validating dataset rows'?' rows':' bytes';
   status.textContent=result.state==='failed'?label+' stopped. '+(result.message??'Retry when the problem is resolved.') : result.state==='cancelled'?label+' cancelled. '+(material?'Originals and earlier revisions are retained.':'Uploaded bytes are retained; retry when ready.'):result.cancelRequested?'Cancelling '+verb+'...':result.state==='queued'?'Waiting for '+verb+'.':(material?result.progress.stage:'Verifying original')+': '+done+' / '+total+unit;
   meter.value=result.progress.total?result.progress.done/result.progress.total:0;
   document.querySelector('[data-action="material-job-cancel"]').hidden=['failed','cancelled'].includes(result.state);
   document.querySelector('[data-action="material-job-cancel"]').disabled=result.cancelRequested;
   document.querySelector('[data-action="material-job-retry"]').hidden=!['failed','cancelled'].includes(result.state);
   const settings=document.querySelector('[data-action="material-plot-job-settings"]');if(settings)settings.hidden=!['failed','cancelled'].includes(result.state);
   if(['queued','running'].includes(result.state))jobTimer=setTimeout(async()=>{
    if(!current())return;
    try{await update((await call('job',{id:job.id},{adopt:false})).job);}catch(error){if(current())status.textContent=(error.message??'Unable to check progress.')+' Reopen evidence to check again.';}
   },500);
  };
  await update(job);
 }
 const preparation=datasetPreparationUI({esc,field,button});
 const mappingRow=(name='',path='')=>'<div class="material-json-field"><div class="material-fields">'+field('Column name','<input data-map-name maxlength="200" value="'+esc(name)+'">')+preparation.sourceField()+field('Field path','<input data-map-path maxlength="2048" value="'+esc(path)+'" placeholder="/measurement">')+'</div>'+button('Remove column','mapping-remove')+'</div>';
 async function datasetForm(){
  datasetIntent=null;
  frame('Retain a dataset',`<p>The original stays intact. Choose how its values become columns; numerical meaning can be declared in the retained dataset.</p>${titleField('Measurements')}<div id="material-picker-source"><input type="hidden" data-value value=""></div>
   ${choose('Source format','format',[['delimited','Delimited text (CSV / TSV)'],['json','JSON array'],['jsonl','JSON Lines'],['json-nested',preparationText('format')]],'delimited')}
   <div id="material-delimited">${choose('Column separator','delimiter',[['auto','Detect from header'],[',','Comma'],['\t','Tab'],[';','Semicolon'],['|','Pipe']],'auto')}
   ${field('First row contains column names','<input id="material-header" type="checkbox" checked>')}</div>
   <div id="material-json" hidden><div id="material-json-array">${field('Path to rows array','<input id="material-rows-path" maxlength="2048" placeholder="/measurements">')}<p class="muted">Leave blank for an array at the root of the file.</p></div>
   <p>Map columns using JSON Pointer paths relative to each row, such as /counter or /measurement/value. Leave a field path blank for a scalar row. Numbers retain their exact spelling. Unmapped fields remain in the original.</p>
   <label><input type="checkbox" id="material-discover-columns"> Discover columns from each row</label><p class="muted">Object and array values stay intact and can be opened in the value inspector.</p><input type="hidden" id="material-mapping-structure" value="0">${preparation.controls()}<div id="material-json-fields">${mappingRow('Value','/value')}</div>${button('Add column','mapping-add')}</div>
   <details><summary>${esc(measurementText('nativeMapping'))}</summary><p>${esc(measurementText('nativeMappingHelp'))}</p><div id="material-picker-native"><input type="hidden" data-value value=""></div>${['offsetColumn','lengthColumn','pointerColumn','idColumn'].map(k=>field(esc(measurementText(k)),`<input id="material-native-${k}" type="number" min="1" max="9007199254740991">`)).join('')}</details>
   <div class="inline-actions">${button('Preview mapping','dataset-preview')}${button('Create dataset','dataset-create')}</div><div id="material-mapping-preview" role="status"></div>`);
  const update=()=>{const format=value('format');document.getElementById('material-delimited').hidden=format!=='delimited';document.getElementById('material-json').hidden=format==='delimited';document.getElementById('material-json-array').hidden=!['json','json-nested'].includes(format);preparation.refresh();document.getElementById('material-mapping-preview').replaceChildren();};
  document.getElementById('material-format').addEventListener('change',update);
  document.getElementById('material-discover-columns').addEventListener('change',event=>{document.getElementById('material-json-fields').hidden=event.target.checked;document.querySelector('[data-action="material-mapping-add"]').hidden=event.target.checked;});
  document.getElementById('material-form').addEventListener('input',event=>{previewController?.abort();document.getElementById('material-mapping-preview')?.replaceChildren();if(event.target.matches('[data-lookup="name"],[data-lookup="mode"],[data-lookup-packed]'))preparation.refresh();});
  const controls=[...document.querySelectorAll('[data-action="material-dataset-preview"],[data-action="material-dataset-create"]')];controls.forEach(el=>el.disabled=true);
  try{await sourceMount('source','Original file',{kind:'artifact'});await sourceMount('native',measurementText('nativeArtifact'),{kind:'artifact',optional:true});}finally{controls.forEach(el=>el.disabled=false);}
 }
 async function queueDataset(command){
  const key=JSON.stringify(command);if(datasetIntent?.key!==key)datasetIntent={key,id:crypto.randomUUID()};
  return call('dataset',{...command,jobId:datasetIntent.id});
 }
 async function queuePlot(command){
  const key=JSON.stringify(command);if(plotIntent?.key!==key)plotIntent={key,id:crypto.randomUUID()};
  return call('plot',{...command,jobId:plotIntent.id});
 }
 async function submitPlot(command){
  const form=document.getElementById('material-form'),generation=jobView;
  if(!form||form.dataset.busy)return;
  const controls=[...document.querySelectorAll('#dialog input,#dialog select,#dialog textarea,#dialog button')].map(el=>({el,disabled:el.disabled}));
  form.dataset.busy='true';form.setAttribute('aria-busy','true');for(const {el} of controls)el.disabled=true;
  try{
   const value=await command();guard();if(generation!==jobView||!form.isConnected)return;
   const result=await queuePlot(value);guard();if(generation!==jobView||!form.isConnected)return;
   await watchJob(result.job);
  }finally{
   delete form.dataset.busy;form.removeAttribute('aria-busy');
   for(const {el,disabled} of controls)if(el.isConnected)el.disabled=disabled;
  }
 }
 function datasetCommand(){
  const format=value('format'),sourceMapping=format==='delimited'?{format,delimiter:value('delimiter'),header:document.getElementById('material-header').checked}
   :{format,rowsPath:value('rows-path'),fields:document.getElementById('material-discover-columns').checked?'all':[...document.querySelectorAll('.material-json-field')].map(row=>({name:row.querySelector('[data-map-name]').value,path:row.querySelector('[data-map-path]').value,...(format==='json-nested'?{source:row.querySelector('[data-map-source]').value}:{})})),...(format==='json-nested'?{joins:preparation.read()}:{})};
  const native=sourcePickers.native.values()[0],nativeMapping=native?{artifact:native,...Object.fromEntries(['offsetColumn','lengthColumn','pointerColumn','idColumn'].map(k=>[k,value('native-'+k)===''?null:Number(value('native-'+k))-1]))}:null;
  return {recordId:owner,title:value('title'),artifact:sourcePickers.source.values()[0],sourceMapping,...(nativeMapping?{nativeMapping}:{})};
 }

 const inputCount=(content,slot='inputs')=>content[slot+'Index']?.count??content[slot]?.length??0;
 async function mountReferences(root,{reference,id,slot='inputs'}){
  if(!root)return;
  let offset=0,next=null,request=0;const generation=jobView;
  async function load(){
   const current=++request;root.setAttribute('aria-busy','true');
   if(!root.childElementCount)root.innerHTML='<p role="status">Loading '+slot+'...</p>';
   root.querySelectorAll('button').forEach(el=>el.disabled=true);
   try{
    const data=await call(id?'draft-references':'references',{...(id?{id}:{ref:reference}),slot,offset,limit:20});guard();
    if(current!==request||generation!==jobView||!root.isConnected)return;next=data.next;
    root.innerHTML='<p>'+data.total+' exact '+slot+' · '+(data.items.length?offset+1:0)+'–'+(offset+data.items.length)+'</p><ul>'+data.items.map(item=>'<li>'+button(esc(item.title),'reference','data-ref="'+esc(JSON.stringify(inheritMaterialNamespace(ref(item),reference?.workspaceId??state.book?.id)))+'"')+' · '+item.kind+' · '+item.revision.slice(0,12)+'</li>').join('')+'</ul><div class="inline-actions"><button type="button" class="button" data-ref-prev>Previous '+slot+'</button><button type="button" class="button" data-ref-next>Next '+slot+'</button></div>';
    root.querySelector('[data-ref-prev]').disabled=offset===0;root.querySelector('[data-ref-next]').disabled=next===null;
    root.querySelector('[data-ref-prev]').onclick=()=>{offset=Math.max(0,offset-20);void load();};
    root.querySelector('[data-ref-next]').onclick=()=>{offset=next;void load();};
   }catch(error){if(generation===jobView&&root.isConnected){root.replaceChildren();const status=document.createElement('p');status.textContent=error.message??'Unable to open references.';const retry=document.createElement('button');retry.type='button';retry.className='button';retry.textContent='Retry references';retry.onclick=()=>void load();root.append(status,retry);}}
   finally{if(current===request&&root.isConnected)root.removeAttribute('aria-busy');}
  }
  await load();
 }
 async function draftForm(id){
  const generation=jobView,draft=await call('draft-read',{id});guard();if(generation!==jobView)return;
  if(draft.state!=='open'){await home({fresh:true});return;}
  referenceDraft=draft;
  const complete=['inputs','outputs'].every(slot=>draft.received[slot]===draft.totals[slot]);
  frame('Unfinished '+draft.kind,'<p>'+esc(draft.title)+'</p><p>Complete this selection to attach it to the record.</p><p id="material-draft-status" role="status"></p>'+
   (draft.method?'<details class="material-more"><summary>Analysis method</summary><dl><dt>Tool</dt><dd>'+esc(draft.method.tool)+' · '+esc(draft.method.version)+'</dd><dt>Parameters</dt><dd><pre>'+esc(draft.method.parameters)+'</pre></dd></dl></details>':'')+
   ['inputs','outputs'].filter(slot=>draft.totals[slot]||slot==='inputs').map(slot=>'<section><h3>'+slot[0].toUpperCase()+slot.slice(1)+'</h3><p>'+draft.received[slot]+' of '+draft.totals[slot]+' received</p><div id="material-draft-'+slot+'"></div>'+(draft.received[slot]<draft.totals[slot]?button('Choose remaining '+slot,'draft-select','data-slot="'+slot+'"'):'')+'</section>').join('')+button('Discard unfinished '+draft.kind,'draft-cancel'),
   (!complete&&referenceIntent?.id===id?button('Retry saving selection','draft-retry'):'')+button('Complete '+draft.kind,'draft-finish',complete?'':'disabled')+button('Back to evidence','home'));
  for(const slot of ['inputs','outputs']){const root=document.getElementById('material-draft-'+slot);if(root)await mountReferences(root,{id,slot});}
 }
 async function draftSelect(slot){
  const remaining=referenceDraft.totals[slot]-referenceDraft.received[slot];
  frame('Choose remaining '+slot,'<p>'+remaining+' '+slot+' still needed for '+esc(referenceDraft.title)+'. Select revisions that have not already been received.</p><div id="material-picker-remaining"><input type="hidden" data-value value=""></div>',button('Save selected '+slot,'draft-save-selection','data-slot="'+slot+'" disabled')+button('Back to unfinished '+referenceDraft.kind,'draft-back')+button('Back to evidence','home'));
  const control=document.querySelector('[data-action="material-draft-save-selection"]');
  try{await sourceMount('remaining','Remaining '+slot,{multiple:true,...(slot==='outputs'?{kind:'artifact'}:{})});}finally{control.disabled=false;}
 }
 async function saveReferenceSelection(){
  const intent=referenceIntent;controller=new AbortController();uploading=true;
  frame('Save '+intent.kind,'<p>Exact references are saved in batches. Received references survive interruption; the complete selection is attached together.</p><p id="material-reference-progress" role="status"></p>',button('Pause saving','pause'));
  let completed=false,error=null;
  try{
   let draft=intent.command?await call('draft-start',{...intent.command,draftId:intent.id},{signal:controller.signal}):await call('draft-read',{id:intent.id},{signal:controller.signal});guard();
   if(draft.state==='completed'){completed=true;}
   else for(const slot of ['inputs','outputs']){
    if(draft.received[slot]<intent.offsets[slot])throw Error('This selection changed. Reopen the unfinished '+intent.kind+'.');
    // Replaying known batches validates their exact contents, even after another
    // client has continued the draft. A received count alone is not a receipt.
    for(let at=0;at<selectionSize(intent[slot]);at+=64){
     guard();controller.signal.throwIfAborted();
     const items=await selectionBatch(call,intent[slot],at,{signal:controller.signal});guard();
     draft=await call('draft-append',{id:intent.id,slot,offset:intent.offsets[slot]+at,items},{signal:controller.signal});
     document.getElementById('material-reference-progress').textContent=draft.received.inputs+' / '+draft.totals.inputs+' inputs and '+draft.received.outputs+' / '+draft.totals.outputs+' outputs received.';
    }
   }
   if(!completed&&intent.finish){await call('draft-finish',{id:intent.id},{signal:controller.signal});guard();completed=true;}
  }catch(failure){error=failure;}
  finally{uploading=false;controller=null;}
  if(completed){referenceIntent=null;await home({fresh:true});notify('Saved '+intent.kind+'.');return;}
  if(!error)referenceIntent=null;
  try{await draftForm(intent.id);}catch{
   frame('Save interrupted','<p role="status">The selection remains in this dialog. Retry saving to check which references were received.</p>',button('Retry saving selection','draft-retry')+button('Back to evidence','home'));
  }
  if(error){const message=error.name==='AbortError'?'Saving paused. Received references are retained.':error.message??'Saving interrupted. Retry this selection.';
   const status=document.getElementById('material-draft-status');if(status)status.textContent=message;else notify(message,error.name!=='AbortError');}
 }

 async function analysisForm(collection=false){
  referenceIntent=null;opened={collection};frame(analysisText(collection?'collectionHeading':'analysisHeading'),analysisFormView({collection,esc,field})+(!collection?analysisMethodFields(blankAnalysisMethod(),{esc,field}):''));
  if(!collection)schemaDispose=wireAnalysisFields(document.getElementById('material-form'),{state,api,call,esc,field,guard,recordId:owner});
  if(!collection)sourcePickers.method=analysisMethodPicker({root:document.getElementById('material-method'),state,api,call,esc,field,guard});
  const generation=jobView,control=document.querySelector('[data-action="material-analysis-save"]');control.disabled=true;
  try{await sourceMount('inputs',analysisText('inputs'),{multiple:true});
   if(generation===jobView&&!collection&&document.getElementById('material-picker-outputs'))await sourceMount('outputs',analysisText('outputs'),{multiple:true,kind:'artifact'});
  }finally{control.disabled=false;}
 }
 function denominatorView(c){
  const d=c.denominator;if(!d)return '';
  const dataset=d.dataset??(c.inputs?.[0]?.kind==='dataset'?c.inputs[0]:null);
  return `<p>${d.rows.toLocaleString()} rows; ${d.included.toLocaleString()} included. ${(d.excludedCount??d.excluded?.length??0).toLocaleString()} excluded.</p><details class="material-more"><summary>Calculation coverage</summary><p>Missing values among included rows:</p><ul>${(d.missing??[]).map(m=>`<li>${esc(m.name??('Column '+(m.column+1)))}: ${(m.count??m.rows?.length??0).toLocaleString()}</li>`).join('')}</ul>${dataset?button('Inspect source rows & exclusions','reference',`data-ref="${esc(JSON.stringify(dataset))}"`):''}</details>`;
 }
 async function inspect(reference,{atPage=0,comparisonView=null,retainedDocument=null}={}){
  frame('Loading evidence','<p role="status">Opening the retained revision...</p>');
  const generation=jobView,requested=ref(inheritMaterialNamespace(reference,state.book?.id)),doc=retainedDocument??await call('read',{ref:requested});guard();
  if(generation!==jobView||!document.getElementById('dialog')?.open)return;
  selectedRef=requested;opened=doc;page=Math.min(atPage,Math.max(0,(opened.content.pageIndex?.count??opened.content.pages?.length??1)-1));columnOffset=0;
  if(opened.kind==='dataset')return datasetView();
  if(opened.content.comparison)return comparisons.open(selectedRef,{restore:comparisonView});
  const correctionControls=await corrections.controls(opened,selectedRef);
  const status=opened.kind==='analysis'?await call('analysis-status',{ref:selectedRef}):null;guard();if(generation!==jobView)return;const c=opened.content;frame(opened.title,`<p>${opened.kind} · ${selectedRef.revision} · ${esc(opened.createdAt)}</p>${opened.previous?button('Previous revision','previous'):''}${correctionControls}
   ${opened.kind==='artifact'?`<dl>${materialSourceLocation(c,esc)}<dt>Original bytes</dt><dd>${c.size.toLocaleString()}</dd><dt>SHA-256</dt><dd class="material-hash">${c.sha256}</dd><dt>Provenance</dt><dd>${esc(c.provenance)||'Not supplied'}</dd></dl>${button('Download original','download')}`:''}
   ${opened.kind==='artifact'&&!referenceContext?button(esc(measurementText('heading')),'measurement-from-artifact',`data-ref="${esc(JSON.stringify(selectedRef))}"`):''}
   ${calculatorRecipeView(c,esc,{button,readOnly:referenceContext})}${analysisChangesView(status,esc)}${c.method&&c.tool!=='Observanda clock synchronization'?comparisons.methodView(c.method):''}
   ${c.tool==='Observanda clock synchronization'?clockSynchronizationView(c,{esc,button})+(referenceContext?'':button(esc(synchronizationText('revise')),'clock-sync-revise',`data-ref="${esc(JSON.stringify(selectedRef))}"`)):''}
   ${c.measurement?measurements.view(c.measurement)+(referenceContext?'':button(esc(measurementText('edit')),'measurement-revise',`data-ref="${esc(JSON.stringify(selectedRef))}"`)):''}
   ${c.tool&&!c.mapping&&!c.measurement&&c.tool!=='Observanda clock synchronization'?`<dl><dt>Tool</dt><dd>${esc(c.tool)} · ${esc(c.version)}</dd><dt>Parameters</dt><dd><pre>${esc(c.parameters)}</pre></dd></dl>`:''}
   ${c.figure?`<div class="material-figure" id="material-figure"></div>${denominatorView(c)}${c.warnings?.length?`<ul>${c.warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}${referenceContext?'':button('Add retained figure to record','attach')+(c.mapping?button('Recalculate with latest dataset','recalculate'):'')}`:''}
   ${c.mapping?`<details class="material-more"><summary>Calculation definition</summary><p>${esc(c.tool)} · ${esc(c.version)}</p><pre>${esc(c.parameters)}</pre></details>`:''}
   ${c.numericTransform?'<p>'+esc(measurementText('plotPolicy',{policy:measurementText(c.numericTransform.policy==='approximate'?'approximatePolicy':'safe')}))+'</p>':''}
   ${c.plotPointsIndex||c.tool==='Observanda table mapping'&&['9','10'].includes(c.version)&&c.figure?.kind==='retained'?button(esc(transformText('points')),'plot-points'):''}
   ${c.numericTransform?.reduction?'<p>'+esc(measurementText('plotReduction'))+'</p>':''}
   ${[1,2,3,4,5,6,7,8,9].includes(c.graphVersion)&&!referenceContext?button('Edit calculation graph','calculation-graph-open',`data-ref="${esc(JSON.stringify(selectedRef))}" data-existing="true"`):''}
   ${c.intake&&!referenceContext?button('Inspect imported file set','intake-open',`data-id="${esc(c.intake.id)}"`):''}
   ${c.acquisition?'Recorded with '+referenceList([c.acquisition]):''}<h3>Exact inputs</h3>${c.inputsIndex?'<div id="material-input-references"></div>':referenceList(c.inputs??[])}${inputCount(c,'outputs')?`<h3>Outputs</h3>${c.outputsIndex?'<div id="material-output-references"></div>':referenceList(c.outputs)}`:''}
   <details><summary>Private manifest</summary><pre>${esc(JSON.stringify(opened,null,2))}</pre></details>`);
  if(c.tool==='Observanda clock synchronization')schemaDispose=wireScalarFields(document.getElementById('material-form'),{call,reference:()=>({ref:selectedRef}),guard,esc});
  if(c.measurement)schemaDispose=measurements.wireView(document.getElementById('material-form'),selectedRef);
  if(c.inputsIndex)await mountReferences(document.getElementById('material-input-references'),{reference:selectedRef});
  if(c.outputsIndex&&inputCount(c,'outputs'))await mountReferences(document.getElementById('material-output-references'),{reference:selectedRef,slot:'outputs'});
  if(c.figure){if(isRetainedFigure(c.figure))await mountRetainedFigure(document.getElementById('material-figure'),{ref:selectedRef});else previews.mount(document.getElementById('material-figure'),c.figure,'material');}
 }
 async function mountRetainedFigure(root,selector,source=selector.ref?.kind==='analysis'?selector.ref:null){
  const generation=jobView,target=selector.ref??{kind:'record',workspaceId:selector.workspaceId,id:selector.recordId,revision:currentRecordRevision()};
  const currentTarget=()=>state.page==='record-reader'&&target.kind==='record'&&target.workspaceId===state.book?.id&&target.id===record()?.id&&typeof target.revision==='string'&&target.revision===currentRecordRevision();
  const inspectResults=showFigureResults&&currentTarget()?async plotId=>{currentView(generation);if(!currentTarget())throw new DOMException('Record figure view changed','AbortError');document.getElementById('dialog').close();await showFigureResults(plotId);}:null;
  const downloadURL=(format,revision)=>{guard();const path=selector.ref?.workspaceId?'/api/projects/material-reference/retained-figure-export':route(endpoint+'retained-figure-export');return path+'?context='+encodeURIComponent(workspaceContext)+'&selection='+encodeURIComponent(JSON.stringify({...selector,expectedRevision:revision,format}));};
  figureReader=retainedFigureReader({root,request:(command,options)=>{guard();return call('retained-figure',{...selector,...command},options);},downloadURL,inspectResults,inspectSource:async(selection,expectedRevision)=>{const {origin}=await call('retained-figure',{...selector,expectedRevision,operation:'source',selection});if(!origin)return;await authorizeSource(origin.ref);const sourceDocument=await call('read',{ref:origin.ref});guard();selectedRef=origin.ref;if(sourceDocument.content.tool!=='Observanda table mapping'||!['8','9','10'].includes(sourceDocument.content.version))return inspect(origin.ref,{retainedDocument:sourceDocument});await plotPoint(Number.isSafeInteger(origin.index)?origin.index:{pointId:origin.pointId,seriesId:origin.seriesId});}});
  await figureReader.ready;
 }
 async function openRetainedFigure(control){
  owner=record()?.id??null;workspaceContext=state.storage?.contextId;projectOwner=researchOwner(state);referenceOrigin=true;referenceContext=true;readNamespace=state.book?.id;referenceTrail=[];
  const selector=control.dataset.figureRef?{ref:JSON.parse(control.dataset.figureRef),figureId:control.dataset.figureId}:{workspaceId:state.book.id,recordId:control.dataset.recordId,figureId:control.dataset.figureId};
  const source=control.dataset.figureSource?JSON.parse(control.dataset.figureSource):null;
  frame(t('retainedFigureReader','heading'),'<div id="material-retained-figure"><p role="status">'+esc(t('retainedFigureReader','loading'))+'</p></div>',button('Close','close'));
  const generation=jobView;if(selector.ref)await authorizeSource(selector.ref);currentView(generation);
  await mountRetainedFigure(document.getElementById('material-retained-figure'),selector,source);
 }
 async function plotPoints(offset=0){
  const reference=selectedRef;frame(transformText('points'),'<p role="status">Loading...</p>');const generation=jobView,data=await call('plot-points',{ref:reference,offset});currentView(generation);
  frame(transformText('points'),'<div class="material-table"><table><thead><tr><th>'+esc(transformText('series'))+'</th><th>'+esc(transformText('point'))+'</th><th>X</th><th>'+esc(transformText('projected'))+'</th><th></th></tr></thead><tbody>'+data.items.map(item=>'<tr><td>'+esc(item.seriesName)+'</td><td>'+(item.point+1)+'</td><td>'+esc(item.x)+'</td><td>'+esc(item.y??'Gap')+'</td><td>'+button(esc(transformText('openPoint')),'plot-point','data-index="'+item.index+'"')+'</td></tr>').join('')+'</tbody></table></div>'+(offset?button(esc(transformText('previous')),'plot-points','data-offset="'+Math.max(0,offset-16)+'"'):'')+(data.next!==null?button(esc(transformText('next')),'plot-points','data-offset="'+data.next+'"'):''),button(esc(transformText('back')),'plot-back'));
 }
 async function plotPoint(index,offset=0){
  const pointSelection=typeof index==='object'?index:{index},pointAttributes=typeof index==='object'?'data-point-id="'+esc(index.pointId)+'" data-series-id="'+esc(index.seriesId)+'"':'data-index="'+index+'"';
  const reference=selectedRef;frame(transformText('point'),'<p role="status">Loading...</p>');const generation=jobView,data=await call('plot-point',{ref:reference,...pointSelection,offset});currentView(generation);
  const fraction=value=>value.numerator+' / '+value.denominator,coordinateLabel=field=>field==='error'?transformText('uncertaintyWidth'):['x','y'].includes(field)?transformText(field):t('figureIntervals',field);
  frame(transformText('point'),'<h3>'+esc(data.seriesName)+' - '+(data.point+1)+'</h3>'+measurementTransformDescription(data.projection,{esc,text:transformText,numberText})+datasetResourcePolicyDescription(data.resourcePolicy,{esc,title:transformText('resourcesSaved')})+'<div class="material-fields measurement-details">'+Object.entries(data.coordinates).map(([field,item])=>'<section><h4>'+esc(coordinateLabel(field))+'</h4><dl><dt>'+esc(transformText('projected'))+'</dt><dd>'+esc(data.coordinate[field])+'</dd><dt>'+esc(transformText('exactValue'))+'</dt><dd><code class="material-hash">'+esc(item.exact)+'</code></dd><dt>'+esc(transformText('error'))+'</dt><dd><code class="material-hash">'+esc(fraction(item.error))+'</code></dd></dl></section>').join('')+'</div><h3>'+esc(transformText(data.operation==='raw'?'sources':'members'))+'</h3><p>'+data.total.toLocaleString()+'</p>'+data.members.map(member=>'<div><p>Page '+(member.position.page+1)+', row '+(member.position.row+1)+'</p>'+member.cells.map(cell=>button(esc(cell.field)+' - column '+(cell.source.selector.column+1),'measurement-inspect','data-source="'+esc(JSON.stringify(cell.source))+'"')).join('')+'</div>').join('')+(data.previous!==null?button(esc(transformText('previous')),'plot-point',pointAttributes+' data-offset="'+data.previous+'"'):'')+(data.next!==null?button(esc(transformText('next')),'plot-point',pointAttributes+' data-offset="'+data.next+'"'):''),button(esc(transformText('points')),'plot-points')+button(esc(transformText('back')),'plot-back'));
 }
 const referenceList=refs=>`<ul>${refs.map(r=>`<li>${button(esc(catalog.find(m=>m.id===r.id&&m.revision===r.revision)?.title??analysisText(r.kind==='record'?'retainedRecord':'retainedInput')),'reference',`data-ref="${esc(JSON.stringify(r))}"`)} · ${esc(r.kind)} · ${r.revision.slice(0,12)}</li>`).join('')}</ul>`;
 async function datasetView(){
  frame('Loading dataset','<p role="status">Opening retained rows...</p>');
  const generation=jobView,data=await call('rows',{ref:selectedRef,page,columnOffset});guard();const c=opened.content;
  if(generation!==jobView||!document.getElementById('dialog')?.open)return;
  frame(opened.title,`<p>${data.rowCount.toLocaleString()} original rows · Page ${data.pages?page+1:0} of ${data.pages}. Original values retain their spelling. Expand a row number for its identity.</p>
   <div class="material-table" tabindex="0" role="region" aria-label="Dataset values"><table><thead><tr><th>Row</th>${data.columns.map(col=>`<th>${esc(col.name)}<small>${esc(col.representation)}${col.representation==='radix'?' · base '+col.radix:''} · ${esc(col.unit)}</small>${computationLabel(col)?'<small>'+esc(computationLabel(col))+'</small>':''}</th>`).join('')}<th>Exclusion</th></tr></thead><tbody>${data.rows.map(r=>`<tr><th scope="row"><details class="material-row-identity"><summary>${esc(r.order??r.line)}</summary><span>${esc(r.id)}${r.locator?.pointer?'<br>'+esc(r.locator.pointer):''}</span></details></th>${r.cells.map((v,i)=>`<td><button type="button" class="link" data-action="material-measurement-inspect" data-source="${esc(JSON.stringify({ref:selectedRef,selector:{kind:'cell',page,row:data.rows.indexOf(r),column:columnOffset+i}}))}" aria-label="${esc(measurementText('inspect'))}: ${esc(data.columns[i].name)} · ${r.order}">${esc(['null','absent'].includes(r.valueKinds?.[i])?'['+r.valueKinds[i]+']':typeof v==='object'?(v.format==='domain-value'?(clockSynchronizationStatusDisplay(v)??clockStatusDisplay(v)??'Inspect '+domainDescription(v.definition)):'Open complete value ('+v.characters.toLocaleString()+' characters)'):v||'∅')}</button></td>`).join('')}<td>${esc(r.excluded??'')}</td></tr>`).join('')}</tbody></table></div>
   ${c.sourceMapping?`<details class="material-more"><summary>Source mapping</summary><p>${esc(c.sourceMapping.format)}${c.sourceMapping.rowsPath?' · Rows at '+esc(c.sourceMapping.rowsPath):''}</p>${preparation.summary(c.sourceMapping)}${(c.sourceMapping.fieldsInSchema||Array.isArray(c.sourceMapping.fields))?`<ul>${(c.sourceMapping.fieldsInSchema?data.columns.map(col=>col.sourceField).filter(Boolean):c.sourceMapping.fields).map(f=>`<li>${esc(f.name)}: ${esc(f.path)||'Row value'}</li>`).join('')}</ul><p>[null] means a declared JSON null; [absent] means the field was missing.</p>`:''}</details>`:''}
   <div class="inline-actions">${button('Previous columns','columns-prev',columnOffset?'':'disabled')}<span>Columns ${columnOffset+1}–${columnOffset+data.columns.length} of ${data.columnCount}</span>${button('Next columns','columns-next',columnOffset+data.columns.length<data.columnCount?'':'disabled')}</div>
   <div class="inline-actions">${button('Previous rows','rows-prev',page?'':'disabled')}${button('Next rows','rows-next',page+1<data.pages?'':'disabled')}${calculatorResultActions(c,{esc,button,readOnly:referenceContext})}${referenceContext?'':(c.calculatorResult?'':button('Edit schema & exclusions','schema'))+button(esc(synchronizationText('title')),'clock-sync-open',`data-ref="${esc(JSON.stringify(selectedRef))}"`)+button('Create reproducible figure','plot-form')+button(esc(aggregationText('open')),'aggregation-open',`data-ref="${esc(JSON.stringify(selectedRef))}"`)+(c.aggregation?button(esc(aggregationText('repeat')),'aggregation-repeat',`data-ref="${esc(JSON.stringify(selectedRef))}"`):'')+button(esc(calculationText('open')),'calculation-open',`data-ref="${esc(JSON.stringify(selectedRef))}"`)+(c.calculation?button(esc(calculationText('repeat')),'calculation-repeat',`data-ref="${esc(JSON.stringify(selectedRef))}"`):'')}${opened.previous?button('Previous revision','previous'):''}</div>`);
 }
 const missingRow=m=>`<div class="material-missing"><div class="material-fields">${field('Missing value (blank is allowed)',`<input data-missing="value" name="missing-${crypto.randomUUID()}" value="${esc(m.value)}">`)}${field('Meaning',`<input data-missing="meaning" name="meaning-${crypto.randomUUID()}" value="${esc(m.meaning)}">`)}</div>${button('Remove missing value','missing-remove')}</div>`;
 const exclusionRow=(row=1,reason='')=>`<div class="material-exclusion"><div class="material-fields">${field('Acquisition row',`<input data-exclusion="row" name="row-${crypto.randomUUID()}" type="number" min="1" max="${schemaRows.length}" value="${esc(row)}">`)}${field('Reason for exclusion',`<input data-exclusion="reason" name="reason-${crypto.randomUUID()}" value="${esc(reason)}">`)}</div>${button('Keep this observation','exclusion-remove')}</div>`;
 async function schemaForm(targetOffset=schemaOffset){
  const form=document.getElementById('material-form'),controls=[...document.querySelectorAll('#dialog input,#dialog select,#dialog textarea,#dialog button')].map(el=>({el,disabled:el.disabled}));
  form.dataset.busy='true';form.setAttribute('aria-busy','true');for(const {el} of controls)el.disabled=true;
  try{
  const generation=jobView,data=await call('schema',{ref:selectedRef,offset:targetOffset});guard();
  if(generation!==jobView||!document.getElementById('dialog')?.open)return;
  schemaOffset=targetOffset;schemaOriginal=data.items;schemaTotal=data.total;
  const columns=data.items.map((col,i)=>schemaDraft.get(schemaOffset+i)??col);frame('Dataset schema & exclusions',`<p>Saving creates a revision. Earlier analyses keep their original inputs. Values are never rewritten.</p>
   ${columns.map((col,i)=>`<details class="material-schema-column"${i===0?' open':''}><summary>${esc(col.name)}</summary>${computationLabel(col)?'<p>'+esc(computationLabel(col))+'</p>':''}<div data-material-column="${schemaOffset+i}" data-scalar-policy-owner="column" class="material-fields">
    ${field('Name',`<input data-schema="name" value="${esc(col.name)}">`)}
    ${field(esc(measurementText('representation')),`<select data-schema="representation">${REPRESENTATIONS.map(v=>option(v,measurementText(v==='radix'?'radixLabel':v),col.representation)).join('')}</select>`)}
    ${measurementDomainControls(col.domain,{esc,field,active:col.representation==='domain'})}
    ${field('Base (for explicit base)',`<input data-schema="radix" type="number" min="2" max="36" value="${col.radix}">`)}
    ${field('Unit',`<input data-schema="unit" value="${esc(col.unit)}">`)}
    <div data-column-policy${isScalarRepresentation(col)?'':' hidden'}>${scalarPolicyControls(col.resourcePolicy,{esc,field,kind:'column'})}</div>
    <div class="material-missing-group"><strong>Missing-value meanings</strong><div data-missing-list>${col.missing.map(m=>missingRow(m)).join('')}</div>${button('Add missing value','missing-add')}</div>
    ${provenanceFields(col,{esc,field})}
   </div></details>`).join('')}
   <input type="hidden" id="material-schema-structure" value="0"><fieldset><legend>Excluded observations</legend><p>Exclusions on this page only. Row numbers refer to this page; other pages keep their exclusions. Original values remain available.</p><div id="material-exclusions">${schemaExclusions.map(r=>exclusionRow(r.row,r.reason)).join('')}</div>${button('Exclude an observation','exclusion-add')}</fieldset>`,`<div class="material-schema-pagination">${button('Previous','schema-prev','aria-label="Previous schema columns" '+(schemaOffset?'':'disabled'))}<span>${schemaOffset+1}–${schemaOffset+columns.length} of ${schemaTotal} columns</span>${button('Next','schema-next','aria-label="Next schema columns" '+(schemaOffset+columns.length<schemaTotal?'':'disabled'))}</div>`+button('Save dataset revision','schema-save')+button('Back to evidence','home'));
  if(schemaDraft.size||JSON.stringify(schemaExclusions)!==schemaInitialExclusions)document.getElementById('material-schema-structure').value='1';
  {const element=document.getElementById('material-form'),reference=structuredClone(selectedRef),provenance=wireProvenance(element,{call,esc,field,recordId:owner,guard,available:()=>element.dataset.busy!=='true',reference:node=>({ref:reference,column:Number(node.closest('[data-material-column]').dataset.materialColumn)})}),domains=wireMeasurementDomains(element),policies=wireScalarPolicies(element,'column'),refresh=event=>{if(event.target.matches('[data-schema=representation]'))event.target.closest('[data-material-column]').querySelector('[data-column-policy]').hidden=!isScalarRepresentation(event.target.value);};element.addEventListener('change',refresh);schemaDispose=()=>{provenance();domains();policies();element.removeEventListener('change',refresh);};schemaDispose.ready=()=>provenance.ready();}
  }finally{delete form.dataset.busy;form.removeAttribute('aria-busy');for(const {el,disabled} of controls)if(el.isConnected)el.disabled=disabled;}
 }
 function captureSchema({validate=false}={}){
  for(const node of document.querySelectorAll('[data-material-column]')){
   const index=Number(node.dataset.materialColumn),get=k=>node.querySelector('[data-schema="'+k+'"]').value;
   const resourcePolicy=isScalarRepresentation(get('representation'))?readScalarPolicy(node,'column',{validate}):undefined;
   const column={...(schemaOriginal[index-schemaOffset].synchronization?{synchronization:schemaOriginal[index-schemaOffset].synchronization}:{}),...(schemaOriginal[index-schemaOffset].computation?{computation:schemaOriginal[index-schemaOffset].computation}:{}),...(resourcePolicy?{resourcePolicy}:{}),name:get('name'),representation:get('representation'),...(get('representation')==='domain'?{domain:readMeasurementDomain(node,{validate})}:{}),radix:Number(get('radix')),unit:get('unit'),missing:[...node.querySelectorAll('.material-missing')].map(row=>({value:row.querySelector('[data-missing="value"]').value,meaning:row.querySelector('[data-missing="meaning"]').value})),...readProvenance(node,schemaOriginal[index-schemaOffset],{validate})};
   if(JSON.stringify(column)===JSON.stringify(schemaOriginal[index-schemaOffset]))schemaDraft.delete(index);else schemaDraft.set(index,column);
  }
  schemaExclusions=[...document.querySelectorAll('.material-exclusion')].map(node=>({row:node.querySelector('[data-exclusion="row"]').value,reason:node.querySelector('[data-exclusion="reason"]').value}));
 }
 function capturePlot({validate=false}={}){
   const mapping={numericPolicy:document.getElementById('material-approximate').checked?'approximate':'safe',x:Number(value('x')),xKind:value('x-kind'),values:[...document.querySelectorAll('[data-material-value]:checked')].map(el=>({column:Number(el.dataset.materialValue),...readIntervalMapping(document.querySelector('[data-material-intervals="'+el.dataset.materialValue+'"]')),count:(v=>v===''?null:Number(v))(document.querySelector('[data-material-intervals="'+el.dataset.materialValue+'"] [data-marker-count-column]').value)})),group:value('group')===''?null:Number(value('group')),operation:value('operation'),order:'source',kind:value('chart'),decimal:'.',mode:'replace'},base=plotBase;base.title=value('title');if(mapping.kind==='heatmap')base.heatmap=heatmapSettings.read();if(mapping.values.some(v=>v.count!=null)){const root=document.querySelector('[data-retained-marker]');base.markerArea={...defaultMarkerArea(),label:root.querySelector('[data-marker-area="label"]').value,unitArea:Number(root.querySelector('[data-marker-area="unitArea"]').value)};}
  const retainedOrder=plotDraft?.mapping.values.map(value=>value.column)??[],chosen=new Map(mapping.values.map(value=>[value.column,value]));mapping.values=[...retainedOrder.filter(index=>chosen.has(index)),...mapping.values.map(value=>value.column).filter(index=>!retainedOrder.includes(index))].map(index=>chosen.get(index));
  mapping.resourcePolicy=readDatasetResourcePolicy(document.getElementById('material-form'),{validate});
  const projection=readMeasurementTransform(document.getElementById('material-form'),{xKind:mapping.xKind,validate,resourcePolicy:mapping.resourcePolicy,text:transformText});if(projection)mapping.projection=projection;
  plotDraft={title:value('title'),mapping,revised:plotDraft?.revised===true};return {recordId:owner,title:plotDraft.title,dataset:selectedRef,mapping,base};
 }
 async function plotForm({offset=0,restore=false}={}){
  if(!restore){plotIntent=null;plotBase=createFigure();plotDraft={title:opened.title,mapping:{resourcePolicy:defaultDatasetResourcePolicy(),numericPolicy:'safe',x:0,xKind:'category',group:null,values:[],operation:'raw',kind:'line',order:'source',decimal:'.',mode:'replace'}};}
  const selected=[...new Set([plotDraft.mapping.x,plotDraft.mapping.group,...plotDraft.mapping.values.flatMap(v=>[v.column,v.error,...INTERVAL_FIELDS.map(k=>v[k]),v.count])].filter(i=>i!==null&&i!==undefined))];
  frame('Loading schema','<p role="status">Opening retained columns...</p>');
  const generation=jobView,data=await loadDatasetColumnWindow(call,selectedRef,{offset,selected});guard();
  if(generation!==jobView||!document.getElementById('dialog')?.open)return;
  const c={...opened.content,columns:data.items.map(({column,index})=>({...column,index}))},mapping=plotDraft.mapping;frame('Create reproducible figure',`${titleField(plotDraft.title)}${plotDraft.revised?'<p>'+esc(transformText('revisedSettings'))+'</p>':''}
   <p>Source revision ${selectedRef.revision.slice(0,12)}. Plot coordinates are approximate decimal values; exact source values remain in the dataset. Explicit-base integers can be labels.</p>
   ${datasetColumnPager(data,{esc})}<div class="material-fields">${choose('Horizontal column','x',c.columns.map(col=>[col.index,col.name]),mapping.x)}${choose('Horizontal representation','x-kind',[['category','Labels (preserve spelling)'],['number','Numeric'],['date','ISO calendar dates']],mapping.xKind)}${choose('Chart type','chart',FIGURE_TYPES,mapping.kind)}${choose('Transformation','operation',FIGURE_OPERATIONS,mapping.operation)}${choose('Split series by','group',[['','No grouping'],...c.columns.map(col=>[col.index,col.name])],mapping.group??'')}</div>
   <fieldset><legend>Numeric value columns</legend>${c.columns.map(col=>{const i=col.index,v=mapping.values.find(v=>v.column===i);return `<label class="material-choice"><input type="checkbox" data-material-value="${i}"${v?' checked':''}${['integer','decimal','radix','radix-fraction','rational'].includes(col.representation)?'':' disabled'}>${esc(col.name)} · ${esc(col.representation)}</label><div data-material-intervals="${i}"${v?'':' hidden'}>${intervalMappingControls(c.columns,{esc,values:v??{}})}${markerMapping(c.columns,esc,v?.count??null)}</div>`;}).join('')}</fieldset>
   <p>Declare numeric columns in “Edit schema &amp; exclusions” first. Count rows also works with text categories. Calculations read retained pages. Figures keep the complete retained result; the reader displays a selected range and exports the complete figure.</p><details data-plot-resources><summary>${esc(transformText('resourcesTitle'))}</summary>${datasetResourcePolicyControls(mapping.resourcePolicy,{esc,field,help:transformText('resourcesHelp'),legacy:'',footer:transformText('resourcesNotes')})}</details>${field(esc(measurementText('approximate')),'<input id="material-approximate" type="checkbox"'+(mapping.numericPolicy==='approximate'?' checked':'')+'>')}<p>${esc(measurementText('approximateHelp'))}</p>${measurementTransformControls(mapping.projection,{esc,field,xKind:mapping.xKind,resourcePolicy:mapping.resourcePolicy,text:transformText,numberText})}<div data-retained-marker>${markerControls(plotBase,esc)}</div><div data-retained-heatmap hidden></div>${button('Calculate & retain figure','plot')}`);
  for(const control of document.querySelectorAll('[data-column-window]'))control.onclick=async()=>{control.disabled=true;try{const next=datasetColumnPageOffset(control);capturePlot();await plotForm({offset:next,restore:true});}catch(error){notify(error.message,true);}finally{if(control.isConnected)control.disabled=false;}};
  const form=document.getElementById('material-form'),transformView=jobView,transforms=wireMeasurementTransforms(form,{xKind:()=>value('x-kind'),resourcePolicy:root=>readDatasetResourcePolicy(root.querySelector('[data-plot-resources]')),guard:()=>currentView(transformView),available:()=>document.getElementById('material-form')===form&&!form.dataset.busy});
  const horizontalKind=document.getElementById('material-x-kind');horizontalKind.addEventListener('change',transforms.refresh);schemaDispose=()=>{horizontalKind.removeEventListener('change',transforms.refresh);transforms.dispose();};
  document.querySelector('[data-retained-marker] [data-marker-area="enabled"]').closest('label').remove();
  for(const el of document.querySelectorAll('[data-material-value]'))el.addEventListener('change',()=>document.querySelector('[data-material-intervals="'+el.dataset.materialValue+'"]').hidden=!el.checked);
  const heatmapHost=document.querySelector('[data-retained-heatmap]');heatmapSettings=mountHeatmap(heatmapHost,{esc,notify,...(plotBase.heatmap?{initial:plotBase.heatmap}:{})});heatmapHost.hidden=mapping.kind!=='heatmap';document.getElementById('material-chart').addEventListener('change',event=>{heatmapHost.hidden=event.target.value!=='heatmap';if(!heatmapHost.hidden)document.getElementById('material-x-kind').value='category';transforms.refresh();});
 }
 async function addFigure(figure){
  if(state.page==='record-reader'&&editRetainedFigure){guard();document.getElementById('dialog').close();await editRetainedFigure({recordId:owner,figure});return;}
  guard();const e=editableRecord(state.book,state.selected),existing=e.figures.findIndex(f=>f.id===figure.id);
  if(existing>=0&&!confirm('Replace this record figure with the retained calculation? Earlier analysis revisions remain available.'))return;
  if(existing>=0)e.figures[existing]=structuredClone(figure);else e.figures.push(structuredClone(figure));
  dirty();document.getElementById('dialog').close();render();notify('Figure added to the draft. Review and save the record.');
 }
 async function openRevision(target,options){
  owner=record()?.id??null;workspaceContext=state.storage?.contextId;projectOwner=researchOwner(state);referenceContext=true;
  if(state.storage?.researchStorage==='catalogue')return retainedRecords.open(target,options);
  const generation=jobView,context=state.storage?.contextId,recordId=state.selected,{selector,...ref}=target,snapshot=await call('read',{ref});
  if(generation!==jobView||context!==state.storage?.contextId||recordId!==state.selected)return;
  historical={target,snapshot};
  frame(snapshot.title,`<p>Retained revision &middot; ${target.revision}</p>${recordRevisionView(snapshot,esc,{anchors:true,figureReference:target,assetUrl:id=>route('/api/media/'+id)})}`,button('Compare with current record','compare-record')+button('Close','close'));
  if(selector){const el=document.getElementById('dialog').querySelector('[id="'+selectorAnchor(selector)+'"]');if(el){el.tabIndex=-1;el.focus();el.scrollIntoView({block:'start'});}else notify(bookTranslate('book','unavailable'),true);}
 }
 async function action(control){
  const name=control.dataset.action;if(!name?.startsWith('material-'))return false;const act=name.slice(9);
  if(act.startsWith('correction-'))return corrections.action(act,control);
  if(corrections.isBusy())return true;
  if(act==='plot-points'){await plotPoints(Number(control.dataset.offset??0));return true;}
  if(act==='plot-point'){await plotPoint(control.dataset.pointId?{pointId:control.dataset.pointId,seriesId:control.dataset.seriesId}:Number(control.dataset.index),Number(control.dataset.offset??0));return true;}
  if(act==='plot-back'){await inspect(selectedRef);return true;}
  if(act==='retained-figure'){await openRetainedFigure(control);return true;}
  if(act==='figure-source'){await openReference(JSON.parse(control.dataset.ref));return true;}
  if(act.startsWith('measurement-')){if(act==='measurement-inspect')await authorizeSource(JSON.parse(control.dataset.source).ref);if(act==='measurement-from-artifact')await authorizeSource(JSON.parse(control.dataset.ref));return measurements.action(act,control);}
  if(act.startsWith('comparison-'))return comparisons.action(act,control);
  if(act.startsWith('clock-sync-'))return referenceContext?true:synchronization.action(act,control);
  if(act.startsWith('calculation-'))return referenceContext?true:calculations.action(act,control);
  if(act.startsWith('aggregation-'))return referenceContext?true:aggregations.action(act,control);
  if(act==='calculator-repeat'||act==='calculator-resume'){
   if(referenceContext||!opened||act==='calculator-repeat'&&!opened.content.calculatorResult||act==='calculator-resume'&&!opened.content.recipe||repeating)return true;guard();const generation=jobView,reference=structuredClone(selectedRef),workspaceId=state.book.id,key=JSON.stringify([workspaceContext,projectOwner,reference]);
   if(calculatorIntent?.key!==key)calculatorIntent={key,jobId:crypto.randomUUID()};const intent=calculatorIntent;repeating=true;control.disabled=true;
   const run=async()=>{currentView(generation);try{const result=await call(act,{workspaceId,ref:reference,...(act==='calculator-repeat'?{jobId:intent.jobId}:{})});currentView(generation);return result;}catch(error){currentView(generation);throw error;}};
   try{const result=await access(run);currentView(generation);calculatorIntent=null;await watchJob(result.job);}finally{repeating=false;if(control.isConnected)control.disabled=false;}return true;
  }
  if(act==='pause'){controller?.abort();uploader.pause();return true;}
  if(control.dataset.action?.startsWith('material-readiness-'))return readiness.action(control);
  if(control.dataset.action?.startsWith('material-intake-'))return intake.action(control);
  if(control.dataset.action?.startsWith('material-continuing-'))return continuing.action(control);
  if(act.startsWith('reuse-original-')){guard();return reuse.action(act,control);}
  if(reuse.isBusy())return true;
  if(uploading||uploader.isBusy()||intake.isBusy()){notify('Pause or finish the import before leaving.',true);return true;}
  if(act==='compare-record'){
   const generation=jobView,context=state.storage?.contextId,recordId=state.selected,revision=historical;
   const {record:current}=await call('current-record',{id:revision.target.id});
   if(generation!==jobView||context!==state.storage?.contextId||recordId!==state.selected||historical!==revision)return true;
   if(!current){notify('The current record is unavailable. The retained revision remains readable.',true);return true;}
   frame('Compare retained and current record',recordRevisionComparison(historical.snapshot,current,esc,{previousFigureReference:historical.target,assetUrl:id=>route('/api/media/'+id)}),button('Close','close'));return true;
  }
  if(act==='close'){stopWatching();document.getElementById('dialog').close();return true;}
  if(act==='open'){referenceOrigin=control.dataset.readonly==='true';referenceContext=referenceOrigin;readingOverview=referenceOrigin;readNamespace=state.book?.id;referenceTrail=[];if(!saved()){notify('Save the record before opening evidence and analysis.',true);return true;}if(owner!==record().id||workspaceContext!==state.storage?.contextId||!sameResearchOwner(projectOwner,researchOwner(state))){referenceIntent=null;referenceDraft=null;draftCursor=null;datasetJobCursor=null;materialCursor=null;importCursor=null;}owner=record().id;workspaceContext=state.storage?.contextId;projectOwner=researchOwner(state);await home();return true;}
  if(act==='repeat'){
   if(!saved()){notify('Save this run first.',true);return true;}
   if(repeating)return true;
   const previous=structuredClone(record()),context=state.storage?.contextId,bookId=state.book.id;
   const controls=[...document.querySelectorAll('main input,main textarea,main select,main button')].map(el=>({el,disabled:el.disabled}));
   const main=document.querySelector('main'),wasInert=main.inert;
   repeating=true;main.inert=true;main.setAttribute('aria-busy','true');for(const {el} of controls)el.disabled=true;
   try{
    const pinned=await call('pin',{id:previous.id,expectedRevision:revisions()[previous.id]});
    if(context!==state.storage?.contextId||bookId!==state.book.id||record()?.id!==previous.id)throw Error('The workspace or record changed. Reopen the run.');
    const next=createRun(state.book,previous,{previous,revision:pinned.revision});
    create(next,previous);notify('New run draft. Record deliberate changes and deviations separately.');
   }finally{repeating=false;main.inert=wasInert;main.removeAttribute('aria-busy');for(const {el,disabled} of controls)if(el.isConnected)el.disabled=disabled;}
   document.querySelector('[data-entry="title"]')?.focus();return true;
  }
  guard();
  if(act==='home'){stopWatching();await home();}
  if(act==='job-open'){const session=imports[Number(control.dataset.index)];await watchJob((await call('job',{id:session.id})).job);}
  if(act==='job-start'){const session=imports[Number(control.dataset.index)];await watchJob((await call('finish',{id:session.id})).job);}
  if(act==='plot-job-settings'){
   const generation=jobView;control.disabled=true;
   try{const {command}=await call('plot-job-settings',{id:control.dataset.job,recordId:owner},{adopt:false});currentView(generation);
    if(command.recordId!==owner)throw Error('The record changed. Reopen evidence.');
    const doc=await call('read',{ref:command.dataset},{adopt:false});currentView(generation);
    selectedRef=command.dataset;opened=doc;plotIntent=null;plotBase={...structuredClone(command.base),id:crypto.randomUUID(),series:[]};
    plotDraft={title:command.title,mapping:{...structuredClone(command.mapping),resourcePolicy:command.mapping.resourcePolicy??defaultDatasetResourcePolicy()},revised:true};await plotForm({restore:true});
   }finally{if(control.isConnected)control.disabled=false;}return true;
  }
  if(act==='job-cancel'||act==='job-retry'){
   const generation=jobView,id=control.dataset.job;control.disabled=true;
   try{
    if(act==='job-retry'){
     const result=await call('job',{id},{adopt:false});currentView(generation);
     if(result.job.type==='analysis.compare'&&state.storage?.researchStorage==='catalogue')for(const source of result.job.sources??[]){await sources.resolve(inheritMaterialNamespace(source,state.book.id),{unlock:true});currentView(generation);}
    }
    const run=async()=>{currentView(generation);try{const result=await call(act==='job-cancel'?'cancel-job':'retry-job',{id});currentView(generation);return result;}catch(error){currentView(generation);throw error;}};
    const result=await(act==='job-retry'?access(run):run());await watchJob(result.job);
   }finally{if(control.isConnected)control.disabled=false;}
  }
  if(act==='upload-form')await uploader.form();
  if(act==='resume-form')await uploader.form(imports[Number(control.dataset.index)]);
  if(act==='upload')await uploader.upload();
  if(act==='dataset-form')await datasetForm();
  if(['mapping-add','mapping-remove','lookup-add','lookup-remove'].includes(act)){const marker=document.getElementById('material-mapping-structure');marker.value=String(Number(marker.value)+1);previewController?.abort();document.getElementById('material-mapping-preview').replaceChildren();}
  if(act==='mapping-add')document.getElementById('material-json-fields').insertAdjacentHTML('beforeend',mappingRow());
  if(act==='mapping-remove')control.closest('.material-json-field').remove();
  if(act==='lookup-add')document.getElementById('material-lookups').insertAdjacentHTML('beforeend',preparation.joinRow());
  if(act==='lookup-remove')control.closest('.material-lookup').remove();
  if(['mapping-add','lookup-add','lookup-remove'].includes(act))preparation.refresh();
  if(act==='dataset-create'){control.disabled=true;try{await watchJob((await queueDataset(datasetCommand())).job);}finally{control.disabled=false;}}
  if(act==='dataset-preview'){
   previewController?.abort();const preview=previewController=new AbortController();let data;
   try{data=await call('dataset-preview',datasetCommand(),{signal:preview.signal});}catch(error){if(preview.signal.aborted)return true;throw error;}
   guard();if(preview.signal.aborted||!document.getElementById('material-mapping-preview'))return true;
   document.getElementById('material-mapping-preview').innerHTML='<p>First '+data.rows.length+' rows and '+data.columns.length+' of '+data.columnCount+' columns. The complete file is validated when preparing the dataset.</p><div class="material-table" tabindex="0" role="region" aria-label="Mapping preview"><table><thead><tr>'+data.columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead><tbody>'+data.rows.map(r=>'<tr>'+r.cells.map((c,i)=>'<td>'+esc(['null','absent'].includes(r.valueKinds?.[i])?'['+r.valueKinds[i]+']':c)+(r.truncated?.[i]?' [preview shortened]':'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  if(act==='dataset-job')await watchJob((await call('job',{id:control.dataset.job})).job);
  if(act==='heads-next'){materialCursor=materialPage.next;await home();}
  if(act==='heads-first'){materialCursor=null;await home();}
  if(act==='imports-next'){importCursor=importsNext;await home();}
  if(act==='imports-first'){importCursor=null;await home();}
  if(act==='dataset-jobs-next'){datasetJobCursor=datasetJobPage.next;await home();}
  if(act==='dataset-jobs-first'){datasetJobCursor=null;await home();}
  if(act==='drafts-first'){draftCursor=null;await home();}
  if(act==='drafts-next'){draftCursor=draftPage.next;await home();}
  if(act==='draft-open')await draftForm(control.dataset.id);
  if(act==='draft-back')await draftForm(referenceDraft.id);
  if(act==='draft-select')await draftSelect(control.dataset.slot);
  if(act==='draft-retry')await saveReferenceSelection();
  if(act==='draft-finish'){
   const id=referenceDraft.id,status=document.getElementById('material-draft-status');uploading=true;control.disabled=true;
   if(status)status.textContent='Completing selection...';
   try{await call('draft-finish',{id});guard();referenceIntent=null;await home({fresh:true});}
   catch(error){if(status?.isConnected)status.textContent='Completion could not be confirmed. Retry to check the saved result. '+(error.message??'Connection interrupted.');}
   finally{uploading=false;if(control.isConnected)control.disabled=false;}
  }
  if(act==='draft-cancel'){if(confirm('Discard this unfinished selection? Retained records and original files remain available.')){await call('draft-cancel',{id:referenceDraft.id});referenceIntent=null;await home({fresh:true});}}
  if(act==='draft-save-selection'){
   const slot=control.dataset.slot,selection=sourcePickers.remaining.snapshot(),draft=referenceDraft;
   if(!selection.count||selection.count>draft.totals[slot]-draft.received[slot])throw Error('Select between 1 and '+(draft.totals[slot]-draft.received[slot])+' remaining '+slot+'.');
   referenceIntent={id:draft.id,kind:draft.kind,inputs:null,outputs:null,[slot]:selection,offsets:{...draft.received},finish:false};await saveReferenceSelection();
  }
  if(act==='analysis-form')await analysisForm();
  if(act==='collection-form')await analysisForm(true);
  if(act==='analysis-save'){
   const inputs=sourcePickers.inputs.snapshot();
   if(!opened.collection)inputs.extra=sourcePickers.method.values();
   const command={recordId:owner,title:value('title'),inputs};
   if(!opened.collection)Object.assign(command,{tool:value('tool'),version:value('version'),parameters:value('parameters'),outputs:sourcePickers.outputs.snapshot()});
   if(!opened.collection){assertAnalysisFieldsReady(document.getElementById('material-form'));command.method=readAnalysisMethod(document.getElementById('material-form'));if(!validAnalysisMethod(command.method))throw Error(atext('invalid'));}
   if(!command.title.trim()||!opened.collection&&(!selectionSize(inputs)||!command.tool.trim()||!command.version.trim()))throw Error(analysisText('required'));
   const {inputs:selectedInputs,outputs=null,...metadata}=command,kind=opened.collection?'collection':'analysis';
   referenceIntent={id:crypto.randomUUID(),kind,command:{...metadata,kind,totals:{inputs:selectionSize(selectedInputs),outputs:selectionSize(outputs)}},inputs:selectedInputs,outputs,offsets:{inputs:0,outputs:0},finish:true};
   await saveReferenceSelection();
  }
  if(act==='inspect')await inspect(items[Number(control.dataset.index)]);
  if(act==='reference'){const r=JSON.parse(control.dataset.ref);await authorizeSource(r);if(referenceContext&&selectedRef)referenceTrail.push({ref:selectedRef,page});if(r.kind==='record')await openRevision(r);else await inspect(r);}
  if(act==='reference-back'){const previous=referenceTrail.pop();if(previous)await inspect(previous.ref,{atPage:previous.page});}
  if(act==='previous')await inspect({...selectedRef,revision:opened.previous});
  if(act==='rows-prev'){page--;await datasetView();}
  if(act==='rows-next'){page++;await datasetView();}
  if(act==='schema'){
   const generation=jobView,data=await call('rows',{ref:selectedRef,page,columnOffset});guard();if(generation!==jobView)return true;
   schemaRows=data.rows;schemaOffset=columnOffset;schemaDraft=new Map();schemaExclusions=schemaRows.flatMap((r,i)=>r.excluded?[{row:String(i+1),reason:r.excluded}]:[]);schemaInitialExclusions=JSON.stringify(schemaExclusions);await schemaForm();
  }
  if(['missing-add','missing-remove','exclusion-add','exclusion-remove'].includes(act)){
   const structure=document.getElementById('material-schema-structure');structure.value=String(Number(structure.value)+1);
   if(act==='missing-add')control.closest('.material-missing-group').querySelector('[data-missing-list]').insertAdjacentHTML('beforeend',missingRow({value:'',meaning:''}));
   if(act==='missing-remove')control.closest('.material-missing').remove();
   if(act==='exclusion-add')document.getElementById('material-exclusions').insertAdjacentHTML('beforeend',exclusionRow());
   if(act==='exclusion-remove')control.closest('.material-exclusion').remove();
  }
  if(act==='schema-save'){
   const current=document.getElementById('material-form'),selection=selectedRef;await schemaDispose?.ready?.();guard();if(current!==document.getElementById('material-form')||!current.isConnected||selection!==selectedRef)throw new DOMException('Dataset schema changed','AbortError');captureSchema({validate:true});const columnChanges=[...schemaDraft].map(([index,column])=>({index,column}));
   const exclusions={...Object.fromEntries(schemaRows.map(r=>[r.id,null]))};
   const seen=new Set();for(const item of schemaExclusions){const row=Number(item.row);if(!Number.isInteger(row)||!schemaRows[row-1]||!item.reason.trim()||seen.has(row))throw Error('Choose a distinct acquisition row and explain its exclusion.');seen.add(row);exclusions[schemaRows[row-1].id]=item.reason;}
   await watchJob((await queueDataset({recordId:owner,title:opened.title,id:opened.id,expectedRevision:selectedRef.revision,artifact:opened.content.inputs[0],baseDataset:selectedRef,sourceMapping:opened.content.sourceMapping,columnChanges,exclusions})).job);
  }
  if(act==='columns-prev'||act==='columns-next'){columnOffset+=act==='columns-next'?16:-16;await datasetView();}
  if(act==='schema-prev'||act==='schema-next'){const current=document.getElementById('material-form'),selection=selectedRef;await schemaDispose?.ready?.();guard();if(current!==document.getElementById('material-form')||!current.isConnected||selection!==selectedRef)throw new DOMException('Dataset schema changed','AbortError');captureSchema();await schemaForm(schemaOffset+(act==='schema-next'?16:-16));}
  if(act==='plot-form')await plotForm();
  if(act==='plot'){await submitPlot(()=>capturePlot({validate:true}));}
  if(act==='attach'){const retained=opened.recordId===owner?{ref:selectedRef,figure:opened.content.figure}:await call('reuse',{recordId:owner,analysis:selectedRef});await addFigure(withFigureSource(retained.figure,retained.ref));}
  if(act==='recalculate'){
   const previous=opened,revision=selectedRef.revision;
   await submitPlot(async()=>{
    const latest=(await call('current',{id:previous.content.inputs[0].id})).item;if(!latest)throw Error('The source dataset is unavailable.');
    return {recordId:owner,title:previous.title,id:previous.id,expectedRevision:revision,dataset:ref(latest),mapping:previous.content.mapping,base:previous.content.figure};
   });
  }
  if(act==='download'){
   guard();const a=document.createElement('a');a.href=originalRoute(selectedRef)+'?context='+encodeURIComponent(workspaceContext);a.download=opened.content.name;a.click();
  }
  if(act==='verify'){notify('Verifying retained revisions and original bytes…');const result=await call('verify');notify('Verified '+result.revisions+' revisions and '+result.originalBytes.toLocaleString()+' original bytes.');}
  return true;
 }
 async function openReference(target){
  referenceOrigin=true;readingOverview=false;owner=record()?.id??null;workspaceContext=state.storage?.contextId;projectOwner=researchOwner(state);referenceContext=true;readNamespace=state.book?.id;referenceTrail=[];selectedRef=null;
  if(target.kind==='record')return openRevision(target);
  return inspect(target);
 }
 async function pinFigureSources(figures){
  const recordId=record()?.id,context=state.storage?.contextId,project=researchOwner(state),before=JSON.stringify(figures);
  if(!revisions()[recordId])return;
  const result=await api(projectApiRoute(endpoint+'figure-sources',project),{recordId,figures},{adopt:false,owner:project});
  if(record()?.id!==recordId||state.storage?.contextId!==context||!sameResearchOwner(project,researchOwner(state))||JSON.stringify(figures)!==before)throw Error(t('figureProvenance','changed'));
  const byId=new Map(result.sources.map(s=>[s.figureId,s.ref]));for(const figure of allFigurePlots(figures))if(byId.has(figure.id))figure.source=byId.get(figure.id);
 }
 return {view,action,openRevision,openReference,pinFigureSources,isReadingReference:()=>referenceContext,isBusy:()=>uploading||repeating||corrections.isBusy()||reuse.isBusy()||intake.isBusy()||measurements.isBusy()||comparisons.isBusy()||calculations.isBusy()||aggregations.isBusy()||synchronization.isBusy()};
}
