import {observationAnnotation,createObservationAnnotation} from './figure-observation-annotations.js';
import {observationControls,observationText} from './figure-observation-ui.js';
import {t} from './i18n/index.js';
import {createAnnotation} from './figure-annotations.js';
import {cloneFigure} from './figure-composition.js';
import {createFigure} from './figure-model.js';
import {figureStyle} from './figure-style.js';

const tr=(key,values)=>['region','callout','addRegion','addCallout'].includes(key)?observationText(key):t('figureComposition',key,values);
export function figureCompositionUI({esc,getFigures,refresh,changed,update,canRemove=()=>true,copied=()=>{},prepare=async()=>{},selectCopy=null}){
 const selected=new Map(),field=(label,control)=>'<label>'+esc(tr(label))+control.replace(/^<(input|select)/,tag=>tag+' aria-label="'+esc(tr(label))+'"')+'</label>',button=(key,extra='')=>'<button type="button" class="button" data-action="figure-composition-'+key+'" '+extra+'>'+esc(tr(key))+'</button>';
 const input=(key,value,type='text',attrs='')=>'<input data-composition-field="'+key+'" type="'+type+'" value="'+esc(value??'')+'" '+attrs+'>';
 const current=f=>f.panels.find(p=>p.id===selected.get(f.id))??f.panels[0];
 function view(f,plotCard){
  const p=current(f),index=f.panels.indexOf(p),sources=getFigures().filter(v=>v.kind!=='panels');
  return '<div class="figure-composition-controls">'+field('figureTitle',input('title',f.title,'text','maxlength="300"'))+
   '<p class="editor-hint">'+esc(tr('help'))+'</p><div class="figure-basics">'+field('columns','<select data-composition-field="columns">'+[1,2,3].map(n=>'<option '+(n===f.layout.columns?'selected':'')+'>'+n+'</option>').join('')+'</select>')+
   ['linkX','linkY'].map(k=>'<label class="check"><input type="checkbox" data-composition-field="'+k+'" '+(f.layout[k]?'checked':'')+'>'+esc(tr(k))+'</label>').join('')+'</div>'+
   field('editing','<select data-composition-panel>'+f.panels.map(p=>'<option value="'+p.id+'" '+(p.id===current(f).id?'selected':'')+'>'+esc(p.label+' · '+p.figure.title)+'</option>').join('')+'</select>')+
   '<div class="figure-basics">'+field('label',input('label',p.label,'text','maxlength="300"'))+(selectCopy?'':field('source','<select data-composition-source>'+sources.map(s=>'<option value="'+s.id+'">'+esc(s.title)+'</option>').join('')+'</select>'))+'</div><div class="inline-actions">'+button('copy',selectCopy||sources.length?'':'disabled')+button('blank',f.panels.length>=8?'disabled':'')+button('up',index?'':'disabled')+button('down',index<f.panels.length-1?'':'disabled')+button('remove',f.panels.length<=2?'disabled':'')+'</div></div>'+plotCard(p.figure,true);
 }
 function annotations(f){
  return '<details class="figure-annotations"><summary>'+esc(tr('annotations'))+'</summary><p class="editor-hint">'+esc(tr('annotationHelp'))+'</p>'+field('annotationLabels','<select data-annotation-layout>'+['auto','key','hidden'].map(value=>'<option value="'+value+'" '+(figureStyle(f).annotationLabels===value?'selected':'')+'>'+esc(tr('labels_'+value))+'</option>').join('')+'</select>')+'<p class="editor-hint">'+esc(tr('annotationLayoutHelp'))+'</p>'+(f.annotations??[]).map((a,i)=>{
   const coordinate=(key,label)=>field(label,'<input data-annotation-field="'+key+'" type="'+(a.axis==='x'&&f.x.kind==='date'?'text':'number')+'" step="any" value="'+esc(a[key]??'')+'">');
   return '<fieldset data-annotation="'+i+'"><legend>'+esc(tr(a.kind))+'</legend><div class="figure-basics">'+field('annotationLabel','<input data-annotation-field="label" maxlength="300" value="'+esc(a.label)+'">')+
    (observationAnnotation(a)?observationControls(a,f,esc):field('axis','<select data-annotation-field="axis">'+[['x','coordinate'],['y','value']].map(([k,label])=>'<option value="'+k+'" '+(a.axis===k?'selected ':'')+(k==='x'&&f.x.kind==='category'?'disabled':'')+'>'+esc(tr(label))+'</option>').join('')+'</select>')+
    coordinate('start','start')+(a.kind==='interval'?coordinate('end','end'):''))+field('color','<input data-annotation-field="color" type="color" value="'+a.color+'">')+(['interval','region'].includes(a.kind)?field('opacity','<input data-annotation-field="opacity" type="number" min="0" max="1" step="0.05" value="'+a.opacity+'">'):'')+'</div>'+button('removeAnnotation','data-index="'+i+'"')+'</fieldset>';
  }).join('')+'<div class="inline-actions">'+button('addBoundary',(f.annotations?.length??0)>=64?'disabled':'')+button('addInterval',(f.annotations?.length??0)>=64?'disabled':'')+button('addRegion',(f.annotations?.length??0)>=64||f.x.kind==='category'?'disabled':'')+button('addCallout',(f.annotations?.length??0)>=64?'disabled':'')+'</div></details>';
 }
 function inputEvent(el,f,host){
  if(el.hasAttribute('data-annotation-layout')){
   if(!['auto','key','hidden'].includes(el.value))return true;
   (f.style??={}).annotationLabels=el.value;changed();update(f,host);return true;
  }
  if(el.dataset.annotationField){
   const a=f.annotations?.[Number(el.closest('[data-annotation]')?.dataset.annotation)],key=el.dataset.annotationField;if(!a)return true;
   if(observationAnnotation(a)){a[key]=['xLower','xUpper','yLower','yUpper'].includes(key)?(el.value.trim()===''?null:key[0]==='x'&&f.x.kind==='date'?el.value:Number(el.value)):['dx','dy','pointIndex','opacity'].includes(key)?Number(el.value):el.value;if(key==='seriesId'){a.pointIndex=0;changed();refresh(f.id);}else{changed();update(f,host);}return true;}
   a[key]=['start','end'].includes(key)?(el.value.trim()===''?null:a.axis==='x'&&f.x.kind==='date'?el.value:Number(el.value)):key==='opacity'?Number(el.value):el.value;
   if(key==='axis'){a.start=null;a.end=null;changed();refresh(f.id);return true;}
   changed();update(f,host);return true;
  }
  if(f.kind!=='panels')return false;
  if(el.hasAttribute('data-composition-panel')){selected.set(f.id,el.value);refresh(f.id);return true;}
  if(!el.dataset.compositionField)return false;
  const key=el.dataset.compositionField;
  if(key==='title')f.title=el.value;else if(key==='label')current(f).label=el.value;else f.layout[key]=el.type==='checkbox'?el.checked:Number(el.value);
  changed();update(f,host);return true;
 }
 async function action(el,f){
  const prefix='figure-composition-';if(!el.dataset.action?.startsWith(prefix))return false;
  const name=el.dataset.action.slice(prefix.length);
  if(name==='addRegion'||name==='addCallout'){f.annotations??=[];if(f.annotations.length>=64)return true;f.annotations.push(createObservationAnnotation(name==='addRegion'?'region':'callout',f));
  }else if(name==='addBoundary'||name==='addInterval'){
   f.annotations??=[];if(f.annotations.length>=64)return true;f.annotations.push(createAnnotation(name==='addBoundary'?'boundary':'interval',f.x.kind==='category'?'y':'x'));
  }else if(name==='removeAnnotation')f.annotations.splice(Number(el.dataset.index),1);
  else if(f.kind==='panels'){
   const p=current(f),i=f.panels.indexOf(p);
   if(name==='copy'){
    if(!canRemove(p.figure)||!confirm(tr('replace')))return true;
    const source=selectCopy?await selectCopy():getFigures().find(s=>s.id===el.closest('[data-figure-id]').querySelector('[data-composition-source]').value&&s.kind!=='panels');
    if(!source)return true;await prepare([source]);const copy=cloneFigure(source);copied([[source,copy]]);p.figure=copy;
   }else if(name==='blank'){
    if(f.panels.length>=8)return true;const figure=createFigure();figure.series[0].points=[{x:null,y:null,error:null}];const panel={id:crypto.randomUUID(),label:String.fromCharCode(65+f.panels.length),figure};f.panels.push(panel);selected.set(f.id,panel.id);
   }else if(name==='remove'){if(f.panels.length<=2||!canRemove(p.figure)||!confirm(tr('removeConfirm')))return true;f.panels.splice(i,1);}
   else if(name==='up'&&i>0)[f.panels[i-1],f.panels[i]]=[p,f.panels[i-1]];
   else if(name==='down'&&i<f.panels.length-1)[f.panels[i+1],f.panels[i]]=[p,f.panels[i+1]];
  }
  changed();refresh(f.id);return true;
 }
 return {view,annotations,input:inputEvent,action};
}
