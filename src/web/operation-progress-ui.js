import {progressUnit} from './progress-units.js';
import {localizedText,onLanguageChange,language} from './i18n/index.js';
import {updateText,updateProperty,updateAttribute} from './progress-dom.js';
import {progressSequences} from './progress-sequences-ui.js';
const text=localizedText('operationProgress');
const duration=ms=>{const seconds=Math.max(0,Math.floor(ms/1000));return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');};
const resolve=value=>typeof value==='function'?value():value;

// One mounted view per operation. Measurements, its clock and language changes
// have separate update paths; none replaces the surrounding form or static DOM.
export function operationProgress({stageText,presentation,title=()=>text('title'),hint='',className='',host=document.querySelector('#dialog[open] form')??document.querySelector('#main'),before=null,disableControls=true,scroll=true,compact=false}={}){
 const node=document.createElement('section');node.className='operation-progress '+className;if(compact)node.classList.add('operation-progress-compact');
 node.innerHTML='<div data-sequences hidden></div><h3></h3><p data-hint></p><p data-path></p><p data-item></p><progress></progress><p data-count role="status"></p><p data-work></p><p data-detail></p><p data-time></p><p data-wait></p>';
 const fields=Object.fromEntries(['hint','path','item','count','work','detail','time','wait'].map(key=>[key,node.querySelector('[data-'+key+']')])),heading=node.querySelector('h3'),bar=node.querySelector('progress'),labels=new Map();
 const sequences=progressSequences(node.querySelector('[data-sequences]'),stageName);
 let details,summary;
 if(compact){details=document.createElement('details');summary=document.createElement('summary');details.append(summary,fields.path,fields.item);node.append(details);}
 fields.detail.hidden=!presentation;
 const anchor=host?.querySelector('h2');if(before?.isConnected)before.before(node);else if(anchor)anchor.after(node);else (host??document.body).prepend(node);
 if(scroll)node.scrollIntoView({block:'nearest'});let value={stage:'preparing',completed:0,unit:'items'},received=performance.now(),started=received,finished=false;
 const controls=disableControls?[...(host?.querySelectorAll('button,input,select')??[])].map(el=>[el,el.disabled]):[];for(const [el] of controls)el.disabled=true;
 function stageName(stage){
  if(!labels.has(stage)){
   let label=resolve(title);
   if(stage==='preparing')label=text('preparing');
   else try{label=stageText?.(stage)??label;}catch{/* Unknown stages retain the operation title and measured counters. */}
   labels.set(stage,label);
  }
  return labels.get(stage);
 }
 function field(key,next){updateText(fields[key],next);updateProperty(fields[key],'hidden',!fields[key].textContent);}
 function renderClock(){
  const since=performance.now()-received,elapsed=value.elapsedMs??(received-started);
  field('time',text('elapsed',{time:duration(elapsed+(finished?0:since))}));
  const quietFor=Math.max(0,(value.observedAt??0)-(value.advancedAt??0))+since;
  field('wait',finished?'':since>=15000?text('connectionQuiet'):quietFor>=15000?text('lastAdvance',{time:duration(quietFor)}):'');
 }
 function renderMeasurement(){
  sequences.update(value.sequences);
  const total=Number.isSafeInteger(value.total)?value.total:null;
  updateText(heading,stageName(value.stage));field('item',value.item);updateAttribute(fields.item,'title',value.item??'');
  // Domain presentation owns its fields. Do not first paint generic counters
  // and immediately overwrite them with storage or record-specific text.
  const number=n=>(n??0).toLocaleString(language());
  const display=presentation?presentation(value):{
   path:(value.stages??[]).filter(stage=>stage!=='preparing'&&stage!==value.stage).map(stageName).join(' › '),
   count:total===null?text('count',{count:number(value.completed),unit:progressUnit(value.unit)}):text('countTotal',{count:number(value.completed),total:number(total),unit:progressUnit(value.unit)}),
   work:'',detail:'',barLabel:stageName(value.stage),total,completed:value.completed??0
  };
  for(const key of ['path','count','work','detail'])field(key,display[key]);
  updateAttribute(bar,'aria-label',display.barLabel);
  if(display.total>0){updateProperty(bar,'max',display.total);updateProperty(bar,'value',display.completed);}else updateAttribute(bar,'value',null);
  if(details)updateProperty(details,'hidden',!fields.path.textContent&&!fields.item.textContent);
 }
 function renderLanguage(){
  labels.clear();updateAttribute(node,'aria-label',resolve(title));field('hint',resolve(hint));if(summary)updateText(summary,text('details'));
  renderMeasurement();renderClock();
 }
 for(const el of [heading,...Object.entries(fields).filter(([key])=>key!=='hint').map(([,el])=>el)])el.tabIndex=0;
 renderLanguage();const unsubscribe=onLanguageChange(renderLanguage),timer=setInterval(renderClock,1000);
 return {element:node,update(next){
  if(finished){finished=false;delete node.dataset.finished;bar.style.visibility='';}
  value=next;received=performance.now();renderMeasurement();renderClock();
 },finish(){if(finished)return;value={...value,elapsedMs:(value.elapsedMs??received-started)+performance.now()-received};finished=true;node.dataset.finished='true';bar.style.visibility='hidden';renderClock();},close(){clearInterval(timer);unsubscribe();node.remove();for(const [el,disabled] of controls)if(el.isConnected)el.disabled=disabled;}};
}
