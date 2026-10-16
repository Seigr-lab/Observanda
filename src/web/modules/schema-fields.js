import {t} from '../i18n/index.js';
import {validFields,fieldValueErrors,fieldChoiceValid} from '../custom-fields.js';
import {fieldNumberControls} from '../custom-field-number-controls.js';
import {setCustomFieldProperty} from '../custom-field-numbers.js';
import {templateFieldInput,templateFieldLabel} from '../custom-field-input.js';
const tr=(key,args)=>t('moduleFields',key,args),FIELD_PAGE=10,CHOICE_PAGE=20;
// Retain only the visible positions while searching a selected item's schema.
export function fieldPage(items,{query='',offset=0,limit=FIELD_PAGE,label=v=>v}={}){
 const needle=query.trim().toLocaleLowerCase(),positions=[];let total=0;
 for(let index=0;index<items.length;index++){
  if(needle&&!String(label(items[index])).toLocaleLowerCase().includes(needle))continue;
  if(total>=offset&&positions.length<limit)positions.push(index);total++;
 }
 if(offset&&offset>=total)return fieldPage(items,{query,offset:Math.max(0,Math.floor((total-1)/limit)*limit),limit,label});
 return {positions,total,offset};
}
export function moduleSchemaFields(c){
 let owner=null,query='',offset=0;const choices=new Map();
 const fields=()=>c.current?.data.fields??c.current?.data.fieldSchema??[];
 function sync(){if(owner!==c.current){owner=c.current;query='';offset=0;choices.clear();}}
 const button=(key,name,attrs='')=>c.button(tr(key),'schema-'+name,attrs);
 const range=p=>c.esc(tr('range',{first:p.total?p.offset+1:0,last:Math.min(p.offset+p.positions.length,p.total),total:p.total}));
 function pager(p,limit,attrs=''){
  return `<nav class="module-actions" aria-label="${c.esc(tr(attrs?'choicePages':'fieldPages'))}"><span role="status">${range(p)}</span>${button('previous','previous',`${attrs} ${p.offset?'':'disabled'}`)}${button('next','next',`${attrs} ${p.offset+limit<p.total?'':'disabled'}`)}</nav>`;
 }
 function choiceState(key){if(!choices.has(key))choices.set(key,{query:'',offset:0});return choices.get(key);}
 function choiceControl(f,index,edit){
  const state=choiceState(f.key),p=fieldPage(f.choices,{...state,limit:CHOICE_PAGE});state.offset=p.offset;
  const attrs=`data-schema-field="${index}"`,search=c.field(tr('findChoices'),`<input type="search" data-schema-search="choices" ${attrs} value="${c.esc(state.query)}">`);
  if(edit)return `<div data-schema-choices>${search}${p.positions.map(i=>`<div class="module-inline">${c.field(tr('choice',{number:i+1}),`<input data-schema-choice="${i}" ${attrs} value="${c.esc(f.choices[i])}" required maxlength="160">`)}${button('removeChoice','remove-choice',`${attrs} data-choice-index="${i}"`)}</div>`).join('')}${pager(p,CHOICE_PAGE,attrs)}${button('addChoice','add-choice',attrs)}</div>`;
  const selected=c.current.data.values[f.key]??'',visible=p.positions.map(i=>f.choices[i]);
  if(selected&&!visible.includes(selected))visible.unshift(selected);
  return `${f.choices.length>CHOICE_PAGE?search:''}<select aria-label="${c.esc(f.label+(f.unit?' ('+f.unit+')':''))}" data-resource-value="${c.esc(f.key)}" ${f.required?'required':''}>${c.option('',tr('choose'),selected)}${visible.map(value=>c.option(value,value,selected)).join('')}</select>${f.choices.length>CHOICE_PAGE?pager(p,CHOICE_PAGE,attrs):''}`;
 }
 function editField(f,index){
  const attrs=`data-schema-index="${index}"`;
  return `<section class="module-schema-field" data-schema-field-row="${index}"><div class="form-grid">${c.field(tr('label'),`<input ${attrs} data-schema-property="label" value="${c.esc(f.label)}" maxlength="160" required>`)}${c.field(tr('type'),`<select ${attrs} data-schema-property="type">${['text','number','boolean','date','select'].map(type=>c.option(type,tr('types.'+type),f.type)).join('')}</select>`)}${c.field(tr('unit'),`<input ${attrs} data-schema-property="unit" value="${c.esc(f.unit)}" maxlength="80">`)}</div>${fieldNumberControls(f,c,key=>`${attrs} data-schema-property="${key}"`)}<label class="checkbox"><input type="checkbox" ${attrs} data-schema-property="required" ${f.required?'checked':''}>${c.esc(tr('required'))}</label>${f.type==='select'?choiceControl(f,index,true):''}${button('removeField','remove-field',`data-schema-field="${index}"`)}</section>`;
 }
 function valueField(f,index){
  const value=c.current.data.values[f.key]??'',attrs=`data-resource-value="${c.esc(f.key)}"`,label=templateFieldLabel(f);
  if(f.type==='select')return `<section class="module-schema-field"><h3>${c.esc(label)}</h3>${choiceControl(f,index,false)}</section>`;
  return c.field(c.esc(label),templateFieldInput(f,value,{esc:c.esc,attrs}));
 }
 function view({edit=false}={}){
  sync();const values=fields(),p=fieldPage(values,{query,offset,label:f=>f.label+' '+f.key});offset=p.offset;
  const visible=new Set(p.positions.map(i=>values[i].key));for(const key of choices.keys())if(!visible.has(key))choices.delete(key);
  return `<div data-module-schema>${edit?`<div class="section-bar"><h2>${c.esc(tr('fields'))}</h2>${button('addField','add-field')}</div><p class="muted">${c.esc(tr('schemaHelp'))}</p>`:''}${values.length>FIELD_PAGE||query?c.field(tr('findFields'),`<input type="search" data-schema-search="fields" value="${c.esc(query)}">`):''}${p.positions.map(i=>edit?editField(values[i],i):valueField(values[i],i)).join('')}${p.total>FIELD_PAGE?pager(p,FIELD_PAGE):''}${!p.total?`<p role="status">${c.esc(tr('empty'))}</p>`:''}</div>`;
 }
 function redraw(el){
  const kind=el.dataset.schemaSearch,index=el.dataset.schemaField,start=el.selectionStart,end=el.selectionEnd;
  c.draw();const selector=`[data-schema-search="${kind}"]${index===undefined?'':`[data-schema-field="${index}"]`}`,next=document.querySelector(selector);next?.focus({preventScroll:true});if(start!==null)next?.setSelectionRange(start,end);
 }
 function input(el){
  sync();const values=fields();
  if(el.dataset.schemaSearch){
   if(el.dataset.schemaSearch==='fields'){query=el.value;offset=0;choices.clear();}
   else{const f=values[Number(el.dataset.schemaField)];if(!f)return false;Object.assign(choiceState(f.key),{query:el.value,offset:0});}
   redraw(el);return false;
  }
  if(el.dataset.schemaChoice!==undefined){const f=values[Number(el.dataset.schemaField)],index=Number(el.dataset.schemaChoice);if(!f||!Number.isInteger(index)||index<0||index>=f.choices.length)return false;f.choices[index]=el.value;return true;}
  if(el.dataset.schemaIndex!==undefined){const f=values[Number(el.dataset.schemaIndex)],key=el.dataset.schemaProperty;if(!setCustomFieldProperty(f,key,key==='required'?el.checked:el.value))return false;if(['type','numericRepresentation'].includes(key))c.draw();return true;}
  if(el.dataset.resourceValue){const f=values.find(f=>f.key===el.dataset.resourceValue);if(!f)return false;c.current.data.values[f.key]=f.type==='boolean'?(el.value===''?null:el.value==='true'):el.value;return true;}
  return false;
 }
 function action(name,node){
  if(!name.startsWith('schema-'))return false;sync();const values=fields(),index=Number(node.dataset.schemaField),f=values[index];
  if(['schema-next','schema-previous'].includes(name)){
   const step=name==='schema-next'?1:-1;
   if(node.dataset.schemaField!==undefined&&f)choiceState(f.key).offset=Math.max(0,choiceState(f.key).offset+step*CHOICE_PAGE);
   else offset=Math.max(0,offset+step*FIELD_PAGE);
  }else if(name==='schema-add-field'){
   values.push({key:'field_'+crypto.randomUUID().replaceAll('-',''),label:'',type:'text',unit:'',required:false,choices:[]});query='';offset=Math.floor((values.length-1)/FIELD_PAGE)*FIELD_PAGE;c.change();
  }else if(name==='schema-remove-field'&&f){values.splice(index,1);choices.delete(f.key);c.change();}
  else if(name==='schema-add-choice'&&f){f.choices.push('');Object.assign(choiceState(f.key),{query:'',offset:Math.floor((f.choices.length-1)/CHOICE_PAGE)*CHOICE_PAGE});c.change();}
  else if(name==='schema-remove-choice'&&f){const at=Number(node.dataset.choiceIndex);if(Number.isInteger(at)&&at>=0&&at<f.choices.length){f.choices.splice(at,1);c.change();}}
  c.draw();document.querySelector('[data-module-schema] input,[data-module-schema] select')?.focus({preventScroll:true});return true;
 }
 function validate({edit=false}={}){
  sync();const values=fields();let index=-1;
  if(edit){if(validFields(values))return;index=values.findIndex(f=>!validFields([f]));}
  else{const errors=fieldValueErrors(values,c.current.data.values);if(!errors.length)return;index=values.findIndex(f=>f.label===errors[0]);}
  query='';offset=Math.floor(Math.max(0,index)/FIELD_PAGE)*FIELD_PAGE;choices.clear();
  const field=values[index];
  if(edit&&field?.type==='select'){
   const seen=new Set(),choice=field.choices.findIndex(value=>{if(!fieldChoiceValid(value)||seen.has(value))return true;seen.add(value);return false;});
   if(choice>=0)choiceState(field.key).offset=Math.floor(choice/CHOICE_PAGE)*CHOICE_PAGE;
  }
  c.draw();
  throw Error(tr('invalid',{field:values[index]?.label||tr('fields')}));
 }
 return {view,input,action,validate};
}
