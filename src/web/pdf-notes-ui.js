import './i18n/catalogues/pdfEditor.js';
import {t} from './i18n/index.js';
import {validPdfNoteContent} from './pdf-notes-model.js';
import {proseText} from './prose-model.js';
const tr=key=>t('pdfEditor',key);
// Use the parent's rich editor registry so notes share its link and figure tools.
export function pdfNotesUI({esc,getDocument,getSection,changed,draw,field}){
 let context='',content='',kind='footnote',block=0,entry=0;
 const key=()=>[getDocument()?.header.id,getSection()?.id].join(':'),same=value=>value===key();
 function reset(){context=key();content='';kind='footnote';block=0;entry++;}
 const button=(label,command,id='')=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="note-'+command+'"'+(id?' data-id="'+id+'"':'')+'>'+esc(tr(label))+'</button>';
 const label=(name,input)=>'<label class="field">'+esc(tr(name))+input+'</label>';
 function controls(value,id=''){
  const attr=id?' data-pdf-note-id="'+id+'"':' data-pdf-note-new';
  return label('noteKind','<select'+attr+' data-pdf-note-field="kind">'+[['footnote','noteSection'],['page-footnote','notePageFootnote'],['endnote','noteEndnote']].map(([name,title])=>'<option value="'+name+'"'+(value.kind===name?' selected':'')+'>'+esc(tr(title))+'</option>').join('')+'</select>')+label('noteBlock','<input type="number"'+attr+' data-pdf-note-field="block" min="0" max="12000" step="1" value="'+value.block+'">');
 }
 function view(){
  if(context!==key())reset();const section=getSection();if(!section)return '';const selected=context;
  let html='<details data-pdf-notes'+(section.notes?.length?' open':'')+'><summary>'+esc(tr('notesTitle'))+'</summary><p>'+esc(tr('noteSectionHelp'))+'</p>';
  for(const note of section.notes??[])html+='<section class="panel" data-pdf-note="'+note.id+'">'+field({key:'pdf-note-'+note.id,label:tr('noteContent'),value:note.content,set:value=>{if(same(selected)&&getSection()?.notes?.includes(note)){note.content=value;changed();}}})+controls(note,note.id)+button('noteRemove','remove',note.id)+'</section>';
  html+='<section class="panel" data-pdf-note-new-form>'+field({key:'pdf-note-new-'+section.id+'-'+entry,label:tr('noteContent'),value:content,set:value=>{if(same(selected))content=value;}})+controls({kind,block})+button('noteAdd','add')+'</section>';
  return html+'</details>';
 }
 function input(el){
  const name=el.dataset.pdfNoteField;if(!name)return false;if(context!==key())reset();
  const value=name==='block'?(el.value===''?NaN:Number(el.value)):el.value;
  if(name==='block'&&(!Number.isInteger(value)||value<0||value>12000)||name==='kind'&&!['footnote','page-footnote','endnote'].includes(value)){el.setAttribute?.('aria-invalid','true');return true;}
  if(!['block','kind'].includes(name))return false;el.removeAttribute?.('aria-invalid');
  if(!el.dataset.pdfNoteId){if(name==='block')block=value;else kind=value;return true;}
  const note=getSection()?.notes?.find(value=>value.id===el.dataset.pdfNoteId);if(note){note[name]=value;changed();}return true;
 }
 function hasPending(){try{return !!proseText(content).trim();}catch{return true;}}
 function applyPending(){
  if(!validPdfNoteContent(content))throw Error(tr('noteMissingContent'));const section=getSection();if(!section)return false;
  (section.notes??=[]).push({id:crypto.randomUUID(),content:structuredClone(content),kind,block});content='';kind='footnote';block=0;entry++;changed();draw();return true;
 }
 function flush(){if(context!==key())reset();return hasPending()?applyPending():false;}
 function action(command,node){
  if(!command.startsWith('note-'))return false;if(context!==key())reset();const section=getSection();if(!section)return true;
  if(command==='note-add'){
   applyPending();return true;
  }
  if(command==='note-remove'){const index=section.notes?.findIndex(value=>value.id===node.dataset.id)??-1;if(index>=0){section.notes.splice(index,1);if(!section.notes.length)delete section.notes;changed();draw();}return true;}
  return false;
 }
 return {view,input,action,hasPending,flush};
}
