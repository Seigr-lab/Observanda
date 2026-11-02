import {retryModule} from './retry-module.js';
import {equationTarget,renderedMath,templates,templateSource} from './website-equation-math.js';
import {equationStructures} from './website-equation-structures.js';

const renderer=retryModule(()=>import('./vendor/equations.js'),'/vendor/equations.js');
const symbols=[['π','\\pi '],['α','\\alpha '],['β','\\beta '],['θ','\\theta '],['Δ','\\Delta '],['∞','\\infty '],['±','\\pm '],['×','\\times '],['÷','\\div '],['≤','\\le '],['≥','\\ge '],['≠','\\ne '],['≈','\\approx '],['∑','\\sum '],['∫','\\int '],['∂','\\partial ']];
export async function editWebsiteEquation({doc,at,t,apply,current=()=>true}){
 let target;try{target=equationTarget(doc,at);}catch{throw Error(t('equationProtected'));}
 const {renderEquation}=await renderer(),host=document,dialog=host.createElement('dialog');
 if(!current())return;
 dialog.className='website-author-dialog website-equation-dialog';
 dialog.setAttribute('aria-label',t('equationEdit'));
 if(!host.querySelector('link[data-equation-composer]')){
  const link=host.createElement('link');link.rel='stylesheet';link.href='/website-files-equation.css';link.dataset.equationComposer='';host.head.append(link);
 }
 const form=host.createElement('form');dialog.append(form);
 const element=(tag,parent,text)=>{const node=host.createElement(tag);if(text!==undefined)node.textContent=text;parent.append(node);return node;};
 const button=(parent,text,action)=>{const b=element('button',parent,text);b.type='button';b.className='button';b.onclick=action;return b;};
 const field=(parent,key,tag='input')=>element(tag,element('label',parent,t(key)));
 element('h2',form,t('equationEdit'));element('p',form,t('equationHelp'));
 const input=field(form,'equationExpression','textarea');input.rows=2;input.maxLength=4000;input.spellcheck=false;input.value=target.source;
 const partsBox=element('div',form),partChoice=field(partsBox,'equationParts','select');
 let parts=[],lastParsed=null;
 button(partsBox,t('equationChangePart'),()=>{const part=parts[Number(partChoice.value)];if(part){active=input;input.setSelectionRange(part.from,part.to);start(part.kind,part);}});
 const tools=element('fieldset',form);element('legend',tools,t('equationStructures'));
 const sizes=element('span',tools),rows=field(sizes,'equationRows'),cols=field(sizes,'equationColumns');
 for(const dimension of [rows,cols]){dimension.type='number';dimension.min='1';dimension.max='12';dimension.value='2';}
 for(const kind of Object.keys(templates))button(tools,t('equation'+kind[0].toUpperCase()+kind.slice(1)),()=>start(kind));
 const palette=element('fieldset',form);element('legend',palette,t('equationSymbols'));
 for(const [glyph,tex] of symbols)button(palette,glyph,()=>{
  if(!active||active.readOnly)return;
  active.setRangeText(active.dataset.words!==undefined?glyph:tex,active.selectionStart,active.selectionEnd,'end');active.focus();refresh();
 });
 const structure=element('div',form),preview=element('div',form);
 preview.className='website-equation-preview';preview.setAttribute('aria-label',t('equationPreview'));preview.setAttribute('role','group');
 const description=field(form,'equationDescription');description.maxLength=1000;description.value=target.label;
 const error=element('p',form);error.setAttribute('role','status');
 const actions=element('div',form);actions.className='inline-actions';const save=element('button',actions,t('equationApply'));save.type='submit';save.className='button primary';
 button(actions,t('cancel'),()=>dialog.close());
 let active=input,levels=[],ready=null;
 function watch(control){control.addEventListener('focus',()=>{active=control;});control.addEventListener('input',refresh);}
 function withSlot(text,level,part){return text.slice(0,level.from)+part+text.slice(level.to);}
 function expanded(placeholders){
  const edits=new Map();
  for(const level of [...levels].reverse()){
   const values=level.fields.map(f=>{const value=edits.get(f)??f.value;if(!value.trim()&&!placeholders)throw TypeError();return value||'\\square';});
   edits.set(level.anchor,withSlot(level.anchor.value,level,templateSource(level.kind,values,level.columns)));
  }
  return edits.get(input)??input.value;
 }
 function refresh(){
  ready=null;preview.replaceChildren();save.disabled=true;
  if(lastParsed!==input.value){
   parts=input.value.length<=4000?equationStructures(input.value):[];lastParsed=input.value;partChoice.replaceChildren();
   for(const [index,part] of parts.entries()){
    const option=element('option',partChoice,t('equation'+part.kind[0].toUpperCase()+part.kind.slice(1))+' · '+input.value.slice(part.from,part.to).slice(0,70));option.value=String(index);
   }
  }
  partsBox.hidden=!!levels.length||!parts.length;
  try{
   const source=expanded(true);if(!source.trim()){error.textContent='';return;}
   const math=renderedMath(host,source,renderEquation);preview.append(math);
   try{expanded(false);ready=math;save.disabled=false;error.textContent='';}
   catch{error.textContent=t('equationSlots');}
  }catch{error.textContent=t('equationInvalid');}
 }
 function finish(level,commit){
  if(levels.at(-1)!==level)return;
  if(commit){
   const empty=level.fields.find(f=>!f.value.trim());if(empty){empty.focus();return;}
   const value=templateSource(level.kind,level.fields.map(f=>f.value),level.columns);
   level.anchor.setRangeText(value,level.from,level.to,'end');
  }
  levels.pop();level.panel.remove();level.anchor.readOnly=false;active=level.anchor;active.focus();refresh();
 }
 function start(kind,part){
  const anchor=active;
  if(!anchor||anchor.readOnly||anchor.dataset.words!==undefined)return;
  let height=1,width=1;
  if(kind==='matrix'){
   width=part?.columns??cols.valueAsNumber;height=part?part.values.length/width:rows.valueAsNumber;
   if(![height,width].every(n=>Number.isInteger(n)&&n>=1&&n<=12)){error.textContent=t('equationDimensions');return;}
  }
  const level={kind,anchor,from:anchor.selectionStart,to:anchor.selectionEnd,columns:width,fields:[],panel:element('fieldset',structure)};
  const selected=anchor.value.slice(level.from,level.to);levels.push(level);anchor.readOnly=true;
  element('legend',level.panel,t('equation'+kind[0].toUpperCase()+kind.slice(1)));
  const slots=element('div',level.panel);slots.className='website-equation-slots website-equation-'+kind;
  if(kind==='matrix')slots.style.setProperty('--equation-columns',String(width));
  const labels=kind==='matrix'?Array.from({length:height*width},(_,i)=>t('equationCell')+' '+(1+Math.floor(i/width))+', '+(1+i%width)):templates[kind].map(key=>t(key));
  for(const label of labels){
   const f=element('input',element('label',slots,label));f.type='text';f.maxLength=4000;f.spellcheck=false;
   if(kind==='text')f.dataset.words='';watch(f);level.fields.push(f);
  }
  if(part)level.fields.forEach((f,i)=>{f.value=part.values[i];});else level.fields[0].value=selected;
  button(level.panel,t('equationUseStructure'),()=>finish(level,true));button(level.panel,t('cancel'),()=>finish(level,false));
  (!part&&selected&&level.fields[1]||level.fields[0]).focus();refresh();
 }
 watch(input);form.onsubmit=e=>{
  e.preventDefault();refresh();if(!ready)return;
  if(!current()){dialog.close();return;}
  target.apply(doc.importNode(ready,true),description.value.trim());dialog.close();apply(doc);
 };
 host.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();input.focus();refresh();
 return dialog;
}
