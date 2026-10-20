import {publicationSourceClient} from './publication-source-client.js';
import {emptyPublicationSource,validPublicationSources,resolvePublicationSource} from './publication-sources-model.js';
import {websiteRecordShare} from './website-selection.js';
import {websiteSnapshot} from './website-context.js';
import {researchId} from './research-reference.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('publicationSources',key,args);

// The editor narrows source permissions with website-owned choices. Opening, searching and paging
// are reads; an independently owned source never becomes an authoring draft.
export function publicationSourcesUI({state,api,esc,access,checkpoint,changed,notify,onOpenPage,documents}){
 const client=publicationSourceClient({state,api,access});
 let context=null,version=0,controller=null,timer=null,projectId=null,offset=0,revision=null,search='',page=null,owner=null,head=null,recordProject=null,records=null,recordSearch='',cursor=null,details=null,error=false,loading=false;
 let selectedSource=null,includedSources=new Set(),selectionRevision=null;
 const native=()=>documents?.enabled();
 const root=()=>document.querySelector('[data-publication-sources]');
 const identity=()=>JSON.stringify([websiteSnapshot(state),state.book?.id,state.etag]);
 const active=()=>state.page==='website'&&!state.access?.locked&&!state.storageUnavailable&&!!root();
 function stop(){version++;controller?.abort();controller=null;clearTimeout(timer);timer=null;}
 function close(){stop();client.close();selectedSource=null;includedSources.clear();selectionRevision=null;context=null;page=null;head=null;owner=null;records=null;details=null;projectId=null;offset=0;revision=null;search='';recordSearch='';cursor=null;loading=false;error=false;}
 function source(){const row=native()?(selectedSource?.workspaceId===owner?.workspaceId?selectedSource:null):(state.book.website.researchSources??[]).find(source=>source.workspaceId===owner?.workspaceId);return row?.labBookId&&head?resolvePublicationSource({...head,id:head.workspaceId},row,owner):row;}
 function change(edit){
  if(!active()||context!==identity()||!owner||!head)return;
  const sources=structuredClone(state.book.website.researchSources??[]);let row=sources.find(source=>source.workspaceId===owner.workspaceId);
  if(!row){row=emptyPublicationSource(owner.workspaceId,owner.labBookId);sources.push(row);}
  else if(owner.labBookId){Object.assign(row,resolvePublicationSource({...head,id:head.workspaceId},row,owner));row.labBookId=owner.labBookId;}edit(row,sources);
  if(!validPublicationSources(sources)){notify(text('limit'),true);paint();return;}
  checkpoint('publication-sources');state.book.website.researchSources=sources;changed();paint();
 }
 async function nativeChange(operation){await run(async signal=>{await documents.perform([{type:'source-selection',workspaceId:owner.workspaceId,...(owner.labBookId?{labBookId:owner.labBookId}:{}),...operation}]);return documents.sources({sourceId:owner.workspaceId,recordIds:records?.items.map(item=>item.id)??[]},{signal});},value=>{selectedSource=value.source;selectionRevision=value.summary.revision;changed();});}
 const available=record=>record.share===true&&head?.notebooks.find(book=>book.id===record.notebookId)?.share!==false;
 const projectAvailable=()=>head?.notebooks.some(book=>book.projectId===recordProject&&book.share!==false);
 function selected(record){const selection=source()?.selection??emptyPublicationSource(owner.workspaceId).selection;return available(record)&&websiteRecordShare(selection,record,recordProject);}
 const button=(label,action,extra='')=>'<button type="button" class="button" data-source-action="'+action+'" '+extra+'>'+esc(text(label))+'</button>';
 function paint(){
  const host=root();if(!host||!active())return;
  host.querySelector('[data-source-status]').textContent=loading?text('loading'):error?text('failed'):'';
  host.querySelector('[data-source-status]').setAttribute('role',error?'alert':'status');
  host.querySelector('[data-source-retry]').hidden=!error;
  const container=host.querySelector('[data-source-body]');
  if(head){
   const row=source(),included=row?.selection.includeProjects.includes(recordProject),selectedProject=head.projects.find(p=>p.id===recordProject);
   container.innerHTML='<h3>'+esc(head.title)+'</h3>'+button('browse','browse')+(row?button('remove','remove'):'')+
    (head.projects.length>1?'<label class="field">'+esc(text('project'))+'<select data-source-project '+(loading?'disabled':'')+'>'+head.projects.map(p=>'<option value="'+p.id+'" '+(p.id===recordProject?'selected':'')+'>'+esc(p.title)+'</option>').join('')+'</select></label>':'')+
    (selectedProject?'<label class="checkbox"><input type="checkbox" data-source-all '+(loading||!projectAvailable()?'disabled ':'')+(included&&projectAvailable()?'checked':'')+'><span>'+esc(text(owner?.labBookId?'includeBook':'includeAll'))+'</span></label>'+(!projectAvailable()?'<p>'+esc(text('sourcePrivate'))+'</p>':'')+'<label class="field">'+esc(text('searchRecords'))+'<input type="search" data-source-record-search maxlength="512" value="'+esc(recordSearch)+'"></label>':'')+
    (!loading&&records?records.items.map(record=>'<section class="website-record"><label class="checkbox"><input type="checkbox" data-source-record="'+record.id+'" '+(selected(record)?'checked':'')+' '+(available(record)?'':'disabled')+'><span>'+esc(record.title)+(!available(record)?'<small>'+esc(text('sourcePrivate'))+'</small>':'')+'</span></label>'+(onOpenPage&&selected(record)?button('openPage','page','data-id="'+record.id+'"'):'')+(record.attachmentCount?button('attachments','media','data-id="'+record.id+'"'):'')+(details?.id===record.id?details.attachments.map(a=>'<label class="checkbox"><input type="checkbox" data-source-attachment="'+a.id+'" data-record="'+record.id+'" '+(available(record)&&a.share&&(row?.selection.records.find(r=>r.id===record.id)?.attachments.find(v=>v.id===a.id)?.share??a.share)?'checked':'')+' '+(available(record)&&a.share?'':'disabled')+'><span>'+esc(a.caption||a.alt||a.kind)+(!available(record)||!a.share?'<small>'+esc(text('sourcePrivate'))+'</small>':'')+'</span></label>').join(''):'')+'</section>').join('')+(records.items.length?'':'<p>'+esc(text('noRecords'))+'</p>'):'')+
    (records?'<div class="inline-actions">'+button('previous','records-previous',loading||!records.previousCursor?'disabled':'')+'<span>'+esc(records.total?text('range',{first:records.offset+1,last:records.offset+records.items.length,total:records.total}):text('noRecords'))+'</span>'+button('next','records-next',loading||!records.nextCursor?'disabled':'')+'</div>':'');
  }else{
   container.innerHTML=(projectId?button('back','back'):'')+'<label class="field">'+esc(text('search'))+'<input type="search" data-source-search maxlength="160" value="'+esc(search)+'"></label>'+
    (!loading&&page?page.items.map((item,index)=>'<section class="website-record"><p>'+esc([...item.ancestors,item.label].join(' / '))+'</p>'+button(item.kind==='project'?'books':'open','open','data-index="'+index+'"')+((native()?includedSources.has(item.workspaceId):(state.book.website.researchSources??[]).some(s=>s.workspaceId===item.workspaceId))?'<span>'+esc(text('included'))+'</span>':'')+'</section>').join('')+(page.items.length?'':'<p>'+esc(text('empty'))+'</p>'):'')+
    (page?'<div class="inline-actions">'+button('previous','directory-previous',loading||!offset?'disabled':'')+button('next','directory-next',loading||offset+page.items.length>=page.total?'disabled':'')+'</div>':'');
  }
 }
 async function run(operation,accept){
  stop();if(!active())return;controller=new AbortController();const signal=controller.signal,stamp=context,request=version;loading=true;error=false;paint();
  const valid=()=>active()&&!signal.aborted&&request===version&&stamp===identity();
  try{const value=await operation(signal);if(valid())await accept(value);}
  catch(reason){if(valid()&&reason.name!=='AbortError')error=true;}
  finally{if(valid()){loading=false;controller=null;paint();}}
 }
 const loadDirectory=()=>run(async signal=>{const value=await client.directory({projectId,search,offset,limit:10,revision},{signal,unlock:true});if(native()){const selected=await documents.sources({sourceIds:value.items.map(item=>item.workspaceId).filter(researchId)},{signal});includedSources=new Set(selected.sources.map(source=>source.workspaceId));selectionRevision=selected.summary.revision;}return value;},value=>{page=value;revision=value.revision;});
 function loadRecords(){if(!recordProject){records=null;paint();return;}
  return run(signal=>client.query('content',{projectId:recordProject,search:recordSearch,cursor},{signal}),async value=>{
   if(!Array.isArray(value.items)||value.items.length>10||!Number.isSafeInteger(value.total)||value.total<0||!Number.isSafeInteger(value.offset)||value.offset<0||value.items.some(row=>!researchId(row.id)||typeof row.title!=='string'||!head.notebooks.some(n=>n.id===row.notebookId&&n.projectId===recordProject)||typeof row.share!=='boolean'||!Number.isSafeInteger(row.attachmentCount)||row.attachmentCount<0)||new Set(value.items.map(row=>row.id)).size!==value.items.length||![value.previousCursor,value.nextCursor].every(c=>c===null||typeof c==='string'&&!!c))throw Error('PUBLICATION_SOURCE_RESPONSE');
   if(native()){const selected=await documents.sources({sourceId:owner.workspaceId,recordIds:value.items.map(item=>item.id)});selectedSource=selected.source;selectionRevision=selected.summary.revision;}records=value;
  });
 }
 async function openSource(item){
  selectedSource=null;await run(signal=>client.open(item,{signal,unlock:true}),value=>{owner=value.owner;head=value.head;recordProject=head.projects[0]?.id??null;records=null;details=null;recordSearch='';cursor=null;});
  if(head&&!error&&active())await loadRecords();
 }
 function view(){return '<section class="panel" data-publication-sources><h2>'+esc(text('title'))+'</h2><p data-source-status role="status"></p><button type="button" class="button" data-source-action="retry" data-source-retry hidden>'+esc(text('retry'))+'</button><div data-source-body></div></section>';}
 function bind(){
  if(!active()){close();return;}
  if(context!==identity()){close();context=identity();void loadDirectory();}
  else if(native()&&!loading&&selectionRevision!==state.websiteEditor.sources.revision){if(head)void loadRecords();else void loadDirectory();}
  const host=root();if(host.dataset.bound==='true'){paint();return;}host.dataset.bound='true';
  host.addEventListener('click',event=>{
   const control=event.target.closest('[data-source-action]');if(!control||!host.contains(control))return;event.preventDefault();event.stopPropagation();if(!active()||context!==identity()||loading)return;
   const action=control.dataset.sourceAction;
   if(action==='retry'){if(head)void loadRecords();else{revision=null;offset=0;void loadDirectory();}return;}
   if(action==='browse'||action==='back'){stop();client.close();head=null;owner=null;records=null;details=null;projectId=null;offset=0;revision=null;search='';void loadDirectory();return;}
   if(action.startsWith('directory-')){offset=Math.max(0,offset+(action.endsWith('previous')?-10:10));void loadDirectory();return;}
   if(action==='open'){const item=page?.items[Number(control.dataset.index)];if(!item)return;if(item.kind==='project'){projectId=item.projectId;offset=0;revision=null;search='';void loadDirectory();}else void openSource(item);return;}
   if(action.startsWith('records-')){const next=records?.[action.endsWith('previous')?'previousCursor':'nextCursor'];if(next){cursor=next;details=null;void loadRecords();}return;}
   if(action==='remove'){if(native()){void nativeChange({kind:'remove'});return;}change((_row,rows)=>rows.splice(rows.findIndex(row=>row.workspaceId===owner.workspaceId),1));return;}
   if(action==='page'){const record=records?.items.find(record=>record.id===control.dataset.id);if(!record||!selected(record))return;void run(signal=>client.query('record',{recordId:record.id},{signal}),async value=>{if(value.record?.id!==record.id||value.page?.owner?.workspaceId!==owner.workspaceId)throw Error('PUBLICATION_SOURCE_RESPONSE');await onOpenPage?.(value.page);});return;}
   if(action==='media'){const record=records?.items.find(record=>record.id===control.dataset.id);if(!record)return;void run(signal=>client.query('record',{recordId:record.id},{signal}),value=>{if(value.record?.id!==record.id||value.record.notebookId!==record.notebookId||!Array.isArray(value.record.attachments))throw Error('PUBLICATION_SOURCE_RESPONSE');details=value.record;});}
  });
  host.addEventListener('input',event=>{
   const el=event.target;event.stopPropagation();if(!el.matches('[data-source-search],[data-source-record-search]'))return;stop();const focused=el.hasAttribute('data-source-search');if(focused){search=el.value;offset=0;revision=null;}else{recordSearch=el.value;cursor=null;details=null;}timer=setTimeout(()=>{if(focused)void loadDirectory();else void loadRecords();},180);
  });
  host.addEventListener('change',event=>{
   const el=event.target;if(!el.matches('[data-source-project],[data-source-all],[data-source-record],[data-source-attachment]'))return;event.stopPropagation();if(!active()||context!==identity()||loading)return;
   if(el.hasAttribute('data-source-project')){if(!head.projects.some(p=>p.id===el.value))return;recordProject=el.value;cursor=null;recordSearch='';records=null;details=null;void loadRecords();return;}
   if(el.hasAttribute('data-source-all')){
    if(!projectAvailable()){paint();return;}
    if(native()){void nativeChange({kind:'project',projectId:recordProject,share:el.checked});return;}
    const include=el.checked,selection=structuredClone(source()?.selection??emptyPublicationSource(owner.workspaceId).selection),chosenProject=recordProject;
    void run(signal=>client.query('summary',{selection,search:''},{signal}),value=>{
     const membership=value.selectionProjects;
     if(!membership||typeof membership!=='object'||Object.entries(membership).some(([id,project])=>!selection.records.some(record=>record.id===id)||!head.projects.some(p=>p.id===project)))throw Error('PUBLICATION_SOURCE_RESPONSE');
     if(JSON.stringify(selection)!==JSON.stringify(source()?.selection??emptyPublicationSource(owner.workspaceId).selection))return;
     change(row=>{
      if(include){if(!row.projectIds.includes(chosenProject))row.projectIds.push(chosenProject);if(!row.selection.includeProjects.includes(chosenProject))row.selection.includeProjects.push(chosenProject);}
      else row.selection.includeProjects=row.selection.includeProjects.filter(id=>id!==chosenProject);
      row.selection.records=row.selection.records.map(record=>membership[record.id]===chosenProject?{...record,share:null}:record).filter(record=>record.share!==null||record.attachments.length);
     });
    });return;
   }
   const record=records?.items.find(record=>record.id===(el.dataset.sourceRecord??el.dataset.record));if(!record||!available(record)){paint();return;}
   if(el.hasAttribute('data-source-attachment')&&!details?.attachments.some(a=>a.id===el.dataset.sourceAttachment&&a.share)){paint();return;}
   if(native()){void nativeChange({kind:el.hasAttribute('data-source-record')?'record':'attachment',projectId:recordProject,recordId:record.id,...(el.hasAttribute('data-source-attachment')?{attachmentId:el.dataset.sourceAttachment}:{}),share:el.checked});return;}
   change(row=>{if(el.checked&&!row.projectIds.includes(recordProject))row.projectIds.push(recordProject);let choice=row.selection.records.find(r=>r.id===record.id);if(!choice){choice={id:record.id,share:null,attachments:[]};row.selection.records.push(choice);}
    if(el.hasAttribute('data-source-record'))choice.share=el.checked;
    else{const id=el.dataset.sourceAttachment;if(!details?.attachments.some(a=>a.id===id))return;const prior=choice.attachments.find(a=>a.id===id);if(prior)prior.share=el.checked;else choice.attachments.push({id,share:el.checked});}
   });
  });
  paint();
 }
 return {view,bind,close,sync(){if(!active()||context!==identity())close();}};
}
