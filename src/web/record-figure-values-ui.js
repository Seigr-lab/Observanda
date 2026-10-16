import {figureEditor} from './figure-editor.js';
import {renderFigureView} from './figure-renderer.js';
import {createFigure} from './figure-model.js';
import {createComposition,figurePlots} from './figure-composition.js';
import {recordFigureCopyPicker} from './record-figure-copy-picker.js';
import {t} from './i18n/index.js';
const text=(key,args)=>t('recordValues',key,args);
export const recordFigureAction=(figure,esc,busy=false)=>'<button type="button" class="button record-figure-edit" data-action="record-value-edit" data-value-field="figure:'+figure.id+'" aria-label="'+esc(text('editFigure',{title:figure.title}))+'"'+(busy?' disabled':'')+'>'+esc(text('editFigureButton'))+'</button>';

// Reuse the scientific editor with a selected-value draft and DOM owner.
export function recordFigureView({state,api,esc,notify},lifecycle){
 let editor=null,dialog=null,listener=null,picker=null;
 const feedback=(message,error=false)=>{const status=dialog?.querySelector('[data-figure-message]');if(status){status.textContent=message;status.classList.toggle('error',error);}else notify(message,error);};
 return {
  initialize(base,value,input,changed){
   if(input.retainedFigure){value.value=structuredClone(input.retainedFigure);value.value.id=base.field.slice(7);changed();return;}
   if(value.value!==null||!['plot','panels'].includes(input.create))return;
   const plot=()=>{const figure=createFigure();figure.series[0].points=[{x:null,y:null,error:null}];return figure;};
   value.value=input.create==='panels'?createComposition([plot(),plot()]):plot();value.value.id=base.field.slice(7);changed();
  },
  fields(base,value,changed){
   if(!value.value)return '<p>'+esc(text('figureAbsent'))+'</p>';
   const sources=new WeakMap(),amended=()=>{if(value.copies){const ids=new Set(figurePlots(value.value).map(plot=>plot.id));value.copies=value.copies.filter(copy=>ids.has(copy.targetId));if(!value.copies.length)delete value.copies;}changed();};
   picker=recordFigureCopyPicker({state,api,esc,context:lifecycle.context});
   editor=figureEditor({getFigures:()=>[value.value],getResults:()=>({statements:base.definition.linkedFigureIds.map(figureId=>({kind:'figure',figureId}))}),
    selectCopy:async()=>{const waiting=picker.open(base);lifecycle.refresh();try{const source=await waiting;if(source){sources.set(source.figure,source);return source.figure;}return null;}finally{lifecycle.refresh();}},
    copyPairs:pairs=>{for(const [source,target] of pairs){const retained=sources.get(source);if(!retained)throw Error(text('copyPlotInvalid'));(value.copies??=[]).push({source:retained.source,figureId:retained.figureId,plotId:retained.plotId,targetId:target.id});}},
    root:()=>dialog,selectedOnly:true,changed:amended,notify:feedback,context:lifecycle.context,busyChanged:lifecycle.refresh});
   return '<p role="status" data-figure-message></p>'+editor.view();
  },
  bind(host){
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
  busy:()=>Boolean(picker?.busy()||editor?.isBusy()),
  validate(){if(!editor)return false;editor.validate();return true;},
  preview:base=>base.value.value?'<p>'+esc(base.value.value.title)+'</p>'+renderFigureView(base.value.value,{idPrefix:'saved-figure-conflict'}):'<p>'+esc(text('figureAbsent'))+'</p>',
  release(){picker?.destroy();picker=null;if(dialog){dialog.removeEventListener('click',listener);dialog.classList.remove('record-figure-writing');}editor?.release();editor=null;dialog=null;listener=null;}
 };
}
