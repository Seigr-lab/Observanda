import {t} from './i18n/index.js';
import {pdfCrossReferenceTargets,appendPdfCrossReference} from './pdf-cross-reference-model.js';
const defaultText=(key,args)=>t('pdfEditor',key,args);
// One pinned outline page and one selected section. The parent owns autosave
// and replacing the active rich editor after an appended reference paragraph.
export function pdfCrossReferencesUI({getDocument,getSection,post,esc,draw,insertContent,text=defaultText}){
 let context='',query='',page=null,previous=[],targets=null,targetOffset=0,request=null,epoch=0,disposed=false;
 const identity=()=>[getDocument()?.header.id,getDocument()?.revision,getSection()?.id].join(':'),button=(label,command,attrs='')=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="cross-reference-'+command+'" '+attrs+'>'+esc(text(label))+'</button>';
 function reset(){request?.abort();request=null;context=identity();page=null;previous=[];targets=null;targetOffset=0;epoch++;}
 function sync(){if(context!==identity())reset();}
 const current=token=>!disposed&&token===epoch&&context===identity();
 function view(){
  sync();if(disposed||!getDocument()||!getSection())return '';
  let html='<details data-pdf-cross-references'+(page?' open':'')+'><summary>'+esc(text('crossReferences'))+'</summary><p>'+esc(text('crossReferenceHelp'))+'</p><label class="field">'+esc(text('outlineSearch'))+'<input type="search" data-pdf-cross-reference-query maxlength="240" value="'+esc(query)+'"></label>'+button('outlineSearchAction','search');
  if(page){
   html+='<nav aria-label="'+esc(text('crossReferenceSections'))+'">'+page.items.map((item,index)=>'<span>'+esc(item.title||text('untitled'))+'</span> '+button('crossReferenceChoose','section','data-index="'+index+'" aria-label="'+esc(item.title||text('untitled'))+'"')).join('')+'</nav>';
   if(!page.items.length)html+='<p>'+esc(text('outlineEmpty'))+'</p>';
   html+='<div class="pdf-toolbar">'+(previous.length?button('previous','previous'):'')+(page.next!==null?button('outlineContinue','next'):'')+'</div>';
  }
  if(targets){
   html+='<ul>'+targets.slice(targetOffset,targetOffset+20).map((item,index)=>'<li><span>'+esc(text('crossReference'+item.target.kind[0].toUpperCase()+item.target.kind.slice(1))+': '+(item.label||text('untitled')))+'</span> '+button(item.ambiguous?'crossReferenceAmbiguous':'crossReferenceInsert','insert','data-index="'+(targetOffset+index)+'"'+(item.ambiguous?' disabled':''))+'</li>').join('')+'</ul><div class="pdf-toolbar">'+(targetOffset?button('previous','targets-previous'):'')+(targetOffset+20<targets.length?button('next','targets-next'):'')+'</div>';
  }
  return html+'</details>';
 }
 function input(node){if(!node.hasAttribute('data-pdf-cross-reference-query'))return false;sync();query=node.value;request?.abort();epoch++;return true;}
 async function load(offset,back){
  sync();request?.abort();const abort=new AbortController();request=abort;const token=++epoch,document=getDocument();
  try{const result=await post('outline',{id:document.header.id,revision:document.revision,query,offset,limit:20},{signal:abort.signal});if(!current(token))return;if(result.revision!==document.revision)throw Error('CONFLICT');page=result;query=result.query;previous=back;targets=null;draw();}catch(error){if(current(token))throw error;}finally{if(request===abort)request=null;}
 }
 async function action(name,node){
  if(!name.startsWith('cross-reference-'))return false;sync();if(disposed||!getDocument()||!getSection())return true;
  if(name==='cross-reference-search'){await load(0,[]);return true;}
  if(name==='cross-reference-next'||name==='cross-reference-previous'){
   if(page&&page.query!==query.normalize('NFKC').trim().toLowerCase())await load(0,[]);
   else if(name==='cross-reference-next'&&page?.next!==null&&page)await load(page.next,[...previous,page.offset]);
   else if(name==='cross-reference-previous'&&previous.length)await load(previous.at(-1),previous.slice(0,-1));return true;
  }
  if(name==='cross-reference-section'){
   const row=page?.items[Number(node.dataset.index)];if(!row)return true;request?.abort();const abort=new AbortController();request=abort;const token=++epoch,document=getDocument();
   try{const result=await post('section',{id:document.header.id,revision:document.revision,sectionId:row.id},{signal:abort.signal});if(!current(token))return true;if(result.section?.id!==row.id)throw Error('CONFLICT');targets=pdfCrossReferenceTargets(result.section,{documentId:document.header.id});targetOffset=0;draw();}catch(error){if(current(token))throw error;}finally{if(request===abort)request=null;}return true;
  }
  if(name==='cross-reference-targets-next'||name==='cross-reference-targets-previous'){if(targets){targetOffset=Math.max(0,Math.min(Math.floor((targets.length-1)/20)*20,targetOffset+(name.endsWith('next')?20:-20)));draw();}return true;}
  if(name==='cross-reference-insert'){
   const item=targets?.[Number(node.dataset.index)];if(!item||item.ambiguous)return true;
   const label=text('crossReference'+item.target.kind[0].toUpperCase()+item.target.kind.slice(1))+': '+(item.label||text('untitled'));
   await insertContent(appendPdfCrossReference(getSection().content,item.target,label));return true;
  }
  return true;
 }
 function deactivate(){request?.abort();request=null;epoch++;}
 return {view,input,action,deactivate,dispose(){disposed=true;deactivate();}};
}
