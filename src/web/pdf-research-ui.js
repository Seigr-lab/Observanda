import {t} from './i18n/index.js';
import {proseText,renderProse} from './prose-model.js';
import {renderFigure} from './figure-renderer.js';
import {pdfResearchChanges} from './pdf-research-model.js';
const tr=key=>t('pdfEditor',key);
export function pdfResearchUI({state,api,post,esc,getDocument,getSection,retained}){
 let visible=false,directory=null,projectId=null,owner=null,records=null,record=null,parts=null,collection='sections',capture=null,replace=false,search='',commandId=null,pendingRetain=null;
 const button=(label,command,attrs='')=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="research-'+command+'" '+attrs+'>'+esc(label)+'</button>';
 const query=input=>post('source',input);
 async function owners(id=null,offset=0){projectId=id;const prefix='/api/projects/'+(state.projectOwner?.projectId?state.projectOwner.projectId+'/':'');directory=await api(prefix+'publication-source-directory',{workspaceId:state.book.id,projectId:id,search:'',offset,limit:20,revision:offset?directory?.revision??null:null},{adopt:false});owner=records=record=parts=capture=null;}
 async function browse(source,after=null){owner=source;records=await query({operation:'records',sourceId:source.workspaceId,snapshotId:after?records.snapshotId:null,after,search});record=parts=capture=null;}
 async function recordParts(offset=0){parts=await query({operation:'parts',sourceId:owner.workspaceId,snapshotId:records.snapshotId,recordId:record.id,collection,offset});capture=null;}
 async function choose(kind,id){capture=await query({operation:'selection',sourceId:owner.workspaceId,snapshotId:records.snapshotId,recordId:record.id,collection:kind,itemId:id});commandId=crypto.randomUUID();pendingRetain=null;replace=false;}
 function source(input){return {sourceId:input.workspaceId,snapshotId:input.snapshotId,recordId:input.recordId,collection:input.collection,itemId:input.itemId};}
 function view(){
  if(!visible)return '';
  let html='<section class="panel pdf-research-picker"><div class="pdf-toolbar"><h2>'+esc(tr(replace?'reviewSource':'research'))+'</h2>'+button(tr('closeSource'),'close')+'</div><p>'+esc(tr('researchIntro'))+'</p>';
  if(capture){
   if(replace){const current=getSection(),diff=pdfResearchChanges(current,capture);html+='<p>'+esc(tr(diff.sourceChanged?'sourceChanged':'sourceUnchanged'))+'</p>'+(diff.locallyEdited?'<p>'+esc(tr('localSourceEdits'))+'</p>':'')+'<div class="pdf-source-diff">'+[[tr('retainedSource'),current.research.content],[tr('currentDocument'),current.content],[tr('incomingSource'),capture.content]].map(([title,value])=>'<div><h3>'+esc(title)+'</h3><pre>'+esc(proseText(value))+'</pre></div>').join('')+'</div>'+(diff.figuresChanged?'<p>'+esc(tr('sourceFiguresChanged'))+'</p>':'');}
   html+='<h3>'+esc(capture.title)+'</h3><div class="pdf-source-preview">'+renderProse(capture.content,{resolveLink:()=>null,figure:id=>{const figure=capture.figures.find(value=>value.id===id);return figure?renderFigure(figure,{idPrefix:'pdf-source-'+id}):'';}})+'</div>'+button(tr(replace?'acceptSource':'insertSource'),'retain')+button(tr('keepSource'),'reject');
  }else if(record){html+='<div class="pdf-toolbar"><h3>'+esc(record.title)+'</h3>'+button(tr('sourceRecords'),'records-back')+button(tr('recordBody'),'body')+button(tr('sourceSections'),'sections')+button(tr('sourceFigures'),'figures')+'</div>'+parts.items.map(item=>button(item.title,'choose','data-id="'+item.id+'"')).join('')+(parts.next!==null?button(tr('more'),'parts-more','data-offset="'+parts.next+'"'):'');}
  else if(owner){html+='<div class="pdf-toolbar"><h3>'+esc(owner.label)+'</h3>'+button(tr('sourceOwners'),'owners')+'</div><label>'+esc(tr('searchResearch'))+'<input data-pdf-source-search value="'+esc(search)+'"></label>'+button(tr('search'),'search')+'<div class="pdf-source-list">'+records.items.map(item=>button(item.title,'record','data-id="'+item.id+'"')).join('')+'</div>'+(records.next?button(tr('more'),'records-more'):'');}
  else if(directory){html+='<div class="pdf-toolbar">'+(projectId?button(tr('sourceOwners'),'owners'):'')+button(tr('ownerContent'),'host')+'</div><div class="pdf-source-list">'+directory.items.map(item=>button([...item.ancestors,item.label].join(' / '),item.kind==='project'?'project':'owner','data-id="'+item.workspaceId+'"')).join('')+'</div>'+(directory.offset+directory.items.length<directory.total?button(tr('more'),'owners-more'):'');}
  return html+'</section>';
 }
 async function action(name,node){
  if(!name.startsWith('research-'))return false;name=name.slice(9);
  if(name==='open'){visible=true;replace=false;await owners();}
  else if(name==='close'){visible=false;capture=null;}
  else if(name==='owners')await owners();
  else if(name==='owners-more')await owners(projectId,directory.offset+20);
  else if(name==='project')await owners(directory.items.find(item=>item.workspaceId===node.dataset.id).projectId);
  else if(name==='owner')await browse(directory.items.find(item=>item.workspaceId===node.dataset.id));
  else if(name==='host')await browse({workspaceId:state.book.id,label:tr('ownerContent')});
  else if(name==='search')await browse(owner);
  else if(name==='records-more')await browse(owner,records.next);
  else if(name==='record'){record=records.items.find(item=>item.id===node.dataset.id);await recordParts();}
  else if(name==='records-back')record=parts=capture=null;
  else if(name==='sections'||name==='figures'){collection=name;await recordParts();}
  else if(name==='parts-more')await recordParts(Number(node.dataset.offset));
  else if(name==='body')await choose('body',record.id);
  else if(name==='choose')await choose(collection,node.dataset.id);
  else if(name==='reject'){capture=null;visible=false;}
  else if(name==='review'){const previous=getSection().research;capture=await query({operation:'selection',...source(previous),snapshotId:null});replace=true;visible=true;commandId=crypto.randomUUID();pendingRetain=null;}
  else if(name==='retain'){
   const document=getDocument();pendingRetain??={id:document.header.id,commandId,expectedRevision:document.revision,sectionId:replace?getSection().id:crypto.randomUUID(),replace,source:source(capture)};const result=await post('source-retain',pendingRetain),sectionId=pendingRetain.sectionId;
   visible=false;capture=null;await retained(result,sectionId);
  }else return false;
  return true;
 }
 return {view,action,input(el){if(!el.hasAttribute('data-pdf-source-search'))return false;search=el.value;return true;},close(){visible=false;capture=null;}};
}
