import {retainedFigureAuthoringUI} from './retained-figure-authoring-ui.js';
import {projectApiRoute,researchOwner} from './project-context.js';
import {materialReferenceReader} from './material-reference-requests.js';
import {isRetainedFigure} from './retained-figure-model.js';
import {retainedFigureEditor} from './retained-figure-editor.js';
import {figureEditor} from './figure-editor.js';
import {renderFigureView} from './figure-presentation.js';
import {createFigure} from './figure-model.js';
import {createComposition,figurePlots} from './figure-composition.js';
import {recordFigureCopyPicker} from './record-figure-copy-picker.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordValues',key,args);

// Reuse the scientific editor with a selected-value draft and DOM owner.
export function recordFigureView({state,api,esc,notify},lifecycle){
 let editor=null,dialog=null,listener=null,picker=null,retained=null,selected=null,activateManual=null,manualActive=false;
 const manualText=key=>t('retainedFigureEditor',key);
 const feedback=(message,error=false)=>{const status=dialog?.querySelector('[data-figure-message]');if(status){status.textContent=message;status.classList.toggle('error',error);}else notify(message,error);};
 return {
  async prepare(base,value,input){
   if(input.retainedFigure)return;
   if(value.value?.document?.format==='figure-authoring')return;
   if(value.value===null&&['plot','panels'].includes(input.create)||value.value&&(!isRetainedFigure(value.value)||!value.value.source))await lifecycle.draftChange('start',{create:value.value===null?input.create:null});
  },
  initialize(base,value,input,changed){
   if(input.retainedFigure){value.value=structuredClone(input.retainedFigure);value.value.id=base.field.slice(7);changed();return;}
   if(value.value!==null||!['plot','panels'].includes(input.create))return;
   const plot=()=>{const figure=createFigure();figure.series[0].points=[{x:null,y:null,error:null}];return figure;};
   value.value=input.create==='panels'?createComposition([plot(),plot()]):plot();value.value.id=base.field.slice(7);changed();
  },
  fields(base,value,changed){
   if(!value.value)return '<p>'+esc(text('figureAbsent'))+'</p>';
   if(isRetainedFigure(value.value)){selected={base,value,changed};return '<div data-retained-figure-editor></div>'; }
   const sources=new WeakMap(),amended=()=>{if(value.copies){const ids=new Set(figurePlots(value.value).map(plot=>plot.id));value.copies=value.copies.filter(copy=>ids.has(copy.targetId));if(!value.copies.length)delete value.copies;}changed();};
   picker=recordFigureCopyPicker({state,api,esc,context:lifecycle.context});
   editor=figureEditor({getFigures:()=>[value.value],getResults:()=>({statements:base.definition.linkedFigureIds.map(figureId=>({kind:'figure',figureId}))}),
    selectCopy:async()=>{const waiting=picker.open(base);lifecycle.refresh();try{const source=await waiting;if(source){sources.set(source.figure,source);return source.figure;}return null;}finally{lifecycle.refresh();}},
    copyPairs:pairs=>{for(const [source,target] of pairs){const retained=sources.get(source);if(!retained)throw Error(text('copyPlotInvalid'));(value.copies??=[]).push({source:retained.source,figureId:retained.figureId,plotId:retained.plotId,targetId:target.id});}},
    root:()=>dialog,selectedOnly:true,changed:amended,notify:feedback,context:lifecycle.context,busyChanged:lifecycle.refresh});
   return '<p role="status" data-figure-message></p>'+editor.view();
  },
  bind(host){
   if(selected){
    dialog=host;const {base,value,changed}=selected;
    const root=host.querySelector('[data-retained-figure-editor]'),manual=()=>{retained?.release();manualActive=true;retained=retainedFigureAuthoringUI({root,state,api,base,value,lifecycle,changed});};
    activateManual=manual;if(value.value.document.format==='figure-authoring'||!value.value.source){manual();return;}
    root.innerHTML='<button type="button" class="button" data-edit-measurements>'+esc(manualText('editMeasurements'))+'</button><p>'+esc(manualText('authoredCopy'))+'</p><div data-source-presentation></div>';
    const converting=root.querySelector('[data-edit-measurements]');converting.onclick=async()=>{if(converting.disabled)return;const token=lifecycle.context();converting.disabled=true;
     try{await retained.checkpoint();await lifecycle.draftChange('start',{create:null},{checkpoint:true});if(token===lifecycle.context()&&root.isConnected)manual();}
     catch(error){if(token===lifecycle.context()&&root.isConnected&&error.name!=='AbortError'){feedback(error.message,true);converting.disabled=false;}}
    };
    const owner=researchOwner(state),read=materialReferenceReader({api,local:(name,body,options)=>api('/api/research/materials/'+name,body,{...options,owner,adopt:false})}),request=(body,options)=>read('retained-figure',body,options);
    retained=retainedFigureEditor({root:root.querySelector('[data-source-presentation]'),figure:value.value,request,context:lifecycle.context,busyChanged:lifecycle.refresh,notifyPending:pending=>{if(pending)changed();},
     change:(body,options)=>api('/api/research/materials/retained-figure-change',{recordId:base.recordId,...body},{...options,owner,adopt:false}),
     downloadURL:(ref,format,expectedRevision)=>(ref.workspaceId?'/api/projects/material-reference/retained-figure-export':projectApiRoute('/api/research/materials/retained-figure-export',owner))+'?context='+encodeURIComponent(state.storage.contextId)+'&selection='+encodeURIComponent(JSON.stringify({ref,expectedRevision,format})),
     adopt:figure=>{value.value=figure;changed();}});return;
   }
   if(!editor)return;dialog=host;dialog.classList.add('record-figure-writing');
   listener=event=>{
    const control=event.target.closest('[data-action],[data-heatmap-add],[data-heatmap-remove]');
    if(!control?.closest('[data-writing-fields]')||!((control.dataset.action??'').startsWith('figure-')||control.hasAttribute('data-heatmap-add')||control.hasAttribute('data-heatmap-remove')))return;
    event.stopPropagation();if(control.disabled||control.closest('[inert]'))return;
    void editor.action(control).catch(error=>feedback(error.message,true));
   };
   dialog.addEventListener('click',listener);editor.bind();
  },
  input:element=>{editor?.input(element);return false;},
  busy:()=>Boolean(retained?.isBusy()||picker?.busy()||editor?.isBusy()),
  async checkpoint(options){if(selected?.value.value?.document?.format==='figure-authoring'&&!manualActive){activateManual?.();await retained?.ready;}return retained?.checkpoint(options);},
  validate(){if(retained)return retained.validate();if(!editor)return false;editor.validate();return true;},
  preview:base=>base.value.value?'<p>'+esc(typeof base.value.value.title==='string'?base.value.value.title:base.value.value.title.preview)+'</p>'+renderFigureView(base.value.value,{idPrefix:'saved-figure-conflict'}):'<p>'+esc(text('figureAbsent'))+'</p>',
  release(){retained?.release();retained=null;selected=null;activateManual=null;manualActive=false;picker?.destroy();picker=null;if(dialog){dialog.removeEventListener('click',listener);dialog.classList.remove('record-figure-writing');}editor?.release();editor=null;dialog=null;listener=null;}
 };
}
