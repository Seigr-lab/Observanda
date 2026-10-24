import {datasetCalculationGraphUI} from '../src/web/dataset-calculation-graph-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment,serialize} from 'parse5';
import {randomUUID} from 'node:crypto';
import {clockSynchronizationUI,clockSynchronizationLineageView,clockSynchronizationView,clockSynchronizationDescription,clockSynchronizationCellPreview,clockSynchronizationAnchorEligible,clockSynchronizationStatusDisplay} from '../src/web/clock-synchronization-ui.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {defaultColumn} from '../src/web/dataset-schema.js';
import {blankClock} from '../src/web/measurement-model.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,input)=>'<label>'+label+input+'</label>';
const ref=kind=>({kind,id:randomUUID(),revision:'a'.repeat(64),workspaceId:randomUUID()});
const scalar=(spelling,representation='decimal',radix=10)=>({spelling,representation,radix});
const retainedScalar=()=>({format:'dataset-cell',version:1,characters:10000,sha256:'b'.repeat(64),parts:{format:1,kind:'cell-text',count:1,chunkSize:16,root:{count:1,height:1,key:'c'.repeat(64),hash:'d'.repeat(64)}}});
const timeColumn=()=>({...defaultColumn({label:'Elapsed reading'}),representation:'decimal',unit:'ticks',time:{kind:'elapsed',reference:'Declared source',resolution:'',uncertainty:''}});
// A small retained-identity DOM for mocked workbench requests. No browser,
// workspace, database or server is opened by these interaction checks.
function harness(t){
 const old=globalThis.document,cache=new WeakMap(),raw=new WeakMap();let tree=parseFragment('');
 const attrs=node=>Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value]));
 const descendants=node=>(node.childNodes??[]).flatMap(child=>[child,...descendants(child)]);
 const matches=(node,selector)=>selector.split(',').some(raw=>{let s=raw.trim(),a=attrs(node);if(s.startsWith('#'))return a.id===s.slice(1);const m=/^([\w-]+)?(?:\[([^=\]]+)(?:="?([^"\]]*)"?)?\])?$/.exec(s);return !!m&&(!m[1]||node.nodeName===m[1])&&(!m[2]||Object.hasOwn(a,m[2])&&(m[3]===undefined||a[m[2]]===m[3]));});
 function wrap(node){
  if(cache.has(node))return cache.get(node);const listeners=new Map(),a=attrs(node);let value=a.value;
  const out={get isConnected(){return node===tree||descendants(tree).includes(node);},get dataset(){return Object.fromEntries(Object.entries(attrs(node)).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v]));},
   get value(){if(value!==undefined)return value;if(node.nodeName==='select'){const options=descendants(node).filter(child=>child.nodeName==='option'),selected=options.find(child=>Object.hasOwn(attrs(child),'selected'))??options[0];return selected?attrs(selected).value??'':'';}return node.nodeName==='textarea'?out.textContent:'';},set value(v){value=String(v);},
   checked:Object.hasOwn(a,'checked'),disabled:Object.hasOwn(a,'disabled'),hidden:Object.hasOwn(a,'hidden'),inert:false,
   get innerHTML(){return serialize(node);},set innerHTML(html){const fragment=parseFragment(String(html));node.childNodes=fragment.childNodes;for(const child of node.childNodes)child.parentNode=node;},
   get textContent(){return descendants(node).filter(child=>child.nodeName==='#text').map(child=>child.value).join('');},set textContent(v){node.childNodes=[{nodeName:'#text',value:String(v),parentNode:node}];},
   querySelector(selector){return out.querySelectorAll(selector)[0]??null;},querySelectorAll(selector){return descendants(node).filter(child=>matches(child,selector)).map(wrap);},
   append(child){const found=raw.get(child);if(!found)throw Error('Unknown append child');if(found.parentNode)found.parentNode.childNodes=found.parentNode.childNodes.filter(n=>n!==found);found.parentNode=node;node.childNodes.push(found);},
   replaceChildren(){node.childNodes=[];},setAttribute(name,v){node.attrs??=[];const old=node.attrs.find(attr=>attr.name===name);if(old)old.value=String(v);else node.attrs.push({name,value:String(v)});},getAttribute(name){return attrs(node)[name]??null;},hasAttribute(name){return Object.hasOwn(attrs(node),name);},toggleAttribute(name,on){if(on)out.setAttribute(name,'');else node.attrs=(node.attrs??[]).filter(attr=>attr.name!==name);},
   addEventListener(type,callback){listeners.set(type,[...(listeners.get(type)??[]),callback]);},dispatchEvent(event){for(const callback of listeners.get(event.type)??[])callback(event);},
   contains(child){return descendants(node).some(n=>cache.get(n)===child);},closest(selector){let current=node;while(current){if(matches(current,selector))return wrap(current);current=current.parentNode;}return null;}
  };cache.set(node,out);raw.set(out,node);return out;
 }
 globalThis.document={querySelector:selector=>wrap(tree).querySelector(selector),querySelectorAll:selector=>wrap(tree).querySelectorAll(selector)};
 t.after(()=>{globalThis.document=old;});
 return {frame(title,body,actions){tree=parseFragment('<h2>'+esc(title)+'</h2>'+body+(actions??''));},query:selector=>document.querySelector(selector),all:selector=>document.querySelectorAll(selector),html:()=>serialize(tree)};
}
const control=(action,data={})=>({dataset:{action,...data}});
const perform=(ui,action,data={})=>ui.action('clock-sync-'+action,control(action,data));
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('typed missing and domain cells remain inspectable without becoming scalar anchors',()=>{
 const column=timeColumn(),row={cells:['0'],valueKinds:['value']};assert.equal(clockSynchronizationAnchorEligible(row,column),true);
 for(const kind of ['null','absent','missing']){const row={cells:[null],valueKinds:[kind]};assert.equal(clockSynchronizationAnchorEligible(row,column),false);assert.doesNotMatch(clockSynchronizationCellPreview(row,column),/object/);}
 column.missing=[{value:'NA',meaning:'Not observed'}];assert.equal(clockSynchronizationAnchorEligible({cells:['NA'],valueKinds:['value']},column),false);assert.match(clockSynchronizationCellPreview({cells:['NA']},column),/Missing value/);
 assert.equal(clockSynchronizationAnchorEligible({...row,excluded:'Excluded by author'},column),false);
 const domain={...column,representation:'domain',domain:defaultDomain('symbol')};assert.equal(clockSynchronizationAnchorEligible({cells:[{format:'domain-value',definition:domain.domain,original:'event'}]},domain),false);assert.doesNotMatch(clockSynchronizationCellPreview({cells:[{format:'domain-value',definition:domain.domain,original:'event'}]},domain),/object Object/);
 const unknown={...column,time:{...column.time,clock:blankClock()}};assert.equal(clockSynchronizationAnchorEligible(row,unknown),false);unknown.time.clock.wrap=unknown.time.clock.reset='none';assert.equal(clockSynchronizationAnchorEligible(row,unknown),true);
});

test('model and measurement descriptions escape values and offer selected full bound reads',()=>{
 const source=ref('dataset'),reference=ref('dataset'),retained=retainedScalar();
 const value={version:1,method:'two-anchor-affine',source:{ref:source,column:0},anchors:[0,1].map(row=>({source:{ref:source,selector:{kind:'cell',page:0,row,column:0}},reference:{ref:reference,selector:{kind:'cell',page:0,row,column:0}}})),validity:{lower:scalar('0'),upper:scalar('100')},target:{unit:'s',time:{...timeColumn().time,clock:{...blankClock(),epoch:'<epoch>'}}},rationale:'<pairing>',resourcePolicy:defaultDatasetResourcePolicy()};
 let html=clockSynchronizationView(value,{esc,button:(label,action,attrs)=>'<button '+attrs+'>'+label+'</button>'});assert.match(html,/&lt;pairing&gt;/);assert.match(html,/&lt;epoch&gt;/);assert.match(html,/Anchor pair 2/);assert.doesNotMatch(html,/<pairing>/);
 value.validity.upper.spelling=retained;html=clockSynchronizationView(value,{esc,button:()=>''});assert.match(html,/data-scalar-path="validity.upper.spelling"/);assert.match(html,/View exact text/);assert.match(clockSynchronizationDescription(value,{esc}),/data-scalar-path="synchronization.validity.upper.spelling"/);
 const domain={...defaultDomain('symbol'),namespace:'observanda.clock-synchronization-status.v1'};assert.match(clockSynchronizationStatusDisplay({format:'domain-value',definition:domain,original:'outside-validity'}),/Outside declared source validity/);assert.equal(clockSynchronizationStatusDisplay('untrusted',{domain}),null);assert.equal(clockSynchronizationStatusDisplay('ready',{domain:{...domain,namespace:'another'}}),null);
});

test('authoring pins explicit paired cells and preserves all inputs and command identity across refusal and retry',async t=>{
 const dom=harness(t),source=ref('dataset'),reference=ref('dataset'),result=ref('analysis'),column=timeColumn(),saved=[],inspected=[],calls=[];let refuse=true,holdAnchor=false,releaseAnchor;
 const call=async(name,data,options)=>{calls.push({name,data,options});if(name==='list')return {items:[{...reference,title:'Reference dataset'}],next:null};if(name==='schema')return {items:[column],offset:data.offset??0,total:18,next:data.offset===0?16:null};if(name==='rows')return {page:data.page,pages:1,rows:[0,1].map(i=>({order:i+1,cells:[String(i*10)],valueKinds:['value']}))};if(name==='measurement-inspect'){const result={kind:'cell',value:{spelling:String(data.source.selector.row*10),presence:'value',representation:'decimal'},row:{}};return holdAnchor?new Promise(resolve=>releaseAnchor=()=>resolve(result)):result;}if(name==='clock-synchronization-save'){saved.push(structuredClone(data));if(refuse){refuse=false;throw Error('Declared resource limit');}return {ref:result};}throw Error(name);};
 const ui=clockSynchronizationUI({call,frame:dom.frame,esc,field,guard(){},owner:()=> 'record',inspect:async value=>inspected.push(value)});t.after(()=>ui.clean());await ui.open(source);await settle();
 await perform(ui,'schema',{side:'source',offset:'16'});dom.query('[data-sync-side="source"]').querySelector('[data-sync-column]').value='16';await perform(ui,'column',{side:'source'});
 const picker=dom.query('#clock-sync-reference');picker.value=picker.querySelectorAll('option')[1].value;picker.dispatchEvent({type:'change'});await perform(ui,'reference');dom.query('[data-sync-side="reference"]').querySelector('[data-sync-column]').value='0';await perform(ui,'column',{side:'reference'});
 for(const [side,row] of [['source',0],['source',1],['reference',0]])await perform(ui,'anchor',{side,row:String(row),anchor:String(row)});
 dom.query('[data-sync="title"]').value='Paired exact clock';dom.query('[data-sync="lower-spelling"]').value='000.00';dom.query('[data-sync="upper-spelling"]').value='14';dom.query('[data-sync="upper-representation"]').value='radix';dom.query('[data-sync="upper-radix"]').value='6';dom.query('[data-sync="rationale"]').value='Explicit same-event pairing';
 const controls=dom.query('[data-sync-controls]'),rationale=dom.query('[data-sync="rationale"]'),columnPlaceholder=dom.query('[data-sync-side="source"]').querySelector('option');assert.equal(columnPlaceholder.disabled,true);holdAnchor=true;const pendingAnchor=perform(ui,'anchor',{side:'reference',row:'1',anchor:'1'});
 assert.equal(controls.disabled,true);assert.equal(dom.query('[data-clock-synchronization]').getAttribute('aria-busy'),'true');assert.match(dom.query('[data-sync-status]').textContent,/operation in progress/);assert.equal(rationale.closest('fieldset'),controls);await perform(ui,'save');assert.equal(saved.length,0);releaseAnchor();await pendingAnchor;assert.equal(controls.disabled,false);assert.equal(dom.query('[data-clock-synchronization]').getAttribute('aria-busy'),'false');assert.equal(dom.query('[data-sync-status]').hidden,true);assert.equal(columnPlaceholder.disabled,true);assert.equal(rationale.value,'Explicit same-event pairing');
 await assert.rejects(perform(ui,'save'),/Declared resource limit/);assert.equal(ui.isBusy(),false);assert.equal(controls.disabled,false);assert.equal(dom.query('[data-sync="lower-spelling"]').value,'000.00');assert.match(dom.query('[data-sync-anchors]').textContent,/column 17/);assert.equal(dom.query('[data-sync="rationale"]').value,'Explicit same-event pairing');
 await perform(ui,'save');assert.equal(saved.length,2);assert.deepEqual(saved[0],saved[1]);assert.equal(saved[0].synchronization.source.column,16);assert.equal(saved[0].synchronization.anchors[1].source.selector.column,16);assert.deepEqual(saved[0].synchronization.validity.upper,scalar('14','radix',6));assert.deepEqual(saved[0].synchronization.target.time,column.time);assert.deepEqual(inspected,[result]);assert.ok(calls.filter(c=>c.name==='measurement-inspect').every(c=>c.options.adoptOwner===false));
});

test('stale schema completion cannot enable or replace a newer editor',async t=>{
 const dom=harness(t),source=ref('dataset');let release,requests=0;
 const ui=clockSynchronizationUI({call:async name=>{if(name==='list')return {items:[],next:null};if(name==='schema'){if(requests++===0)return new Promise(resolve=>release=resolve);return {items:[timeColumn()],offset:0,total:1,next:null};}throw Error(name);},frame:dom.frame,esc,field,guard(){},owner:()=> 'record',inspect:async()=>{}});t.after(()=>ui.clean());
 const old=ui.open(source);await settle();await ui.open({...source,revision:'b'.repeat(64)});const input=dom.query('[data-sync="title"]');input.value='New editor';release({items:[],offset:0,total:0,next:null});await assert.rejects(old,{name:'AbortError'});assert.equal(dom.query('[data-sync="title"]'),input);assert.equal(input.value,'New editor');assert.equal(ui.isBusy(),false);
});


test('revising a pinned model keeps prior anchors and retained bounds without aggregate hydration',async t=>{
 const dom=harness(t),source=ref('dataset'),reference=ref('dataset'),modelRef=ref('analysis'),next={...modelRef,revision:'f'.repeat(64)},column=timeColumn(),commands=[],calls=[],inspected=[];
 const model={tool:'Observanda clock synchronization',version:1,method:'two-anchor-affine',source:{ref:source,column:0},anchors:[0,1].map(row=>({source:{ref:source,selector:{kind:'cell',page:0,row,column:0}},reference:{ref:reference,selector:{kind:'cell',page:0,row,column:0}}})),validity:{lower:scalar('0000'),upper:scalar(retainedScalar())},target:{unit:column.unit,time:structuredClone(column.time)},rationale:'Original exact pairing',resourcePolicy:{...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxScalarCharacters:16384}}},original=structuredClone(model);
 const ui=clockSynchronizationUI({call:async(name,data,options)=>{calls.push({name,data,options});if(name==='read')return {title:'Original pinned model',content:model};if(name==='list')return {items:[],next:null};if(name==='schema')return {items:[column],offset:0,total:1,next:null};if(name==='rows')return {page:0,pages:1,rows:[0,1].map(row=>({cells:[String(row)],valueKinds:['value']}))};if(name==='clock-synchronization-save'){commands.push(data);return {ref:next};}throw Error('Unexpected hydration: '+name);},frame:dom.frame,esc,field,guard(){},owner:()=> 'record',inspect:async r=>inspected.push(r)});t.after(()=>ui.clean());
 await perform(ui,'revise',{ref:JSON.stringify(modelRef)});assert.equal(dom.query('[data-sync="title"]').value,'Original pinned model');assert.match(dom.query('[data-sync-anchors]').textContent,/Anchor pair 2/);assert.equal(dom.query('[data-sync="lower-spelling"]').value,'0000');assert.match(dom.html(),/Load complete text to edit/);assert.equal(dom.query('[data-sync="upper-spelling"]').hasAttribute('readonly'),true);assert.equal(dom.query('[data-sync-controls]').disabled,false);
 dom.query('[data-sync="rationale"]').value='Revised explicit rationale';await perform(ui,'save');assert.equal(commands[0].id,modelRef.id);assert.equal(commands[0].expectedRevision,modelRef.revision);assert.deepEqual(commands[0].synchronization.anchors,original.anchors);assert.deepEqual(commands[0].synchronization.validity,original.validity);assert.equal(commands[0].synchronization.rationale,'Revised explicit rationale');assert.deepEqual(model,original);assert.deepEqual(inspected,[next]);assert.equal(calls.filter(c=>c.name==='measurement-scalar').length,0);
});


test('graph upgrade and model selection preserve editable choices when saving is refused',async t=>{
 const dom=harness(t),graph=ref('analysis'),model=ref('analysis'),other=ref('analysis'),binding={id:randomUUID(),position:0},calls=[],changes=[];let version=8,refuse=true;
 const page=()=>({title:'Pinned graph',graphVersion:version,counts:{bindings:1,nodes:0,outputs:0},items:[],total:0,next:null,policy:defaultDatasetResourcePolicy()});
 const ui=datasetCalculationGraphUI({call:async(name,data,options)=>{calls.push({name,data,options});if(name==='calculation-graph-page')return page();if(name==='list')return {items:[{...other,title:'Other analysis'},{...model,title:'Clock model'}],next:null};if(name==='read')return {content:data.ref.id===model.id?{tool:'Observanda clock synchronization',version:1,method:'two-anchor-affine'}:{tool:'Other analysis'}};if(name==='calculation-graph-change'){changes.push(structuredClone(data));if(data.collection==='version'){version=data.graphVersion;return {ref:graph};}if(refuse){refuse=false;throw Error('Resource policy refusal');}return {ref:{...graph,revision:'b'.repeat(64)}};}throw Error(name);},frame:dom.frame,esc,field,guard(){},owner:()=> 'record',inspect:async()=>{},watchJob:async()=>{}});t.after(()=>ui.clean());
 const action=(name,data={})=>ui.action('calculation-graph-'+name,control(name,data));await ui.open(graph,{existing:true});assert.match(dom.html(),/Enable clock synchronization/);assert.doesNotMatch(dom.html(),/Add clock synchronization/);await action('clock-sync-upgrade');await action('apply-clock-sync-upgrade');assert.equal(changes[0].graphVersion,9);assert.match(dom.html(),/Add clock synchronization/);
 await action('add',{kind:'clock-synchronize'});await settle();dom.query('[data-graph-field="binding"]').value=JSON.stringify(binding);dom.query('[data-graph-field="column"]').value='18';dom.query('[data-graph-field="operation"]').value='status';dom.query('[data-graph-field="outside"]').value='error';
 const picker=dom.query('#graph-clock-sync-model');picker.value=picker.querySelectorAll('option')[1].value;picker.dispatchEvent({type:'change'});await assert.rejects(action('apply'),/not a retained two-anchor/);assert.equal(changes.length,1);assert.equal(dom.query('[data-graph-field="column"]').value,'18');
 picker.value=picker.querySelectorAll('option')[2].value;picker.dispatchEvent({type:'change'});await assert.rejects(action('apply'),/Resource policy refusal/);assert.equal(dom.query('[data-graph-field="outside"]').value,'error');assert.equal(ui.isBusy(),false);await action('apply');assert.deepEqual(changes[1],changes[2]);assert.deepEqual(changes[2].item.model,model);assert.deepEqual(changes[2].item.binding,binding);assert.equal(changes[2].item.column,17);assert.equal(changes[2].item.operation,'status');assert.equal(changes[2].item.outside,'error');assert.ok(calls.filter(call=>call.name==='read').every(call=>call.options.adoptOwner===false));
});


test('segmented clock models require explicit graph twelve and retain node choices on the older-version refusal',async t=>{
 const dom=harness(t),graph=ref('analysis'),model=ref('analysis'),binding={id:randomUUID(),position:0},policy=defaultDatasetResourcePolicy(),changes=[];policy.resources.maxScalarCharacters=20000;let version=11;
 const ui=datasetCalculationGraphUI({call:async(name,data)=>{if(name==='calculation-graph-page')return {title:'Historical graph',graphVersion:version,counts:{bindings:1,nodes:0,outputs:0},items:[],total:0,next:null,policy};if(name==='list')return {items:[{...model,title:'Segmented model'}],next:null};if(name==='read')return {content:{tool:'Observanda clock synchronization',version:2,method:'segmented-piecewise-affine-v1'}};if(name==='calculation-graph-change'){changes.push(structuredClone(data));if(data.collection==='version')version=data.graphVersion;return {ref:graph};}throw Error(name);},frame:dom.frame,esc,field,guard(){},owner:()=> 'record',inspect:async()=>{},watchJob:async()=>{}});t.after(()=>ui.clean());const action=(name,data={})=>ui.action('calculation-graph-'+name,control(name,data));await ui.open(graph,{existing:true});await action('add',{kind:'clock-synchronize'});await settle();dom.query('[data-graph-field="binding"]').value=JSON.stringify(binding);dom.query('[data-graph-field="column"]').value='19';dom.query('[data-graph-field="operation"]').value='status';const picker=dom.query('#graph-clock-sync-model');picker.value=picker.querySelectorAll('option')[1].value;picker.dispatchEvent({type:'change'});await assert.rejects(action('apply'),/Enable segmented clock synchronization/);assert.equal(changes.length,0);assert.equal(dom.query('[data-graph-field="column"]').value,'19');assert.equal(dom.query('[data-graph-field="operation"]').value,'status');await action('cancel-edit');await action('segmented-clock-upgrade');assert.equal(dom.query('[data-dataset-resource="maxScalarCharacters"]').value,'20000');await action('apply-segmented-clock-upgrade');assert.equal(changes[0].graphVersion,12);assert.deepEqual(changes[0].policy,policy);await action('add',{kind:'clock-synchronize'});await settle();dom.query('[data-graph-field="binding"]').value=JSON.stringify(binding);const selected=dom.query('#graph-clock-sync-model');selected.value=selected.querySelectorAll('option')[1].value;selected.dispatchEvent({type:'change'});await action('apply');assert.equal(changes[1].item.model.id,model.id);
});

test('new clock authoring offers simple and segmented methods before creating a model',async t=>{
 const dom=harness(t),calls=[],ui=clockSynchronizationUI({call:async(name)=>{calls.push(name);throw Error(name);},frame:dom.frame,esc,field,guard(){},owner:()=> 'record',inspect:async()=>{}});t.after(()=>ui.clean());await perform(ui,'open',{ref:JSON.stringify(ref('dataset'))});assert.match(dom.html(),/Two-anchor affine model/);assert.match(dom.html(),/Segmented piecewise interpolation/);assert.ok(dom.query('[data-action="material-clock-sync-affine-open"]'));assert.ok(dom.query('[data-action="material-clock-segments-open"]'));assert.deepEqual(calls,[]);
});


test('segmented lineage names the selected segment and adjacent anchor positions without private identifiers',()=>{
 const value={version:2,model:ref('analysis'),segment:{id:randomUUID(),position:1},bracket:[{position:2},{position:3}],status:'ready'},html=clockSynchronizationLineageView(value,{esc});assert.match(html,/Declared segment 2/);assert.match(html,/adjacent anchor pairs 3 and 4/);assert.doesNotMatch(html,new RegExp(value.segment.id));assert.doesNotMatch(html,new RegExp(value.model.id));assert.match(clockSynchronizationLineageView({...value,segment:null,bracket:[],status:'outside-validity'},{esc}),/No declared segment selected/);
});


test('segmented lineage distinguishes calculation row selection from an excluded source without changing stored status',()=>{
 const value={version:2,model:ref('analysis'),segment:null,bracket:[],status:'excluded-input',outputExcluded:true},saved=structuredClone(value),html=clockSynchronizationLineageView(value,{esc});assert.match(html,/Excluded by the calculation.*row selection/);assert.doesNotMatch(html,/Source reading excluded/);assert.deepEqual(value,saved);for(const outputExcluded of [false,undefined,'true'])assert.match(clockSynchronizationLineageView({...value,outputExcluded},{esc}),/Source reading excluded/);
});
