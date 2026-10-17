import {configurationDocumentClient} from './configuration-document-client.js';
import {fieldNumberControls} from './custom-field-number-controls.js';
import {setCustomFieldProperty} from './custom-field-numbers.js';
import {customFieldText} from './custom-field-presentation.js';
import {enabledLabBookTypes} from './feature-modules.js';
import {profileById} from './laboratory/catalog.js';
import {t} from './i18n/index.js';

const text=(key,args)=>t('configurationEditor',key,args);
const copy=value=>structuredClone(value);
const empty=()=>({rows:[],total:0,offset:0,next:null});
const pageSize=20;
export function configurationEditor({state,api,esc,field,option,draw,onChange=()=>{},root=()=>document.querySelector('[data-configuration-editor]'),actionName='configuration-edit'}){
 let section=null,definition=null,choice=null,choiceText='',choiceBase='',profileId,sections=empty(),fields=empty(),choices=empty(),profiles=empty(),busy=false,error=null,epoch=0,controller=null,retry=null;
 const client=configurationDocumentClient({state,api,onChange:()=>{status();onChange();}});
 const dirty=()=>client.isDirty()||choiceText!==choiceBase;
 function status(){
  const node=root()?.querySelector('[data-configuration-status]');if(!node)return;
  node.textContent=error?.message??client.error()?.message??text(busy?'loading':client.busy()?'saving':dirty()?'unsaved':'saved');
  node.classList.toggle('module-error',Boolean(error||client.error()));
 }
 function stop(){epoch++;controller?.abort();controller=null;client.stop();section=definition=choice=null;choiceText=choiceBase='';sections=fields=choices=profiles=empty();error=null;busy=false;retry=null;}
 async function run(operation){
  const current=++epoch;controller?.abort();controller=new AbortController();busy=true;error=null;retry=operation;draw?.();
  try{await operation(controller.signal);if(current!==epoch)return;retry=null;}
  catch(reason){if(current!==epoch||reason.name==='AbortError')return;error=reason;}
  finally{if(current===epoch){busy=false;draw?.();status();onChange();}}
 }
 async function flushChoice(){
  if(!choice||choiceText===choiceBase)return;
  const previous=choice,submitted=choiceText;
  await client.perform([{type:previous.key===null?'append':'replace',collection:'choices',sectionId:section.key,fieldKey:definition.key,...(previous.key===null?{}:{key:previous.key}),value:submitted}]);
  choice={...previous,key:submitted,value:submitted};choiceBase=submitted;
  const row=choices.rows.findIndex(value=>value.key===previous.key);if(row>=0)choices.rows[row]=copy(choice);
 }
 async function flush(){await flushChoice();return client.flush();}
 async function loadField(key,{signal,offset=0}={}){
  const next=key?await client.item('fields',key,{sectionId:section.key,signal}):null;
  const window=next?.value.type==='select'?await client.window('choices',{sectionId:section.key,fieldKey:key,offset,limit:pageSize,signal}):empty();
  signal?.throwIfAborted();definition=next;choices=window;choice=null;choiceText=choiceBase='';
 }
 async function loadSection(key,{signal,offset=0,fieldKey=null}={}){
  const next=key?await client.item('sections',key,{signal}):null;
  const window=next?await client.window('fields',{sectionId:key,offset,limit:pageSize,signal}):empty();
  const selectedKey=fieldKey??window.rows[0]?.key,selected=selectedKey?await client.item('fields',selectedKey,{sectionId:key,signal}):null;
  const values=selected?.value.type==='select'?await client.window('choices',{sectionId:key,fieldKey:selectedKey,offset:0,limit:pageSize,signal}):empty();
  signal?.throwIfAborted();section=next;fields=window;definition=selected;choices=values;choice=null;choiceText=choiceBase='';
 }
 async function reload({signal,retain=true}={}){
  const [types,installed]=await Promise.all([
   client.window('sections',{offset:sections.offset,limit:pageSize,...(profileId?{profileId}:{}),signal}),
   client.window('profiles',{offset:profiles.offset,limit:pageSize,signal})
  ]);
  sections=types;profiles=installed;
  let key=retain?section?.key:null;
  if(key)try{await loadSection(key,{signal,offset:fields.offset,fieldKey:definition?.key});return;}catch(reason){if(reason.code!=='NOT_FOUND')throw reason;}
  await loadSection(types.rows[0]?.key,{signal});
 }
 async function open(owner,options={}){
  stop();profileId=options.profileId;
  await run(async signal=>{await client.open(owner,{...options,signal});await reload({signal,retain:false});});
 }
 const button=(key,command,attributes='',label)=>'<button type="button" class="button subtle" data-action="'+actionName+'" data-command="'+command+'" '+attributes+'>'+esc(label??text(key))+'</button>';
 function pages(name,window){
  return '<nav class="inline-actions" aria-label="'+esc(text(name))+'"><span>'+esc(window.total?text('range',{first:window.offset+1,last:window.offset+window.rows.length,total:window.total}):text('empty'))+'</span>'+button('previous','page','data-collection="'+name+'" data-offset="'+Math.max(0,window.offset-pageSize)+'" '+(window.offset===0?'disabled':''))+button('next','page','data-collection="'+name+'" data-offset="'+(window.next??0)+'" '+(window.next===null?'disabled':''))+'</nav>';
 }
 function profileView(){
  if(profileId)return '';
  const available=enabledLabBookTypes(state.dashboardSettings);
  return '<section><h3>'+esc(text('profiles'))+'</h3>'+profiles.rows.map(row=>'<label class="checkbox"><input type="checkbox" data-configuration-profile="'+esc(row.key)+'" '+(row.value.enabled?'checked':'')+'>'+esc(profileById(row.key)?.label??row.key)+'</label>').join('')+pages('profiles',profiles)+(available.length?field(esc(text('profiles')),'<select data-configuration-add-profile>'+available.map(profile=>option(profile.id,profile.label,available[0].id)).join('')+'</select>')+button('enabled','profile-add'):'')+'</section>';
 }
 function definitionView(){
  if(!definition)return '<p>'+esc(text('selectField'))+'</p>';
  const value=definition.value,attr=key=>'data-configuration-field-prop="'+key+'"';
  return '<div class="lab-field-config" data-field-key="'+esc(definition.key)+'"><div class="lab-field-primary">'+
   field(customFieldText('label'),'<textarea '+attr('label')+' required maxlength="160" rows="1">'+esc(value.label)+'</textarea>')+
   field(customFieldText('type'),'<select '+attr('type')+'>'+['text','number','date','boolean','select'].map(type=>option(type,customFieldText('types.'+type),value.type)).join('')+'</select>')+
   (value.type==='number'?field(customFieldText('unit'),'<input '+attr('unit')+' maxlength="80" value="'+esc(value.unit)+'">'):'')+
   '<label class="checkbox"><input type="checkbox" '+attr('required')+' '+(value.required?'checked':'')+'>'+esc(customFieldText('required'))+'</label>'+button('removeField','field-remove')+'</div>'+
   fieldNumberControls(value,{field,option,esc},attr)+(value.type==='select'?'<section><h4>'+esc(text('choices'))+'</h4><div class="lab-type-list">'+choices.rows.map(row=>button('choiceValue','choice-select','data-key="'+esc(row.key)+'" aria-current="'+(choice?.key===row.key)+'"',row.value)).join('')+'</div>'+pages('choices',choices)+button('addChoice','choice-add')+(choice?field(esc(text('choiceValue')),'<input data-configuration-choice maxlength="160" required value="'+esc(choiceText)+'">')+button('save','choice-apply')+button('removeChoice','choice-remove'):'')+'</section>':'')+'</div>';
 }
 function view(){
  const value=section?.value;
  return '<div data-configuration-editor><fieldset class="project-config-fields" '+(busy?'disabled aria-busy="true"':'')+'>'+profileView()+'<div class="lab-type-layout"><aside class="lab-type-catalogue" aria-label="'+esc(text('sections'))+'"><div class="lab-type-list-heading"><strong>'+esc(text('sections'))+'</strong>'+button('addType','section-add')+'</div><div class="lab-type-list">'+sections.rows.map(row=>button('sections','section-select','data-key="'+esc(row.key)+'" aria-current="'+(section?.key===row.key)+'"',row.value.label+(row.value.enabled?'':' ('+text('removed')+')'))).join('')+'</div>'+pages('sections',sections)+'</aside><section class="lab-type-detail" aria-label="'+esc(text('sections'))+'">'+
   (value?'<div class="inline-actions">'+button('moveUp','section-move','data-direction="-1" '+(!value.enabled?'disabled':''))+button('moveDown','section-move','data-direction="1" '+(!value.enabled?'disabled':''))+button(value.enabled?'removeType':'restoreType','section-toggle')+'</div>'+
    field(customFieldText('typeName'),'<textarea data-configuration-section-prop="label" required maxlength="160" rows="1">'+esc(value.label)+'</textarea>')+
    field(customFieldText('guidance'),'<textarea data-configuration-section-prop="description" maxlength="2000" rows="2">'+esc(value.description)+'</textarea>')+
    '<h4>'+esc(text('fields'))+'</h4><div class="lab-type-list">'+fields.rows.map(row=>button('fields','field-select','data-key="'+esc(row.key)+'" aria-current="'+(definition?.key===row.key)+'"',row.value.label)).join('')+'</div>'+pages('fields',fields)+button('addField','field-add')+definitionView():'<p>'+esc(text('selectType'))+'</p>')+
   '</section></div></fieldset><p role="status" data-configuration-status>'+esc(error?.message??client.error()?.message??text(busy?'loading':dirty()?'unsaved':'saved'))+'</p>'+((error||client.error())?button('retry','retry'):'')+'</div>';
 }
 function input(element){
  if(!root()?.contains(element))return false;if(busy)return true;
  if(element.hasAttribute('data-configuration-choice')){choiceText=element.value;status();onChange();return true;}
  const sectionProperty=element.dataset.configurationSectionProp,fieldProperty=element.dataset.configurationFieldProp;
  if(sectionProperty&&section){section.value[sectionProperty]=element.value;client.changed({type:'replace',collection:'sections',key:section.key,value:copy(section.value)});return true;}
  if(fieldProperty&&definition){
   if(!setCustomFieldProperty(definition.value,fieldProperty,fieldProperty==='required'?element.checked:element.value))return true;
   client.changed({type:'replace',collection:'fields',sectionId:section.key,key:definition.key,value:copy(definition.value),...(definition.value.type==='number'?{}:{remove:['numeric']})});
   if(['type','numericRepresentation'].includes(fieldProperty))void run(async signal=>{await flush();if(fieldProperty==='type')await loadField(definition.key,{signal});});
   return true;
  }
  if(element.hasAttribute('data-configuration-profile')){void run(async signal=>{await flush();const key=element.dataset.configurationProfile,profile=profiles.rows.find(row=>row.key===key);await client.perform([profileById(key)?{type:'profile-enable',key,enabled:element.checked}:{type:'replace',collection:'profiles',key,value:{...profile.value,enabled:element.checked}}]);await reload({signal});});return true;}
  return element.hasAttribute('data-configuration-add-profile');
 }
 async function action(control){
  if(control.dataset.action!==actionName||!root()?.contains(control))return false;if(busy)return true;
  const {command:kind,key,collection,offset,direction}=control.dataset;
  if(kind==='retry'){const operation=retry??(async signal=>{await flush();await reload({signal});});await run(operation);return true;}
  await run(async signal=>{
   await flush();
   if(kind==='section-select'){await loadSection(key,{signal});return;}
   if(kind==='field-select'){await loadField(key,{signal});return;}
   if(kind==='choice-apply'){choices=await client.window('choices',{sectionId:section.key,fieldKey:definition.key,offset:choices.offset,limit:pageSize,signal});return;}
   if(kind==='choice-select'){choice=copy(choices.rows.find(row=>row.key===key));choiceText=choiceBase=choice.value;return;}
   if(kind==='page'){
    const selectors=collection==='fields'?{sectionId:section.key}:collection==='choices'?{sectionId:section.key,fieldKey:definition.key}:collection==='sections'&&profileId?{profileId}:{};
    const result=await client.window(collection,{...selectors,offset:Number(offset),limit:pageSize,signal});
    if(collection==='sections')sections=result;else if(collection==='fields')fields=result;else if(collection==='choices')choices=result;else profiles=result;return;
   }
   let operation,added=null;
   if(kind==='section-add'){added=crypto.randomUUID();operation={type:'append',collection:'sections',value:{id:added,profileId:profileId??null,key:'section-'+crypto.randomUUID(),label:text('newType'),description:'',enabled:true,fields:[]}};}
   if(kind==='section-toggle')operation={type:'replace',collection:'sections',key:section.key,value:{...copy(section.value),enabled:!section.value.enabled}};
   if(kind==='section-move')operation={type:'section-move',key:section.key,direction:Number(direction)};
   if(kind==='field-add'){added='field_'+crypto.randomUUID().replaceAll('-','');operation={type:'append',collection:'fields',sectionId:section.key,value:{key:added,label:text('newField'),type:'text',unit:'',required:false,choices:[]}};}
   if(kind==='field-remove')operation={type:'remove',collection:'fields',sectionId:section.key,key:definition.key};
   if(kind==='choice-add'){choice={key:null,value:''};choiceText=choiceBase='';return;}
   if(kind==='choice-remove'){if(choice.key!==null)operation={type:'remove',collection:'choices',sectionId:section.key,fieldKey:definition.key,key:choice.key};choice=null;choiceText=choiceBase='';}
   if(kind==='profile-add'){const key=root()?.querySelector('[data-configuration-add-profile]')?.value;if(key)operation={type:'profile-enable',key,enabled:true};}
   if(!operation)return;
   await client.perform([operation]);await reload({signal});
   if(added){if(kind==='section-add')await loadSection(added,{signal});else await loadField(added,{signal});}
  });return true;
 }
 async function checkpoint(){if(busy||!client.descriptor())throw error??Error(text('loading'));await flush();return client.checkpoint();}
 async function save(){if(busy||!client.descriptor())throw error??Error(text('loading'));await flush();const result=await client.save();await reload();return result;}
 async function discard(){epoch++;controller?.abort();busy=false;choiceText=choiceBase;const result=await client.discard();if(result)await reload();error=null;draw?.();return result;}
 return {open,view,input,action,flush,checkpoint,save,discard,stop,isDirty:dirty,client,descriptor:client.descriptor,changedHeader:(key,value)=>client.changed({type:'header',key,value}),
  async source(source,name){await flush();await client.perform([{type:'source',source,...(name===undefined?{}:{name})}]);await reload({retain:false});draw?.();},
  error:()=>error??client.error(),busy:()=>busy||client.busy()};
}
