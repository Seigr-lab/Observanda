import './i18n/catalogues/pdfEditor.js';
import {t} from './i18n/index.js';
import {pdfNoteCall,pdfNoteLocations,validPdfNoteContent} from './pdf-notes-model.js';
import {proseText} from './prose-model.js';
const tr=key=>t('pdfEditor',key);
// Use the parent's rich editor registry so notes share its link and figure tools.
export function pdfNotesUI({esc,getDocument,getSection,changed,draw,field,insertLink,goToMarker}){
 let context='',content='',kind='footnote',entry=0;
 const key=()=>[getDocument()?.header.id,getSection()?.id].join(':'),same=value=>value===key();
 function reset(){context=key();content='';kind='footnote';entry++;}
 const button=(label,command,id='')=>'<button type="button" class="button" data-action="module-command" data-module-id="pdf-editor" data-command="note-'+command+'"'+(id?' data-id="'+id+'"':'')+'>'+esc(tr(label))+'</button>';
 const label=(name,input)=>'<label class="field">'+esc(tr(name))+input+'</label>';
 function controls(value,id=''){
  const attr=id?' data-pdf-note-id="'+id+'"':' data-pdf-note-new';
  return label('noteKind','<select'+attr+' data-pdf-note-field="kind">'+[['footnote','noteSection'],['page-footnote','notePageFootnote'],['endnote','noteEndnote']].map(([name,title])=>'<option value="'+name+'"'+(value.kind===name?' selected':'')+'>'+esc(tr(title))+'</option>').join('')+'</select>')+(id&&value.anchor!=='inline'?label('noteBlock','<input type="number"'+attr+' data-pdf-note-field="block" min="0" max="12000" step="1" value="'+value.block+'">'):'');
 }
 function view(){
  if(context!==key())reset();const section=getSection();if(!section)return '';const selected=context,newEntry=entry;
  let html='<details data-pdf-notes'+(section.notes?.length?' open':'')+'><summary>'+esc(tr('notesTitle'))+'</summary><p>'+esc(tr('noteSectionHelp'))+'</p>';
  const locations=pdfNoteLocations(section.content);
  for(const note of section.notes??[]){const at=locations.get(note.id);
   html+='<section class="panel" data-pdf-note="'+note.id+'">'+field({key:'pdf-note-'+note.id,label:tr('noteContent'),value:note.content,set:value=>{if(same(selected)&&getSection()?.notes?.includes(note)){note.content=value;changed();}}})+controls(note,note.id)+(note.anchor==='inline'&&at&&!at.ambiguous?button('noteGoMarker','marker',note.id):'')+(note.anchor==='inline'&&(!at||at.ambiguous)?'<p role="alert">'+esc(t('errors','PDF_NOTE_ANCHOR'))+'</p>':'')+button('noteMoveMarker','move',note.id)+button('noteRemove','remove',note.id)+'</section>';
  }
  html+='<section class="panel" data-pdf-note-new-form>'+field({key:'pdf-note-new-'+section.id+'-'+entry,label:tr('noteContent'),value:content,set:value=>{if(same(selected)&&entry===newEntry)content=value;}})+controls({kind})+button('noteAdd','add')+'</section>';
  return html+'</details>';
 }
 function input(el){
  const name=el.dataset.pdfNoteField;if(!name)return false;if(context!==key())reset();
  const value=name==='block'?(el.value===''?NaN:Number(el.value)):el.value;
  if(name==='block'&&(!Number.isInteger(value)||value<0||value>12000)||name==='kind'&&!['footnote','page-footnote','endnote'].includes(value)){el.setAttribute?.('aria-invalid','true');return true;}
  if(!['block','kind'].includes(name))return false;el.removeAttribute?.('aria-invalid');
  if(!el.dataset.pdfNoteId){if(name==='kind')kind=value;return true;}
  const note=getSection()?.notes?.find(value=>value.id===el.dataset.pdfNoteId);if(note&&(name!=='block'||note.anchor!=='inline')){note[name]=value;changed();}return true;
 }
 function hasPending(){try{return !!proseText(content).trim();}catch{return true;}}
 function applyPending(){
  if(!validPdfNoteContent(content))throw Error(tr('noteMissingContent'));const section=getSection();if(!section)return false;
  const note={id:crypto.randomUUID(),content:structuredClone(content),kind,anchor:'inline'};
  if(!insertLink({href:pdfNoteCall(note.id),label:'†'},'insert'))throw Error(tr('referenceChooseCaret'));
  (getSection().notes??=[]).push(note);content='';kind='footnote';entry++;changed();draw();return true;
 }
 function flush(){if(context!==key())reset();return hasPending()?applyPending():false;}
 function action(command,node){
  if(!command.startsWith('note-'))return false;if(context!==key())reset();const section=getSection();if(!section)return true;
  if(command==='note-add'){
   applyPending();return true;
  }
  const note=section.notes?.find(value=>value.id===node.dataset.id);if(!note)return true;
  const marker={href:pdfNoteCall(note.id),label:'†'};
  if(command==='note-marker'){goToMarker(marker.href);return true;}
  if(command==='note-move'){if(!insertLink(marker,'move'))throw Error(tr('referenceChooseCaret'));delete note.block;note.anchor='inline';changed();draw();return true;}
  if(command==='note-remove'){if(note.anchor==='inline'&&!insertLink(marker,'remove'))throw Error(tr('referenceChooseCaret'));const section=getSection();section.notes=section.notes.filter(value=>value.id!==note.id);if(!section.notes.length)delete section.notes;changed();draw();return true;}
  return false;
 }
 return {view,input,action,hasPending,flush};
}
