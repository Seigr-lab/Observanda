import {clockSynchronizationContextText} from './measurement-clock-context.js';
import {t} from './i18n/index.js';
import {materialSourcePicker} from './material-source-picker.js';
import {materialReference} from './material-reference.js';
import {NUMBER_REPRESENTATIONS,numeralUsesRadix} from './numeral-context.js';
import {CLOCK_SYNCHRONIZATION_STATUS_NAMESPACE,CLOCK_SYNCHRONIZATION_STATUSES} from './measurement-clock-synchronization-model.js';
import {isScalarRepresentation} from './measurement-model.js';
import {datasetResourcePolicyControls,readDatasetResourcePolicy,datasetResourcePolicyDescription} from './dataset-resource-policy-ui.js';
import {defaultDatasetResourcePolicy} from './dataset-resource-policy.js';
import {measurementClockDescription} from './measurement-clock-ui.js';
import {intervalUncertaintyView} from './measurement-interval-ui.js';
import {measurementUnitDescription} from './measurement-unit-ui.js';
import {scalarSpellingView,scalarSpellingInput,readScalarSpelling,wireScalarFields} from './measurement-scalar-ui.js';
import {computationLabel} from './measurement-computation.js';
import {domainDescription} from './measurement-domain-ui.js';
export const synchronizationText=(key,args)=>t('measurements','sync-'+key,args);
const text=synchronizationText;
const location=s=>text('cell',{page:s.selector.page+1,row:s.selector.row+1,column:s.selector.column+1,revision:s.ref.revision.slice(0,12)});
export function clockSynchronizationStatusDisplay(value,format){
 const definition=value?.format==='domain-value'?value.definition:format?.domain,code=value?.format==='domain-value'?value.original:typeof value==='string'?value:value?.text;
 if(definition?.codec!=='observanda.symbol'||definition.codecVersion!==1||definition.namespace!==CLOCK_SYNCHRONIZATION_STATUS_NAMESPACE||!CLOCK_SYNCHRONIZATION_STATUSES.includes(code))return null;
 return text('status-'+code)+' ['+code+']';
}
export function clockSynchronizationLineageView(value,{esc}){
 if(value?.version!==2||!CLOCK_SYNCHRONIZATION_STATUSES.includes(value.status))return '';const status=value.outputExcluded===true?text('piecewise-outputExcluded'):text('status-'+value.status),brackets=value.bracket??[],selected=value.segment;
 const message=selected&&Number.isSafeInteger(selected.position)&&selected.position>=0?text('piecewise-lineageSegment',{segment:selected.position+1,bracket:brackets.length===2&&brackets.every(item=>Number.isSafeInteger(item.position)&&item.position>=0)?text('piecewise-lineageBracket',{lower:brackets[0].position+1,upper:brackets[1].position+1}):text('piecewise-lineageNoBracket'),status}):text('piecewise-lineageNoSegment',{status});
 return '<p data-clock-synchronization-lineage>'+esc(message)+'</p>';
}
export function clockSynchronizationColumnEligible(column){return isScalarRepresentation(column)&&['elapsed','inferred-elapsed','external'].includes(column.time?.kind)&&(!column.time.clock||column.time.clock.wrap==='none'&&column.time.clock.reset==='none');}
export function clockSynchronizationCellPreview(row,column,index=0){
 const value=row.cells[index],kind=row.valueKinds?.[index];
 if(['null','absent','missing'].includes(kind))return text(kind);
 if(typeof value==='string')return column.missing?.some(item=>item.value===value)?text('missing')+' ['+value+']':value.length>256?value.slice(0,256)+'...':value;
 if(value?.format==='domain-value')return clockSynchronizationStatusDisplay(value)??domainDescription(value.definition);
 if(['domain-preview','scalar-preview'].includes(value?.format))return value.text+(value.complete?'':'...');
 return text('retainedValue');
}
export function clockSynchronizationAnchorEligible(row,column,index=0){return clockSynchronizationColumnEligible(column)&&!row.excluded&&!['null','absent','missing'].includes(row.valueKinds?.[index])&&!column.missing?.some(item=>item.value===row.cells[index]);}
export function clockSynchronizationDescription(value,{esc,prefix='synchronization.'}={}){
 if(!value)return '';
 if(value.version===2)return '<section data-clock-synchronization-context><h3>'+esc(text('title'))+'</h3><p>'+esc(clockSynchronizationContextText(value))+'</p></section>';
 const scalar=key=>{const q=value.validity[key];return scalarSpellingView(q.spelling,{esc,field:prefix+'validity.'+key+'.spelling'})+' ('+esc(q.representation)+', '+esc(text('base'))+' '+q.radix+')';};
 return '<section data-clock-synchronization-context><h3>'+esc(text('title'))+'</h3><p>'+esc(text('publicMethod'))+'</p><dl><dt>'+esc(text('validity'))+'</dt><dd>'+scalar('lower')+' &ndash; '+scalar('upper')+'</dd>'+(value.epoch?'<dt>'+esc(text('targetEpoch'))+'</dt><dd>'+esc(value.epoch)+'</dd>':'')+'</dl></section>';
}
function targetDescription(value,{esc,prefix=''}){
 const time=value.time??{},clock=time.clock,q=value.quantity??{},label=key=>t('measurements',key),rows=[['targetUnit',value.unit],['targetTime',time.kind],['targetReference',time.reference],['targetEpoch',clock?.epoch]],details=[['origin',q.origin],['time-resolution',time.resolution],['time-uncertainty',time.uncertainty],...(clock?['width','frequency','ordering','wrap','reset'].map(key=>[key,clock[key]]):[])];
 return '<dl>'+rows.map(([key,value])=>'<dt>'+esc(text(key))+'</dt><dd>'+esc(value??'')+'</dd>').join('')+details.filter(([,value])=>value!==undefined&&value!==null&&value!=='').map(([key,value])=>'<dt>'+esc(label(key))+'</dt><dd>'+esc(value)+'</dd>').join('')+'</dl>'+measurementUnitDescription(q.unitDefinition,{esc,path:prefix+'quantity.unitDefinition'})+measurementClockDescription(clock?.definition,{esc,path:prefix+'time.clock.definition'})+intervalUncertaintyView(q.uncertainty,{esc,path:prefix+'quantity.uncertainty'});
}
export function clockSynchronizationView(value,{esc,button}){
 if(!value)return '';
 if(value.version===2)return '<section data-clock-synchronization-view><p>'+esc(text('publicSegmentedMethod'))+'</p><p>'+esc(value.rationale)+'</p></section>';
 return '<section data-clock-synchronization-view>'+(computationLabel(value)?'<p>'+esc(computationLabel(value))+'</p><p>'+esc(t('measurements','approximationHelp'))+'</p>':'')+clockSynchronizationDescription({...value,epoch:value.target.time.clock?.epoch},{esc,prefix:''})+'<p>'+esc(text('help'))+'</p>'+targetDescription(value.target,{esc,prefix:'target.'})+'<dl><dt>'+esc(text('rationale'))+'</dt><dd>'+esc(value.rationale)+'</dd></dl>'+'<ol>'+value.anchors.map((pair,index)=>'<li><strong>'+esc(text('anchor',{number:index+1}))+'</strong>'+['source','reference'].map(side=>'<p>'+esc(text(side))+': '+esc(location(pair[side]))+' '+button(esc(text('inspectCell')),'measurement-inspect','data-source="'+esc(JSON.stringify(pair[side]))+'"')+'</p>').join('')+'</li>').join('')+'</ol>'+datasetResourcePolicyDescription(value.resourcePolicy,{esc})+'</section>';
}
// Four pinned cell locators persist independently of browsing. Only the selected
// schema and row pages are held; complete scalar text uses the selected reader.
export function clockSynchronizationUI({call,frame,esc,field,guard,owner,inspect}){
 let element=null,generation=0,controller=null,picker=null,busy=false,source=null,id=null,revision=null,scalarDispose=null,selected=[{},{}],sides={};
 const button=(key,action,attrs='',args)=>'<button type="button" class="button" data-action="material-clock-sync-'+action+'" '+attrs+'>'+esc(text(key,args))+'</button>';
 const input=(key,label,value='',type='text')=>field(esc(text(label)),'<input data-sync="'+key+'" type="'+type+'" value="'+esc(value)+'">');
 const active=()=>element?.isConnected&&document.querySelector('[data-clock-synchronization]')===element;
 function clean(){generation++;controller?.abort();controller=null;picker?.dispose();picker=null;scalarDispose?.();scalarDispose=null;element=null;busy=false;}
 function current(token){guard();if(token!==generation||!active())throw new DOMException('Clock synchronization view changed','AbortError');}
 function setBusy(value){
  busy=value;if(element?.isConnected){element.setAttribute('aria-busy',String(value));element.querySelector('[data-sync-controls]').disabled=value;}
  const status=document.querySelector('[data-sync-status]');if(status){status.hidden=!value;status.textContent=value?text('working'):'';}
  for(const b of document.querySelectorAll('[data-action="material-clock-sync-save"],[data-action="material-clock-sync-back"]'))b.disabled=value;
 }
 const request=(operation,data)=>call(operation,data,{signal:controller.signal,adopt:false,adoptOwner:false});
 const sideRoot=side=>element.querySelector('[data-sync-side="'+side+'"]');
 const scalar=(key,value={spelling:'',representation:'decimal',radix:10},policy=defaultDatasetResourcePolicy())=>'<fieldset data-sync-bound="'+key+'"><legend>'+esc(text(key))+'</legend>'+field(esc(text('spelling')),scalarSpellingInput(value.spelling,{esc,field:'validity.'+key+'.spelling',attributes:'data-sync="'+key+'-spelling"',resourcePolicy:policy}))+field(esc(text('representation')),'<select data-sync="'+key+'-representation">'+NUMBER_REPRESENTATIONS.map(r=>'<option value="'+r+'"'+(r===value.representation?' selected':'')+'>'+esc(r)+'</option>').join('')+'</select>')+input(key+'-radix','base',value.radix,'number')+'</fieldset>';
 const sideHTML=side=>'<fieldset data-sync-side="'+side+'"><legend>'+esc(text(side))+'</legend><div data-sync-columns></div><div data-sync-rows></div><div data-sync-cell-detail></div></fieldset>';
 function anchors(){element.querySelector('[data-sync-anchors]').innerHTML=selected.map((pair,i)=>'<li><strong>'+esc(text('anchor',{number:i+1}))+'</strong>'+['source','reference'].map(side=>'<p>'+esc(text(side))+': '+esc(pair[side]?location(pair[side]):text('notSelected'))+'</p>').join('')+'</li>').join('');}
 function target(){const column=sides.reference.definition,node=element.querySelector('[data-sync-target]');node.innerHTML=column?'<h3>'+esc(text('target'))+'</h3><p>'+esc(text('targetHelp'))+'</p>'+targetDescription(column,{esc}):'<p>'+esc(text('targetMissing'))+'</p>';}

 async function schema(side,offset=0){
  const token=generation,state=sides[side],reference=state.ref,page=await request('schema',{ref:reference,offset,limit:16});current(token);if(reference!==state.ref)return;state.schema=page;
  const host=sideRoot(side).querySelector('[data-sync-columns]');host.innerHTML=field(esc(text('column')),'<select data-sync-column><option value="" disabled'+(state.column===null?' selected':'')+'>'+esc(text('chooseColumn'))+'</option>'+page.items.map((c,i)=>'<option value="'+(page.offset+i)+'"'+(page.offset+i===state.column?' selected':'')+'>'+esc(String(page.offset+i+1)+'. '+c.name+' ['+c.unit+'] - '+c.representation)+'</option>').join('')+'</select>')+button('useColumn','column','data-side="'+side+'"')+'<p>'+esc(text('eligibleHelp'))+'</p><div class="inline-actions">'+(page.offset?button('previousColumns','schema','data-side="'+side+'" data-offset="'+Math.max(0,page.offset-16)+'"'):'')+(page.next!==null?button('nextColumns','schema','data-side="'+side+'" data-offset="'+page.next+'"'):'')+'</div>';
 }
 async function rows(side,page=0){
  const token=generation,state=sides[side],reference=state.ref,column=state.column,data=await request('rows',{ref:reference,page,columnOffset:column});current(token);if(reference!==state.ref||column!==state.column)return;state.rows=data;
  sideRoot(side).querySelector('[data-sync-rows]').innerHTML='<p>'+esc(text('rowPage',{page:page+1,total:data.pages}))+'</p>'+(computationLabel(state.definition)?'<p>'+esc(computationLabel(state.definition))+'</p>':'')+'<div class="material-table"><table><thead><tr><th>'+esc(text('row'))+'</th><th>'+esc(text('spelling'))+'</th><th>'+esc(text('pair'))+'</th></tr></thead><tbody>'+data.rows.map((row,i)=>'<tr><th>'+esc(row.order??row.line??i+1)+'</th><td>'+esc(clockSynchronizationCellPreview(row,state.definition))+(row.excluded?'<p>'+esc(text('excluded'))+'</p>':'')+' '+button('inspectCell','cell','data-side="'+side+'" data-row="'+i+'" data-offset="0"')+'</td><td>'+[0,1].map(anchor=>button('useAnchor','anchor','data-side="'+side+'" data-row="'+i+'" data-anchor="'+anchor+'"'+(clockSynchronizationAnchorEligible(row,state.definition)?'':' disabled'),{number:anchor+1})).join('')+'</td></tr>').join('')+'</tbody></table></div><div class="inline-actions">'+(page?button('previousRows','rows','data-side="'+side+'" data-page="'+(page-1)+'"'):'')+(page+1<data.pages?button('nextRows','rows','data-side="'+side+'" data-page="'+(page+1)+'"'):'')+'</div>';
  sideRoot(side).querySelector('[data-sync-cell-detail]').replaceChildren();
 }
 const cell=(side,row)=>({ref:structuredClone(sides[side].ref),selector:{kind:'cell',page:sides[side].rows.page,row,column:sides[side].column}});
 async function open(reference,{model=null,modelRef=null,title=text('title')}={}){
  clean();source=materialReference(reference);revision=modelRef?materialReference(modelRef):null;id=revision?.id??crypto.randomUUID();selected=model?structuredClone(model.anchors):[{},{}];sides={source:{ref:source,column:model?.source.column??null},reference:{ref:model?structuredClone(model.anchors[0].reference.ref):null,column:model?.anchors[0].reference.selector.column??null}};controller=new AbortController();
  const policy=model?.resourcePolicy??defaultDatasetResourcePolicy();
  frame(text(revision?'revise':'title'),'<div data-clock-synchronization data-scalar-policy-owner="clock-sync" aria-busy="false"><fieldset data-sync-controls><p>'+esc(text('help'))+'</p>'+input('title','name',title)+sideHTML('source')+'<div data-sync-reference-picker><input type="hidden" data-value value=""></div>'+button('loadReference','reference')+sideHTML('reference')+'<h3>'+esc(text('anchors'))+'</h3><ol data-sync-anchors></ol><div data-sync-target></div><fieldset><legend>'+esc(text('validity'))+'</legend><p>'+esc(text('validityHelp'))+'</p><div class="material-fields">'+scalar('lower',model?.validity.lower,policy)+scalar('upper',model?.validity.upper,policy)+'</div></fieldset>'+field(esc(text('rationale')),'<textarea data-sync="rationale" rows="3">'+esc(model?.rationale??'')+'</textarea>')+'<details data-scalar-policy-for="clock-sync"><summary>'+esc(text('resources'))+'</summary><input type="checkbox" data-scalar-policy-enabled checked hidden>'+datasetResourcePolicyControls(policy,{esc,field})+'</details></fieldset></div>','<p data-sync-status role="status" aria-live="polite" hidden></p>'+button('save','save')+button('back','back'));
  element=document.querySelector('[data-clock-synchronization]');anchors();target();picker=materialSourcePicker({root:element.querySelector('[data-sync-reference-picker]'),call,esc,field,guard,recordId:owner(),label:text('referenceDataset'),id:'clock-sync-reference',kind:'dataset',optional:true});
  scalarDispose=wireScalarFields(element,{call:(name,data,options)=>call(name,data,{...options,adopt:false,adoptOwner:false}),reference:node=>node.closest('[data-sync-target]')?{ref:sides.reference.ref,column:sides.reference.column}:{ref:revision},guard,available:()=>!busy,esc});
  const token=generation;setBusy(true);try{
   await schema('source',Math.floor((sides.source.column??0)/16)*16);
   if(model){for(const side of ['source','reference']){if(side==='reference')await schema(side,Math.floor(sides[side].column/16)*16);const state=sides[side],definition=state.schema.items[state.column-state.schema.offset];if(!definition)throw Error(text('chooseColumn'));state.definition=structuredClone(definition);await rows(side,model.anchors[0][side].selector.page);}target();}
  }finally{if(token===generation)setBusy(false);}
 }
 function choose(reference){clean();source=materialReference(reference);const attrs='data-ref="'+esc(JSON.stringify(source))+'"';frame(text('methodChoice'),'<p>'+esc(text('methodChoiceHelp'))+'</p>',button('affineChoice','affine-open',attrs)+'<button type="button" class="button" data-action="material-clock-segments-open" '+attrs+'>'+esc(text('piecewiseChoice'))+'</button>');}
 async function revise(reference){
  const token=++generation;setBusy(true);try{const doc=await call('read',{ref:reference},{adopt:false,adoptOwner:false});guard();if(token!==generation)throw new DOMException('Clock synchronization view changed','AbortError');if(doc.content?.tool!=='Observanda clock synchronization')throw Error(text('graphModelInvalid'));await open(doc.content.source.ref,{model:doc.content,modelRef:reference,title:doc.title});}finally{if(token===generation)setBusy(false);}
 }
 function capture(){
  const get=key=>element.querySelector('[data-sync="'+key+'"]').value,resourcePolicy=readDatasetResourcePolicy(element);
  if(!sides.source.definition||!sides.reference.definition||selected.some(pair=>!pair.source||!pair.reference))throw Error(text('incomplete'));
  const bound=key=>{const representation=get(key+'-representation');return {spelling:readScalarSpelling(element.querySelector('[data-sync="'+key+'-spelling"]'),{validate:true}),representation,radix:numeralUsesRadix(representation)?Number(get(key+'-radix')):10};},reference=sides.reference.definition;
  return {recordId:owner(),id,...(revision?{expectedRevision:revision.revision}:{}),title:get('title'),synchronization:{version:1,method:'two-anchor-affine',source:{ref:source,column:sides.source.column},anchors:structuredClone(selected),validity:{lower:bound('lower'),upper:bound('upper')},target:{unit:reference.unit,...(reference.quantity?{quantity:structuredClone(reference.quantity)}:{}),time:structuredClone(reference.time)},rationale:get('rationale'),resourcePolicy}};
 }
 async function action(act,control){
  if(!act.startsWith('clock-sync-'))return false;guard();if(busy)return true;if(act==='clock-sync-open'){choose(JSON.parse(control.dataset.ref));return true;}if(act==='clock-sync-affine-open'){await open(JSON.parse(control.dataset.ref));return true;}if(act==='clock-sync-revise'){await revise(JSON.parse(control.dataset.ref));return true;}if(!active())return true;
  const token=generation,side=control.dataset.side;if(act==='clock-sync-save'){await scalarDispose?.ready?.();current(token);}setBusy(true);
  try{
   if(act==='clock-sync-back'){const reference=revision??source;clean();await inspect(reference);return true;}
   if(act==='clock-sync-reference'){
    const reference=picker.values()[0];if(!reference)throw Error(text('chooseReference'));const previous=sides.reference;sides.reference={ref:reference,column:null};
    try{await schema('reference');}catch(error){if(token===generation)sides.reference=previous;throw error;}
    for(const pair of selected)delete pair.reference;anchors();target();sideRoot('reference').querySelector('[data-sync-rows]').replaceChildren();sideRoot('reference').querySelector('[data-sync-cell-detail]').replaceChildren();
   }else if(act==='clock-sync-schema')await schema(side,Number(control.dataset.offset));
   else if(act==='clock-sync-column'){
    const state=sides[side],value=sideRoot(side).querySelector('[data-sync-column]').value;if(value==='')throw Error(text('chooseColumn'));
    const column=Number(value),definition=state.schema.items[column-state.schema.offset];if(!definition)throw Error(text('chooseColumn'));
    const previous={column:state.column,definition:state.definition,rows:state.rows};state.column=column;state.definition=structuredClone(definition);
    try{await rows(side);}catch(error){if(token===generation)Object.assign(state,previous);throw error;}
    for(const pair of selected)delete pair[side];anchors();target();
   }else if(act==='clock-sync-rows')await rows(side,Number(control.dataset.page));
   else if(act==='clock-sync-anchor'){
    const row=Number(control.dataset.row),anchor=Number(control.dataset.anchor),state=sides[side];if(![0,1].includes(anchor)||!state?.rows?.rows[row]||!clockSynchronizationAnchorEligible(state.rows.rows[row],state.definition))throw Error(text('invalidAnchor'));
    const source=cell(side,row),data=await request('measurement-inspect',{source,offset:0});current(token);if(data.value?.presence!=='value'||!isScalarRepresentation(data.value)||data.row?.excluded||data.domain)throw Error(text('invalidAnchor'));
    selected[anchor][side]=source;anchors();
   }else if(act==='clock-sync-cell'){
    const row=Number(control.dataset.row),source=cell(side,row),data=await request('measurement-inspect',{source,offset:Number(control.dataset.offset)});current(token);
    const page=data.textPage??(typeof data.value?.spelling==='string'?{text:data.value.spelling,offset:0,total:data.value.spelling.length,previous:null,next:null}:null),presence=data.value?.presence;
    sideRoot(side).querySelector('[data-sync-cell-detail]').innerHTML=(presence&&presence!=='value'?'<p>'+esc(text(['null','absent','missing'].includes(presence)?presence:'retainedValue'))+'</p>':'')+(data.domain?'<p>'+esc(domainDescription(data.domain.definition))+'</p>':'')+(computationLabel(data.computation??data.column)?'<p>'+esc(computationLabel(data.computation??data.column))+'</p>':'')+(page?'<pre>'+esc(page.text)+'</pre><p>'+esc(text('valuePage',{offset:page.text.length?page.offset+1:0,end:page.offset+page.text.length,total:page.total}))+'</p>'+['previous','next'].map((key,i)=>page[key]==null?'':button(i?'nextValue':'previousValue','cell','data-side="'+side+'" data-row="'+row+'" data-offset="'+page[key]+'"')).join(''):'');
   }else if(act==='clock-sync-save'){const command=capture(),result=await request('clock-synchronization-save',command);current(token);clean();await inspect(result.ref);}
  }finally{if(token===generation)setBusy(false);}return true;
 }
 return {open,revise,action,clean,isOpen:active,isBusy:()=>busy};
}
