import {t} from './i18n/index.js';
import {templateFieldInput,templateFieldLabel,templateInputValue} from './custom-field-input.js';
import {sameConfigurationPin} from './configuration-document-client.js';
const tr=(key,values)=>t('online',key,values),text=(key,values)=>t('configurationEditor',key,values);
const today=()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const empty=()=>({offset:0,total:0,next:null});
const sourceOf=choice=>({kind:choice.kind,id:choice.id,revision:choice.revision,...(choice.configurationPin?{configurationPin:choice.configurationPin}:{})});
const sameSource=(a,b)=>a?.kind===b?.kind&&a?.id===b?.id&&a?.revision===b?.revision&&sameConfigurationPin(a?.configurationPin,b?.configurationPin);

// The exact creation command still belongs to the encrypted local outbox.
// Schema pages retain only visible definitions; authored scalar values survive paging.
export function onlineCreationUI({call,esc,field,form,error}){
 let connectionId=null,books=[],choices=[],choice=null,fields=[],choiceField=null,valuesPage=null,pending=null,draft=null,loading=false,generation=0,typePage=empty(),fieldPage=empty(),typeQuery='',choiceQuery='',retry=null;
 const option=(value,label,selected)=>'<option value="'+esc(value)+'" '+(value===selected?'selected':'')+'>'+esc(label)+'</option>';
 const choiceKey=c=>c.kind+':'+c.id,root=()=>document.querySelector('[data-online-form="create"]');
 const button=(label,command,attributes='')=>'<button type="button" class="button" data-action="module-command" data-command="online-creation-'+command+'" '+attributes+'>'+esc(label)+'</button>';
 const values=()=>draft.values[draft.choice]??={};
 const selected=field=>Object.hasOwn(values(),field.key)?values()[field.key]:null;
 function pages(page,collection){return '<nav class="inline-actions" aria-label="'+esc(text(collection==='types'?'sections':collection))+'"><span>'+esc(page.total?text('range',{first:page.offset+1,last:Math.min(page.offset+20,page.total),total:page.total}):text('empty'))+'</span>'+button(text('previous'),collection+'-previous',!page.offset?'disabled':'')+button(text('next'),collection+'-next',page.next===null?'disabled':'')+'</nav>';}
 function controls(){
  const visible=choice&&!choices.some(item=>choiceKey(item)===draft.choice)?[choice,...choices]:choices;
  const choicePanel=choiceField?'<section data-online-choice-window><h3>'+esc(templateFieldLabel(choiceField))+'</h3>'+field(text('searchChoices'),'<input data-online-choice-search maxlength="160" value="'+esc(choiceQuery)+'">')+button(text('searchChoices'),'choices-search')+(valuesPage?.items??[]).map(value=>button(value,'value','data-value="'+esc(value)+'" aria-pressed="'+(value===selected(choiceField))+'"')).join('')+pages(valuesPage??empty(),'choices')+button(text('clearChoice'),'clear-choice')+'</section>':'';
  return field(tr('book'),'<select name="creationBook" required '+(loading?'disabled':'')+'>'+books.map(book=>option(book.id,book.title,draft.notebookId)).join('')+'</select>')+
   field(tr('recordTitle'),'<input name="creationTitle" maxlength="180" required value="'+esc(draft.title)+'">')+
   field(tr('creationDate'),'<input name="creationDate" type="date" required value="'+esc(draft.occurredOn)+'">')+
   '<fieldset '+(loading?'disabled':'')+'>'+field(text('search'),'<input data-online-type-search maxlength="160" value="'+esc(typeQuery)+'">')+button(text('search'),'types-search')+
   field(tr('creationType'),'<select name="creationType" required>'+visible.map(item=>option(choiceKey(item),item.label,draft.choice)).join('')+'</select>')+pages(typePage,'types')+
   (choice?.description?'<p>'+esc(choice.description)+'</p>':'')+
   fields.map(definition=>{
    const scalar=selected(definition),attrs='data-creation-field="'+esc(definition.key)+'"';
    return field(esc(templateFieldLabel(definition)),definition.type==='select'&&!Array.isArray(definition.choices)?'<input readonly '+attrs+' value="'+esc(scalar??'')+'">'+button(text('chooseMoreChoices'),'choose','data-key="'+esc(definition.key)+'"'):templateFieldInput(definition,scalar,{esc,attrs}));
   }).join('')+(choice?.kind==='template'?pages(fieldPage,'fields'):'')+choicePanel+'</fieldset>'+(loading?'<p role="status">'+esc(text('loading'))+'</p>':'')+(retry?button(text('retry'),'retry'):'');
 }
 function capture(element){
  if(!draft||pending||!element?.elements.creationTitle)return;
  draft.title=element.elements.creationTitle.value;draft.occurredOn=element.elements.creationDate.value;
  for(const node of element.querySelectorAll('[data-creation-field]')){
   const definition=fields.find(value=>value.key===node.dataset.creationField);if(definition&&!node.readOnly)values()[definition.key]=templateInputValue(definition,node.value);
  }
 }
 function captureHeader(){const host=root();if(draft&&!pending&&host?.elements.creationTitle){draft.title=host.elements.creationTitle.value;draft.occurredOn=host.elements.creationDate.value;}}
 function draw(){
  if(pending){
   const body='<p>'+esc(tr(pending.rejected?'creationRejected':'creationPendingHelp'))+'</p><p><strong>'+esc(pending.command.title)+'</strong></p>'+(pending.rejected?'<p>'+esc(pending.rejected.message)+'</p>':'');
   form('create','creationNew',body,pending.rejected?'creationReview':pending.result?'creationOpen':'retrySend');
  }else if(draft){
   form('create','creationNew','<p>'+esc(tr('creationHelp'))+'</p>'+controls(),'creationCreate');
   root().querySelector('[type="submit"]').disabled=loading||!choice||Boolean(retry);
  }
 }
 function validPage(value,rows){
  if(!Array.isArray(rows)||rows.length>20||!Number.isSafeInteger(value.total)||value.total<0||!Number.isSafeInteger(value.offset)||value.offset<0||value.offset+rows.length>value.total||value.next!==null&&(!Number.isSafeInteger(value.next)||value.next<=value.offset))throw Error(text('invalid'));
 }
 async function request(operation,data){
  const notebookId=data.notebookId??draft.notebookId,result=await call('request',{connectionId,operation,data:{notebookId,...data}});
  if(result.notebookId!==notebookId)throw Error(text('invalid'));return result;
 }
 async function run(operation){
  if(loading||!draft)return;capture(root());const version=++generation;loading=true;retry=null;let failure=null;draw();
  try{await operation(()=>version===generation);if(version===generation)retry=null;}
  catch(reason){if(version===generation){retry=operation;failure=reason;}}
  finally{if(version===generation){captureHeader();loading=false;draw();if(failure)error(failure);}}
 }
 async function readFields(source,offset=0,notebookId=draft.notebookId){
  if(source.kind!=='template')return {fields:source.fields??[],...empty()};
  const response=await request('creationFields',{notebookId,source:sourceOf(source),offset,limit:20});
  validPage(response,response.fields);if(!sameSource(response.source,sourceOf(source)))throw Error(text('invalid'));return response;
 }
 async function loadChoices(notebookId,{offset=0,reset=false,preferred=null}={}){
  return run(async current=>{
   const response=await request('creation',{notebookId,offset,limit:20,query:typeQuery});validPage(response,response.choices);
   let page=response;
   // A rejected late selection is found with bounded pages before review.
   if(preferred)while(!page.choices.some(item=>choiceKey(item)===preferred)&&page.next!==null){page=await request('creation',{notebookId,offset:page.next,limit:20,query:typeQuery});validPage(page,page.choices);if(!current())return;}
   if(!current())return;
   const next=reset?(page.choices.find(item=>choiceKey(item)===preferred)??page.choices[0]??null):choice;
   let selectedFields=null;if(reset&&next)selectedFields=await readFields(next,0,notebookId);
   if(!current())return;
   choices=page.choices;typePage=page;draft.notebookId=notebookId;
   if(reset){choice=next;draft.choice=next?choiceKey(next):'';fields=selectedFields?.fields??[];fieldPage=selectedFields??empty();choiceField=valuesPage=null;}
  });
 }
 async function chooseType(next){
  if(!next)return;await run(async current=>{const page=await readFields(next);if(!current())return;choice=next;draft.choice=choiceKey(next);fields=page.fields;fieldPage=page;choiceField=valuesPage=null;});
 }
 async function loadFields(offset){
  await run(async current=>{const result=await readFields(choice,offset);if(!current())return;fields=result.fields;fieldPage=result;choiceField=valuesPage=null;});
 }
 async function loadValues(definition,offset=0){
  await run(async current=>{
   const source=sourceOf(choice),response=await request('creationChoices',{source,fieldKey:definition.key,offset,limit:20,query:choiceQuery});
   validPage(response,response.items);if(!sameSource(response.source,source)||response.items.some(value=>typeof value!=='string'||value.length>160))throw Error(text('invalid'));
   if(current()){choiceField=definition;valuesPage=response;}
  });
 }
 return {
  async load(id){connectionId=id;pending=(await call('creation-pending',{connectionId})).pending;},
  pending:()=>Boolean(pending),
  async open(id,notebooks,notebookId){
   generation++;loading=false;connectionId=id;books=notebooks;pending=(await call('creation-pending',{connectionId})).pending;
   if(pending){draw();return;}
   draft={notebookId:notebookId||books[0].id,title:'',occurredOn:today(),choice:'',values:{}};choice=null;choices=fields=[];typePage=fieldPage=empty();choiceField=valuesPage=null;typeQuery=choiceQuery='';await loadChoices(draft.notebookId,{reset:true});
  },
  input(element){
   const host=element.closest('[data-online-form="create"]');if(!host)return false;capture(host);if(loading)return true;
   if(element.name==='creationBook'){const id=element.value;element.value=draft.notebookId;typeQuery='';void loadChoices(id,{reset:true});}
   else if(element.name==='creationType'){const next=choices.find(item=>choiceKey(item)===element.value);element.value=draft.choice;void chooseType(next);}
   else if(element.hasAttribute('data-online-type-search'))typeQuery=element.value;
   else if(element.hasAttribute('data-online-choice-search'))choiceQuery=element.value;
   return true;
  },
  async action(command,node){
   if(!command.startsWith('creation-'))return false;if(loading||!draft||pending)return true;capture(root());
   const name=command.slice(9);
   if(name==='retry'){if(retry)await run(retry);}
   else if(name==='types-search')await loadChoices(draft.notebookId);
   else if(name.startsWith('types-'))await loadChoices(draft.notebookId,{offset:name==='types-next'?typePage.next:Math.max(0,typePage.offset-20)});
   else if(name.startsWith('fields-'))await loadFields(name==='fields-next'?fieldPage.next:Math.max(0,fieldPage.offset-20));
   else if(name==='choose'){choiceQuery='';await loadValues(fields.find(field=>field.key===node.dataset.key));}
   else if(name==='choices-search')await loadValues(choiceField);
   else if(name.startsWith('choices-'))await loadValues(choiceField,name==='choices-next'?valuesPage.next:Math.max(0,valuesPage.offset-20));
   else if(name==='value'||name==='clear-choice'){values()[choiceField.key]=name==='value'?node.dataset.value:null;draw();}
   return true;
  },
  async submit(element){
   if(loading||retry)return null;
   if(pending?.rejected){
    const old=pending.command;await call('creation-acknowledge',{connectionId,id:old.id});pending=null;choice=null;fields=[];typeQuery=choiceQuery='';
    draft={notebookId:old.notebookId,title:old.title,occurredOn:old.occurredOn,choice:choiceKey(old.source),values:{[choiceKey(old.source)]:old.values}};
    await loadChoices(old.notebookId,{reset:true,preferred:choiceKey(old.source)});return null;
   }
   if(!pending){capture(element);if(!choice)return null;pending={command:{id:crypto.randomUUID(),notebookId:draft.notebookId,source:sourceOf(choice),title:draft.title,occurredOn:draft.occurredOn,values:structuredClone(values())}};}
   try{pending=await call('create-record',{connectionId,command:pending.command});if(pending.rejected){draw();return null;}const result=pending.result;await call('creation-acknowledge',{connectionId,id:pending.command.id});pending=null;return result;}
   catch(reason){draw();throw reason;}
  },
  clear(){generation++;loading=false;draft=choice=choiceField=valuesPage=retry=null;choices=fields=[];}
 };
}
