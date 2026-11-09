import {documentEditors} from './document-editor.js';
import {renderProse} from './prose-model.js';
import {recordValueEditor} from './record-value-editor.js';
import {recordPasteRecovery} from './record-paste-recovery.js';
import {focusedRecordWriting} from './focused-record-writing.js';
import {t} from './i18n/index.js';
const text=key=>t('recordWriting',key);
export function recordWritingUI(options){
 let added=null;
 const navigation=focusedRecordWriting(options);
 return recordValueEditor({...options,
  onSaved:async(...args)=>{await options.onSaved(...args);added=null;},
  onClosed:async()=>{
   const target=added;added=null;
   try{if(target&&options.state.book?.id===target.workspaceId&&!options.state.access?.locked)await options.onSaved(null,target,{});}
   catch(error){options.notify(error.message,true);}
   finally{await options.onClosed?.();}
  },
  adapter:{route:'writing',baseName:'writing',messages:'recordWriting',navigation,target:value=>({sectionId:value.sectionId??null}),view:lifecycle=>recordWritingView(options,lifecycle,{navigation,onRecoverySaved:target=>{added=target;}})}});
}
export function recordWritingView(options,{context,close},{onRecoverySaved=null,navigation=null}={}){
 const {state,esc,field,destinations,figures,onOpenLink,notify}=options;

  const editors=documentEditors({context,book:()=>state.book,destinations,figures,onOpenLink:async href=>{if(await close())onOpenLink?.(href);},onError:message=>notify(message,true)});
  return {heading:base=>text(base?.sectionId===null?'summary':'section'),focus:'[data-writing-heading],.ProseMirror',release:()=>editors.release(),bind:dialog=>editors.bind(dialog),
   pendingPaste:editors.pendingPaste,reviewPaste:editors.reviewPaste,editorState:()=>editors.state('selected-writing'),
   fields:(base,value,changed)=>(base.sectionId===null?'':field(esc(text('title')),'<input data-writing-heading type="text" maxlength="160" required value="'+esc(value.title)+'">')+'<label class="checkbox"><input type="checkbox" data-writing-share-pdf '+(value.sharePdf?'checked':'')+'>'+esc(t('recordValues','sharePdf'))+'</label><label class="checkbox"><input type="checkbox" data-writing-share '+(value.share!==false?'checked':'')+'>'+esc(text('publication'))+'</label><p class="muted">'+esc(text('publicationHint'))+'</p>')+editors.field({key:'selected-writing',initialState:navigation?.editorState(base.sectionId),recovery:onRecoverySaved?recordPasteRecovery({state,api:options.api,base,context,onSaved:onRecoverySaved}):null,label:text('body'),value:value.body,set:body=>{value.body=body;changed();}}),
   preview:conflict=>(conflict.value.title?'<h4>'+esc(conflict.value.title)+'</h4>':'')+renderProse(conflict.value.body),
   input:(element,base,value)=>{if(element.matches('[data-writing-share-pdf]')&&base.sectionId!==null){value.sharePdf=element.checked;return true;}if(element.matches('[data-writing-share]')&&base.sectionId!==null){value.share=element.checked;return true;}if(!element.matches('[data-writing-heading]'))return false;value.title=element.value;return true;}
  };

}
