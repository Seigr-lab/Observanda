import {researchContext,researchOwner} from './project-context.js';
import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
import {t} from './i18n/index.js';

const text=(key,args)=>t('recordWriting',key,args);

// Keep a page of headings and draft receipts. Section bodies are requested
// only on selection. Reopening the last record may resume its checkpoint.
export function focusedRecordWriting({state,api}){
 const nav=document.createElement('nav');nav.className='focused-writing-outline';
 const list=document.createElement('ul'),heading=document.createElement('h3'),revision=document.createElement('p'),feedback=document.createElement('p');
 const pages=document.createElement('div');pages.className='inline-actions';
 feedback.setAttribute('role','status');nav.append(heading,list,pages,revision,feedback);
 let active=false,scope=null,target=null,selected=null,page=null,request=null,owner=null,visit=null,last=null,epoch=0;
 const drafts=new Map(),editingStates=new Map();
 function stop(){request?.abort();request=null;epoch++;active=false;page=null;visit=null;nav.remove();}
 function clear(){stop();scope=null;target=null;last=null;drafts.clear();editingStates.clear();}
 function begin(input){
  stop();if(!input.focused)return input;
  const key=JSON.stringify([researchContext(state),state.book.id,input.recordId]);
  if(scope!==key)clear();scope=key;target={workspaceId:state.book.id,recordId:input.recordId};owner=researchOwner(state);active=true;
  selected=input.sectionId??last??null;
  return {...input,sectionId:selected};
 }
 function button(label,action){
  const control=document.createElement('button');control.type='button';control.className='button';control.textContent=label;
  control.addEventListener('click',action);return control;
 }
 function paint(){
  const section=(id,title)=>{
   const li=document.createElement('li'),control=button(title,()=>visit?.(id));
   if(id===selected)control.setAttribute('aria-current','true');li.append(control);return li;
  };
  list.replaceChildren(section(null,text('focusSummary')),...(page?.sections??[]).map(item=>section(item.id,item.title||text('focusUntitled'))));
  pages.replaceChildren();
  for(const [key,offset] of [['focusPrevious',page?.previous],['focusNext',page?.next]]){
   if(offset!=null)pages.append(button(text(key),()=>void load(offset,null)));
  }
 }
 async function load(offset,anchor,refresh=false){
  request?.abort();const pending=new AbortController(),generation=epoch;request=pending;
  feedback.textContent=text('focusLoading');nav.setAttribute('aria-busy','true');
  try{
   const query={...target,offset,anchor,expectedStructureRevision:refresh?null:page?.structureRevision??null};
   const result=await api('/api/research/records/writing/outline',query,{owner,signal:pending.signal,adopt:false});
   if(!active||epoch!==generation||pending.signal.aborted)return;
   if(result?.workspaceId!==query.workspaceId||result.recordId!==query.recordId||!revisionId(result.structureRevision)||
      !Number.isSafeInteger(result.total)||result.total<0||!Number.isSafeInteger(result.offset)||result.offset<0||
      !Array.isArray(result.sections)||result.sections.length!==Math.max(0,Math.min(16,result.total-result.offset))||
      !result.sections.every((s,i)=>researchId(s?.id)&&typeof s.title==='string'&&s.position===result.offset+i)||
      (anchor&&!result.sections.some(s=>s.id===anchor))||(!anchor&&result.offset!==offset)||
      result.previous!==(result.offset?Math.max(0,result.offset-16):null)||result.next!==(result.offset+16<result.total?result.offset+16:null))throw Error(text('invalidRead'));
   page=result;paint();feedback.textContent='';
  }catch(error){
   if(pending.signal.aborted||epoch!==generation)return;
   if(error.code==='RECORD_CHANGED'&&!refresh){await load(0,selected,true);return;}
   feedback.replaceChildren(document.createTextNode(error.message||text('invalidRead')),button(text('focusReload'),()=>void load(0,null,true)));
  }finally{if(request===pending){request=null;nav.removeAttribute('aria-busy');}}
 }
 function show(dialog,base,switchField){
  if(!active||!base)return;
  visit=switchField;selected=last=base.sectionId;
  const item=page?.sections.find(s=>s.id===selected);if(item&&typeof base.value?.title==='string')item.title=base.value.title;
  nav.setAttribute('aria-label',text('focusOutline'));heading.textContent=text('focusOutline');revision.textContent=text('focusRevision',{revision:base.revision.slice(0,12)});revision.title=base.revision;
  dialog.prepend(nav);paint();
  if(!page&&!request)void load(0,selected);
 }
 function remember(base,writer,editorState){
  if(!active||!base)return;
  if(writer?.revision)drafts.set(base.sectionId,{id:writer.id,revision:writer.revision});else drafts.delete(base.sectionId);
  editingStates.delete(base.sectionId);
  if(editorState)editingStates.set(base.sectionId,editorState);
  // The durable draft has the complete text. Keep undo histories for a
  // small working set so visiting many large fields cannot retain them all.
  if(editingStates.size>3)editingStates.delete(editingStates.keys().next().value);
 }
 return {begin,show,remember,stop,clear,get active(){return active;},draft:id=>active?drafts.get(id):null,
  editorState:id=>active?editingStates.get(id):null,forget(id){drafts.delete(id);editingStates.delete(id);},busy(value){nav.inert=value;}};
}
