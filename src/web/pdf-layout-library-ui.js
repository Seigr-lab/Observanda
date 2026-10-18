import {customFontId} from './font-catalogue.js';
import {t} from './i18n/index.js';
import {pdfLayoutPreset} from './pdf-layout-model.js';
const tr=key=>t('pdfEditor',key);
export function pdfLayoutLibraryUI({post,esc,getLayout,getFontSource,applyLayout}){
 let layouts={items:[],next:null},chosen='digital',draftName='',pending=null;
 const builtin=()=>['digital','print'].includes(chosen),selected=()=>layouts.items.find(item=>item.id===chosen);
 const button=(label,command,disabled=false)=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="layout-'+command+'"'+(disabled?' disabled':'')+'>'+esc(tr(label))+'</button>';
 async function load(){layouts=await post('layouts');if(!builtin()&&!selected())chosen='digital';}
 function view(){
  return '<details data-pdf-library><summary>'+esc(tr('savedLayouts'))+'</summary><p>'+esc(tr('layoutCopy'))+'</p><label class="field">'+esc(tr('chooseLayout'))+'<select data-pdf-preset>'+['digital','print'].map(id=>'<option value="'+id+'"'+(chosen===id?' selected':'')+'>'+esc(tr(id+'Layout'))+'</option>').join('')+layouts.items.map(item=>'<option value="'+item.id+'"'+(chosen===item.id?' selected':'')+'>'+esc(item.name)+'</option>').join('')+'</select></label><div class="pdf-toolbar">'+button('applyDocumentLayout','apply-document')+button('applySectionLayout','apply-section',!getLayout('section'))+button('removeLayout','remove',builtin())+(layouts.next?button('more','more'):'')+'</div><label class="field">'+esc(tr('layoutName'))+'<input data-pdf-layout-name maxlength="240" value="'+esc(draftName)+'"></label><div class="pdf-toolbar">'+button('saveDocumentLayout','save-document')+button('saveSectionLayout','save-section',!getLayout('section'))+'</div></details>';
 }
 function input(el){
  if(el.hasAttribute('data-pdf-layout-name')){draftName=el.value;return true;}
  if(el.hasAttribute('data-pdf-preset')){chosen=el.value;const remove=el.closest('[data-pdf-library]')?.querySelector('[data-command="layout-remove"]');if(remove)remove.disabled=builtin();return true;}
  return false;
 }
 async function action(command){
  if(!command.startsWith('layout-'))return false;
  const operation=command.slice(7);
  if(operation.startsWith('apply-')){const layout=builtin()?pdfLayoutPreset(chosen):selected()?.layout;if(!layout)throw new Error(tr('missingLayout'));await applyLayout(operation.slice(6),structuredClone(layout),builtin()?null:selected());}
  else if(operation.startsWith('save-')){
   if(!pending){const layout=getLayout(operation.slice(5));if(!layout||!draftName.trim())throw new Error(tr('nameLayout'));pending={id:crypto.randomUUID(),commandId:crypto.randomUUID(),expectedRevision:null,operation:{type:'save',name:draftName.trim(),layout:structuredClone(layout),...(customFontId(layout.font)?{fontSource:getFontSource(layout.font)}:{})}};}
   const saved=await post('layout-change',pending),item={id:pending.id,revision:saved.revision,name:pending.operation.name,layout:pending.operation.layout};pending=null;draftName='';
   await load();if(!layouts.items.some(entry=>entry.id===item.id))layouts.items.push(item);chosen=item.id;
  }else if(operation==='remove'){
   const item=selected();if(!item)throw new Error(tr('missingLayout'));await post('layout-change',{id:item.id,commandId:crypto.randomUUID(),expectedRevision:item.revision,operation:{type:'remove'}});await load();
  }else if(operation==='more'){
   const more=await post('layouts',{after:layouts.next});layouts={items:[...new Map([...layouts.items,...more.items].map(item=>[item.id,item])).values()],next:more.next};
  }else return false;
  return true;
 }
 return {load,view,input,action};
}
