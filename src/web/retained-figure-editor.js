import {defaultMarkerArea} from './figure-marker-area.js';
import {authoredFigureProperties,authoredFigureAddition} from './retained-figure-authoring-controls.js';
import {t} from './i18n/index.js';
import {escapeFigureText as esc} from './retained-figure-text.js';
import {figureStyle,seriesStyle} from './figure-style.js';
import {retainedFigureReader} from './retained-figure-reader.js';
import {retainedFigureProperties} from './retained-figure-properties.js';
import {validRetainedFigure} from './retained-figure-model.js';
import {validFigureSource} from './figure-provenance.js';
import {retainedAnnotationCreation,updateRetainedAnnotationCreation,readRetainedAnnotation,retainedCalloutTargetControls,readRetainedCalloutTarget,retainedThresholdProperties,retainedThresholdScalar} from './retained-figure-annotation-ui.js';
const text=(key,args)=>t('retainedFigureEditor',key,args);
const get=(value,path)=>path.split('.').reduce((value,key)=>value?.[key],value);
const patch=(path,value)=>path.split('.').reverse().reduce((value,key)=>({[key]:value}),value);
const button=(key,action,disabled=false)=>'<button type="button" class="button" data-fe="'+action+'"'+(disabled?' disabled':'')+'>'+esc(text(key))+'</button>';
const field=(label,control)=>'<label class="field">'+esc(label)+control+'</label>';
// One presentation member and one text range are edited at a time. The host
// checkpoints the returned descriptor using its ordinary selected-value draft.
export function retainedFigureEditor({root,figure,request,change,downloadURL,adopt,context,busyChanged=()=>{},notifyPending=()=>{},authoring=null}){
 const token=context(),controller=new AbortController();let stopped=false,loading=false,pending=false,reader=null,ref=authoring?{revision:authoring.revision()}:figure.source,part='figure',panelPosition=0,position=0,panelCount=0,count=0,plotId=null,item=null,header=null,top=null,property='',properties=[],textOffset=0,textLimit=4096,textLength=0,textTotal=0,textNext=null,textHistory=[],loaded=false,active=null,mutation=null,creating=null,seriesPosition=0,seriesId=null,seriesCount=0,queuedChange=null;
 const guard=()=>{controller.signal.throwIfAborted();if(stopped||token!==context()||!root.isConnected)throw new DOMException('Figure editor closed','AbortError');};
 const call=async(operation,extra={})=>{guard();const expected=ref,reply=await (authoring?authoring.read({operation,...extra},{signal:controller.signal}):request({ref:expected,expectedRevision:expected.revision,operation,...extra},{signal:controller.signal}));guard();if(ref!==expected||reply.revision!==expected.revision)throw Error(text('changed'));return reply;};
 const selected=()=>part==='figure'?{collection:'header',id:top.header.id}:['plot','thresholds'].includes(part)?{collection:'header',id:plotId,plotId}:{collection:part,id:item?.id,...(part==='panels'?{}:{plotId})};
 const textField=()=>part==='thresholds'?'heatmap.thresholds.'+position+'.'+property:property;
 const value=()=>part==='figure'?top.header:part==='plot'?header:part==='thresholds'?header.heatmap.thresholds[position]:item?.value;
 function reconcile(){if(!authoring||authoring.revision()===ref.revision)return false;if(pending||mutation)throw Error(text('changed'));ref={revision:authoring.revision()};figure=authoring.figure?.()??figure;loaded=false;return true;}
 const report=error=>{if(error.name!=='AbortError'&&!stopped&&root.querySelector('[data-fe-status]'))root.querySelector('[data-fe-status]').textContent=error.message;};
 function busy(value){loading=value;if(stopped)return;root.setAttribute('aria-busy',String(value));root.querySelectorAll('button,input,select,textarea').forEach(node=>{if(value){if(node.dataset.feDisabled===undefined)node.dataset.feDisabled=String(node.disabled);node.disabled=true;}else if(node.dataset.feDisabled!==undefined){node.disabled=node.dataset.feDisabled==='true';delete node.dataset.feDisabled;}});busyChanged();}

 function setPending(value){if(pending===value)return;pending=value;if(!stopped)notifyPending(value);}
 const snapshot=()=>({ref,part,panelPosition,position,panelCount,count,plotId,item,header,top,property,properties,textOffset,textLimit,textLength,textTotal,textNext,textHistory:[...textHistory],loaded,creating,seriesPosition,seriesId,seriesCount});
 function restore(saved){({part,panelPosition,position,panelCount,count,plotId,item,header,top,property,properties,textOffset,textLimit,textLength,textTotal,textNext,textHistory,loaded,creating,seriesPosition,seriesId,seriesCount}=saved);for(const [selector,value]of [['part',part],['property',property],['panel',panelPosition+1],['position',position+1]]){const node=root.querySelector('[data-fe-'+selector+']');if(node)node.value=value;}}
 function invalidate(){if(stopped)return;loaded=false;reader?.dispose();reader=null;root.innerHTML=button(mutation?'retry':'reload','reload')+'<p role="status" data-fe-status></p>';}
 function run(operation){
  if(active)return active;
  const task=Promise.resolve().then(async()=>{guard();busy(true);const saved=snapshot();try{await operation();}catch(error){if(!stopped){if(ref===saved.ref&&!mutation&&saved.loaded)restore(saved);else invalidate();}throw error;}finally{busy(false);}});
  active=task;const clear=()=>{if(active===task)active=null;};task.then(clear,clear);return task;
 }
 function controls(){
  const source=part==='points'?item?.value?.source?.origin?.ref:figure.source;
  const parts=['figure','panels','plot','series',...(authoring?['points']:[]),...(header?.kind==='heatmap'?['thresholds']:['annotations','ticks'])];
  root.innerHTML='<p>'+esc(text(authoring?'authoringHelp':'help'))+'</p>'+field(text('area'),'<select data-fe-part>'+parts.map(key=>'<option value="'+key+'"'+(key===part?' selected':'')+(!plotId&&!['figure','panels'].includes(key)?' disabled':'')+'>'+esc(text(key))+'</option>').join('')+'</select>')+
   '<div class="inline-actions">'+field(text('panel'),'<input type="number" data-fe-panel min="1" max="'+panelCount+'" value="'+(panelPosition+1)+'"'+(!panelCount?' disabled':'')+'>')+button('go','panel',!panelCount)+'</div>'+
   (part==='points'?'<div class="inline-actions">'+field(text('seriesPosition'),'<input type="number" data-fe-series min="1" max="'+seriesCount+'" value="'+(seriesPosition+1)+'"'+(!seriesCount?' disabled':'')+'>')+button('go','series',!seriesCount)+'</div>':'')+
   (['panels','series','points','annotations','ticks','thresholds'].includes(part)?'<div class="inline-actions">'+field(text('position'),'<input type="number" data-fe-position min="1" max="'+Math.max(count,1)+'" value="'+(position+1)+'"'+(!count?' disabled':'')+'>')+button('go','position',!count)+button('previous','previous',!count||!position)+button('next','next',position+1>=count)+'</div><p>'+esc(text('range',{position:count?position+1:0,total:count}))+'</p>':'')+
   (source?'<button type="button" class="button" data-action="material-figure-source" data-ref="'+esc(JSON.stringify(source))+'">'+esc(text('inspectOriginal'))+'</button>':'')+'<div data-fe-fields></div><div class="inline-actions">'+(['panels','series','points','annotations','ticks'].includes(part)?button('moveEarlier','move-earlier',!count||position===0)+button('moveLater','move-later',!count||position+1===count):'')+
   (['annotations','ticks',...(authoring?['points','series','panels']:[])].includes(part)?button('add','add',authoring&&part!=='panels'&&(!plotId||part==='points'&&!seriesId))+button('remove','remove',!count):'')+'</div>'+button('preview','preview')+'<div data-fe-preview></div><p role="status" data-fe-status></p>';
 }
 async function load(){
  top=await call('open');const panels=await call('window',{selection:{collection:'panels',offset:panelPosition,limit:1}});panelCount=panels.total;plotId=panels.items[0]?.plotId??null;if(!plotId&&!authoring)throw Error(text('rangeError'));
  header=plotId?(await call('header',{selection:{plotId}})).header:top.header;item=null;count=0;if(header.kind==='heatmap'&&['annotations','ticks'].includes(part)||header.kind!=='heatmap'&&part==='thresholds'){part='plot';property='';}
  if(part==='thresholds')count=header.heatmap.thresholds.length;
  if(part==='points'){const series=plotId?await call('window',{selection:{collection:'series',plotId,offset:seriesPosition,limit:1}}):{total:0,items:[]};seriesCount=series.total;seriesId=series.items[0]?.id??null;}
  if(!['figure','plot','thresholds'].includes(part)&&(plotId||part==='panels')&&(part!=='points'||seriesId)){const page=await call('window',{selection:{collection:part,...(part==='panels'?{}:{plotId}),...(part==='points'?{seriesId}:{}),offset:position,limit:1}});count=page.total;item=page.items[0]??null;}
  const markup=await fieldMarkup();reader?.dispose();reader=null;controls();root.querySelector('[data-fe-fields]').innerHTML=markup;updateRetainedAnnotationCreation(root,header);loaded=true;busy(true);
 }
 async function fieldMarkup(){
  const actions='<div class="inline-actions">'+button('apply','apply')+button('reset','reset')+'</div>';
  if(creating)return retainedAnnotationCreation(header)+actions;
  properties=part==='points'?authoredFigureProperties(part,value(),header):part==='thresholds'?retainedThresholdProperties(header,position):retainedFigureProperties(part,value(),header);if(authoring&&['figure','plot'].includes(part))properties=[...properties,...authoredFigureProperties(part,value(),header)];if(part==='annotations'&&value()?.kind==='callout')properties.push({path:'target',type:'target',label:'calloutTarget'});if(!properties.some(p=>p.path===property))property=properties[0]?.path??'';
  if(!property)return '<p>'+esc(text('empty'))+'</p>';
  const definition=properties.find(p=>p.path===property),source=value(),actual=get(source,property),defaults=property.startsWith('style.')?(part==='series'?seriesStyle(source):figureStyle(source))[property.slice(6)]:undefined;
  let current=actual??defaults??(definition.type==='boolean'?false:'');
  if(definition.type==='text'){
   const result=actual===null?{text:'',total:0}:await call('text',{selection:{...selected(),field:textField(),offset:textOffset,limit:textLimit}});current=result.text;textTotal=result.total;
   if(/[\uD800-\uDBFF]$/.test(current)&&textOffset+current.length<textTotal){current+=(await call('text',{selection:{...selected(),field:textField(),offset:textOffset+current.length,limit:1}})).text;}
   textLength=current.length;textNext=textOffset+textLength<textTotal?textOffset+textLength:null;
  }

  let target='';if(definition.type==='target'){const series=(await call('item',{selection:{collection:'series',plotId,id:source.seriesId}})).item;if(!series)throw Error(text('rangeError'));target=retainedCalloutTargetControls({seriesPosition:series.position,pointPosition:source.pointIndex});}
  let input=definition.type==='target'?target:definition.type==='text'?'<textarea data-fe-value rows="5" maxlength="16384">'+esc(current)+'</textarea>':definition.options?'<select data-fe-value>'+definition.options.map(v=>'<option value="'+esc(v)+'"'+(String(current)===String(v)?' selected':'')+'>'+esc(text('option_'+v))+'</option>').join('')+'</select>':definition.type==='boolean'?'<input type="checkbox" data-fe-value'+(current?' checked':'')+'>':'<input data-fe-value type="'+(definition.type==='color'?'color':definition.type==='number'?'number':'text')+'"'+(definition.type==='number'?' step="any"':'')+' value="'+esc(current)+'">';
  return field(text('property'),'<select data-fe-property>'+properties.map(p=>'<option value="'+p.path+'"'+(p.path===property?' selected':'')+'>'+esc(text(p.label))+'</option>').join('')+'</select>')+field(text(definition.label),input)+(definition.type==='text'?'<p>'+esc(text('textRange',{start:textTotal?textOffset+1:0,end:textOffset+textLength,total:textTotal}))+'</p><div class="inline-actions">'+button('previous','text-previous',!textOffset)+button('next','text-next',textNext===null)+'</div>':'')+'<div class="inline-actions">'+button('apply','apply')+button('reset','reset')+'</div>';
 }
 async function fields(){const markup=await fieldMarkup();root.querySelector('[data-fe-fields]').innerHTML=markup;updateRetainedAnnotationCreation(root,header);busy(true);}
 async function mutate(operation){
  guard();if(!mutation&&authoring&&authoring.revision()!==ref.revision)throw Error(text('changed'));mutation??={operationId:crypto.randomUUID(),ref:structuredClone(ref),operation:structuredClone(operation)};let result;
  try{result=await (authoring?authoring.change(mutation.operation,{signal:controller.signal,mutationId:mutation.operationId},queuedChange):change(structuredClone(mutation),{signal:controller.signal}));}catch(error){if(['INVALID','MATERIAL_INVALID','MATERIAL_CHANGED'].includes(error.code))mutation=null;throw error;}
  guard();if(authoring){if(!validRetainedFigure(result?.value?.value,{draft:true})||typeof result.revision!=='string')throw Error(text('invalidReply'));figure=result.value.value;ref={revision:result.revision};}else if(!validFigureSource(result?.ref)||!validRetainedFigure(result.figure)||result.figure.document.data.root!==figure.document.data.root||result.figure.document.data.index!==figure.document.data.index)throw Error(text('invalidReply'));
  const committed=mutation.operation;if(!authoring){ref=result.ref;figure={...result.figure,id:figure.id,source:ref};}mutation=null;loaded=false;
  if(committed.collection===part){if(committed.type==='append'){position=count;creating=null;}else if(committed.type==='remove'){position=Math.max(0,position-1);if(part==='panels')panelPosition=Math.min(panelPosition,Math.max(0,count-2));if(part==='series')seriesPosition=Math.min(seriesPosition,Math.max(0,count-2));}else if(committed.type==='move')position+=committed.direction;}
  setPending(false);adopt(figure);
 }
 async function apply(){
  if(mutation){await mutate(mutation.operation);return;}if(!pending)return;if(!loaded)throw Error(text('changed'));
  if(creating){const value=await readRetainedAnnotation(root,{id:creating,header,plotId,call});await mutate({type:'append',collection:'annotations',plotId,value});return;}
  const definition=properties.find(p=>p.path===property),node=root.querySelector('[data-fe-value]');if(!node?.reportValidity())throw Error(text('invalidValue'));
  if(definition.type==='target'){const {seriesId,pointIndex}=await readRetainedCalloutTarget(root,{plotId,call});await mutate({type:'patch',...selected(),patch:{seriesId,pointIndex}});}
  else if(definition.type==='text'){textLimit=Math.max(4096,node.value.length);await mutate(part==='points'&&get(value(),property)===null?{type:'patch',...selected(),patch:{[property]:node.value}}:{type:'text',...selected(),field:textField(),offset:textOffset,remove:textLength,text:node.value});}
  else {const raw=definition.type==='boolean'?node.checked:definition.type==='number'?(node.value===''?null:Number(node.value)):node.value;if(definition.type==='number'&&raw!==null&&!Number.isFinite(raw))throw Error(text('invalidValue'));await mutate(part==='thresholds'?{...retainedThresholdScalar(header,position,property,raw),...selected()}:{type:'patch',...selected(),patch:authoring&&property==='markerArea'?{markerArea:raw?defaultMarkerArea():null}:patch(property,raw)});}
 }
 async function act(action){
  if(loading)return;if(pending&&!['apply','reset','reload','preview'].includes(action))throw Error(text('applyFirst'));return run(async()=>{
   if(action==='apply'){await apply();await load();return;}
   if(action==='reset'){creating=null;setPending(false);if(reconcile())await load();else await fields();return;}
   if(action==='reload'){if(mutation)await mutate(mutation.operation);else reconcile();await load();return;}
   if(action==='text-next'){textHistory.push(textOffset);textOffset=textNext;await fields();return;}
   if(action==='text-previous'){textOffset=textHistory.pop()??0;await fields();return;}
   if(action==='preview'){if(authoring){await apply();const finished=await authoring.finish({signal:controller.signal},queuedChange);guard();if(!validRetainedFigure(finished?.value?.value)||typeof finished.revision!=='string')throw Error(text('invalidReply'));figure=finished.value.value;ref={revision:finished.revision};if(!loaded)await load();}reader?.dispose();reader=retainedFigureReader({root:root.querySelector('[data-fe-preview]'),request:(body,options)=>authoring?authoring.read(body,options):request({ref,...body},options),...(authoring?{}:{downloadURL:(format,revision)=>downloadURL(ref,format,revision)})});await reader.ready;return;}
   if(action==='series'){const next=Number(root.querySelector('[data-fe-series]').value)-1;if(!Number.isSafeInteger(next)||next<0||next>=seriesCount)throw Error(text('rangeError'));seriesPosition=next;position=0;}
   else if(action==='panel'){const next=Number(root.querySelector('[data-fe-panel]').value)-1;if(!Number.isSafeInteger(next)||next<0||next>=panelCount)throw Error(text('rangeError'));panelPosition=next;position=0;}
   else if(['position','previous','next'].includes(action)){const next=action==='position'?Number(root.querySelector('[data-fe-position]').value)-1:position+(action==='next'?1:-1);if(!Number.isSafeInteger(next)||next<0||next>=count)throw Error(text('rangeError'));position=next;}
   else if(action==='remove'){const node=root.querySelector('[data-fe="remove"]');if(node.dataset.confirm!=='true'){node.dataset.confirm='true';node.textContent=text('confirmRemove');return;}await mutate({type:'remove',...selected()});}
   else if(action.startsWith('move-')){const direction=action==='move-earlier'?-1:1;await mutate({type:'move',...selected(),direction});}
   else if(action==='add'){
    const manual=authoring?authoredFigureAddition(part,{plotId,seriesId}):null;if(manual){await mutate(manual);if(part==='panels')panelPosition=position;await load();return;}
    if(part==='annotations'){creating=crypto.randomUUID();await fields();setPending(true);return;}
    const value=part==='ticks'?{axis:'y',value:0,label:text('newTick')}:{id:crypto.randomUUID(),kind:'boundary',axis:'y',start:0,end:null,label:text('newAnnotation'),color:'#92549f',opacity:.15};
    await mutate({type:'append',collection:part,plotId,value});
   }
   textOffset=0;textHistory=[];await load();
  });
 }
 const click=event=>{const node=event.target.closest('[data-fe]');if(!node||!root.contains(node)||node.disabled)return;event.preventDefault();event.stopPropagation();void act(node.dataset.fe).catch(report);};
 const input=event=>{const node=event.target;if(node.hasAttribute('data-fe-value')){event.stopPropagation();if(!loading&&loaded){if(creating&&['kind','axis'].includes(node.dataset.feKey))updateRetainedAnnotationCreation(root,header);if(pending)notifyPending(true);else setPending(true);}} };
 const choose=async event=>{const node=event.target;if(!node.matches('[data-fe-part],[data-fe-property]')||loading)return;event.stopPropagation();const old=node.hasAttribute('data-fe-part')?part:property;if(pending){node.value=old;report(Error(text('applyFirst')));return;}try{await run(async()=>{if(node.hasAttribute('data-fe-part')){part=node.value;position=0;property='';}else property=node.value;textOffset=0;textHistory=[];await load();});}catch(error){report(error);}};
 root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',choose);
 const ready=run(load).catch(report);
 async function checkpoint({change:withinQueue}={}){
  const previousChange=queuedChange;if(withinQueue)queuedChange=withinQueue;try{
  const node=document.activeElement,focus=node&&root.contains(node)&&node.matches('[data-fe-value]')?{selection:JSON.stringify(selected()),property,offset:textOffset,start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection,key:node.dataset.feKey??null}:null;
  if(active)await active.catch(()=>{});guard();if(!mutation)reconcile();if(!pending&&!mutation&&loaded)return;
  await run(async()=>{await apply();if(!loaded)await load();});
  if(focus&&loaded&&focus.selection===JSON.stringify(selected())&&focus.property===property&&focus.offset===textOffset){guard();const current=root.querySelector(focus.key?'[data-fe-key="'+focus.key+'"]':'[data-fe-value]');current?.focus({preventScroll:true});if(current&&typeof focus.start==='number')current.setSelectionRange(focus.start,focus.end,focus.direction);}
  }finally{queuedChange=previousChange;}
 }
 return {ready,selection:()=>({plotId,seriesId,part,kind:top?.header.kind}),isBusy:()=>loading,hasPending:()=>pending||!!mutation,checkpoint,async validate(){try{await checkpoint();return true;}catch(error){report(error);return false;}},release(){stopped=true;controller.abort();reader?.dispose();root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',choose);}};
}
