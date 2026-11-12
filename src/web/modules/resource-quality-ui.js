import {materialReference} from '../material-reference.js';
import {qualityAssessment,qualityDay} from './resource-quality.js';
import {qualityText as tr,readinessText} from './resource-quality-presentation.js';

export function resourceQualityEditor(){
 let picker,host;
 function close(){picker?.dispose();picker=null;host?.replaceChildren();host=null;}
 function form(d,c){
  if(!['material','equipment'].includes(d.data.kind))return '';
  const q=d.data.quality,{esc,field,button,option}=c;
  if(!q)return '<section class="module-block">'+button(tr(d.data.kind==='equipment'?'equipmentSetup':'lotSetup'),'quality-enable')+'</section>';
  const lot=q.kind==='lot',ref=lot?q.evidence:q.certificate;
  const input=(key,label,type,max)=>field(esc(tr(label)),'<input data-quality-field="'+key+'" type="'+type+'" value="'+esc(q[key]??'')+'" '+(max?'maxlength="'+max+'" ':'')+(key==='number'?(d.base?.quality?'readonly':'required'):'')+'>');
  const rules=['reserve','use','run'].filter(key=>lot||key!=='use').map(key=>field(esc(tr(key)),'<select data-quality-rule="'+key+'">'+['warn','block'].map(value=>option(value,tr(value),q.policy[key])).join('')+'</select>')).join('');
  const on=qualityDay(new Date().toISOString()),summary=readinessText(qualityAssessment(q,'run',on),q);
  return '<section class="module-block" data-quality-editor><h2>'+esc(tr('qualityTitle'))+'</h2><div class="form-grid">'+
   (lot?input('number','lotNumber','text',160)+input('supplier','supplier','text',240)+input('expiresOn','expiresOn','date')+input('retestOn','retestOn','date'):'')+
   input('holdReason','holdReason','text',500)+'</div><fieldset><legend>'+esc(tr(lot?'evidence':'certificate'))+'</legend>'+
   (ref?'<p><code>'+esc(ref.id+' / '+ref.revision)+'</code></p>':'')+
   (q.coverage?'<p>'+esc(tr('from')+' '+(q.coverage.from??tr('unknownCoverage'))+' · '+tr('through')+' '+(q.coverage.through??tr(q.coverage.expiry==='open'?'openCoverage':'unknownCoverage')))+'</p>':'')+
   button(tr('choose'),'quality-choose')+(ref?button(tr('remove'),'quality-remove'):'')+'<div data-quality-picker></div></fieldset><div class="form-grid">'+rules+'</div><p data-readiness>'+esc(summary)+'</p></section>';
 }
 function input(el,c){
  const q=c.current?.data?.quality,key=el.dataset.qualityField,step=el.dataset.qualityRule;
  if(!q||(!key&&!step))return false;
  if(step)q.policy[step]=el.value;
  else q[key]=el.type==='date'?(el.value||null):el.value;
  const status=el.closest('[data-quality-editor]').querySelector('[data-readiness]');
  status.textContent=readinessText(qualityAssessment(q,'run',qualityDay(new Date().toISOString())),q);
  return true;
 }
 async function action(name,c){
  if(!name.startsWith('quality-'))return false;
  const d=c.current,q=d.data.quality,{api,state}=c.services;
  const update=()=>{close();c.change();c.draw();};
  if(name==='quality-enable'){
   const common={version:1,holdReason:'',policy:{reserve:'warn',use:'warn',run:'warn'}};
   d.data.quality=d.data.kind==='material'?{...common,kind:'lot',number:'',supplier:'',evidence:null,expiresOn:null,retestOn:null}:{...common,kind:'equipment',certificate:null,coverage:null};
   update();return true;
  }
  if(!q)return true;
  if(name==='quality-remove'){if(q.kind==='lot')q.evidence=null;else{q.certificate=null;q.coverage=null;}update();}
  else if(name==='quality-cancel')close();
  else if(name==='quality-choose'){
   close();const current=host=document.querySelector('[data-quality-picker]'),workspaceId=state.book.id;
   const active=()=>current.isConnected&&c.current===d&&state.book.id===workspaceId&&!state.access?.locked;
   const guard=()=>{if(!active())throw new DOMException('','AbortError');};
   const {materialSourcePicker}=await import('../material-source-picker.js');if(!active())return true;
   current.innerHTML='<div><input type="hidden" data-value></div>'+c.button(tr('useSelection'),'quality-accept')+c.button(tr('cancel'),'quality-cancel');
   picker=materialSourcePicker({root:current.firstElementChild,call:(op,data,options)=>api('/api/research/materials/'+op,data,{...options,adopt:false}),esc:c.esc,field:c.field,guard,recordId:null,scope:'all',kind:q.kind==='lot'?null:'analysis',label:tr(q.kind==='lot'?'evidence':'certificate'),id:'quality-source',optional:true});
   current.querySelector('[data-scope]').closest('.field').hidden=true;await picker.ready;
  }else if(name==='quality-accept'){
   const selected=picker?.values()[0];if(!selected)throw Error(tr('selectFirst'));
   const ref=materialReference({...selected,workspaceId:selected.workspaceId??state.book.id});
   if(q.kind==='lot')q.evidence=ref;
   else{const selectedHost=host,details=await api('/api/research/materials/calibration-inspect',{ref},{adopt:false});if(!selectedHost.isConnected||c.current!==d)return true;
    if(!details.coverage)throw Error(tr('invalidCertificate'));q.certificate=ref;q.coverage=details.coverage;}
   update();
  }
  return true;
 }
 return {form,input,action,close};
}
