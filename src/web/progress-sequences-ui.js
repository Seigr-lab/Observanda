import {localizedText} from './i18n/index.js';
import {updateText,updateAttribute,updateProperty,placeAt} from './progress-dom.js';
const text=localizedText('operationProgress');

// Planned steps stay attached to their task while its measured stage changes.
// Existing rows and disclosures survive polling, counters and language changes.
export function progressSequences(host,stageName){
 const views=new Map();
 return {update(sequences=[]){
  const keep=new Set();
  for(const [index,sequence] of sequences.entries()){
   const key=index+':'+sequence.id;keep.add(key);let view=views.get(key);
   if(!view){
    const element=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ol');
    element.className='operation-sequence';element.append(summary,list);view={element,summary,list,rows:new Map()};views.set(key,view);
   }
   placeAt(host,view.element,index);
   const current=sequence.steps.findIndex(step=>step.state==='running'),completed=sequence.steps.filter(step=>step.state==='completed').length;
   updateText(view.summary,text(current>=0?'sequenceCurrent':'sequenceComplete',{name:stageName(sequence.id),current:current+1,completed,total:sequence.steps.length}));
   const rowKeys=new Set();
   for(const [position,step] of sequence.steps.entries()){
    rowKeys.add(step.stage);let row=view.rows.get(step.stage);
    if(!row){const element=document.createElement('li'),label=document.createElement('span'),state=document.createElement('span');state.className='operation-step-state';element.append(label,state);row={element,label,state};view.rows.set(step.stage,row);}
    placeAt(view.list,row.element,position);updateText(row.label,stageName(step.stage));updateText(row.state,text('step-'+step.state));
    updateAttribute(row.element,'data-state',step.state);updateAttribute(row.element,'aria-current',step.state==='running'?'step':null);
   }
   for(const [key,row] of view.rows)if(!rowKeys.has(key)){row.element.remove();view.rows.delete(key);}
  }
  for(const [key,view] of views)if(!keep.has(key)){view.element.remove();views.delete(key);}
  updateProperty(host,'hidden',!sequences.length);
 }};
}
