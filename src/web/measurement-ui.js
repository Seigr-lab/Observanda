import {publicSpectrumContext} from './dataset-spectrum-model.js';
import {spectrumContextText,spectrumText} from './dataset-spectrum-context.js';
import {coordinateFrameContextText,coordinateFrameLineageView} from './coordinate-frame-context.js';
import {publicCoordinateFrameContext} from './coordinate-frame-schema.js';
import {coordinateFrameText} from './coordinate-frame-ui.js';
import {clockSynchronizationDescription,clockSynchronizationStatusDisplay,clockSynchronizationLineageView} from './clock-synchronization-ui.js';
import {clockSynchronizationContextText} from './measurement-clock-context.js';
import {computationPolicyView,cellComputationView} from './measurement-computation-ui.js';
import {computationLabel,hasApproximateComputation} from './measurement-computation.js';
import {scalarPolicyControls,readScalarPolicy,wireScalarPolicies,scalarPolicyDescription,scalarSpellingInput,readScalarSpelling,scalarSpellingView,wireScalarFields} from './measurement-scalar-ui.js';
import {windowSources,windowText} from './dataset-window-ui.js';
import {numeralClipboardControls,wireNumeralClipboard,copyNumeralClipboard,numeralClipboardText} from './numeral-clipboard-ui.js';
import {validNumeralClipboardValue} from './numeral-clipboard.js';
import {intervalUncertaintyDescription,intervalUncertaintyView} from './measurement-interval-ui.js';
import {clockStatusDisplay,clockOperationText} from './measurement-clock-operation-ui.js';
import {domainDescription,domainComponentPageView} from './measurement-domain-ui.js';
import {measurementClockDescription} from './measurement-clock-ui.js';
import {measurementUnitDescription} from './measurement-unit-ui.js';
import {aggregationInspection} from './dataset-aggregation-ui.js';
import {measurementText as m,provenanceFields,readProvenance,wireProvenance} from './measurement-schema-ui.js';
import {REPRESENTATIONS,MEASUREMENT_ROLES,validMeasurement,isScalarRepresentation} from './measurement-model.js';
import {materialSourcePicker} from './material-source-picker.js';

export function measurementUI({call,frame,esc,field,guard,owner,inspect,notify,download,origin,readOnly=()=>false}){
 let source=null,byteOffset=0,draft=null,title='',dispose=null,picker=null,inspection=null,back=null,editing=null,scalarReference=null,scalarSource=null,generation=0,trail=[],returnTarget=null,saving=false;
 const button=(key,action,data='')=>`<button type="button" class="button" data-action="material-measurement-${action}" ${data}>${esc(m(key))}</button>`;
 const input=(key,value='',type='text')=>field(esc(m(key)),key==='note'?`<textarea data-measurement="note" maxlength="10000" rows="3">${esc(value)}</textarea>`:`<input data-measurement="${key}" type="${type}" maxlength="${({title:300,spelling:8192,unit:100,pointer:2048,nativeId:500})[key]??1000}" value="${esc(value)}">`);
 const select=(key,value,values)=>field(esc(m(key)),`<select data-measurement="${key}">${values.map(v=>`<option value="${v}"${value===v?' selected':''}>${esc(m(v==='radix'?'radixLabel':v))}</option>`).join('')}</select>`);
 const val=k=>document.querySelector('[data-measurement="'+k+'"]').value;
 const clipboardValue=value=>value?.presence==='value'?{spelling:value.spelling,context:{version:1,representation:value.representation,radix:['radix','radix-fraction'].includes(value.representation)?value.radix:10}}:null;
 const copyControls=value=>{const copied=clipboardValue(value);return validNumeralClipboardValue(copied)?numeralClipboardControls({esc,paste:false}).replace('data-numeral-copy','data-action="material-measurement-copy-value" data-value="'+esc(JSON.stringify(copied))+'"'):'';};
 const sourceButton=(value,key='open')=>button(key,'inspect',`data-source="${esc(JSON.stringify(value))}"`);
 const sourceDescription=s=>[m(s.selector.kind),...Object.entries(s.selector).filter(([k])=>k!=='kind').map(([k,v])=>m(k)+': '+(['page','row','column'].includes(k)?v+1:v)),s.ref.revision.slice(0,12)].join(' · ');
 const refButton=r=>`<button type="button" class="button" data-action="material-reference" data-ref="${esc(JSON.stringify(r))}">${esc(r.label??r.kind)} · ${esc(r.revision.slice(0,12))}</button>`;
 const pairs=(values)=>'<dl>'+values.filter(([,v])=>v!==''&&v!==null&&v!==undefined).map(([k,v])=>'<dt>'+esc(m(k))+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>';
 function facts(value,{spelling=true}={}){
  const q=value.quantity??{},time=value.time??{},clock=time.clock,computation=value.computation??value.column?.computation;
  const synchronization=value.synchronization??value.column?.synchronization,coordinateFrame=value.coordinateFrame??value.column?.coordinateFrame,frameContext=publicCoordinateFrameContext(value.column??value);
  const coordinateContext=coordinateFrame?(frameContext?'<p>'+esc(coordinateFrameContextText(frameContext))+'</p>':'')+'<p><strong>'+esc(coordinateFrameText('frameReference'))+'</strong><br>'+refButton(coordinateFrame.frame)+'</p>'+(coordinateFrame.transform?'<p><strong>'+esc(coordinateFrameText('transformReference'))+'</strong><br>'+refButton(coordinateFrame.transform)+'</p>':''):'';
  const spectral=value.spectrum??value.column?.spectrum,spectralContext=spectral?'<details data-spectrum-context><summary>'+esc(spectrumText('methodDetails'))+'</summary><p>'+esc(spectrumContextText(publicSpectrumContext(spectral)))+'</p></details><button type="button" class="button" data-action="material-spectrum-review" data-ref="'+esc(JSON.stringify(spectral.analysis))+'">'+esc(spectrumText('review'))+'</button>':'';
  return spectralContext+coordinateContext+(synchronization?(synchronization.version===2?'':'<p>'+esc(clockSynchronizationContextText(synchronization))+'</p>')+clockSynchronizationDescription(synchronization,{esc}):'')+(hasApproximateComputation(computation)?'<p><strong>'+esc(computationLabel(computation))+'</strong></p><p>'+esc(m('approximationHelp'))+'</p>'+computationPolicyView(computation,{esc})+(computation.recipe?refButton(computation.recipe):''):'')+(spelling?'<dl><dt>'+esc(m(hasApproximateComputation(computation)?'storedComputation':'spelling'))+'</dt><dd>'+scalarSpellingView(value.value.spelling,{esc,field:'value.spelling'})+'</dd></dl>':'')+scalarPolicyDescription(value.resourcePolicy??value.column?.resourcePolicy,{esc})+pairs([['presence',m(value.value.presence)],['representation',m(value.value.representation==='radix'?'radixLabel':value.value.representation)],...(value.value.representation==='domain'?[]:[['radix',value.value.radix]]),['unit',value.value.unit],['origin',m(q.origin??'unspecified')],['time-kind',m(time.kind??'unknown')],...['reference','resolution','uncertainty'].map(k=>['time-'+k,time[k]??'']),...(clock?['width','frequency','ordering','wrap','reset','epoch'].map(k=>[k,['ordering','wrap','reset'].includes(k)?m(clock[k]==='source'?'sourceOrder':clock[k]):clock[k]??'']):[])])+measurementUnitDescription(q.unitDefinition,{esc})+measurementClockDescription(clock?.definition,{esc})+intervalUncertaintyView(q.uncertainty,{esc})+[['conversion',q.conversion],['calibration',q.calibration],['intervalMethodReference',q.uncertainty?.method?.reference],['model',clock?.model],['referenceData',clock?.referenceData]].filter(([,ref])=>ref).map(([key,ref])=>'<p><strong>'+esc(m(key))+'</strong><br>'+refButton(ref)+'</p>').join('');
 }
 function view(value){return `<section class="measurement-details"><h3>${esc(m('heading'))}</h3>${facts(value)}${copyControls(value.value)}${pairs([['decoderVersion',value.decoderVersion],['integrity',m(value.integrity)],['completion',m(value.completion)],['note',value.note]])}<p>${esc(m('integrityHelp'))}</p>${MEASUREMENT_ROLES.some(k=>value.references[k])?'<h4>'+esc(m('references'))+'</h4>':''}${MEASUREMENT_ROLES.filter(k=>value.references[k]).map(k=>`<p>${esc(m(k))}: ${refButton(value.references[k])}</p>`).join('')}<h4>${esc(m('sources'))}</h4><ol>${value.sources.map(s=>'<li>'+esc(sourceDescription(s))+' '+sourceButton(s)+'</li>').join('')}</ol></section>`;}
 function clean(){generation++;dispose?.();dispose=null;picker?.dispose();picker=null;}
 function renderForm(){
  clean();frame(m('heading'),`<div data-scalar-policy-owner="measurement"><p>${esc(m('help'))}</p>${input('title',title)}<div class="material-fields">${field(esc(m('spelling')),scalarSpellingInput(draft.value.spelling,{esc,field:'value.spelling',attributes:'data-measurement="spelling"',resourcePolicy:draft.resourcePolicy}))}${select('presence',draft.value.presence,['value','missing','null','absent','unknown'])}${select('representation',draft.value.representation,REPRESENTATIONS.filter(v=>v!=='domain'))}${input('radix',draft.value.radix,'number')}${input('unit',draft.value.unit)}</div>${scalarPolicyControls(draft.resourcePolicy,{esc,field,kind:'measurement'})}${numeralClipboardControls({esc})}${provenanceFields(draft,{esc,field,extra:true})}${select('integrity',draft.integrity,['unknown','not-checked','verified','failed'])}${select('completion',draft.completion,['unknown','complete','partial'])}${input('note',draft.note)}<p>${esc(m('integrityHelp'))}</p><h3>${esc(m('sources'))}</h3><ol>${draft.sources.map((s,i)=>`<li>${esc(m(s.selector.kind))} · ${esc(s.ref.revision.slice(0,12))} ${button('remove','remove',`data-index="${i}"`)}</li>`).join('')}</ol>${button('addSource','add-source')}<div data-measurement-picker></div><input type="hidden" id="measurement-edited" value="1"></div>`,button('save','save')+button('cancel','back'));
  const element=document.getElementById('material-form'),reference=()=>scalarReference,available=()=>!saving,stop=wireProvenance(element,{call:async(operation,data,options)=>{if(operation==='measurement-scalar'&&data.field==='value.spelling'&&scalarSource&&!editing.expectedRevision){const result=await call('measurement-inspect',{source:scalarSource,offset:data.offset},options);return result.textPage;}return call(operation,data,options);},esc,field,recordId:owner(),guard,reference,available}),policy=wireScalarPolicies(element,'measurement'),clipboard=wireNumeralClipboard(element,{maxLength:65536,resourcePolicy:()=>readScalarPolicy(element.querySelector('[data-scalar-policy-owner=measurement]'),'measurement',{validate:true}),guard,available:()=>available()&&!element.querySelector('[data-measurement=spelling]').readOnly,fields:()=>({spelling:element.querySelector('[data-measurement=spelling]'),representation:element.querySelector('[data-measurement=representation]'),radix:element.querySelector('[data-measurement=radix]')})});dispose=()=>{clipboard();policy();stop?.();};dispose.ready=()=>stop.ready();
 }
 function capture({validate=false}={}){
  title=val('title');draft.value={spelling:readScalarSpelling(document.querySelector('[data-measurement=spelling]'),{validate}),presence:val('presence'),representation:val('representation'),radix:Number(val('radix')),unit:val('unit')};
  const resourcePolicy=readScalarPolicy(document.querySelector('[data-scalar-policy-owner=measurement]'),'measurement',{validate});draft.version=resourcePolicy?2:1;if(resourcePolicy)draft.resourcePolicy=resourcePolicy;else delete draft.resourcePolicy;
  Object.assign(draft,readProvenance(document.getElementById('material-form'),draft,{validate}));
  draft.decoderVersion=document.querySelector('[data-provenance="decoderVersion"]').value;
  for(const role of ['decoder','schema'])draft.references[role]=JSON.parse(document.querySelector('[data-provenance="ref-'+role+'"]').value);
  draft.integrity=val('integrity');draft.completion=val('completion');draft.note=val('note');
 }
 async function start(s){
  const request=++generation,seed=await call('measurement-seed',{source:s});guard();if(request!==generation)return;
  back=()=>open(s,{returning:true});editing={id:crypto.randomUUID(),expectedRevision:null};scalarReference={ref:s.ref,...(s.selector.kind==='cell'?{column:s.selector.column}:{})};scalarSource=structuredClone(s);draft={version:1,...seed,references:Object.fromEntries(MEASUREMENT_ROLES.map(k=>[k,null])),decoderVersion:'',integrity:'unknown',completion:'unknown',note:''};title=m('heading');renderForm();
 }
 async function open(s,{offset=0,lineageOffset=0,lineageLimit=16,sourceOffset=0,componentOffset=0,returning=false}={}){
  if(!returning){if(document.querySelector('[data-measurement-inspection]')){trail.push({source,offset:byteOffset});if(trail.length>32)trail.shift();}else{trail=[];returnTarget=origin();}}
  clean();const request=generation;source=s;byteOffset=offset;frame(m('heading'),'<p role="status">'+esc(m('loading'))+'</p>');
  const data=await call('measurement-inspect',{source:s,offset,lineageOffset,lineageLimit,sourceOffset,componentOffset});guard();if(request!==generation||!document.getElementById('dialog')?.open)return;inspection=data;
  let html='';
  if(data.kind==='cell')html=facts(data,{spelling:!data.textPage})+(data.exact?pairs([[hasApproximateComputation(data.computation??data.column?.computation)?(data.computation??data.column.computation).kind==='approximate'?'exactApproximation':'exactApproximateInputs':'exact',data.exact.numerator+' / '+data.exact.denominator]]):'')+pairs([['rowIdentity',data.row.id],['exclusion',data.row.excluded??'']])+`<h3>${esc(m('surrounding'))}</h3><div class="material-table measurement-surrounding" data-measurement-surrounding><table><thead><tr><th scope="col" aria-label="${esc(m('row'))}">${esc(m('surroundingRow'))}</th><th scope="col">${esc(m('value'))}</th><th scope="col">${esc(m('exclusion'))}</th></tr></thead><tbody>${data.surrounding.map(r=>`<tr><th scope="row">${r.order}</th><td><div class="measurement-surrounding-value">${sourceButton({ref:s.ref,selector:{...s.selector,page:r.page,row:r.row}})}<span>${esc(r.presence!=='value'?m(r.presence):r.value)}</span>${r.presence==='value'?cellComputationView({}, {cellComputations:[r.computation]},0,{esc}):''}</div></td><td>${esc(r.excluded??'')}</td></tr>`).join('')}</tbody></table></div>${data.original?sourceButton(data.original,'original'):''}${data.native?sourceButton(data.native,'native'):''}`;
  else if(data.kind==='bytes')html=`<p>${esc(m('bytesHelp'))}</p><p>${esc(m('range',{offset:data.offset,end:data.offset+data.length-1,total:data.total,context:data.contextOffset}))}</p><pre>${esc(data.hex)}</pre><pre>${esc(data.text)}</pre>${button('downloadSlice','download-slice')}${data.previous!==null?button('previous','previous'):''}${data.next!==null?button('next','next'):''}`;
  else if(data.kind==='json-pointer')html=`<p>${esc(m('jsonHelp'))}</p><p>${esc(data.pointer)}</p>${data.textPage?'':'<pre>'+esc(data.text)+'</pre>'}`;
  else if(data.kind==='unresolved')html='<p>'+esc(m('unresolved'))+'</p><pre>'+esc(data.nativeId)+'</pre>';
  else html=refButton(s.ref);
  if(data.textPage)html+='<pre>'+esc(data.textPage.text)+'</pre><p>'+String(data.textPage.offset+1)+' - '+String(data.textPage.offset+data.textPage.text.length)+' / '+String(data.textPage.total)+'</p>'+(data.previous!==null?button('previousValue','previous'):'')+(data.next!==null?button('nextValue','next'):'');
  if(data.domain){const page=data.domain,status=clockSynchronizationStatusDisplay(data.textPage?.text,{domain:page.definition})??clockStatusDisplay(data.textPage?.text,{domain:page.definition});if(status)html+='<p>'+esc(status)+'</p>';html+='<h3>'+esc(domainDescription(page.definition))+'</h3>'+scalarPolicyDescription(page.definition.resourcePolicy,{esc})+(page.supported?'<p>Exact declared components; no magnitude or order is inferred.</p>':'<p>This codec version is preserved without semantic interpretation.</p>')+domainComponentPageView(page,{esc});}
  if(data.aggregation)html+=aggregationInspection(data,{esc,sourceButton,button});
  if(data.lineage){const page=data.lineage;html+='<h3>'+esc(m('sources'))+'</h3><p>'+esc(String(page.offset+1)+' - '+String(page.offset+page.items.length)+' / '+String(page.total))+'</p><ol>'+page.items.map((item,index)=>'<li>'+esc('Input '+(item.binding.position+1)+', column '+(item.column+1)+(item.relativeRow===-1?' - '+clockOperationText('previousSource'):''))+clockSynchronizationLineageView(item.synchronization,{esc})+coordinateFrameLineageView(item,{esc})+(item.windowPage?windowSources(item.windowPage,{esc,sourceButton}):item.missing?'<p>Unmatched source row</p>':'<ul>'+item.sources.map(source=>'<li>'+esc(sourceDescription(source))+' '+sourceButton(source)+'</li>').join('')+'</ul>')+(item.windowPage?.previous!==null&&item.windowPage?.previous!==undefined?'<button type="button" class="button" data-action="material-measurement-lineage" data-offset="'+(page.offset+index)+'" data-limit="1" data-source-offset="'+item.windowPage.previous+'">'+esc(windowText('previous'))+'</button>':'')+(item.sourcePage?.next!==null&&item.sourcePage?.next!==undefined?'<button type="button" class="button" data-action="material-measurement-lineage" data-offset="'+(page.offset+index)+'" data-limit="1" data-source-offset="'+item.sourcePage.next+'">'+(item.windowPage?esc(windowText('next')):'More sources for this input')+'</button>':'')+'</li>').join('')+'</ol>'+[page.previous,page.next].map((at,index)=>at===null?'':'<button type="button" class="button" data-action="material-measurement-lineage" data-offset="'+at+'">'+esc(m(index?'next':'previous'))+'</button>').join('');}
  if(data.derivedSources)html+='<h3>'+esc(m('sources'))+'</h3><ol>'+data.derivedSources.map(source=>'<li>'+esc(sourceDescription(source))+' '+sourceButton(source)+'</li>').join('')+'</ol>';
  const copied=data.kind==='cell'&&!data.textPage?clipboardValue(data.value):null;if(validNumeralClipboardValue(copied))html+=numeralClipboardControls({esc,paste:false});
  frame(m('heading'),`<div class="measurement-details" data-measurement-inspection>${html}</div>`,(readOnly()||data.cellReference&&!(data.column?.resourcePolicy&&isScalarRepresentation(data.value))?'':button('retain','retain'))+(s.ref.kind==='artifact'?button('download','download'):'')+button('back','back-source'));
  {const element=document.querySelector('[data-measurement-inspection]'),scalars=wireScalarFields(element,{call,reference:node=>({ref:s.ref,...(node.dataset.scalarComponent!==undefined||node.dataset.scalarPath==='weight.spelling'?{selector:s.selector}:node.dataset.scalarPath?.startsWith('aggregation.values.')?{}:s.selector.kind==='cell'?{column:s.selector.column}:{})}),guard,esc}),clipboard=validNumeralClipboardValue(copied)?wireNumeralClipboard(element,{guard,read:()=>copied}):null;dispose=()=>{scalars();clipboard?.();};}
 }
 async function addSource(){
  await dispose?.ready?.();capture();if(draft.sources.length>=32)throw Error(m('tooMany'));
  const root=document.querySelector('[data-measurement-picker]');root.innerHTML='<div data-picker><input type="hidden" data-value value=""></div>'+select('selector','whole',['whole','cell','bytes','json-pointer','native-record'])+'<div data-selector-fields></div>'+button('add','add')+button('cancel','cancel-source');
  const choose=root.querySelector('[data-measurement="selector"]'),fields=root.querySelector('[data-selector-fields]');
  const update=()=>{fields.innerHTML=choose.value==='cell'?input('page','1','number')+input('row','1','number')+input('column','1','number'):choose.value==='bytes'?input('offset','0','number')+input('length','1','number')+input('nativeId'):choose.value==='json-pointer'?input('pointer'):choose.value==='native-record'?input('nativeId'):'';};choose.onchange=update;update();
  picker=materialSourcePicker({root:root.querySelector('[data-picker]'),call,esc,field,guard,recordId:owner(),label:m('source'),id:'measurement-source'});
  const kinds=()=>{if(!root.isConnected)return;let ref;try{ref=picker.values()[0];}catch{choose.disabled=true;return;}choose.disabled=false;const values=ref.kind==='dataset'?['cell']:ref.kind==='artifact'?['whole','bytes','json-pointer','native-record']:['whole'];choose.innerHTML=values.map(v=>`<option value="${v}">${esc(m(v))}</option>`).join('');update();};
  root.addEventListener('change',event=>{if(event.target.id==='measurement-source')kinds();});await picker.ready;if(root.isConnected)kinds();
 }
 async function action(act,control){
  if(!act.startsWith('measurement-'))return false;
  const key=act.slice(12);guard();
  if(readOnly()&&!['copy-value','inspect','from-artifact','back-source','previous','next','lineage','components','download','download-slice'].includes(key))return true;
  if(saving)return true;
  if(key==='copy-value'){const request=generation;try{await copyNumeralClipboard(JSON.parse(control.dataset.value),navigator.clipboard);guard();if(request===generation&&control.isConnected)notify(numeralClipboardText('copied'));}catch(error){if(request===generation&&control.isConnected)notify(numeralClipboardText(error.code==='NUMERAL_CLIPBOARD_INVALID'?'invalid':'unavailable'),true);}return true;}
  if(key==='components')await open(source,{offset:byteOffset,componentOffset:Number(control.dataset.offset),returning:true});
  if(key==='lineage')await open(source,{offset:byteOffset,lineageOffset:Number(control.dataset.offset),lineageLimit:Number(control.dataset.limit??16),sourceOffset:Number(control.dataset.sourceOffset??0),returning:true});
  if(key==='inspect')await open(JSON.parse(control.dataset.source));
  if(key==='retain')await start(source);
  if(key==='from-artifact')await open({ref:JSON.parse(control.dataset.ref),selector:{kind:'whole'}});
  if(key==='back-source'){const previous=trail.pop();if(previous)await open(previous.source,{offset:previous.offset,returning:true});else await inspect(returnTarget?.ref??source.ref,{atPage:returnTarget?.page??0,comparisonView:returnTarget?.comparisonView});}
  if(key==='back'){clean();await back();}
  if(key==='remove'){await dispose?.ready?.();capture();draft.sources.splice(Number(control.dataset.index),1);renderForm();}
  if(key==='add-source')await addSource();
  if(key==='cancel-source'){picker?.dispose();picker=null;document.querySelector('[data-measurement-picker]').replaceChildren();}
  if(key==='add'){
   const ref=picker.values()[0],kind=val('selector');let selector={kind};
   if(kind==='cell')Object.assign(selector,{page:Number(val('page'))-1,row:Number(val('row'))-1,column:Number(val('column'))-1});
   if(kind==='bytes')Object.assign(selector,{offset:Number(val('offset')),length:Number(val('length')),...(val('nativeId')?{nativeId:val('nativeId')}:{})});
   if(kind==='json-pointer')selector.pointer=val('pointer');if(kind==='native-record')selector.nativeId=val('nativeId');
   await call('measurement-inspect',{source:{ref,selector}});guard();draft.sources.push({ref,selector});renderForm();
  }
  if(key==='save'){
   const current=document.getElementById('material-form'),request=generation;await dispose?.ready?.();guard();if(request!==generation||current!==document.getElementById('material-form')||!current.isConnected)throw new DOMException('Measurement editor changed','AbortError');capture({validate:true});if(!title.trim()||!validMeasurement(draft))throw Error(m('invalid'));control.disabled=true;saving=true;
   try{const result=await call('measurement-save',{recordId:owner(),title,...editing,measurement:draft});guard();clean();await inspect(result.ref);notify(m('saved'));}finally{saving=false;if(control.isConnected)control.disabled=false;}
  }
  if(key==='revise'){const ref=JSON.parse(control.dataset.ref),doc=await call('read',{ref});guard();draft=structuredClone(doc.content.measurement);title=doc.title;editing={id:ref.id,expectedRevision:ref.revision};scalarReference={ref};scalarSource=null;back=()=>inspect(ref);renderForm();}
  if(key==='previous'||key==='next')await open(source,{offset:inspection[key],returning:true});
  if(key==='download')download(source.ref);
  if(key==='download-slice'){
   const bytes=Uint8Array.from(atob(inspection.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),a=document.createElement('a');a.href=url;a.download='bytes-'+inspection.offset+'-'+inspection.length+'.bin';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return true;
 }
 function wireView(element,reference){return wireScalarFields(element,{call,reference:()=>({ref:reference}),guard,esc});}
 return {action,view,wireView,sourceButton,clean,isBusy:()=>saving};
}
