import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment,serialize} from 'parse5';
import {randomUUID} from 'node:crypto';
import {statisticalUncertaintyUI,defaultUncertaintyDefinition,nextUncertaintyCovariance,uncertaintyCellEligible} from '../src/web/statistical-uncertainty-ui.js';
import {blankUnitDefinition} from '../src/web/measurement-unit-model.js';
import {validStatisticalUncertaintyDefinition,validStatisticalUncertaintyInput,validStatisticalUncertaintyCovariance} from '../src/web/measurement-statistical-uncertainty-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,input)=>'<label class="field">'+label+input+'</label>';
const ref=()=>({kind:'dataset',id:randomUUID(),revision:'a'.repeat(64)});
const retainedScalar=(characters=9002)=>({format:'dataset-cell',version:1,characters,sha256:'b'.repeat(64),parts:{format:1,kind:'cell-text',count:1,chunkSize:16,root:{count:1,height:1,key:'c'.repeat(64),hash:'d'.repeat(64)}}});
// Parsed DOM and mocked requests only; no browser, database, or native runtime.
function harness(t){
 const old=globalThis.document,cache=new WeakMap(),raw=new WeakMap();let tree=parseFragment('');
 const attrs=node=>Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value]));
 const descendants=node=>(node.childNodes??[]).flatMap(child=>[child,...descendants(child)]);
 const matches=(node,selector)=>selector.split(',').some(raw=>{
  let s=raw.trim(),a=attrs(node);if(s.includes(' ')){const at=s.lastIndexOf(' '),last=s.slice(at+1);if(!matches(node,last))return false;let parent=node.parentNode;while(parent){if(matches(parent,s.slice(0,at)))return true;parent=parent.parentNode;}return false;}
  for(const state of ['checked','disabled'])if(s.endsWith(':'+state)){if(!(cache.get(node)?.[state]??Object.hasOwn(a,state)))return false;s=s.slice(0,-state.length-1);}
  if(s.startsWith('#'))return a.id===s.slice(1);if(s.startsWith('.'))return (a.class??'').split(' ').includes(s.slice(1));
  const m=/^([\w-]+)?(?:\[([^=\]]+)(?:="?([^"\]]*)"?)?\])?$/.exec(s);return !!m&&(!m[1]||node.nodeName===m[1])&&(!m[2]||Object.hasOwn(a,m[2])&&(m[3]===undefined||a[m[2]]===m[3]));
 });
 function wrap(node){
  if(cache.has(node))return cache.get(node);const listeners=new Map(),a=attrs(node);let value=a.value;
  const out={get isConnected(){return node===tree||descendants(tree).includes(node);},get dataset(){const name=key=>'data-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());return new Proxy({},{get:(_,key)=>attrs(node)[name(key)],deleteProperty:(_,key)=>{node.attrs=(node.attrs??[]).filter(a=>a.name!==name(key));return true;}});},
   get value(){if(value!==undefined)return value;if(node.nodeName==='select'){const options=descendants(node).filter(child=>child.nodeName==='option'),selected=options.find(child=>Object.hasOwn(attrs(child),'selected'))??options[0];return selected?attrs(selected).value??'':'';}return node.nodeName==='textarea'?out.textContent:'';},set value(v){value=String(v);},
   checked:Object.hasOwn(a,'checked'),disabled:Object.hasOwn(a,'disabled'),hidden:Object.hasOwn(a,'hidden'),inert:false,readOnly:Object.hasOwn(a,'readonly'),maxLength:Number(a.maxlength??-1),ownerDocument:{defaultView:{Event:class {constructor(type,options){this.type=type;Object.assign(this,options);}}}},
   get innerHTML(){return serialize(node);},set innerHTML(html){const fragment=parseFragment(String(html));node.childNodes=fragment.childNodes;for(const child of node.childNodes)child.parentNode=node;},
   get textContent(){return descendants(node).filter(child=>child.nodeName==='#text').map(child=>child.value).join('');},set textContent(v){node.childNodes=[{nodeName:'#text',value:String(v),parentNode:node}];},
   querySelector(selector){return out.querySelectorAll(selector)[0]??null;},querySelectorAll(selector){return descendants(node).filter(child=>matches(child,selector)).map(wrap);},
   append(child){const found=raw.get(child);if(!found)throw Error('Unknown append child');if(found.parentNode)found.parentNode.childNodes=found.parentNode.childNodes.filter(n=>n!==found);found.parentNode=node;node.childNodes.push(found);},
   remove(){if(node.parentNode)node.parentNode.childNodes=node.parentNode.childNodes.filter(child=>child!==node);},replaceChildren(){node.childNodes=[];},setAttribute(name,v){node.attrs??=[];const old=node.attrs.find(attr=>attr.name===name);if(old)old.value=String(v);else node.attrs.push({name,value:String(v)});},getAttribute(name){return attrs(node)[name]??null;},hasAttribute(name){return Object.hasOwn(attrs(node),name);},toggleAttribute(name,on){if(on)out.setAttribute(name,'');else node.attrs=(node.attrs??[]).filter(attr=>attr.name!==name);},
   addEventListener(type,callback){listeners.set(type,[...(listeners.get(type)??[]),callback]);},dispatchEvent(event){for(const callback of listeners.get(event.type)??[])callback(event);},
   matches(selector){return matches(node,selector);},contains(child){return descendants(node).some(n=>cache.get(n)===child);},closest(selector){let current=node;while(current){if(matches(current,selector))return wrap(current);current=current.parentNode;}return null;}
  };cache.set(node,out);raw.set(out,node);return out;
 }
 globalThis.document={getElementById:id=>id==='dialog'?{open:true}:null,querySelector:selector=>wrap(tree).querySelector(selector),querySelectorAll:selector=>wrap(tree).querySelectorAll(selector)};
 t.after(()=>{globalThis.document=old;});
 return {frame(title,body,actions){tree=parseFragment('<h2>'+esc(title)+'</h2>'+body+(actions??''));},query:selector=>document.querySelector(selector),all:selector=>document.querySelectorAll(selector),html:()=>serialize(tree)};
}
const control=(action,data={})=>({dataset:{action,...data}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));


const get=(dom,key)=>dom.query('[data-uncertainty-field="'+key+'"]');
const change=(input,value)=>{input.value=value;input.onchange?.();};
const dataset=ref(),cell=(column=1,row=0)=>({ref:dataset,selector:{kind:'cell',page:0,row,column}}),unit=blankUnitDefinition();
const operand=(spelling='1')=>({kind:'declared',scalar:{spelling,representation:'integer',radix:10},unitDefinition:unit,rationale:'Explicit local derivative or covariance.'});
const input=(index=0)=>({id:randomUUID(),name:'Input '+(index+1),estimate:cell(index+1),sensitivity:operand()});
function author(t,{inputs=[],covariance=[],definition={...defaultUncertaintyDefinition(),nominal:cell(),rationale:'First-order model.',evaluationPoint:'At retained estimates.'},request=async()=>undefined,result=null,isCurrent=true}={}){
 const dom=harness(t),calls=[],watched=[],inspected=[],versions=[];let revision=1,reference={kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)},title='Pinned uncertainty model';
 const model={definition:structuredClone(definition),inputs:structuredClone(inputs),covariance:structuredClone(covariance)},columns=Array.from({length:20},(_,index)=>({name:'Declared '+(index+1),representation:'integer',radix:10,unit:'',quantity:{unitDefinition:unit},missing:[{value:'NA',meaning:'Missing'}]}));
 const call=async(name,data)=>{calls.push({name,data:structuredClone(data)});const custom=await request(name,data);if(custom!==undefined)return custom;
  if(name==='uncertainty-create'){model.definition=structuredClone(data.definition);title=data.title;return {ref:reference};}
  if(name==='uncertainty-page'||name==='uncertainty-result'){const values=model[data.collection],offset=data.offset??0;return {ref:reference,title,recordId:dataset.id,isCurrent,definition:structuredClone(model.definition),inputCount:model.inputs.length,covarianceCount:model.covariance.length,items:structuredClone(values.slice(offset,offset+16)),offset,total:values.length,next:offset+16<values.length?offset+16:null,...(result?{result,analysis:{kind:'analysis',id:randomUUID(),revision:'b'.repeat(64)}}:{})};}
  if(name==='uncertainty-change'){versions.push(structuredClone(model));if(data.collection==='settings'){assert.ok(validStatisticalUncertaintyDefinition(data.definition));model.definition=structuredClone(data.definition);title=data.title;}else{assert.ok(data.remove||(data.collection==='inputs'?validStatisticalUncertaintyInput(data.item,model.definition.resourcePolicy):validStatisticalUncertaintyCovariance(data.item,model.definition.resourcePolicy)));if(data.remove)model[data.collection].splice(data.offset,1);else model[data.collection][data.offset]=structuredClone(data.item);}reference={...reference,revision:String(++revision).padStart(64,'0')};return {ref:reference};}
  if(name==='schema'){const offset=data.offset??0;return {items:columns.slice(offset,offset+16),offset,total:20,next:offset+16<20?offset+16:null};}
  if(name==='rows')return {page:data.page,pages:2,rows:[{cells:['2'],valueKinds:['string'],order:1},{cells:[null],valueKinds:['null'],order:2},{cells:['3'],valueKinds:['string'],excluded:'Rejected reading',order:3}],columns:[columns[data.columnOffset]]};
  if(name==='measurement-inspect')return {kind:'cell',value:{spelling:'2',presence:'value',representation:'integer',radix:10,unit:''},column:columns[data.source.selector.column],quantity:{unitDefinition:unit},row:{id:'pinned'},surrounding:[],previous:null,next:null};
  if(name==='dataset-preview')return {columns:['Nominal','Variance','Standard uncertainty'],rows:[{cells:['10','9/1','3/1']}]};if(name==='dataset')return {job:{id:'saved'}};throw Error('Unexpected '+name);
 };
 const ui=statisticalUncertaintyUI({call,frame:dom.frame,esc,field,guard(){},owner:()=>dataset.id,inspect:async selected=>inspected.push(selected),watchJob:async job=>watched.push(job)});t.after(()=>ui.clean());const act=(key,data={})=>ui.action('uncertainty-'+key,control(key,data));return {...dom,ui,act,calls,model,versions,watched,inspected,open:()=>ui.open(reference,{existing:true}),create:()=>ui.open(dataset),result:()=>ui.open(dataset,{result:true}),reference:()=>reference};
}
const chooseAddress=(dom,key,source=cell())=>{dom.query('[data-uncertainty-locator="'+key+'"]').value=JSON.stringify(source);};
const authorOperand=dom=>{change(get(dom,'operandKind'),'declared');get(dom,'spelling').value='1';dom.query('[data-unit-enabled]').checked=true;get(dom,'operandRationale').value='Authored exact difference quantity.';};

test('new uncertainty model uses shared policies and an explicit paged nominal cell selection',async t=>{
 const dom=author(t);await dom.create();const created=dom.calls.find(call=>call.name==='uncertainty-create').data;assert.deepEqual(created.definition,defaultUncertaintyDefinition());assert.ok(dom.query('[data-uncertainty-edit]'));get(dom,'modelTitle').value='Declared propagation';get(dom,'rationale').value='Sum of two input estimates';get(dom,'evaluationPoint').value='At the recorded operating point';
 await dom.act('pick-cell',{target:'nominal'});await dom.act('pick-schema',{offset:'16'});dom.query('[data-uncertainty-column]').value='18';await dom.act('pick-column');const controls=dom.all('[data-action="material-uncertainty-pick-use"]');assert.equal(controls.length,3);assert.equal(controls[0].disabled,false);assert.equal(controls[1].disabled,true);assert.equal(controls[2].disabled,true);await dom.act('pick-use',{row:'0'});assert.deepEqual(JSON.parse(dom.query('[data-uncertainty-locator="nominal"]').value),cell(18));assert.equal(get(dom,'rationale').value,'Sum of two input estimates');await dom.act('apply');assert.equal(dom.model.definition.nominal.selector.column,18);assert.equal(dom.model.definition.evaluationPoint,'At the recorded operating point');assert.ok(dom.calls.filter(call=>call.name==='schema').every(call=>call.data.limit===16));assert.match(dom.html(),/0 saved entries; 0 required/);
});

test('a refused uncertainty item preserves exact authored scalar, units, rationale and choices through busy retry',async t=>{
 let hold=true,release,refuse=true;const dom=author(t,{request:async(name)=>{if(name==='uncertainty-change'&&refuse){if(hold)await new Promise(resolve=>release=resolve);refuse=false;throw Error('Selected source access refused');}}});await dom.open();await dom.act('add');get(dom,'name').value='Input estimate';chooseAddress(dom,'estimate',cell(18));authorOperand(dom);change(get(dom,'representation'),'radix-fraction');get(dom,'radix').value='6';get(dom,'spelling').value='0.3';const pending=dom.act('apply');await settle();assert.equal(dom.ui.isBusy(),true);assert.equal(dom.query('[data-uncertainty-controls]').disabled,true);await dom.act('cancel-edit');assert.ok(dom.query('[data-uncertainty-edit]'));hold=false;release();await assert.rejects(pending,/access refused/);assert.equal(dom.query('[data-uncertainty-controls]').disabled,false);assert.equal(get(dom,'name').value,'Input estimate');assert.equal(get(dom,'spelling').value,'0.3');assert.equal(get(dom,'radix').value,'6');assert.equal(dom.query('[data-unit-enabled]').checked,true);assert.deepEqual(JSON.parse(dom.query('[data-uncertainty-locator="estimate"]').value),cell(18));await dom.act('apply');assert.equal(dom.model.inputs[0].sensitivity.scalar.spelling,'0.3');assert.equal(dom.model.inputs[0].sensitivity.scalar.radix,6);assert.equal(dom.versions[0].inputs.length,0);
});

test('covariance uses complete column-major pages and saves an intentional zero without inferring omitted entries',async t=>{
 const inputs=Array.from({length:6},(_,index)=>input(index)),covariance=Array.from({length:18},(_,index)=>({...nextUncertaintyCovariance(index),value:operand('0')})),dom=author(t,{inputs,covariance});await dom.open();await dom.act('tab',{collection:'covariance'});assert.equal(dom.all('[data-uncertainty-item]').length,16);await dom.act('page',{offset:'16'});assert.equal(dom.all('[data-uncertainty-item]').length,2);await dom.act('add');assert.match(dom.html(),/input 4 and input 6/);authorOperand(dom);get(dom,'spelling').value='0';get(dom,'operandRationale').value='Independence explicitly asserted for this pair.';await dom.act('apply');assert.deepEqual(dom.model.covariance[18],{i:3,j:5,value:{...operand('0'),rationale:'Independence explicitly asserted for this pair.'}});assert.equal(dom.model.covariance.length,19);assert.equal(dom.model.inputs.length,6);assert.match(dom.html(),/19 saved entries; 21 required/);assert.ok(dom.calls.filter(call=>call.name==='uncertainty-page').every(call=>call.data.limit===16));
});

test('long declared covariance scalar edits use its authenticated absolute entry and await hydration',async t=>{
 const full='0'.repeat(9000)+'1',pointer=retainedScalar(full.length),inputs=Array.from({length:6},(_,index)=>input(index)),covariance=Array.from({length:18},(_,index)=>({...nextUncertaintyCovariance(index),value:operand(index===17?pointer:'0')})),definition={...defaultUncertaintyDefinition(),nominal:cell(),rationale:'Model',evaluationPoint:'Recorded point'},policy=definition.resourcePolicy;policy.resources.maxScalarCharacters=20000;let release;
 const dom=author(t,{definition,inputs,covariance,request:async(name,data)=>{if(name==='uncertainty-scalar'){await new Promise(resolve=>release=resolve);return {offset:data.characterOffset,total:full.length,text:full,next:null};}}});await dom.open();await dom.act('tab',{collection:'covariance'});await dom.act('page',{offset:'16'});await dom.act('edit',{index:'1'});const spelling=get(dom,'spelling'),selectedRef=dom.reference();assert.equal(spelling.readOnly,true);const root=dom.query('[data-statistical-uncertainty]');root.dispatchEvent({type:'click',target:root.querySelector('[data-scalar-edit]'),preventDefault(){},stopPropagation(){}});await settle();assert.deepEqual(dom.calls.at(-1),{name:'uncertainty-scalar',data:{ref:selectedRef,collection:'covariance',offset:17,field:'value.scalar.spelling',characterOffset:0,limit:16384}});let completed=false;const pending=dom.act('apply').then(()=>completed=true);await settle();assert.equal(completed,false);release();await pending;assert.equal(dom.model.covariance[17].value.scalar.spelling,full);
});

test('source refusal and late propagation responses leave the current uncertainty draft or newer view intact',async t=>{
 let rejectSource=true,release;const dom=author(t,{request:async(name)=>{if(name==='measurement-inspect'&&rejectSource)throw Error('Source denied');if(name==='dataset-preview')await new Promise(resolve=>release=resolve);}});await dom.open();await dom.act('settings');get(dom,'rationale').value='Keep this model rationale';await dom.act('pick-cell',{target:'nominal'});dom.query('[data-uncertainty-column]').value='1';await dom.act('pick-column');await assert.rejects(dom.act('pick-use',{row:'0'}),/Source denied/);assert.equal(get(dom,'rationale').value,'Keep this model rationale');assert.equal(dom.ui.isBusy(),false);rejectSource=false;await dom.act('pick-use',{row:'0'});await dom.act('apply');const pending=dom.act('preview');await settle();dom.ui.clean();dom.frame('Current view','<p data-current>Current view</p>');release();await assert.rejects(pending,{name:'AbortError'});assert.ok(dom.query('[data-current]'));assert.deepEqual(dom.watched,[]);
});

test('source eligibility requires declared scalar units and preserves typed missing and exclusion rules',()=>{
 const column={representation:'integer',radix:10,quantity:{unitDefinition:unit},missing:[{value:'NA',meaning:'Not recorded'}]};assert.equal(uncertaintyCellEligible({cells:['0'],valueKinds:['string']},column),true);for(const row of [{cells:[null],valueKinds:['null']},{cells:[''],valueKinds:['absent']},{cells:['NA'],valueKinds:['string']},{cells:['1'],excluded:'Rejected'}])assert.equal(uncertaintyCellEligible(row,column),false);assert.equal(uncertaintyCellEligible({cells:['1']},{...column,quantity:{}}),false);assert.equal(uncertaintyCellEligible({cells:['[]']},{...column,representation:'domain'}),false);
});


test('retained uncertainty receipt pages result scalars and keeps the dataset identity when amending its model',async t=>{
 const definition=defaultUncertaintyDefinition(),pointer=retainedScalar(9002),result={version:1,method:'first-order-covariance-v1',inputCount:1,covarianceMeaning:'input-estimates',resourcePolicy:definition.resourcePolicy,nominal:{scalar:{spelling:'10',representation:'integer',radix:10},unitDefinition:unit},variance:{scalar:{spelling:'9/1',representation:'rational',radix:10},unitDefinition:unit},standardUncertainty:{scalar:{spelling:pointer,representation:'rational',radix:10},unitDefinition:unit},squareRoot:{engine:4,policy:definition.calculationPolicy,approximate:false,computation:null},approximateInputs:false};
 const dom=author(t,{inputs:[input()],covariance:[{i:0,j:0,value:operand('9')}],result,request:async(name,data)=>name==='measurement-scalar'?{offset:data.offset,total:9002,text:'3/1',next:null}:undefined});await dom.result();assert.match(dom.html(),/Exact square root/);assert.match(dom.html(),/does not assert a coverage interval/);const root=dom.query('[data-statistical-uncertainty]'),node=root.querySelector('[data-scalar-path="result.standardUncertainty.scalar.spelling"]');root.dispatchEvent({type:'click',target:node.querySelector('[data-scalar-view]'),preventDefault(){},stopPropagation(){}});await settle();assert.equal(dom.calls.at(-1).name,'measurement-scalar');assert.equal(dom.calls.at(-1).data.field,'result.standardUncertainty.scalar.spelling');assert.equal(dom.calls.at(-1).data.collection,undefined);assert.equal(dom.calls.at(-1).data.ref.kind,'analysis');
 await dom.act('edit-model');await dom.act('preview');const command=dom.calls.at(-1).data;assert.equal(command.id,dataset.id);assert.equal(command.expectedRevision,dataset.revision);assert.deepEqual(command.uncertainty,{version:1,definition:dom.reference()});
});

test('uncertainty preview labels bounded spellings and preserves execution identity for retry',async t=>{
 const dom=author(t,{request:async(name)=>name==='dataset-preview'?{columns:['Nominal','Variance','Standard uncertainty'],rows:[{cells:['10','9/1','3'.repeat(4096)],truncated:[false,false,true]}]}:undefined});await dom.open();await dom.act('preview');const first=dom.calls.at(-1).data;assert.match(dom.query('[data-uncertainty-preview]').textContent,/preview truncates long spellings/);assert.match(dom.query('[data-uncertainty-preview]').textContent,/complete computational value/);assert.equal(first.expectedRevision,null);assert.match(first.id,/^[0-9a-f-]{36}$/);await dom.act('preview');assert.equal(dom.calls.at(-1).data.id,first.id);assert.equal(dom.calls.at(-1).data.uncertainty.definition.revision,first.uncertainty.definition.revision);
});


test('historical model pages preserve sources and explain history without offering mutation or silently selecting a head',async t=>{
 const dom=author(t,{inputs:[input()],covariance:[{i:0,j:0,value:operand('4')}],isCurrent:false});await dom.open();assert.match(dom.html(),/data-uncertainty-historical/);assert.match(dom.html(),/earlier model revision/);for(const action of ['settings','edit','add','preview','retain'])assert.equal(dom.query('[data-action="material-uncertainty-'+action+'"]'),null);const before=dom.calls.length;for(const action of ['settings','edit','add','apply','retain'])await dom.act(action,{index:'0'});assert.equal(dom.calls.length,before);await dom.act('inspect-cell',{source:JSON.stringify(cell())});assert.match(dom.query('[data-uncertainty-source-detail]').textContent,/Selected source reading/);await dom.act('tab',{collection:'covariance'});assert.equal(dom.all('[data-uncertainty-item]').length,1);await dom.result();assert.equal(dom.query('[data-action="material-uncertainty-edit-model"]'),null);await dom.act('edit-model');assert.equal(dom.calls.at(-1).name,'uncertainty-result');assert.equal(dom.model.covariance[0].value.scalar.spelling,'4');
});


test('saved uncertainty listing keeps controls before inputs and folds model explanation into native details',async t=>{
 const dom=author(t,{inputs:[input()]});await dom.open();
 for(const name of ['model','method']){const details=dom.query('[data-uncertainty-'+name+'-details]');assert.ok(details);assert.equal(details.hasAttribute('open'),false);assert.ok(details.querySelector('summary'));}
 assert.match(dom.query('[data-uncertainty-model-details]').textContent,/First-order model/);assert.match(dom.query('[data-uncertainty-method-details]').textContent,/does not assert a coverage interval/);
 assert.ok(dom.html().indexOf('data-uncertainty-actions')<dom.html().indexOf('data-uncertainty-item='));assert.equal(dom.query('[data-uncertainty-controls]').hasAttribute('style'),false);assert.equal(dom.all('[data-action="material-uncertainty-preview"]').length,1);await dom.act('inspect-cell',{source:JSON.stringify(cell())});assert.match(dom.query('[data-uncertainty-source-detail]').textContent,/Selected source reading/);
});


test('uncertainty preview keeps each radix and declared unit visible without presenting a truncated unit scalar as complete',async t=>{
 const scale={format:'scalar-preview',text:'1'.repeat(4096),complete:false},contexts=[{representation:'radix',radix:6,unitDefinition:{...unit,kind:'absolute',dimensions:[{axis:'temperature',exponent:1}],offset:{spelling:'273.15',representation:'decimal',radix:10}}},{representation:'rational',radix:10,unitDefinition:unit},{representation:'decimal',radix:10,unitDefinition:{...unit,scale:{representation:'integer',radix:10,spelling:scale}}}],dom=author(t,{request:async name=>name==='dataset-preview'?{columns:['Nominal','Variance','Standard uncertainty'],contexts,rows:[{cells:['14','13/1','3.6055512754']}]}:undefined});await dom.open();await dom.act('preview');
 const headers=dom.all('[data-uncertainty-preview-context]');assert.deepEqual(headers.map(node=>node.textContent),['radix, base 6','rational, base 10','decimal, base 10']);const units=dom.all('[data-uncertainty-preview-unit]');assert.equal(units.length,3);assert.match(units[0].textContent,/temperature\^1/);assert.match(units[0].textContent,/273.15 \(decimal, base 10\)/);assert.match(units[2].textContent,/111\.\.\./);assert.match(dom.query('[data-uncertainty-preview]').textContent,/preview truncates long spellings/);assert.equal(units[2].querySelector('[data-scalar-view]'),null);assert.equal(dom.all('[data-action="material-uncertainty-retain"]').length,1);
});
