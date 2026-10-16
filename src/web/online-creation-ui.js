import {t} from './i18n/index.js';
import {templateFieldInput,templateFieldLabel,templateInputValue} from './custom-field-input.js';
const tr=(key,values)=>t('online',key,values);
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};

// Owns the new-record dialog. Once sent, its exact request is owned by the
// encrypted local outbox; closing or reloading never turns a retry into a copy.
export function onlineCreationUI({call,esc,field,form,error}){
 let connectionId=null,books=[],choices=[],pending=null,draft=null,loading=false,generation=0;
 const option=(value,label,selected)=>'<option value="'+esc(value)+'" '+(value===selected?'selected':'')+'>'+esc(label)+'</option>';
 const choiceKey=c=>c.kind+':'+c.id;
 const selected=()=>choices.find(c=>choiceKey(c)===draft?.choice);
 function controls(){
  const choice=selected();
  return field(tr('book'),'<select name="creationBook" required>'+books.map(b=>option(b.id,b.title,draft.notebookId)).join('')+'</select>')+
   field(tr('creationType'),'<select name="creationType" required>'+choices.map(c=>option(choiceKey(c),c.label,draft.choice)).join('')+'</select>')+
   field(tr('recordTitle'),'<input name="creationTitle" maxlength="180" required value="'+esc(draft.title)+'">')+
   field(tr('creationDate'),'<input name="creationDate" type="date" required value="'+esc(draft.occurredOn)+'">')+
   (choice?.description?'<p>'+esc(choice.description)+'</p>':'')+
   (choice?.fields??[]).map(f=>{
    const values=draft.values[draft.choice]??{},value=Object.hasOwn(values,f.key)?values[f.key]:null;
    return field(esc(templateFieldLabel(f)),templateFieldInput(f,value,{esc,attrs:'data-creation-field="'+esc(f.key)+'"'}));
   }).join('');
 }
 function draw(){
  if(pending){
   const body='<p>'+esc(tr(pending.rejected?'creationRejected':'creationPendingHelp'))+'</p><p><strong>'+esc(pending.command.title)+'</strong></p>'+(pending.rejected?'<p>'+esc(pending.rejected.message)+'</p>':'');
   form('create','creationNew',body,pending.rejected?'creationReview':pending.result?'creationOpen':'retrySend');
  }else form('create','creationNew','<p>'+esc(tr('creationHelp'))+'</p>'+controls(),'creationCreate');
 }
 function capture(el){
  if(!draft||pending)return;
  draft.title=el.elements.creationTitle.value;draft.occurredOn=el.elements.creationDate.value;
  const fields=selected()?.fields??[],values={};
  for(const node of el.querySelectorAll('[data-creation-field]')){const f=fields.find(f=>f.key===node.dataset.creationField);if(f)values[f.key]=templateInputValue(f,node.value);}
  draft.values[draft.choice]=values;
 }
 async function loadChoices(id){
  const version=++generation;loading=true;
  try{const value=await call('request',{connectionId,operation:'creation',data:{notebookId:id}});if(version!==generation)return;choices=value.choices;draft.notebookId=id;draft.choice=choiceKey(choices[0]);draw();}
  finally{if(version===generation)loading=false;}
 }
 return {
  async load(id){connectionId=id;pending=(await call('creation-pending',{connectionId})).pending;},
  pending:()=>!!pending,
  async open(id,notebooks,notebookId){
   connectionId=id;books=notebooks;pending=(await call('creation-pending',{connectionId})).pending;
   if(pending){draw();return;}
   draft={notebookId:notebookId||books[0].id,title:'',occurredOn:today(),choice:'',values:{}};await loadChoices(draft.notebookId);
  },
  input(element){
   const el=element.closest('[data-online-form="create"]');if(!el)return false;capture(el);
   if(element.name==='creationBook'){const id=element.value;element.value=draft.notebookId;if(!loading)void loadChoices(id).catch(error);}
   if(element.name==='creationType'){draft.choice=element.value;draw();}
   return true;
  },
  async submit(el){
   if(loading)return null;
   if(pending?.rejected){
    const old=pending.command;await call('creation-acknowledge',{connectionId,id:old.id});pending=null;
    draft={notebookId:old.notebookId,title:old.title,occurredOn:old.occurredOn,choice:choiceKey(old.source),values:{[choiceKey(old.source)]:old.values}};
    await loadChoices(old.notebookId);if(choices.some(c=>choiceKey(c)===choiceKey(old.source))){draft.choice=choiceKey(old.source);draw();}return null;
   }
   if(!pending){
    capture(el);const choice=selected();if(!choice)return null;
    pending={command:{id:crypto.randomUUID(),notebookId:draft.notebookId,source:{kind:choice.kind,id:choice.id,revision:choice.revision},title:draft.title,occurredOn:draft.occurredOn,values:draft.values[draft.choice]??{}}};
   }
   try{
    pending=await call('create-record',{connectionId,command:pending.command});
    if(pending.rejected){draw();return null;}
    const result=pending.result;
    await call('creation-acknowledge',{connectionId,id:pending.command.id});pending=null;return result;
   }catch(e){draw();throw e;}
  },
  clear(){generation++;loading=false;draft=null;choices=[];}
 };
}
