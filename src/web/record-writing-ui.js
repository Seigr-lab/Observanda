import {documentEditors} from './document-editor.js';
import {renderProse} from './prose-model.js';
import {recordValueEditor} from './record-value-editor.js';
import {t} from './i18n/index.js';
const text=key=>t('recordWriting',key);
export function recordWritingUI(options){
 return recordValueEditor({...options,adapter:{route:'writing',baseName:'writing',messages:'recordWriting',target:value=>({sectionId:value.sectionId??null}),view:lifecycle=>recordWritingView(options,lifecycle)}});
}
export function recordWritingView(options,{context,close}){
 const {state,esc,field,destinations,figures,onOpenLink,notify}=options;

  const editors=documentEditors({context,book:()=>state.book,destinations,figures,onOpenLink:async href=>{if(await close())onOpenLink?.(href);},onError:message=>notify(message,true)});
  return {heading:base=>text(base?.sectionId===null?'summary':'section'),focus:'[data-writing-heading],.ProseMirror',release:()=>editors.release(),bind:dialog=>editors.bind(dialog),
   fields:(base,value,changed)=>(base.sectionId===null?'':field(esc(text('title')),'<input data-writing-heading type="text" maxlength="160" required value="'+esc(value.title)+'">'))+editors.field({key:'selected-writing',label:text('body'),value:value.body,set:body=>{value.body=body;changed();}}),
   preview:conflict=>(conflict.value.title?'<h4>'+esc(conflict.value.title)+'</h4>':'')+renderProse(conflict.value.body),
   input:(element,base,value)=>{if(!element.matches('[data-writing-heading]'))return false;value.title=element.value;return true;}
  };

}
