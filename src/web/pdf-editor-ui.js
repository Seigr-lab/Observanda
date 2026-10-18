import {pdfPrintConditionUI} from './pdf-print-condition-ui.js';
import {pdfPressArtworkUI} from './pdf-press-artwork-ui.js';
import {pdfEditorFonts} from './pdf-editor-fonts.js';
import {pdfFontChoices} from './pdf-font-model.js';
import {pdfEditHistory,pdfEditHistoryShortcut} from './pdf-edit-history.js';
import {pdfOutputProfileFields,changePdfOutputProfile} from './pdf-output-profile-fields.js';
import {pdfFindingsFields,focusPdfFinding} from './pdf-findings-ui.js';
import {pdfPressFields,changePdfPress,refreshPdfPress} from './pdf-press-fields.js';
import {pdfCrossReferencesUI} from './pdf-cross-references-ui.js';
import {pdfPaginationUI} from './pdf-pagination-ui.js';
import {pdfCaptionFields,changePdfCaption} from './pdf-caption-fields.js';
import {pdfPageNavigator} from './pdf-page-navigator.js';
import {pdfOutlineUI} from './pdf-outline-ui.js';
import {pdfCompositionUI} from './pdf-composition-ui.js';
import {pdfAudienceFields,pdfPublicationFields,pdfAudienceSummaryFields,updatePdfPublicationFields,changePdfAudience,changePdfPublication} from './pdf-audience-fields.js';
import {pdfNotesUI} from './pdf-notes-ui.js';
import {pdfExportsUI} from './pdf-exports-ui.js';
import {pdfImagesUI} from './pdf-images-ui.js';
import {pdfStructureDefaults} from './pdf-structure-model.js';
import {customFontId} from './font-catalogue.js';
import {pdfResearchUI} from './pdf-research-ui.js';
import {pdfPreviewController} from './pdf-preview-controller.js';
import {pdfLayoutLibraryUI} from './pdf-layout-library-ui.js';
import {t} from './i18n/index.js';
import {documentEditors} from './document-editor.js';
import {pdfLayoutPreset,validPdfDocumentHeader,validPdfSection} from './pdf-layout-model.js';
import {pdfLayoutFields,changePdfLayout} from './pdf-layout-fields.js';
import {researchId} from './research-reference.js';
const tr=(key,values)=>t('pdfEditor',key,values),uuid=()=>crypto.randomUUID();
export async function pdfEditorUI({state,api,esc,render,notify}){
 const workspaceId=state.book.id;
 if(!document.querySelector('link[data-pdf-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href='/pdf-editor.css';link.dataset.pdfStyle='';document.head.append(link);}
 let selected=null,section=null,archived=false,list={items:[],next:null},sections={items:[],next:null,total:0},offset=0,editions=null,canRender=false,canArchival=false,disposed=false,timer=null,saving=null,retry=null,headerDirty=0,sectionDirty=0,serial=0,error='',busy=false,loadedPath=null,contentEpoch=0,preflight=null,audienceSummary=null,fontChoices=[],pendingFont=null,pendingFinding=null;
 const root=()=>document.querySelector('[data-pdf-editor]'),active=()=>!disposed&&state.page==='module'&&state.moduleId==='pdf-editor';
 const draw=()=>{if(active())render();};
 async function post(operation,data={},options={}){
  const {editHistory=true,...requestOptions}=options,result=await api('/api/pdf/'+operation,{workspaceId,...data},{...requestOptions,adopt:false});
  if(editHistory&&selected?.header.id===data.id&&data.expectedRevision)history.record(data,result);
  if(selected?.header.id===data.id&&result.fonts){selected.header.fonts=result.fonts;}
  return result;
 }
 const history=pdfEditHistory({getDocument:()=>selected,flush,restore:command=>post('change',command,{editHistory:false}),reopen:restoreEditor,changed:refreshHistory});
 function refreshHistory(){const value=history.state();for(const direction of ['undo','redo']){const node=root()?.querySelector('[data-command="edit-'+direction+'"]');if(node)node.disabled=busy||value.busy||!(direction==='undo'?(value.canUndo||dirty()):value.canRedo);}}
 async function restoreEditor({id,revision}){
  const sectionId=section?.id,next=await post('open',{id,revision});
  let retained=null;if(sectionId)try{retained=await post('section',{id,revision,sectionId,locate:true});}catch(error){if(error.code!=='NOT_FOUND')throw error;}
  const nextOffset=retained?Math.floor(retained.ordinal/20)*20:Math.min(offset,Math.max(0,Math.floor((next.count-1)/20)*20)),nextSections=await post('sections',{id,revision,offset:nextOffset,limit:20});
  const nextSection=retained?.section??(nextSections.items.length?(await post('section',{id,revision,sectionId:nextSections.items[0].id})).section:null),fonts=await post('fonts',{id});
  if(disposed||selected?.header.id!==id)return;
  if(dirty()||notes.hasPending()||(images.isBusy()||pressArtwork.isBusy()||printCondition.isBusy()||printCondition.hasPending())||pendingFont)throw new Error(tr('undoPendingEdits'));
  contentEpoch++;docs.release();outline.deactivate();research.close();selected=next;section=nextSection;sections=nextSections;offset=nextOffset;editions=null;preflight=null;audienceSummary=null;error='';fontChoices=[...new Map([...fonts.available,...fonts.retained].map(font=>[font.id,font])).values()];preview.invalidate();draw();
 }
 function historyKey(event){const direction=pdfEditHistoryShortcut(event);if(!active()||busy||!selected||!direction)return;const value=history.state();if(!(direction==='undo'?(value.canUndo||dirty()):value.canRedo))return;event.preventDefault();void action('edit-'+direction).catch(error=>notify(error.message??String(error)));}
 const pages=pdfPageNavigator({getHost:()=>root()?.querySelector('[data-pdf-pages]'),getFrame:()=>root()?.querySelector('[data-pdf-preview] iframe'),esc});
 const preview=pdfPreviewController({request:(id,revision,signal)=>post('export',{id,revision},{signal}),onChange:updatePreview});
 function updatePreview(){
  const state=preview.state();pages.update(state);const panel=root()?.querySelector('[data-pdf-preview]');if(!panel)return;const frame=panel.querySelector('iframe'),message=panel.querySelector('[data-pdf-preview-status]');
  frame.hidden=!state.current;if(state.current&&frame.getAttribute('src')?.split('#')[0]!==state.current.url)frame.src=state.current.url;
  message.textContent=state.error||(dirty()?tr('previewSaving'):state.busy?tr('rendering'):state.scheduled||state.current?.revision!==selected?.revision?tr('previewOld'):'');message.hidden=!message.textContent;
 }
 const retainedFonts=pdfEditorFonts({read:(data,options)=>post('font-read',data,{...options,response:'blob'}),notify});
 const docs=documentEditors({fonts:()=>pdfFontChoices(fontChoices),context:()=>[selected?.header.id,section?.id,contentEpoch].join(':'),figures:()=>section?.figures??[],onError:e=>notify(e.message??String(e))});
 const dirty=()=>!!(headerDirty||sectionDirty||retry),button=(label,command,attrs='')=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="'+command+'" '+attrs+'>'+esc(tr(label))+'</button>';
 const status=()=>{refreshHistory();composition.refresh();pagination.refresh();const host=root();if(!audienceSummary)host?.querySelector("[data-pdf-audience-summary]")?.remove();if(!preflight)host?.querySelector("[data-pdf-preflight]")?.remove();const fields=host?.querySelector('[data-pdf-publication-host]');if(fields&&selected&&section)updatePdfPublicationFields(fields,selected.header,section,{esc,text:tr});if(host){host.setAttribute('aria-busy',String(busy));host.inert=busy;if(selected){const heading=host.querySelector('h1');if(heading.textContent!==selected.header.name)heading.textContent=selected.header.name;}if(section){const entry=host.querySelector('[data-command="section"][data-id="'+section.id+'"]'),title=section.title||tr('untitled');if(entry){if(entry.textContent!==title)entry.textContent=title;entry.style.paddingInlineStart=(.75+((section.level??1)-1))+'rem';}}}const node=root()?.querySelector('[data-pdf-status]');if(node)node.textContent=error||(printCondition.hasPending()?tr('printProfileUnconfirmed'):dirty()||saving?tr('saving'):tr('saved'));const retryButton=root()?.querySelector('[data-command="retry"]');if(retryButton)retryButton.hidden=!error;updatePreview();};
 function change(kind){preflight=null;audienceSummary=null;if(kind==='header')headerDirty=++serial;else sectionDirty=++serial;error='';preview.invalidate();status();clearTimeout(timer);timer=setTimeout(()=>void save().catch(()=>{}),600);}
 async function command(operation){const result=await post('change',{id:selected.header.id,commandId:uuid(),expectedRevision:selected.revision,operation});selected.revision=result.revision;return result;}
 async function save(){
  if(printCondition.hasPending())await printCondition.whenIdle();
  clearTimeout(timer);if(saving)return saving;if(!selected||!dirty())return;
  if(!validPdfDocumentHeader(selected.header)||section&&!validPdfSection(section)){error=tr('invalid');status();throw new Error(error);}
  saving=(async()=>{
   while(dirty()){
    if(!retry){if(!validPdfDocumentHeader(selected.header)||section&&!validPdfSection(section))throw new Error(tr('invalid'));const kind=headerDirty?'header':'section',mark=kind==='header'?headerDirty:sectionDirty;retry={kind,mark,command:{id:selected.header.id,commandId:uuid(),expectedRevision:selected.revision,operation:{type:kind,[kind]:structuredClone(kind==='header'?selected.header:section)}}};}
    const task=retry,result=await post('change',task.command);selected.revision=result.revision;if(active())retainedFonts.update(selected,section,fontChoices);if(task.kind==='section'){const summary=sections.items.find(item=>item.id===task.command.operation.section.id);if(summary){summary.title=task.command.operation.section.title;summary.level=task.command.operation.section.level??1;}}
    if(task.kind==='header'&&headerDirty===task.mark)headerDirty=0;if(task.kind==='section'&&sectionDirty===task.mark)sectionDirty=0;retry=null;
   }
   error='';
  })().catch(e=>{error=e.message??String(e);throw e;}).finally(()=>{saving=null;if(!error&&!dirty()&&selected)preview.refresh(selected.header.id,selected.revision);status();});status();return saving;
 }
 async function load(id){
  contentEpoch++;preflight=null;audienceSummary=null;outline.deactivate();research.close();docs.release();loadedPath=id||'';editions=null;offset=0;error='';preview.reset();selected=null;section=null;sections={items:[],next:null,total:0};
  if(!id){history.clear();list=await post(archived?'archive':'list');return;}
  if(!researchId(id))throw new Error('Invalid document');selected=await post('open',{id});history.observe(selected);const fonts=await post('fonts',{id});fontChoices=[...new Map([...fonts.available,...fonts.retained].map(font=>[font.id,font])).values()];await sectionPage(0);
 }
 async function sectionPage(value){offset=value;sections=await post('sections',{id:selected.header.id,revision:selected.revision,offset,limit:20});section=sections.items.length?(await post('section',{id:selected.header.id,sectionId:sections.items[0].id,revision:selected.revision})).section:null;}
 async function activate(){const path=state.modulePath??'';if(loadedPath===path)return;await flush();await load(path);}
 const library=pdfLayoutLibraryUI({post,esc,getLayout:kind=>kind==='document'?selected?.header.layout:section?(section.layout??selected.header.layout):null,getFontSource:id=>({documentId:selected.header.id,pin:selected.header.fonts?.find(pin=>pin.id===id)}),applyLayout:async(kind,layout,source)=>{if(customFontId(layout.font))await ensureFont(layout.font,source?{id:source.id,revision:source.revision}:null);if(kind==='document'){selected.header.layout=layout;change('header');}else if(section){section.layout=layout;change('section');}}});
 const research=pdfResearchUI({state,api,post,esc,getDocument:()=>selected,getSection:()=>section,retained:async(result,sectionId)=>{const id=selected.header.id;await load(id);section=(await post('section',{id,sectionId,revision:selected.revision})).section;}});
 const notes=pdfNotesUI({esc,getDocument:()=>selected,getSection:()=>section,changed:()=>change('section'),draw,field:options=>docs.field(options)});
 const outline=pdfOutlineUI({post,esc,draw:()=>{const host=root()?.querySelector('[data-pdf-outline-host]');if(host)host.innerHTML=outline.view();},getDocument:()=>selected,getSection:()=>section,changedSelection:async({documentId,revision,sectionId,ordinal})=>{if(disposed||selected?.header.id!==documentId)return;contentEpoch++;docs.release();selected=await post('open',{id:documentId,revision});await sectionPage(Math.floor(ordinal/20)*20);section=(await post('section',{id:documentId,sectionId,revision})).section;preflight=null;audienceSummary=null;preview.invalidate();draw();}});
 const crossReferences=pdfCrossReferencesUI({esc,getDocument:()=>selected,getSection:()=>section,post,draw,insertContent:content=>{section.content=content;contentEpoch++;docs.release();change('section');draw();}});
 const pagination=pdfPaginationUI({esc,getDocument:()=>selected,getSection:()=>section,changed:()=>change('section'),draw});
 const composition=pdfCompositionUI({esc,getDocument:()=>selected,getSection:()=>section,changed:()=>change('section'),draw});
 const exports=pdfExportsUI({post,esc,draw:()=>{const host=root()?.querySelector("[data-pdf-exports-host]");if(host)host.innerHTML=exports.view();},getDocument:()=>selected,notify});
 const pressArtwork=pdfPressArtworkUI({post,getDocument:()=>selected,changed:()=>change('header'),draw,notify});
 const printCondition=pdfPrintConditionUI({post,esc,getDocument:()=>selected,prepare:async()=>{await pendingFont;await images.whenIdle();await pressArtwork.whenIdle();notes.flush();await save();},changed:()=>change('header'),saved:()=>{preflight=null;preview.invalidate();preview.refresh(selected.header.id,selected.revision);status();},setBusy:value=>{busy=value;status();},draw,notify});
 const images=pdfImagesUI({post,esc,getDocument:()=>selected,getSection:()=>section,changed:()=>change('section'),draw,notify,readImage:data=>post('image-read',data)});
 const structureView=()=>{const settings=selected.header.structure??pdfStructureDefaults();return '<details><summary>'+esc(tr('documentStructure'))+'</summary>'+label('contentsTitle','<input data-pdf-structure="contentsTitle" maxlength="160" value="'+esc(settings.contentsTitle)+'">')+['contents','numberSections','internalLinks','externalLinks','printUrls','printQrCodes','bookmarks','pageReferences'].map(key=>label(key,'<input type="checkbox" data-pdf-structure="'+key+'"'+((key==='bookmarks'?(settings[key]??true):settings[key])?' checked':'')+'>')).join('')+'</details>';};
 const label=(key,input)=>'<label class="field">'+esc(tr(key))+input+'</label>';
 function view(){
  docs.release();
  let body='<div class="pdf-toolbar"><h1>'+esc(selected?selected.header.name:tr(archived?'archivedDocuments':'title'))+'</h1>'+button(selected?'back':'new',selected?'list':'new')+(!selected?button(archived?'activeDocuments':'archivedDocuments','archive-list')+button('exports','exports-open'):'')+'</div>';
  if(!selected)body+='<div class="pdf-document-list">'+(list.items.length?list.items.map(item=>'<button class="button" data-action="module-command" data-module-id="pdf-editor" data-command="'+(archived?'archive-restore':'open')+'" data-id="'+item.id+'">'+esc(item.name)+(archived?' - '+esc(tr('restoreDocument')):'')+'</button>').join(''):'<p>'+esc(tr(archived?'archiveEmpty':'empty'))+'</p>')+'</div>'+(list.next?button('more','more-documents','data-after="'+list.next+'"'):'');
  else{
   body+='<div class="pdf-toolbar"><span role="status" data-pdf-status>'+esc(error||(dirty()||saving?tr('saving'):tr('saved')))+'</span>'+button('retry','retry',error?'':'hidden')+button('undo','edit-undo',history.state().canUndo||dirty()?'':'disabled')+button('redo','edit-redo',history.state().canRedo?'':'disabled')+button('history','history')+button('archiveDocument','archive-document')+button('exports','exports-open')+button('research','research-open')+button('preview','preview',!canRender?'disabled':'')+button('selectionReview','selection-review')+button('preflight','preflight',!canRender?'disabled':'')+button('download','download',!canRender?'disabled':'')+'</div>';
   if(!canRender)body+='<p>'+esc(tr('desktop'))+'</p>';
   if(editions){body+='<section class="panel"><h2>'+esc(tr('history'))+'</h2><p>'+esc(tr('historyIntro'))+'</p>'+editions.items.map(item=>'<div class="pdf-toolbar"><span>'+esc(tr('edition',{number:item.sequence+1}))+' Â· '+esc(item.name)+'</span>'+(item.revision===selected.revision?'<span>'+esc(tr('current'))+'</span>':button('restore','restore','data-revision="'+item.revision+'"'))+'</div>').join('')+(editions.next!==null?button('more','more-history','data-before="'+editions.next+'"'):'')+'</section>';}
   body+=research.view()+pdfAudienceSummaryFields(audienceSummary,{esc,text:tr});
   body+=pdfFindingsFields(preflight,{esc,button});
   body+='<div class="pdf-editor-surface'+(preview.state().visible?' has-preview':'')+'"><div class="pdf-workbench"><aside>'+library.view()+pdfAudienceFields(selected.header,{esc,text:tr})+structureView()+pdfCaptionFields(selected.header,{esc})+pdfPressFields(selected.header,{esc})+pdfOutputProfileFields(selected.header,{esc,archival:canArchival})+printCondition.view()+'<details><summary>'+esc(tr('document'))+'</summary>'+label('name','<input data-pdf-header="name" maxlength="240" value="'+esc(selected.header.name)+'">')+label('language','<input data-pdf-header="language" value="'+esc(selected.header.language)+'">')+label('direction','<select data-pdf-header="direction">'+['ltr','rtl','auto'].map(key=>'<option value="'+key+'"'+(selected.header.direction===key?' selected':'')+'>'+esc(tr(key))+'</option>').join('')+'</select>')+'</details><details><summary>'+esc(tr('documentLayout'))+'</summary><p>'+esc(tr('layoutNote'))+'</p>'+pdfLayoutFields(selected.header.layout,'document',{esc,fonts:fontChoices})+'</details><div data-pdf-outline-host>'+outline.view()+'</div><h2>'+esc(tr('sections'))+'</h2><nav aria-label="'+esc(tr('sections'))+'">'+sections.items.map(item=>'<button class="button" data-action="module-command" data-module-id="pdf-editor" data-command="section" data-id="'+item.id+'" style="padding-inline-start:'+(.75+((item.level??1)-1))+'rem"'+(section?.id===item.id?' aria-current="true"':'')+'>'+esc(item.id===section?.id?section.title||tr('untitled'):item.title||tr('untitled'))+'</button>').join('')+'</nav>'+(offset>0||sections.next!==null?'<div class="pdf-toolbar">'+button('previous','section-page','data-offset="'+Math.max(0,offset-20)+'"'+(offset===0?' disabled':''))+button('next','section-page','data-offset="'+sections.next+'"'+(sections.next===null?' disabled':''))+'</div>':'')+button('newSection','append')+'</aside><section class="pdf-composer">';
   if(section)body+=(section.research?'<div class="pdf-toolbar"><span>'+esc(tr('retainedResearch'))+'</span>'+button('reviewSource','research-review')+'</div>':'')+label('section','<input data-pdf-section="title" maxlength="240" value="'+esc(section.title)+'">')+'<div class="pdf-toolbar">'+button('up','move','data-direction="-1"'+(offset===0&&sections.items[0]?.id===section.id?' disabled':''))+button('down','move','data-direction="1"'+(sections.next===null&&sections.items.at(-1)?.id===section.id?' disabled':''))+button('removeSection','remove-section')+'</div>'+label('level','<select data-pdf-section="level">'+[1,2,3,4,5,6].map(level=>'<option value="'+level+'"'+((section.level??1)===level?' selected':'')+'>'+level+'</option>').join('')+'</select>')+'<details><summary>'+esc(tr('sectionLayout'))+'</summary>'+label('start','<select data-pdf-section="start">'+['flow','page','recto','verso'].map(key=>'<option value="'+key+'"'+((section.start??'flow')===key?' selected':'')+'>'+esc(tr(key))+'</option>').join('')+'</select>')+'<label><input type="checkbox" data-pdf-custom'+(section.layout?' checked':'')+'>'+esc(tr('custom'))+'</label>'+(section.layout?pdfLayoutFields(section.layout,'section',{esc,fonts:fontChoices}):'<p>'+esc(tr('inherit'))+'</p>')+'</details><div data-pdf-publication-host>'+pdfPublicationFields(selected.header,section,{esc,text:tr})+'</div>'+composition.view()+pagination.view()+images.view()+docs.field({key:section.id,label:tr('content'),value:section.content,set:value=>{section.content=value;change('section');}})+notes.view()+crossReferences.view();
   body+='</section></div>';
   if(preview.state().visible){const current=preview.state().current;body+='<section class="panel pdf-preview-panel" data-pdf-preview><div class="pdf-toolbar"><h2>'+esc(tr('previewTitle'))+'</h2>'+button('closePreview','close-preview')+'</div><p role="status" data-pdf-preview-status></p><div data-pdf-pages>'+pages.view()+'</div><iframe class="pdf-preview" title="'+esc(tr('previewTitle'))+'"'+(current?' src="'+esc(pages.frameURL()??current.url)+'"':' hidden')+'></iframe></section>';}
   body+='</div>';
  }
  body+='<div data-pdf-exports-host>'+exports.view()+'</div>';
  return '<section data-pdf-editor aria-busy="'+busy+'"'+(busy?' inert':'')+'>'+body+'</section>';
 }
 async function action(name,node){
  if(busy)return;busy=true;status();
  try{
   if(name==='edit-undo'||name==='edit-redo'){await history.run(name==='edit-undo'?'undo':'redo');return;}
   if(name==='print-condition-retry'){await printCondition.retry();return;}
   if(name==='retry'){await save();return;}
   if(name==='close-preview'){preview.close();draw();return;}
   if(name==='download'){await flush();await exports.start();return;}
   if(pages.action(name,node))return;
   if(await exports.action(name,node))return;
   if(notes.action(name,node)){await save();draw();return;}notes.flush();await save();
   if(await crossReferences.action(name,node)){await save();return;}
   if(await outline.action(name,node))return;
   if(composition.action(name)||pagination.action(name)){await save();return;}
   if(changePdfPublication(selected?.header,section,name)){change('section');await save();status();return;}
   if(name==='selection-review'){audienceSummary=await post('selection',{id:selected.header.id,revision:selected.revision});draw();return;}
   if(await library.action(name)){draw();return;}
   if(printCondition.action(name)||pressArtwork.action(name)||await research.action(name,node)||await images.action(name,node)){draw();return;}
   if(name==='archive-list'){archived=!archived;state.modulePath='';await load('');}
   else if(name==='archive-document'){await command({type:'remove'});archived=false;state.modulePath='';await load('');}
   else if(name==='archive-restore'){const saved=await post('openArchived',{id:node.dataset.id});await post('change',{id:node.dataset.id,commandId:uuid(),expectedRevision:saved.revision,operation:{type:'restore-document'}});await load('');}
   else if(name==='new'){archived=false;const id=uuid(),first={id:uuid(),title:'',content:'',layout:null,start:null},header={version:1,id,name:tr('new'),language:document.documentElement.lang||'en',direction:'auto',layout:pdfLayoutPreset()};await post('change',{id,commandId:uuid(),expectedRevision:null,operation:{type:'create',header,section:first}});state.modulePath=id;await load(id);}
   else if(name==='list'||name==='open'){state.modulePath=name==='list'?'':node.dataset.id;await load(state.modulePath);}
   else if(name==='more-documents'){const more=await post(archived?'archive':'list',{after:node.dataset.after});list={items:[...list.items,...more.items],next:more.next};}
   else if(name==='section'){section=(await post('section',{id:selected.header.id,sectionId:node.dataset.id,revision:selected.revision})).section;}
   else if(name==='section-page')await sectionPage(Number(node.dataset.offset));
   else if(name==='append'){const next={id:uuid(),title:'',content:'',layout:null,start:null};await command({type:'append',section:next});selected.count++;await sectionPage(Math.floor((selected.count-1)/20)*20);section=next;}
   else if(name==='move'){await command({type:'move',sectionId:section.id,direction:Number(node.dataset.direction)});const id=section.id;await sectionPage(offset);section=(await post('section',{id:selected.header.id,sectionId:id,revision:selected.revision})).section;}
   else if(name==='remove-section'){await command({type:'remove-section',sectionId:section.id});selected.count--;await sectionPage(Math.min(offset,Math.max(0,Math.floor((selected.count-1)/20)*20)));}
   else if(name==='history'){editions=editions?null:await post('history',{id:selected.header.id});}
   else if(name==='more-history'){const more=await post('history',{id:selected.header.id,before:Number(node.dataset.before)});editions={items:[...editions.items,...more.items],next:more.next};}
   else if(name==='restore'){await command({type:'restore',revision:node.dataset.revision});await load(selected.header.id);}
   else if(name==='preflight')preflight=await post('preflight',{id:selected.header.id,revision:selected.revision});
   else if(name==='finding'){const finding=preflight?.findings[Number(node.dataset.finding)];if(!finding?.sectionId)return;const target=await post('section',{id:selected.header.id,sectionId:finding.sectionId,revision:selected.revision,locate:true});await sectionPage(Math.floor(target.ordinal/20)*20);section=target.section;pendingFinding=finding;}
   else if(name==='preview')void preview.show(selected.header.id,selected.revision).catch(()=>{});
   draw();
  }finally{busy=false;if(selected&&!dirty())preview.refresh(selected.header.id,selected.revision);status();if(pendingFinding&&focusPdfFinding(root(),section,pendingFinding))pendingFinding=null;}
 }
 async function ensureFont(id,sourceLayout=null){
  if(selected.header.fonts?.some(pin=>pin.id===id))return;
  const documentId=selected.header.id;await post('font-retain',{id:documentId,commandId:uuid(),expectedRevision:selected.revision,fontId:id,...(sourceLayout?{sourceLayout}:{})});
  if(disposed||selected?.header.id!==documentId)throw new DOMException('Document changed','AbortError');
  selected=await post('open',{id:documentId});const fonts=await post('fonts',{id:documentId});fontChoices=[...new Map([...fonts.available,...fonts.retained].map(font=>[font.id,font])).values()];
 }
 function retainFont(id,kind){
  if(busy||pendingFont)return pendingFont;busy=true;status();
  pendingFont=(async()=>{await save();await ensureFont(id);if(kind==='header')selected.header.layout.font=id;else section.layout.font=id;change(kind);await save();})().catch(e=>{if(active())notify(e.message??String(e));}).finally(()=>{pendingFont=null;busy=false;status();});return pendingFont;
 }
 async function flush(){await pendingFont;await images.whenIdle();await pressArtwork.whenIdle();await printCondition.whenIdle();notes.flush();return save();}
 function input(el){
  if(el.hasAttribute('data-pdf-audience')){if(changePdfAudience(selected.header,el.value)){change('header');draw();}return true;}
  if(changePdfCaption(selected.header,el)){change('header');return true;}
  if(el.dataset.pdfStructure){selected.header.structure??=pdfStructureDefaults();selected.header.structure[el.dataset.pdfStructure]=el.type==='checkbox'?el.checked:el.value;change('header');return true;}
  if(outline.input(el)||crossReferences.input(el))return true;
  if(composition.input(el)||pagination.input(el))return true;
  if(printCondition.input(el)||pressArtwork.input(el)||library.input(el)||research.input(el)||images.input(el)||notes.input(el))return true;
  if(el.dataset.pdfHeader){selected.header[el.dataset.pdfHeader]=el.value;change('header');return true;}
  if(el.dataset.pdfSection){section[el.dataset.pdfSection]=el.dataset.pdfSection==='level'?Number(el.value):el.dataset.pdfSection==='start'&&el.value==='flow'?null:el.value;change('section');return true;}
  if(el.hasAttribute('data-pdf-output-profile')){if(changePdfOutputProfile(selected.header,el.value)){change('header');draw();}return true;}
  if(el.dataset.pdfPress){if(changePdfPress(selected.header,el))change('header');return true;}
  if(el.dataset.pdfLayout){const kind=el.dataset.pdfLayout==='document'?'header':'section',layout=kind==='header'?selected.header.layout:section.layout;if(el.dataset.key==='font'&&customFontId(el.value)){void retainFont(el.value,kind);return true;}changePdfLayout(layout,el.dataset.key,el.type==='checkbox'?el.checked:el.value);if(kind==='header')refreshPdfPress(selected.header,root());change(kind);if(el.dataset.key==='master.enabled')draw();return true;}
  if(el.hasAttribute('data-pdf-custom')){section.layout=el.checked?structuredClone(selected.header.layout):null;change('section');draw();return true;}return false;
 }
 const capabilities=await post('capabilities');canRender=capabilities.render;canArchival=capabilities.archival===true;await library.load();await activate();document.addEventListener('keydown',historyKey);
 return {activate,view,action,input,bind:()=>{docs.bind(root()??document);retainedFonts.update(selected,section,fontChoices);exports.bind();composition.bind(root());pagination.bind(root());pages.bind();status();if(pendingFinding&&!busy){focusPdfFinding(root(),section,pendingFinding);pendingFinding=null;}},isDirty:()=>dirty()||saving!==null||pendingFont!==null||(images.isBusy()||pressArtwork.isBusy()||printCondition.isBusy()||printCondition.hasPending())||notes.hasPending(),needsNavigationGuard:()=>dirty()||saving!==null||pendingFont!==null||(images.isBusy()||pressArtwork.isBusy()||printCondition.isBusy()||printCondition.hasPending())||notes.hasPending(),flushAutosave:flush,save:flush,discard:async()=>{clearTimeout(timer);await printCondition.discard();if(saving)await saving.catch(()=>{});retry=null;headerDirty=sectionDirty=0;await load(state.modulePath??'');draw();},deactivate(){pressArtwork.deactivate();retainedFonts.clear();crossReferences.deactivate();outline.deactivate();exports.deactivate();docs.release();preview.close();},dispose(){printCondition.dispose();pressArtwork.dispose();retainedFonts.dispose();disposed=true;document.removeEventListener('keydown',historyKey);history.clear();crossReferences.dispose();pages.dispose();outline.dispose();composition.dispose();pagination.dispose();exports.dispose();images.dispose();clearTimeout(timer);preview.reset();docs.release();if(dirty())void save().catch(()=>{});}};
}
