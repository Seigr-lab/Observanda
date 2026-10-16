import {researchTargetPicker} from './research-target-picker.js';
import {researchReference,parseResearchReference} from './research-reference.js';
import {WORKFLOW_ROLES,workflowRole} from './record-workflow.js';
import {RELATION_TYPES} from './record-model.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordValues',key,args);
export const recordRelationAddButton=esc=>'<button type="button" class="button" data-action="record-value-add-relation">'+esc(text('addRelation'))+'</button>';
export const recordRelationEditButton=(link,esc)=>'<button type="button" class="button" data-action="record-value-edit" data-value-field="relation:'+link.id+'" aria-label="'+esc(text('editRelation',{label:link.label||link.type}))+'">'+esc(text('editRelationButton'))+'</button>';

// Discovery is embedded in the selected editor. Changing or closing its form
// cancels discovery, so an old choice cannot enter another recovered edit.
export function recordRelationView({state,api,esc,field},lifecycle){
 let current=null,unbind=null,retained=null,pending=false;
 const empty=()=>({type:RELATION_TYPES[0],label:'',reference:''});
 const picker=researchTargetPicker({state,api,esc,field,excludeId:()=>current?.base.recordId,active:()=>!!current?.dialog?.open&&current.context===lifecycle.context()});
 const stop=()=>{picker.stop();pending=false;current?.dialog?.querySelector('[data-relation-picker]')?.replaceChildren();lifecycle.refresh();};
 const option=(id,label,value)=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(label)+'</option>';
 const roleLabel=role=>text('relationRole_'+role);
 const version=item=>item.role?(workflowRole(item.role).exact?'exact':'current'):parseResearchReference(item.reference)?.revision?'exact':'current';
 function refresh(){
  const {dialog,value}=current,item=value.value??retained,removed=value.value===null&&!!current.base.definition.original;
  for(const control of dialog.querySelectorAll('[data-relation-value]')){control.value=item[control.dataset.relationValue]??'';control.disabled=removed;}
  dialog.querySelector('[data-relation-browse]').disabled=removed;
  dialog.querySelector('[data-relation-value="reference"]').setCustomValidity('');
  const control=dialog.querySelector('[data-relation-version]');control.value=version(item);control.disabled=removed||!!item.role;
 }
 async function choose(item,{signal,stillCurrent}){
  const selected=current,mode=selected.dialog.querySelector('[data-relation-version]').value,target={workspaceId:item.workspaceId,kind:item.kind,id:item.id};
  if(mode==='exact'){
   pending=true;lifecycle.refresh();
   try{
    const saved=await api('/api/research/materials/pin',{id:item.id,expectedRevision:item.revision},{adopt:false,signal});
    if(!stillCurrent()||selected!==current)return;
    if(saved.workspaceId!==target.workspaceId||saved.id!==target.id||saved.kind!=='record'||saved.revision!==item.revision)throw Error(text('relationPinChanged'));
    target.revision=saved.revision;
   }finally{if(selected===current&&stillCurrent()){pending=false;lifecycle.refresh();}}
  }
  if(!stillCurrent()||selected!==current)return;
  selected.value.value??=empty();selected.value.value.reference=researchReference(target);selected.value.value.label=item.title;
  stop();refresh();selected.changed();selected.dialog.querySelector('[data-relation-value="reference"]').focus();
 }
 return {
  busy:()=>pending,
  fields(base,value,changed){
   retained=value.value??base.definition.original??empty();current={base,value,changed,context:lifecycle.context(),dialog:null};
   const roles=WORKFLOW_ROLES.filter(role=>base.definition.recordType==='run'||!['run-of','follows-run'].includes(role.id));
   return field(esc(text('relationPurpose')),'<select data-relation-value="role">'+option('',text('relationGeneral'),retained.role??'')+roles.map(role=>option(role.id,roleLabel(role.id),retained.role)).join('')+'</select>')+
    field(esc(text('relationType')),'<input data-relation-value="type" required list="selected-relation-types" value="'+esc(retained.type)+'"><datalist id="selected-relation-types">'+RELATION_TYPES.map(type=>'<option value="'+esc(type)+'"></option>').join('')+'</datalist>')+
    field(esc(text('relationLabel')),'<input data-relation-value="label" value="'+esc(retained.label)+'">')+
    field(esc(text('relationReference')),'<textarea data-relation-value="reference" required rows="3" spellcheck="false">'+esc(retained.reference)+'</textarea>')+
    '<p class="muted">'+esc(text('relationReferenceHelp'))+'</p>'+field(esc(text('relationVersion')),'<select data-relation-version>'+option('current',text('relationCurrent'),version(retained))+option('exact',text('relationExact'),version(retained))+'</select>')+
    '<button type="button" class="button" data-relation-browse>'+esc(text('relationBrowse'))+'</button><div data-relation-picker></div>'+
    (base.definition.original?'<p><label><input type="checkbox" data-relation-remove'+(value.value===null?' checked':'')+'> '+esc(text('removeRelation'))+'</label></p><p class="muted">'+esc(text('removeRelationHelp'))+'</p>':'');
  },
  bind(dialog){
   if(!current)return;current.dialog=dialog;refresh();
   const click=event=>{if(!event.target.closest('[data-relation-browse]'))return;event.preventDefault();event.stopPropagation();
    const role=(current.value.value??retained).role,exact=dialog.querySelector('[data-relation-version]').value==='exact';
    stop();
    picker.open({root:dialog.querySelector('[data-relation-picker]'),recordType:role==='run-of'?'non-run':role==='follows-run'?'run':'all',recordsOnly:!!role||exact,onChoose:choose,onCancel:()=>{stop();dialog.querySelector('[data-relation-browse]').focus();}});
   };
   dialog.addEventListener('click',click);unbind=()=>dialog.removeEventListener('click',click);
  },
  release(){stop();unbind?.();unbind=null;current=null;retained=null;},
  input(element,base,value){
   if(!current)return false;
   if(element.hasAttribute('data-relation-version')){stop();return false;}
   if(element.hasAttribute('data-relation-remove')){stop();if(element.checked){retained=value.value;value.value=null;}else value.value=structuredClone(retained);refresh();return true;}
   const key=element.dataset.relationValue;if(!key)return false;stop();value.value??=empty();
   if(key==='role'){
    if(element.value){value.value.role=element.value;value.value.type=roleLabel(element.value);}else delete value.value.role;
    // A new semantic role needs a deliberate compatible target selection.
    value.value.reference='';refresh();
   }else{value.value[key]=element.value;if(key==='reference'){const target=parseResearchReference(element.value);if(target)value.value.reference=researchReference(target);}}
   return true;
  },
  preview(base){const item=base.value.value;return '<p>'+esc(item?item.type+' · '+item.label:text('relationAbsent'))+'</p>'+(item?'<p class="research-reference">'+esc(item.reference)+'</p>':'');},
  validate(dialog,base,value){
   if(value.value===null)return true;
   const target=parseResearchReference(value.value.reference),control=dialog.querySelector('[data-relation-value="reference"]');
   const issue=!target?text('relationInvalidReference'):target.workspaceId===base.workspaceId&&target.kind==='record'&&target.id===base.recordId?text('relationSelf'):value.value.role&&(target.workspaceId!==base.workspaceId||target.kind!=='record'||workflowRole(value.value.role).exact!==!!target.revision)?text('relationRoleTarget'):'';
   control.setCustomValidity(issue);if(issue){control.reportValidity();return false;}return true;
  }
 };
}
