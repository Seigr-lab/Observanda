import {retainedTableAction} from './retained-table-reader.js';
import {bindReadingTables} from './record-reading-tables.js';
import {ownedAssetURL} from './project-context.js';
import {t} from './i18n/index.js';
import {recordRevisionView,recordRevisionField} from './record-revision-view.js';
import {attemptView} from './attempt-view.js';
import {resultStatementsView} from './result-statements.js';
import {renderProse} from './prose-model.js';
import {applyRichTextStyles} from './rich-text-stylesheet.js';
import {recordFigureRenderer} from './book-reading.js';
import {recordSectionActions} from './record-section-actions.js';
import {recordValueControls,recordContributorControls,recordFigureAction,recordAttemptControls,recordResultControls} from './record-value-controls.js';
import {recordHeaderControls} from './record-header-controls.js';
import {recordMediaControls} from './record-media-values-ui.js';
import {recordMediaActions} from './record-media-actions.js';
import {recordFigureActions} from './record-figure-actions.js';
import {recordTagActions} from './record-tag-actions.js';
import {recordEditingView} from './record-editing-view.js';
import {focusElement} from './focus-management.js';
import {figureResultLinks,resultStatementAnchor} from './figure-result-links.js';

// Reading windows live outside editable workspace snapshots. Selected editing
// owners persist their own values, so a window can never overwrite omissions.
export function recordContentUI({state,api,esc,field,render,report,refresh,editWriting,tools=()=>'',before=()=>'',after=()=>'',links=()=>'',attemptReference=null,resultReference=null}){
 const assetUrl=id=>ownedAssetURL(state,'/api/media/'+id);
 const text=(key,args)=>t('recordContent',key,args);
 let owner=null,reading=null,controller=null,busy=false,error=null,offset=0,search='',lastSearch=null,focus=null,lastAnchor=null,pending=null,progress=null,windows={},detailField='title',resultFigure=null,collectionFocus=null,pendingCollection=null;
 const identity=()=>state.page==='record-reader'&&!state.access?.locked&&!state.storageUnavailable&&state.book?JSON.stringify([state.storage?.contextId,state.book.id,state.selected,state.etag]):null;
 const sectionActions=recordSectionActions({state,api,esc,current:()=>owner===identity()?reading:null,refresh,edit:editWriting,render,report});
 const mediaActions=recordMediaActions({state,api,esc,current:()=>owner===identity()?reading:null,refresh,reveal:async position=>{windows={...windows,attachments:Math.max(0,position)};await load();},render,report});
 const figureCommands=recordFigureActions({state,api,esc,current:()=>owner===identity()?reading:null,refresh,reveal:async position=>{windows={...windows,figures:Math.max(0,position)};await load();},render,report});
 const tags=recordTagActions({state,api,esc,current:()=>owner===identity()?reading:null,refresh,reveal:async position=>{windows={...windows,tags:Math.max(0,position)};await load();},render,report});
 function clear(){sectionActions.checkContext();figureCommands.checkContext();tags.checkContext();controller?.abort();controller=null;owner=null;reading=null;busy=false;error=null;offset=0;search='';lastSearch=null;focus=null;lastAnchor=null;pending=null;progress=null;windows={};detailField='title';resultFigure=null;collectionFocus=null;pendingCollection=null;}
 async function load(extra={},retry=false){
  const key=identity();if(!key)return;
  controller?.abort();const request=new AbortController();controller=request;busy=true;error=null;
  if(!retry||!pending){
   pending={workspaceId:state.book.id,recordId:state.selected,snapshotId:reading?.etag??state.etag,offset,pagedHeader:true,windows:{...windows},...(resultFigure?{resultFigure}:{}),...extra};
   if(pending.resultFigure===null)delete pending.resultFigure;pendingCollection=collectionFocus;
  }
  try{
   let result;
   while(true){
    result=await api('/api/workspace/read/record-content',pending,{adopt:false,signal:request.signal});
    if(request.signal.aborted||identity()!==key)return;
    if(result.workspaceId!==state.book.id||result.recordId!==state.selected||result.etag!==pending.snapshotId)throw Error(text('failed'));
    if(!result.search)break;
    const next=result.search;if(typeof next.nextCursor!=='string'||next.nextCursor===pending.cursor||!Number.isSafeInteger(next.scanned)||next.scanned<1||next.scanned>=next.total)throw Error(text('failed'));
    progress=next;pending={...pending,cursor:next.nextCursor};render();
   }
   if(result.sections.values.length>4)throw Error(text('failed'));
   const header=result.header??reading?.header,resultPage=result.collections?.results;
   if(resultPage&&(![resultPage.offset,resultPage.count,resultPage.total].every(value=>Number.isSafeInteger(value)&&value>=0)||resultPage.count>4||resultPage.offset+resultPage.count>resultPage.total||(header?.results?.statements??[]).length!==resultPage.count))throw Error(text('failed'));
   reading={...result,header};offset=result.sections.offset;resultFigure=reading.resultWindow?.figureId??null;
   windows=Object.fromEntries(Object.entries(reading.collections??{}).map(([name,page])=>[name,page.offset]));
   const notebook=state.book.notebooks.find(n=>n.id===reading.header.notebookId);if(notebook){state.notebook=notebook.id;state.project=notebook.projectId;}
   if(pending.search&&result.found===null)error=text('noMatch');
   if(focus)focus=result.sections.values[0]?.id??null;
   pending=null;pendingCollection=null;progress=null;
  }catch(failure){if(!request.signal.aborted&&identity()===key){collectionFocus=null;error=failure.message??text('failed');if(failure.code==='ACCESS_LOCKED')report(failure);}}
  finally{if(controller===request){controller=null;busy=false;if(identity()===key)render();}}
 }
 const button=(key,action,disabled=false)=>'<button type="button" class="button" data-action="content-'+action+'" '+(disabled?'disabled':'')+'>'+esc(text(key))+'</button>';
 function navigation(){
  const {total,offset,values}=reading.sections;if(total<=4)return '';
  return '<nav class="record-section-navigation" aria-label="'+esc(text('navigation'))+'"><span role="status">'+esc(text('range',{first:offset+1,last:offset+values.length,total}))+'</span><div class="inline-actions">'+button('previous','previous',busy||offset===0)+button('next','next',busy||offset+values.length>=total)+'</div>'+field(esc(text('goTo')),'<input type="number" data-content-position min="1" max="'+total+'" required value="'+(offset+1)+'">')+button('go','go',busy)+'<div class="record-section-find">'+field(esc(text('findHeading')),'<input type="search" data-content-search value="'+esc(search)+'">')+button('findNext','find',busy)+'</div></nav>';
 }
 function view(){
  const editing=state.recordReading===false,controls='<div class="record-toolbar"><button class="button" data-action="back-to-records">'+esc(text('back'))+'</button><button class="button" data-action="'+(editing?'record-read':'record-edit')+'">'+esc(text(editing?'read':'edit'))+'</button>'+tools({readonly:!editing})+'</div>';
  const status=(error?'<p role="alert">'+esc(error)+'</p>'+button('retry','retry',busy):'')+(busy?'<div class="inline-actions"><p role="status">'+esc(progress?text('searchProgress',progress):text('loading'))+'</p>'+button('cancel','cancel')+'</div>':'');
  if(!reading||owner!==identity())return controls+'<section aria-busy="'+busy+'">'+(status||'<p role="status">'+esc(text('loading'))+'</p>')+'</section>';
  const figureReference={kind:'record',id:reading.recordId,revision:reading.revision,workspaceId:reading.workspaceId};
  const figureResults=figure=>figureResultLinks(figure,reading.resultFigures,esc);
  const record={...reading.header,sections:reading.sections.values},inlineRecord={...record,figures:[...record.figures,...reading.inline?.figures??[]],attachments:[...record.attachments,...reading.inline?.attachments??[]]},figureActions=editing?f=>'<div class="inline-actions">'+recordFigureAction(f,esc,busy)+figureCommands.controls(f)+'</div>':undefined,figure=recordFigureRenderer(inlineRecord,esc,{translate:t,assetUrl,figureActions,figureResults,figureReference});
  const fieldsHtml={};for(const [name,page] of Object.entries(reading.collections??{}))if(!name.startsWith('preparation:')&&!['relations','preparations','events','assessments','results'].includes(name)){
   const key=name==='fields'?'template':name;fieldsHtml[key]=page.total?recordHeaderControls(name,page,esc,busy)+recordRevisionField(key,record,esc,{assetUrl,figureActions,figureResults,figureReference}):'';
  }
  if(editing){
  fieldsHtml.contributors=recordHeaderControls('contributors',reading.collections?.contributors,esc,busy)+recordContributorControls(record,esc,busy);
  fieldsHtml.figures=figureCommands.add()+(fieldsHtml.figures??'');
  fieldsHtml.attempt=recordAttemptControls(record,esc,attemptReference,{window:reading.attemptWindow,navigation:name=>recordHeaderControls(name,reading.collections?.[name],esc,busy)});
  fieldsHtml.results=(resultFigure?'<div class="inline-actions"><p>'+esc(text('resultsForFigure'))+'</p>'+button('allResults','results-all',busy)+'</div>':'')+recordHeaderControls('results',reading.collections?.results,esc,busy)+recordResultControls(record,esc,resultReference);
  fieldsHtml.tags=recordHeaderControls('tags',reading.collections?.tags,esc,busy)+tags.view();
  fieldsHtml.attachments=mediaActions.add()+recordHeaderControls('attachments',reading.collections?.attachments,esc,busy)+recordMediaControls(record,esc,busy,mediaActions.controls,{assetUrl});
  }else{
   fieldsHtml.attempt=attemptView(record.attempt,esc,{reference:attemptReference,window:reading.attemptWindow,navigation:name=>recordHeaderControls(name,reading.collections?.[name],esc,busy)});
   fieldsHtml.results=(resultFigure?'<p>'+esc(text('resultsForFigure'))+'</p>'+button('allResults','results-all',busy):'')+recordHeaderControls('results',reading.collections?.results,esc,busy)+'<div class="record-result-values">'+resultStatementsView(record.results,esc,{reference:resultReference,workspaceId:reading.workspaceId})+'</div>';
  }
  const sections=()=>'<section class="record-sections">'+navigation()+record.sections.map((s,i)=>'<section id="record-section-'+s.id+'" tabindex="-1"><div class="section-bar"><h'+(editing?'3':'2')+'>'+esc(s.title)+'</h'+(editing?'3':'2')+'>'+(editing?'<button type="button" class="button" data-action="writing-edit" data-section="'+s.id+'">'+esc(text('editSection'))+'</button>':'')+'</div>'+(editing?sectionActions.controls(s,reading.sections.offset+i,reading.sections.total):'')+renderProse(s.body,{figure})+'</section>').join('')+'</section>';
  if(editing)return controls+recordEditingView({record,esc,status,busy,details:recordValueControls(record,esc,detailField),summary:'<button type="button" class="button" data-action="writing-edit">'+esc(text('editSummary'))+'</button><div class="prose">'+renderProse(record.body,{figure})+'</div>',sections:sectionActions.add()+sections(),fields:fieldsHtml,activity:before({readonly:false}),evidence:after({readonly:false}),relations:recordHeaderControls('relations',reading.collections?.relations,esc,busy)+links(record,{readonly:false})});
  return controls+'<article class="record-reader" aria-busy="'+busy+'"><h1>'+esc(record.title)+'</h1>'+status+recordRevisionView(record,esc,{relations:false,anchors:true,sectionsHtml:sections,fieldsHtml,inlineRecord,attemptReference,resultReference,figureActions,figureResults,figureReference,assetUrl})+before({readonly:true})+after({readonly:true})+recordHeaderControls('relations',reading.collections?.relations,esc,busy)+links(record,{readonly:true})+'</article>';
 }
 function bind(){
  bindReadingTables();
  const key=identity();if(!key){clear();return;}
  if(key!==owner){
   const previous=owner&&JSON.parse(owner),current=JSON.parse(key),sameRecord=previous&&previous.slice(0,3).every((v,i)=>v===current[i]),anchor=state.recordSection??(sameRecord?reading?.sections.values[0]?.id:null);
   const previousWindows=windows,previousDetail=detailField,previousFigure=resultFigure,previousOffset=offset;clear();if(sameRecord){windows=previousWindows;detailField=previousDetail;resultFigure=previousFigure;offset=previousOffset;}owner=key;lastAnchor=state.recordSection;void load(anchor?{anchor,...(resultStatementAnchor(anchor)?{resultFigure:null}:{})}:{});render();return;
  }
  if(state.recordSection&&state.recordSection!==lastAnchor){lastAnchor=state.recordSection;void load({anchor:lastAnchor,...(resultStatementAnchor(lastAnchor)?{resultFigure:null}:{})});render();return;}
  if(busy)return;
  if(reading)applyRichTextStyles(document,{...reading.header,sections:reading.sections.values});
  if(collectionFocus){
   const {name,action,first}=collectionFocus,nav=document.querySelector('[data-record-collection="'+name+'"]'),results=name==='results'?document.querySelector('.record-result-values,.record-reader .result-statements'):null;
   const target=first?results?.querySelector('.result-statements>section')??results:nav?.querySelector('[data-action="'+action+'"]:not([disabled])')??nav?.querySelector('input')??results;
   if(target){if(!target.matches('button,input,select,a[href]'))target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'nearest'});}collectionFocus=null;return;
  }
  if(focus){const target=document.getElementById('record-section-'+focus);target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest'});focus=null;}
  else if(state.recordSection){const id=resultStatementAnchor(state.recordSection)??(state.recordSection.startsWith('record-')?state.recordSection:'record-section-'+state.recordSection),node=document.getElementById(id);if(node)node.tabIndex=-1;node?.focus({preventScroll:true});node?.scrollIntoView({block:'nearest'});}
 }
 async function action(control){
  if(await retainedTableAction(control,{api,esc}))return true;
  if(control.dataset.action==='content-edit-area'){
   const area=[...document.querySelectorAll('[data-record-edit-area]')].find(node=>node.dataset.recordEditArea===control.dataset.area);
   if(area){state.recordSection=null;focusElement(area);area.scrollIntoView({block:'start'});}return true;
  }
  if(await tags.action(control))return true;
  if(await figureCommands.action(control))return true;
  if(await mediaActions.action(control))return true;
  if(await sectionActions.action(control))return true;
  if(['content-results-figure','content-results-all'].includes(control.dataset.action)){
   if(busy||!reading)return true;
   const figureId=control.dataset.action==='content-results-all'?null:control.dataset.resultFigure;if(figureId&&!resultStatementAnchor('result-'+figureId))return true;
   collectionFocus={name:'results',first:true};focus=null;state.recordSection=null;lastAnchor=null;
   const task=load({resultFigure:figureId,windows:{...windows,results:0}});render();await task;return true;
  }
  if(control.dataset.action?.startsWith('content-collection-')){
   if(busy)return true;const name=control.dataset.collection,page=reading?.collections?.[name];if(!page)return true;
   let position=page.offset+(control.dataset.action==='content-collection-previous'?-4:4);
   if(control.dataset.action==='content-collection-go'){const input=document.querySelector('[data-collection-position="'+name+'"]');if(!input.reportValidity())return true;position=Number(input.value)-1;}
   windows={...windows,[name]:Math.max(0,position)};collectionFocus={name,action:control.dataset.action};focus=null;state.recordSection=null;const task=load();render();await task;return true;
  }
  const name=control.dataset.action;if(!['content-previous','content-next','content-go','content-find','content-retry','content-cancel'].includes(name))return false;
  if(name==='content-cancel'){controller?.abort();controller=null;busy=false;error=text('cancelled');progress=null;focus=null;collectionFocus=null;render();return true;}
  if(busy)return true;let extra={};
  if(name==='content-find'){
   search=document.querySelector('[data-content-search]').value.trim();if(!search){error=text('enterHeading');render();return true;}
   extra={search,after:search===lastSearch?offset+1:0};lastSearch=search;
  }else if(name==='content-go'){
   const input=document.querySelector('[data-content-position]');if(!input.reportValidity())return true;extra={offset:Number(input.value)-1};
  }else if(name!=='content-retry')extra={offset:Math.max(0,offset+(name==='content-previous'?-4:4))};
  collectionFocus=name==='content-retry'?pendingCollection:null;focus=!collectionFocus;state.recordSection=null;const task=load(extra,name==='content-retry');render();await task;return true;
 }
 return {view,bind,action,clear,async openAnchor(anchor){
  if(!resultStatementAnchor(anchor)||!identity())return false;
  state.recordSection=anchor;lastAnchor=anchor;focus=null;collectionFocus=null;
  const task=load({anchor,resultFigure:null});render();await task;return true;
 },captureTarget:()=>identity()?{native:true,id:state.selected,snapshotId:owner===identity()&&reading?reading.etag:state.etag}:null,
 savedRevision:()=>reading&&owner===identity()?reading.revision:null,removalTarget:()=>reading&&owner===identity()?{workspaceId:reading.workspaceId,recordId:reading.recordId,expectedRevision:reading.revision,title:reading.header.title}:null,attachMedia:mediaActions.attach,locationTarget:()=>reading&&owner===identity()?{workspaceId:reading.workspaceId,recordId:reading.recordId,sourceNotebookId:reading.header.notebookId,expectedStorageRevision:reading.storageRevision,title:reading.header.title}:null,async revealFigure(target,position){if(state.page!=='record-reader'||state.book?.id!==target.workspaceId||state.selected!==target.recordId||!Number.isSafeInteger(position)||position<0)return;windows={...windows,figures:position};await load();},current:()=>reading&&owner===identity()?{...reading.header,sections:reading.sections.values,relations:[...reading.header.relations,...reading.contextRelations??[]],figures:[...reading.header.figures,...reading.inline?.figures??[]],attachments:[...reading.header.attachments,...reading.inline?.attachments??[]]}:null,input(el){if(tags.input(el))return true;if(el.hasAttribute('data-record-detail-field')){detailField=el.value;return true;}if(!el.hasAttribute('data-content-search'))return false;search=el.value;return true;}};
}
