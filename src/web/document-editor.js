
import {mountRichText} from './vendor/rich-text-editor.js';
import {textTools} from './text-tools.js';
import {proseDocument} from './prose-model.js';
import {applyRichTextStyles} from './rich-text-stylesheet.js';
export {applyRichTextStyles} from './rich-text-stylesheet.js';
import {editorLinkInspector} from './record-links-ui.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Fields supply identity, content and a setter. The editor owns formatting,
// linking, selection and undo; it has no knowledge of record or module storage.
export function documentEditors({context,destinations,onOpenLink,onError,figures,book,fonts}){
 let owner=null;const fields=new Map(),mounted=new Map(),states=new Map(),inspectors=new Map();
 function release(){
  for(const inspector of inspectors.values())inspector.destroy();inspectors.clear();
  for(const [key,editor] of mounted){states.set(key,editor.state);editor.destroy();}
  mounted.clear();fields.clear();
  const next=context();if(next!==owner){states.clear();owner=next;}
 }
 function field({key,label,value,set,maxCharacters=60000}){
  fields.set(key,{label,value,set,maxCharacters});
  return `<div class="document-field" data-document-key="${esc(key)}"><div class="document-label">${esc(label)}</div><div class="document-tools"></div><div class="document-content"></div></div>`;
 }
 function bind(root=document){
  // Undo state belongs to fields on the active view, not every record visited.
  for(const key of states.keys())if(!fields.has(key))states.delete(key);
  for(const host of root.querySelectorAll('[data-document-key]')){
   const key=host.dataset.documentKey,field=fields.get(key);if(!field||mounted.has(key))continue;
   const toolbar=host.querySelector('.document-tools'),mount=host.querySelector('.document-content');
   toolbar.innerHTML=textTools({compact:true,fonts:typeof fonts==='function'?fonts():fonts});
   applyRichTextStyles(document,proseDocument(field.value));
   const editor=mountRichText({mount,toolbar,label:field.label,section:{richText:proseDocument(field.value)},initialState:states.get(key),
    onChange:value=>{field.value=value;applyRichTextStyles(document,value);field.set(value);},onOpenLink,onError,getFigures:figures,getDestinations:destinations,maxCharacters:field.maxCharacters});
   mounted.set(key,editor);
   if(onOpenLink)inspectors.set(key,editorLinkInspector({host,book,open:onOpenLink}));
  }
 }
 return {field,bind,release};
}
