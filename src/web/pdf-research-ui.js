import {t} from './i18n/index.js';
import {proseText,renderProse} from './prose-model.js';
import {renderFigure} from './figure-renderer.js';
import {pdfResearchChanges} from './pdf-research-model.js';
import {pdfResearchTableChoices} from './pdf-research-table.js';
const tr=key=>t('pdfEditor',key);
export function pdfResearchUI({state,api,post,esc,getDocument,getSection,retained}){
 let visible=false,directory=null,projectId=null,owner=null,records=null,record=null,parts=null,collection='sections',capture=null,replace=false,search='',commandId=null,pendingRetain=null,imageCapture=null,imageId=null,imageAlt='',imageCaption='',tableOffset=0;
 const button=(label,command,attrs='')=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="research-'+command+'" '+attrs+'>'+esc(label)+'</button>';
 const query=input=>post('source',input),imageCollection=()=>['attachments','artifacts'].includes(collection);
 function clearImage(){imageCapture=null;imageId=null;imageAlt=imageCaption='';pendingRetain=null;}
 async function owners(id=null,offset=0){projectId=id;const prefix='/api/projects/'+(state.projectOwner?.projectId?state.projectOwner.projectId+'/':'');directory=await api(prefix+'publication-source-directory',{workspaceId:state.book.id,projectId:id,search:'',offset,limit:20,revision:offset?directory?.revision??null:null},{adopt:false});owner=records=record=parts=capture=null;clearImage();}
 async function browse(source,after=null){owner=source;records=await query({operation:'records',sourceId:source.workspaceId,snapshotId:after?records.snapshotId:null,after,search});record=parts=capture=null;clearImage();}
 async function recordParts(position=0){
  const common={sourceId:owner.workspaceId,snapshotId:records.snapshotId,recordId:record.id,collection};
  parts=imageCollection()?await post('source-images',{...common,offset:collection==='attachments'?position:0,cursor:collection==='artifacts'&&position!==0?position:null}):await query({operation:'parts',...common,offset:position});capture=null;clearImage();
 }
 async function choose(kind,id){capture=await query({operation:'selection',sourceId:owner.workspaceId,snapshotId:records.snapshotId,recordId:record.id,collection:kind,itemId:id});commandId=crypto.randomUUID();clearImage();replace=false;tableOffset=0;}
 function source(input){return {sourceId:input.workspaceId,snapshotId:input.snapshotId,recordId:input.recordId,collection:input.collection,itemId:input.itemId,...(input.blockId?{blockId:input.blockId}:{})};}
 function view(){
  if(!visible)return '';
  let html='<section class="panel pdf-research-picker"><div class="pdf-toolbar"><h2>'+esc(tr(replace?'reviewSource':'research'))+'</h2>'+button(tr('closeSource'),'close')+'</div><p>'+esc(tr('researchIntro'))+'</p>';
  if(imageCapture){
   const disabled=pendingRetain?' disabled':'';html+='<div data-pdf-source-image><h3>'+esc(imageCapture.label)+'</h3><p>'+esc(tr('sourceImageIntro'))+'</p><label class="field">'+esc(tr('imageAlt'))+'<input data-pdf-source-image-field="alt" maxlength="2000" required value="'+esc(imageAlt)+'"'+disabled+'></label><label class="field">'+esc(tr('imageCaption'))+'<textarea data-pdf-source-image-field="caption" maxlength="2000"'+disabled+'>'+esc(imageCaption)+'</textarea></label>'+button(tr('sourceImageAdd'),'retain-image')+button(tr('keepSource'),'reject')+'</div>';
  }else if(capture){
   if(replace){const current=getSection(),diff=pdfResearchChanges(current,capture);html+='<p>'+esc(tr(diff.sourceChanged?'sourceChanged':'sourceUnchanged'))+'</p>'+(diff.locallyEdited?'<p>'+esc(tr('localSourceEdits'))+'</p>':'')+'<div class="pdf-source-diff">'+[[tr('retainedSource'),current.research.content],[tr('currentDocument'),current.content],[tr('incomingSource'),capture.content]].map(([title,value])=>'<div><h3>'+esc(title)+'</h3><pre>'+esc(proseText(value))+'</pre></div>').join('')+'</div>'+(diff.figuresChanged?'<p>'+esc(tr('sourceFiguresChanged'))+'</p>':'');}
   if(!replace&&capture.collection!=='figures'){
    if(capture.blockId)html+=button(tr('sourceWhole'),'whole');
    else {const tables=pdfResearchTableChoices(capture.content,{offset:tableOffset});if(tables.total)html+='<div data-pdf-source-tables><h3>'+esc(tr('sourceTables'))+'</h3><p>'+esc(tr('sourceTablesIntro'))+'</p>'+tables.items.map(item=>button(item.title,'table','data-id="'+item.id+'"')).join('')+(tableOffset?button(tr('sourceTablesPrevious'),'tables-previous'):'')+(tables.next!==null?button(tr('more'),'tables-more','data-offset="'+tables.next+'"'):'')+'</div>'; }
   }
   html+='<h3>'+esc(capture.title)+'</h3><div class="pdf-source-preview">'+renderProse(capture.content,{resolveLink:()=>null,figure:id=>{const figure=capture.figures.find(value=>value.id===id);return figure?renderFigure(figure,{idPrefix:'pdf-source-'+id}):'';}})+'</div>'+button(tr(replace?'acceptSource':'insertSource'),'retain')+button(tr('keepSource'),'reject');
  }else if(record){
   html+='<div class="pdf-toolbar"><h3>'+esc(record.title)+'</h3>'+button(tr('sourceRecords'),'records-back')+button(tr('recordBody'),'body')+button(tr('sourceSections'),'sections')+button(tr('sourceFigures'),'figures')+button(tr('sourceImages'),'attachments')+button(tr('sourceArtifacts'),'artifacts')+'</div>';
   html+=parts.items.map(item=>button(imageCollection()?item.label:item.title,imageCollection()?'choose-image':'choose','data-id="'+(imageCollection()?item.source.itemId:item.id)+'"')).join('')+(!parts.items.length&&imageCollection()?'<p>'+esc(tr('sourceImageEmpty'))+'</p>':'')+(parts.next!==null?button(tr('more'),'parts-more','data-offset="'+esc(parts.next)+'"'):'');
  }else if(owner){html+='<div class="pdf-toolbar"><h3>'+esc(owner.label)+'</h3>'+button(tr('sourceOwners'),'owners')+'</div><label>'+esc(tr('searchResearch'))+'<input data-pdf-source-search value="'+esc(search)+'"></label>'+button(tr('search'),'search')+'<div class="pdf-source-list">'+records.items.map(item=>button(item.title,'record','data-id="'+item.id+'"')).join('')+'</div>'+(records.next?button(tr('more'),'records-more'):'');}
  else if(directory){html+='<div class="pdf-toolbar">'+(projectId?button(tr('sourceOwners'),'owners'):'')+button(tr('ownerContent'),'host')+'</div><div class="pdf-source-list">'+directory.items.map(item=>button([...item.ancestors,item.label].join(' / '),item.kind==='project'?'project':'owner','data-id="'+item.workspaceId+'"')).join('')+'</div>'+(directory.offset+directory.items.length<directory.total?button(tr('more'),'owners-more'):'');}
  return html+'</section>';
 }
 async function action(name,node){
  if(!name.startsWith('research-'))return false;name=name.slice(9);
  if(name==='open'){visible=true;replace=false;await owners();}
  else if(name==='close'){visible=false;capture=null;clearImage();}
  else if(name==='owners')await owners();
  else if(name==='owners-more')await owners(projectId,directory.offset+20);
  else if(name==='project')await owners(directory.items.find(item=>item.workspaceId===node.dataset.id).projectId);
  else if(name==='owner')await browse(directory.items.find(item=>item.workspaceId===node.dataset.id));
  else if(name==='host')await browse({workspaceId:state.book.id,label:tr('ownerContent')});
  else if(name==='search')await browse(owner);
  else if(name==='records-more')await browse(owner,records.next);
  else if(name==='record'){record=records.items.find(item=>item.id===node.dataset.id);await recordParts();}
  else if(name==='records-back'){record=parts=capture=null;clearImage();}
  else if(['sections','figures','attachments','artifacts'].includes(name)){collection=name;await recordParts();}
  else if(name==='parts-more')await recordParts(collection==='artifacts'?node.dataset.offset:Number(node.dataset.offset));
  else if(name==='body')await choose('body',record.id);
  else if(name==='choose')await choose(collection,node.dataset.id);
  else if(name==='tables-more')tableOffset=Number(node.dataset.offset);
  else if(name==='tables-previous')tableOffset=Math.max(0,tableOffset-20);
  else if(name==='table'||name==='whole'){const selected=source(capture);delete selected.blockId;capture=await query({operation:'selection',...selected,...(name==='table'?{blockId:node.dataset.id}:{})});commandId=crypto.randomUUID();pendingRetain=null;tableOffset=0;}
  else if(name==='choose-image'){imageCapture=parts.items.find(item=>item.source.itemId===node.dataset.id);if(!imageCapture)return true;imageId=crypto.randomUUID();commandId=crypto.randomUUID();pendingRetain=null;imageAlt=imageCaption='';replace=false;}
  else if(name==='reject'){capture=null;visible=false;clearImage();}
  else if(name==='review'){const previous=getSection().research;capture=await query({operation:'selection',...source(previous),snapshotId:null});replace=true;visible=true;commandId=crypto.randomUUID();clearImage();}
  else if(name==='retain-image'){
   if(!imageCapture||!getSection())return true;if(!imageAlt.trim())throw Error(tr('imageMissingAlt'));const document=getDocument();pendingRetain??={id:document.header.id,commandId,expectedRevision:document.revision,sectionId:getSection().id,imageId,source:imageCapture.source,alt:imageAlt,caption:imageCaption};const result=await post('source-image-retain',pendingRetain),sectionId=pendingRetain.sectionId;visible=false;clearImage();await retained(result,sectionId);
  }else if(name==='retain'){
   const document=getDocument();pendingRetain??={id:document.header.id,commandId,expectedRevision:document.revision,sectionId:replace?getSection().id:crypto.randomUUID(),replace,source:source(capture)};const result=await post('source-retain',pendingRetain),sectionId=pendingRetain.sectionId;
   visible=false;capture=null;await retained(result,sectionId);
  }else return false;
  return true;
 }
 return {view,action,input(el){if(el.dataset.pdfSourceImageField){if(!pendingRetain){if(el.dataset.pdfSourceImageField==='alt')imageAlt=el.value;else if(el.dataset.pdfSourceImageField==='caption')imageCaption=el.value;}return true;}if(!el.hasAttribute('data-pdf-source-search'))return false;search=el.value;return true;},close(){visible=false;capture=null;clearImage();}};
}
