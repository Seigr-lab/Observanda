import './i18n/catalogues/pdfEditor.js';
import {t} from './i18n/index.js';
import {pdfPaginationStatus,pdfPaginationRuleDefaults,pdfSetPaginationRule,pdfRemovePaginationRule,pdfAdjustPagination} from './pdf-pagination-model.js';
const tr=key=>t('pdfEditor',key);
export function pdfPaginationUI({esc,getDocument,getSection,changed,draw}){
 let context='',selected=0,root=null,expanded=false;
 const key=()=>[getDocument()?.header.id,getSection()?.id].join(':'),label=(name,input)=>'<label class="field">'+esc(tr(name))+input+'</label>',button=(name,command,disabled=false)=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="pagination-'+command+'"'+(disabled?' disabled':'')+'>'+esc(tr(name))+'</button>';
 const message=status=>tr(!status.compatible?'paginationPositioned':status.stale?'paginationStale':!status.items.length?'paginationEmpty':'paginationHelp');
 function reset(){context=key();selected=0;root=null;expanded=false;}
 function view(){
  if(context!==key())reset();const section=getSection();if(!section)return '';const status=pdfPaginationStatus(section);if(!status.items.some(item=>item.block===selected))selected=status.items[0]?.block??0;
  const disabled=!status.compatible||status.stale||!status.items.length;let html='<details data-pdf-pagination-editor'+(section.pagination||expanded?' open':'')+'><summary>'+esc(tr('paginationTitle'))+'</summary><p role="status" data-pdf-pagination-status>'+esc(message(status))+'</p>';
  html+='<div class="pdf-toolbar">'+button('paginationAdjust','adjust',!status.compatible||!status.stale)+button('paginationClear','clear',!section.pagination)+'</div><fieldset data-pdf-pagination-controls'+(disabled?' disabled':'')+'>';
  html+=label('paginationBlock','<select data-pdf-pagination-select>'+status.items.map(item=>'<option value="'+item.block+'"'+(item.block===selected?' selected':'')+'>'+esc(String(item.block+1)+(item.label?' - '+item.label:''))+'</option>').join('')+'</select>');
  const value=section.pagination?.rules.find(rule=>rule.block===selected)??pdfPaginationRuleDefaults(section,selected)??{keepWithNext:false,keepTogether:false,widows:3,orphans:3};
  if(value){for(const name of ['keepWithNext','keepTogether'])html+='<label><input type="checkbox" data-pdf-pagination-field="'+name+'"'+(value[name]?' checked':'')+'>'+esc(tr('pagination'+name[0].toUpperCase()+name.slice(1)))+'</label>';for(const name of ['orphans','widows'])html+=label('pagination'+name[0].toUpperCase()+name.slice(1),'<input type="number" min="1" max="10" step="1" data-pdf-pagination-field="'+name+'" value="'+value[name]+'">');html+=button('paginationReset','reset');}
  return html+'</fieldset><p>'+esc(tr('paginationAuthority'))+'</p></details>';
 }
 function refresh(){
  if(!root||!getSection())return;const section=getSection(),status=pdfPaginationStatus(section),text=root.querySelector('[data-pdf-pagination-status]'),controls=root.querySelector('[data-pdf-pagination-controls]'),adjust=root.querySelector('[data-command="pagination-adjust"]'),clear=root.querySelector('[data-command="pagination-clear"]'),select=root.querySelector('[data-pdf-pagination-select]');
  const prior=selected;if(!status.items.some(item=>item.block===selected))selected=status.items[0]?.block??0;
  if(select){const existing=new Map([...select.options].map(option=>[option.value,option]));for(const [index,item] of status.items.entries()){const value=String(item.block),option=existing.get(value)??select.ownerDocument.createElement('option'),label=String(item.block+1)+(item.label?' - '+item.label:'');existing.delete(value);option.value=value;if(option.textContent!==label)option.textContent=label;if(select.options[index]!==option)select.insertBefore(option,select.options[index]??null);}for(const option of existing.values())option.remove();if(select.value!==String(selected))select.value=String(selected);}
  if(prior!==selected){const value=section.pagination?.rules.find(rule=>rule.block===selected)??pdfPaginationRuleDefaults(section,selected)??{keepWithNext:false,keepTogether:false,widows:3,orphans:3};for(const input of root.querySelectorAll('[data-pdf-pagination-field]')){const name=input.dataset.pdfPaginationField;if(['keepWithNext','keepTogether'].includes(name))input.checked=value[name];else input.value=String(value[name]);input.removeAttribute('aria-invalid');}}
  if(text)text.textContent=message(status);if(controls)controls.disabled=!status.compatible||status.stale||!status.items.length;if(adjust)adjust.disabled=!status.compatible||!status.stale;if(clear)clear.disabled=!section.pagination;
 }
 function retain(value){const section=getSection();if(value?.rules.length)section.pagination=value;else delete section.pagination;changed();refresh();}
 function input(el){
  if(context!==key())reset();const section=getSection();if(!section)return false;
  if(el.hasAttribute('data-pdf-pagination-select')){const value=Number(el.value);if(pdfPaginationStatus(section).items.some(item=>item.block===value)){selected=value;expanded=true;draw();}return true;}
  const name=el.dataset.pdfPaginationField;if(!['keepWithNext','keepTogether','widows','orphans'].includes(name))return false;
  const next=pdfSetPaginationRule(section,selected,{[name]:['keepWithNext','keepTogether'].includes(name)?!!el.checked:el.value===''?NaN:Number(el.value)});if(!next){el.setAttribute?.('aria-invalid','true');return true;}el.removeAttribute?.('aria-invalid');expanded=true;retain(next);return true;
 }
 function action(command){if(!['pagination-adjust','pagination-reset','pagination-clear'].includes(command))return false;if(context!==key())reset();const section=getSection();if(!section)return true;if(command==='pagination-clear'){if(section.pagination)retain(null);}else if(!section.composition){if(command==='pagination-adjust')retain(pdfAdjustPagination(section));else if(!pdfPaginationStatus(section).stale)retain(pdfRemovePaginationRule(section,selected));}expanded=true;draw();return true;}
 return {view,input,action,refresh,bind(host){root=host;refresh();},dispose(){root=null;}};
}
