import {t} from './i18n/index.js';
const defaultText=(key,args)=>t('pdfEditor',key,args);
// The parent flushes authoring before actions and owns the selected editor.
// This controller keeps one result page and never replaces source text itself.
export function pdfOutlineUI({post,esc,draw,getDocument,getSection,changedSelection,text=defaultText}){
 let context='',query='',page=null,previous=[],position='',pendingMove=null,request=null,epoch=0,disposed=false;
 const identity=()=>{const value=getDocument();return value?[value.header.id,value.revision].join(':'):'';};
 function reset(){request?.abort();request=null;context=identity();page=null;previous=[];position='';pendingMove=null;epoch++;}
 function sync(){if(context!==identity())reset();}
 const current=token=>!disposed&&token===epoch&&context===identity();
 const button=(label,name,attrs='')=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="outline-'+name+'" '+attrs+'>'+esc(text(label))+'</button>';
 function view(){
  sync();const selected=getDocument();if(!selected||disposed)return '';
  let html='<details data-pdf-outline'+(page?' open':'')+'><summary>'+esc(text('outline'))+'</summary><label class="field">'+esc(text('outlineSearch'))+'<input type="search" data-pdf-outline-query maxlength="240" value="'+esc(query)+'"></label>'+button('outlineSearchAction','search');
  if(page){
   html+='<nav aria-label="'+esc(text('outline'))+'">'+page.items.map(row=>button('outlineOpen','open','data-id="'+esc(row.id)+'" aria-label="'+esc((row.ordinal+1)+'. '+(row.title||text('untitled')))+'"')+' <span>'+esc((row.ordinal+1)+'. '+(row.title||text('untitled')))+'</span>').join('')+'</nav>';
   if(!page.items.length)html+='<p>'+esc(text('outlineEmpty'))+'</p>';
   html+='<div class="pdf-toolbar">'+(previous.length?button('previous','previous'):'')+(page.next!==null?button('outlineContinue','next'):'')+'</div>';
  }else html+='<p>'+esc(text('outlineStart'))+'</p>';
  const section=getSection();if(section&&selected.count>0)html+='<p>'+esc(section.title||text('untitled'))+'</p><label class="field">'+esc(text('outlinePosition'))+'<input type="number" data-pdf-outline-position min="1" max="'+selected.count+'" step="1" value="'+esc(position)+'"></label>'+button('outlineMove','move');
  return html+'</details>';
 }
 function input(node){
  sync();if(node.hasAttribute('data-pdf-outline-query')){query=node.value;request?.abort();request=null;epoch++;return true;}
  if(node.hasAttribute('data-pdf-outline-position')){position=node.value;return true;}return false;
 }
 async function load(offset,back){
  sync();const selected=getDocument();if(!selected)return;
  request?.abort();const controller=new AbortController();request=controller;const token=++epoch,id=selected.header.id,revision=selected.revision;
  try{
   const result=await post('outline',{id,revision,query,offset,limit:20},{signal:controller.signal});if(!current(token))return;
   if(result.revision!==revision)throw Error('CONFLICT');page=result;query=result.query;previous=back;draw();
  }catch(error){if(current(token))throw error;}finally{if(request===controller)request=null;}
 }
 async function action(name,node){
  if(!['outline-search','outline-next','outline-previous','outline-open','outline-move'].includes(name))return false;
  sync();if(disposed||!getDocument())return true;
  if(name==='outline-search'){await load(0,[]);return true;}
  if(name==='outline-next'){if(page&&page.query!==query.normalize('NFKC').trim().toLowerCase())await load(0,[]);else if(page?.next!==null&&page)await load(page.next,[...previous,page.offset]);return true;}
  if(name==='outline-previous'){if(page&&page.query!==query.normalize('NFKC').trim().toLowerCase())await load(0,[]);else if(previous.length)await load(previous.at(-1),previous.slice(0,-1));return true;}
  const selected=getDocument(),token=epoch,documentId=selected.header.id,revision=selected.revision;
  if(name==='outline-open'){
   const row=page?.items.find(item=>item.id===node?.dataset.id);if(row&&page.revision===revision)await changedSelection({documentId,revision,sectionId:row.id,ordinal:row.ordinal});return true;
  }
  const section=getSection(),target=position===''?NaN:Number(position)-1;
  if(!section||!Number.isSafeInteger(target)||target<0||target>=selected.count)throw RangeError(text('outlinePosition'));
  if(!pendingMove||pendingMove.id!==documentId||pendingMove.expectedRevision!==revision||pendingMove.operation.sectionId!==section.id||pendingMove.operation.position!==target)pendingMove={id:documentId,commandId:crypto.randomUUID(),expectedRevision:revision,operation:{type:'move-to',sectionId:section.id,position:target}};
  const command=pendingMove,result=await post('change',command);if(!current(token)||getSection()?.id!==section.id)return true;
  await changedSelection({documentId,revision:result.revision,sectionId:section.id,ordinal:target});if(pendingMove===command)pendingMove=null;if(!disposed)draw();return true;
 }
 function deactivate(){request?.abort();request=null;epoch++;}
 return {view,input,action,deactivate,dispose(){disposed=true;deactivate();}};
}
