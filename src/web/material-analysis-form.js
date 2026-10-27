import './i18n/catalogues/materialAnalysis.js';
import {researchContext} from './project-context.js';
import {materialReference} from './material-reference.js';
import {researchTargetPicker} from './research-target-picker.js';
import {t} from './i18n/index.js';
export const analysisText=(key,values)=>t('materialAnalysis',key,values);

export function analysisFormView({collection,esc,field}){
 const label=key=>esc(analysisText(key));
 return `${field(label('title'),`<input id="material-title" maxlength="300" value="${label(collection?'collectionName':'analysisName')}">`)}
  <div id="material-picker-inputs"><input type="hidden" data-value value=""></div>
  ${collection?'':`${field(label('tool'),'<input id="material-tool" maxlength="200">')}
   ${field(label('version'),'<input id="material-version" maxlength="200">')}
   ${field(label('procedure'),'<textarea id="material-parameters" maxlength="20000" rows="4"></textarea>')}
   <fieldset id="material-method"><legend>${label('method')}</legend>
    <input type="hidden" id="material-record-source" name="material-record-source" value="">
    <p data-method-summary>${label('none')}</p>
    <div class="inline-actions"><button type="button" class="button" data-method-choose>${label('choose')}</button><button type="button" class="text-button" data-method-remove hidden>${label('remove')}</button></div>
    <div data-method-picker hidden></div>
   </fieldset><div id="material-picker-outputs"><input type="hidden" data-value value=""></div>`}
  <button type="button" class="button" data-action="material-analysis-save">${label(collection?'saveCollection':'saveAnalysis')}</button>`;
}

// One selected immutable revision and one summary page, independent of the
// number or size of workspace records. Discovery never replaces the form.
export function analysisMethodPicker({root,state,api,call,esc,field,guard}){
 let selected=null,choosing=false,disposed=false;
 const context=state.storage?.contextId,recordId=state.selected,page=state.page,research=researchContext(state);
 const active=()=>!disposed&&root.isConnected&&['editor','record-reader'].includes(page)&&state.page===page&&researchContext(state)===research&&state.storage?.contextId===context&&state.selected===recordId;
 const picker=researchTargetPicker({state,api,esc,field,active,excludeId:()=>null});
 const host=root.querySelector('[data-method-picker]'),choose=root.querySelector('[data-method-choose]'),remove=root.querySelector('[data-method-remove]'),draft=root.querySelector('#material-record-source');
 function collapse(){picker.stop();choosing=false;host.replaceChildren();host.hidden=true;choose.disabled=false;choose.focus();}
 function update(){
  root.querySelector('[data-method-summary]').textContent=selected?analysisText('selected',{title:selected.title,revision:selected.revision.slice(0,12)}):analysisText('none');
  remove.hidden=!selected;draft.value=selected?JSON.stringify(selected):'';draft.dispatchEvent(new Event('input',{bubbles:true}));
 }
 choose.addEventListener('click',()=>{
  guard();choosing=true;choose.disabled=true;host.hidden=false;
  picker.open({root:host,title:analysisText('choose'),recordsOnly:true,onCancel:collapse,onChoose:async(item,{signal,stillCurrent})=>{
   const retained=await call('pin',{id:item.id,expectedRevision:item.revision},{adopt:false,signal});
   if(!stillCurrent()||!active())return;guard();
   selected={...materialReference(retained),title:item.title};update();collapse();
  }});
 });
 remove.addEventListener('click',()=>{guard();selected=null;update();collapse();});
 return {values(){guard();if(choosing)throw Error(analysisText('finishChoosing'));return selected?[materialReference(selected)]:[];},dispose(){disposed=true;picker.stop();}};
}
