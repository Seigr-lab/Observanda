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
 let selected=null,section=null,list={items:[],next:null},sections={items:[],next:null,total:0},offset=0,editions=null,canRender=false,disposed=false,timer=null,saving=null,retry=null,headerDirty=0,sectionDirty=0,serial=0,error='',busy=false,loadedPath=null,contentEpoch=0,preflight=null,audienceSummary=null,fontChoices=[],pendingFont=null;
 const root=()=>document.querySelector('[data-pdf-editor]'),active=()=>!disposed&&state.page==='module'&&state.moduleId==='pdf-editor';
 const draw=()=>{if(active())render();},post=(operation,data={},options={})=>api('/api/pdf/'+operation,{workspaceId,...data},{...options,adopt:false});
 const preview=pdfPreviewController({request:(id,revision,signal)=>post('export',{id,revision},{signal}),onChange:updatePreview});
 function updatePreview(){
  const panel=root()?.querySelector('[data-pdf-preview]');if(!panel)return;const state=preview.state(),frame=panel.querySelector('iframe'),message=panel.querySelector('[data-pdf-preview-status]');
  frame.hidden=!state.current;if(state.current&&frame.getAttribute('src')!==state.current.url)frame.src=state.current.url;
  message.textContent=state.error||(dirty()?tr('previewSaving'):state.busy?tr('rendering'):state.scheduled||state.current?.revision!==selected?.revision?tr('previewOld'):'');message.hidden=!message.textContent;
 }
 const docs=documentEditors({context:()=>[selected?.header.id,section?.id,contentEpoch].join(':'),figures:()=>section?.figures??[],onError:e=>notify(e.message??String(e))});
 const dirty=()=>!!(headerDirty||sectionDirty||retry),button=(label,command,attrs='')=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="'+command+'" '+attrs+'>'+esc(tr(label))+'</button>';
 const status=()=>{const host=root();const fields=host?.querySelector('[data-pdf-publication-host]');if(fields&&selected&&section)updatePdfPublicationFields(fields,selected.header,section,{esc,text:tr});if(host){host.setAttribute('aria-busy',String(busy));host.inert=busy;if(selected){const heading=host.querySelector('h1');if(heading.textContent!==selected.header.name)heading.textContent=selected.header.name;}if(section){const entry=host.querySelector('[data-command="section"][data-id="'+section.id+'"]'),title=section.title||tr('untitled');if(entry){if(entry.textContent!==title)entry.textContent=title;entry.style.paddingInlineStart=(.75+((section.level??1)-1))+'rem';}}}const node=root()?.querySelector('[data-pdf-status]');if(node)node.textContent=error||(dirty()||saving?tr('saving'):tr('saved'));const retryButton=root()?.querySelector('[data-command="retry"]');if(retryButton)retryButton.hidden=!error;updatePreview();};
 function change(kind){preflight=null;audienceSummary=null;if(kind==='header')headerDirty=++serial;else sectionDirty=++serial;error='';preview.invalidate();status();clearTimeout(timer);timer=setTimeout(()=>void save().catch(()=>{}),600);}
 async function command(operation){const result=await post('change',{id:selected.header.id,commandId:uuid(),expectedRevision:selected.revision,operation});selected.revision=result.revision;return result;}
 async function save(){
  clearTimeout(timer);if(saving)return saving;if(!selected||!dirty())return;
  if(!validPdfDocumentHeader(selected.header)||section&&!validPdfSection(section)){error=tr('invalid');status();throw new Error(error);}
  saving=(async()=>{
   while(dirty()){
    if(!retry){if(!validPdfDocumentHeader(selected.header)||section&&!validPdfSection(section))throw new Error(tr('invalid'));const kind=headerDirty?'header':'section',mark=kind==='header'?headerDirty:sectionDirty;retry={kind,mark,command:{id:selected.header.id,commandId:uuid(),expectedRevision:selected.revision,operation:{type:kind,[kind]:structuredClone(kind==='header'?selected.header:section)}}};}
    const task=retry,result=await post('change',task.command);selected.revision=result.revision;if(task.kind==='section'){const summary=sections.items.find(item=>item.id===task.command.operation.section.id);if(summary){summary.title=task.command.operation.section.title;summary.level=task.command.operation.section.level??1;}}
    if(task.kind==='header'&&headerDirty===task.mark)headerDirty=0;if(task.kind==='section'&&sectionDirty===task.mark)sectionDirty=0;retry=null;
   }
   error='';
  })().catch(e=>{error=e.message??String(e);throw e;}).finally(()=>{saving=null;if(!error&&!dirty()&&selected)preview.refresh(selected.header.id,selected.revision);status();});status();return saving;
 }
 async function load(id){
  contentEpoch++;preflight=null;audienceSummary=null;research.close();docs.release();loadedPath=id||'';editions=null;offset=0;error='';preview.reset();selected=null;section=null;sections={items:[],next:null,total:0};
  if(!id){list=await post('list');return;}
  if(!researchId(id))throw new Error('Invalid document');selected=await post('open',{id});const fonts=await post('fonts',{id});fontChoices=[...new Map([...fonts.available,...fonts.retained].map(font=>[font.id,font])).values()];await sectionPage(0);
 }
 async function sectionPage(value){offset=value;sections=await post('sections',{id:selected.header.id,revision:selected.revision,offset,limit:20});section=sections.items.length?(await post('section',{id:selected.header.id,sectionId:sections.items[0].id,revision:selected.revision})).section:null;}
 async function activate(){const path=state.modulePath??'';if(loadedPath===path)return;await flush();await load(path);}
 const library=pdfLayoutLibraryUI({post,esc,getLayout:kind=>kind==='document'?selected?.header.layout:section?(section.layout??selected.header.layout):null,getFontSource:id=>({documentId:selected.header.id,pin:selected.header.fonts?.find(pin=>pin.id===id)}),applyLayout:async(kind,layout,source)=>{if(customFontId(layout.font))await ensureFont(layout.font,source?{id:source.id,revision:source.revision}:null);if(kind==='document'){selected.header.layout=layout;change('header');}else if(section){section.layout=layout;change('section');}}});
 const research=pdfResearchUI({state,api,post,esc,getDocument:()=>selected,getSection:()=>section,retained:async(result,sectionId)=>{const id=selected.header.id;await load(id);section=(await post('section',{id,sectionId,revision:selected.revision})).section;}});
 const notes=pdfNotesUI({esc,getDocument:()=>selected,getSection:()=>section,changed:()=>change('section'),draw,field:options=>docs.field(options)});
 const exports=pdfExportsUI({post,esc,draw:()=>{const host=root()?.querySelector("[data-pdf-exports-host]");if(host)host.innerHTML=exports.view();},getDocument:()=>selected,notify});
 const images=pdfImagesUI({post,esc,getDocument:()=>selected,getSection:()=>section,changed:()=>change('section'),draw,notify,readImage:data=>post('image-read',data)});
 const structureView=()=>{const settings=selected.header.structure??pdfStructureDefaults();return '<details><summary>'+esc(tr('documentStructure'))+'</summary>'+label('contentsTitle','<input data-pdf-structure="contentsTitle" maxlength="160" value="'+esc(settings.contentsTitle)+'">')+['contents','numberSections','internalLinks','externalLinks','printUrls','bookmarks'].map(key=>label(key,'<input type="checkbox" data-pdf-structure="'+key+'"'+((key==='bookmarks'?(settings[key]??true):settings[key])?' checked':'')+'>')).join('')+'</details>';};
 const label=(key,input)=>'<label class="field">'+esc(tr(key))+input+'</label>';
 function view(){
  docs.release();
  let body='<div class="pdf-toolbar"><h1>'+esc(selected?selected.header.name:tr('title'))+'</h1>'+button(selected?'back':'new',selected?'list':'new')+(!selected?button('exports','exports-open'):'')+'</div>';
  if(!selected)body+='<div class="pdf-document-list">'+(list.items.length?list.items.map(item=>'<button class="button" data-action="module-command" data-module-id="pdf-editor" data-command="open" data-id="'+item.id+'">'+esc(item.name)+'</button>').join(''):'<p>'+esc(tr('empty'))+'</p>')+'</div>'+(list.next?button('more','more-documents','data-after="'+list.next+'"'):'');
  else{
   body+='<div class="pdf-toolbar"><span role="status" data-pdf-status>'+esc(error||(dirty()||saving?tr('saving'):tr('saved')))+'</span>'+button('retry','retry',error?'':'hidden')+button('history','history')+button('exports','exports-open')+button('research','research-open')+button('preview','preview',!canRender?'disabled':'')+button('selectionReview','selection-review')+button('preflight','preflight',!canRender?'disabled':'')+button('download','download',!canRender?'disabled':'')+'</div>';
   if(!canRender)body+='<p>'+esc(tr('desktop'))+'</p>';
   if(editions){body+='<section class="panel"><h2>'+esc(tr('history'))+'</h2><p>'+esc(tr('historyIntro'))+'</p>'+editions.items.map(item=>'<div class="pdf-toolbar"><span>'+esc(tr('edition',{number:item.sequence+1}))+' · '+esc(item.name)+'</span>'+(item.revision===selected.revision?'<span>'+esc(tr('current'))+'</span>':button('restore','restore','data-revision="'+item.revision+'"'))+'</div>').join('')+(editions.next!==null?button('more','more-history','data-before="'+editions.next+'"'):'')+'</section>';}
   body+=research.view()+pdfAudienceSummaryFields(audienceSummary,{esc,text:tr});
   if(preflight)body+='<section class="panel" data-pdf-preflight><h2>'+esc(tr('preflight'))+'</h2><p>'+esc(tr(preflight.status==='ok'?'preflightClear':'preflightReview'))+'</p>'+preflight.findings.map(finding=>'<div class="pdf-toolbar"><span>'+esc(t('errors',finding.code))+'</span>'+(finding.sectionId?button('showFinding','finding','data-id="'+finding.sectionId+'"'):'')+'</div>').join('')+(preflight.truncated?'<p>'+esc(tr('preflightTruncated'))+'</p>':'')+'<p>'+esc(tr('preflightScope'))+'</p></section>';
   body+='<div class="pdf-editor-surface'+(preview.state().visible?' has-preview':'')+'"><div class="pdf-workbench"><aside>'+library.view()+pdfAudienceFields(selected.header,{esc,text:tr})+structureView()+'<details><summary>'+esc(tr('document'))+'</summary>'+label('name','<input data-pdf-header="name" maxlength="240" value="'+esc(selected.header.name)+'">')+label('language','<input data-pdf-header="language" value="'+esc(selected.header.language)+'">')+label('direction','<select data-pdf-header="direction">'+['ltr','rtl','auto'].map(key=>'<option value="'+key+'"'+(selected.header.direction===key?' selected':'')+'>'+esc(tr(key))+'</option>').join('')+'</select>')+'</details><details><summary>'+esc(tr('documentLayout'))+'</summary><p>'+esc(tr('layoutNote'))+'</p>'+pdfLayoutFields(selected.header.layout,'document',{esc,fonts:fontChoices})+'</details><h2>'+esc(tr('sections'))+'</h2><nav aria-label="'+esc(tr('sections'))+'">'+sections.items.map(item=>'<button class="button" data-action="module-command" data-module-id="pdf-editor" data-command="section" data-id="'+item.id+'" style="padding-inline-start:'+(.75+((item.level??1)-1))+'rem"'+(section?.id===item.id?' aria-current="true"':'')+'>'+esc(item.id===section?.id?section.title||tr('untitled'):item.title||tr('untitled'))+'</button>').join('')+'</nav>'+(offset>0||sections.next!==null?'<div class="pdf-toolbar">'+button('previous','section-page','data-offset="'+Math.max(0,offset-20)+'"'+(offset===0?' disabled':''))+button('next','section-page','data-offset="'+sections.next+'"'+(sections.next===null?' disabled':''))+'</div>':'')+button('newSection','append')+'</aside><section class="pdf-composer">';
   if(section)body+=(section.research?'<div class="pdf-toolbar"><span>'+esc(tr('retainedResearch'))+'</span>'+button('reviewSource','research-review')+'</div>':'')+label('section','<input data-pdf-section="title" maxlength="240" value="'+esc(section.title)+'">')+'<div class="pdf-toolbar">'+button('up','move','data-direction="-1"'+(offset===0&&sections.items[0]?.id===section.id?' disabled':''))+button('down','move','data-direction="1"'+(sections.next===null&&sections.items.at(-1)?.id===section.id?' disabled':''))+button('removeSection','remove-section')+'</div>'+label('level','<select data-pdf-section="level">'+[1,2,3,4,5,6].map(level=>'<option value="'+level+'"'+((section.level??1)===level?' selected':'')+'>'+level+'</option>').join('')+'</select>')+'<details><summary>'+esc(tr('sectionLayout'))+'</summary>'+label('start','<select data-pdf-section="start">'+['flow','page','recto','verso'].map(key=>'<option value="'+key+'"'+((section.start??'flow')===key?' selected':'')+'>'+esc(tr(key))+'</option>').join('')+'</select>')+'<label><input type="checkbox" data-pdf-custom'+(section.layout?' checked':'')+'>'+esc(tr('custom'))+'</label>'+(section.layout?pdfLayoutFields(section.layout,'section',{esc,fonts:fontChoices}):'<p>'+esc(tr('inherit'))+'</p>')+'</details><div data-pdf-publication-host>'+pdfPublicationFields(selected.header,section,{esc,text:tr})+'</div>'+images.view()+docs.field({key:section.id,label:tr('content'),value:section.content,set:value=>{section.content=value;change('section');}})+notes.view();
   body+='</section></div>';
   if(preview.state().visible){const current=preview.state().current;body+='<section class="panel pdf-preview-panel" data-pdf-preview><div class="pdf-toolbar"><h2>'+esc(tr('previewTitle'))+'</h2>'+button('closePreview','close-preview')+'</div><p role="status" data-pdf-preview-status></p><iframe class="pdf-preview" title="'+esc(tr('previewTitle'))+'"'+(current?' src="'+esc(current.url)+'"':' hidden')+'></iframe></section>';}
   body+='</div>';
  }
  body+='<div data-pdf-exports-host>'+exports.view()+'</div>';
  return '<section data-pdf-editor aria-busy="'+busy+'"'+(busy?' inert':'')+'>'+body+'</section>';
 }
 async function action(name,node){
  if(busy)return;busy=true;status();
  try{
   if(name==='retry'){await save();return;}
   if(name==='close-preview'){preview.close();draw();return;}
   if(name==='download'){await flush();await exports.start();return;}
   if(await exports.action(name,node))return;
   if(notes.action(name,node)){await save();draw();return;}notes.flush();await save();
   if(changePdfPublication(selected?.header,section,name)){change('section');await save();status();return;}
   if(name==='selection-review'){audienceSummary=await post('selection',{id:selected.header.id,revision:selected.revision});draw();return;}
   if(await library.action(name)){draw();return;}
   if(await research.action(name,node)||await images.action(name,node)){draw();return;}
   if(name==='new'){const id=uuid(),first={id:uuid(),title:'',content:'',layout:null,start:null},header={version:1,id,name:tr('new'),language:document.documentElement.lang||'en',direction:'auto',layout:pdfLayoutPreset()};await post('change',{id,commandId:uuid(),expectedRevision:null,operation:{type:'create',header,section:first}});state.modulePath=id;await load(id);}
   else if(name==='list'||name==='open'){state.modulePath=name==='list'?'':node.dataset.id;await load(state.modulePath);}
   else if(name==='more-documents'){const more=await post('list',{after:node.dataset.after});list={items:[...list.items,...more.items],next:more.next};}
   else if(name==='section'){section=(await post('section',{id:selected.header.id,sectionId:node.dataset.id,revision:selected.revision})).section;}
   else if(name==='section-page')await sectionPage(Number(node.dataset.offset));
   else if(name==='append'){const next={id:uuid(),title:'',content:'',layout:null,start:null};await command({type:'append',section:next});selected.count++;await sectionPage(Math.floor((selected.count-1)/20)*20);section=next;}
   else if(name==='move'){await command({type:'move',sectionId:section.id,direction:Number(node.dataset.direction)});const id=section.id;await sectionPage(offset);section=(await post('section',{id:selected.header.id,sectionId:id,revision:selected.revision})).section;}
   else if(name==='remove-section'){await command({type:'remove-section',sectionId:section.id});selected.count--;await sectionPage(Math.min(offset,Math.max(0,Math.floor((selected.count-1)/20)*20)));}
   else if(name==='history'){editions=editions?null:await post('history',{id:selected.header.id});}
   else if(name==='more-history'){const more=await post('history',{id:selected.header.id,before:Number(node.dataset.before)});editions={items:[...editions.items,...more.items],next:more.next};}
   else if(name==='restore'){await command({type:'restore',revision:node.dataset.revision});await load(selected.header.id);}
   else if(name==='preflight')preflight=await post('preflight',{id:selected.header.id,revision:selected.revision});
   else if(name==='finding'){section=(await post('section',{id:selected.header.id,sectionId:node.dataset.id,revision:selected.revision})).section;}
   else if(name==='preview')void preview.show(selected.header.id,selected.revision).catch(()=>{});
   draw();
  }finally{busy=false;if(selected&&!dirty())preview.refresh(selected.header.id,selected.revision);status();}
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
 async function flush(){await pendingFont;await images.whenIdle();notes.flush();return save();}
 function input(el){
  if(el.hasAttribute('data-pdf-audience')){if(changePdfAudience(selected.header,el.value)){change('header');draw();}return true;}
  if(el.dataset.pdfStructure){selected.header.structure??=pdfStructureDefaults();selected.header.structure[el.dataset.pdfStructure]=el.type==='checkbox'?el.checked:el.value;change('header');return true;}
  if(library.input(el)||research.input(el)||images.input(el)||notes.input(el))return true;
  if(el.dataset.pdfHeader){selected.header[el.dataset.pdfHeader]=el.value;change('header');return true;}
  if(el.dataset.pdfSection){section[el.dataset.pdfSection]=el.dataset.pdfSection==='level'?Number(el.value):el.dataset.pdfSection==='start'&&el.value==='flow'?null:el.value;change('section');return true;}
  if(el.dataset.pdfLayout){const kind=el.dataset.pdfLayout==='document'?'header':'section',layout=kind==='header'?selected.header.layout:section.layout;if(el.dataset.key==='font'&&customFontId(el.value)){void retainFont(el.value,kind);return true;}changePdfLayout(layout,el.dataset.key,el.type==='checkbox'?el.checked:el.value);change(kind);if(el.dataset.key==='master.enabled')draw();return true;}
  if(el.hasAttribute('data-pdf-custom')){section.layout=el.checked?structuredClone(selected.header.layout):null;change('section');draw();return true;}return false;
 }
 canRender=(await post('capabilities')).render;await library.load();await activate();
 return {activate,view,action,input,bind:()=>{docs.bind(root()??document);exports.bind();status();},isDirty:()=>dirty()||saving!==null||pendingFont!==null||images.isBusy()||notes.hasPending(),needsNavigationGuard:()=>dirty()||saving!==null||pendingFont!==null||images.isBusy()||notes.hasPending(),flushAutosave:flush,save:flush,discard:async()=>{clearTimeout(timer);if(saving)await saving.catch(()=>{});retry=null;headerDirty=sectionDirty=0;await load(state.modulePath??'');draw();},deactivate(){exports.deactivate();docs.release();preview.close();},dispose(){disposed=true;exports.dispose();images.dispose();clearTimeout(timer);preview.reset();docs.release();if(dirty())void save().catch(()=>{});}};
}
