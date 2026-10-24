import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment,serialize} from 'parse5';
import {randomUUID} from 'node:crypto';
import {datasetAggregationUI,aggregationInspection,assertAggregationRequestFits} from '../src/web/dataset-aggregation-ui.js';
import {measurementUI} from '../src/web/measurement-ui.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
import {MAX_BYTES} from '../src/web/workspace-limits.js';
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

const get=(dom,key,index)=>index===undefined?dom.query('[data-aggregate="'+key+'"]'):dom.query('[data-aggregate-value="'+index+'"]').querySelector('[data-aggregate="'+key+'"]');
const change=(input,value)=>{input.value=value;input.onchange?.();};
const metric=()=>({column:1,operation:'quantile',name:'Quarter',method:'linear-n-minus-one-v1',probability:{spelling:'0.13',representation:'radix-fraction',radix:6}});
const recipe=(version=3)=>({version,source:ref(),keys:[0],keySemantics:['lexical'],values:[{column:1,operation:'mean',name:'Mean'}],missing:'skip',note:'Original method',...(version>=3?{resourcePolicy:defaultDatasetResourcePolicy()}:{})});
function author(t,{aggregation=recipe(),request=async()=>({columns:['Quarter'],rows:[{cells:['5/4'],valueKinds:['rational']}]})}={}){
 const dom=harness(t),selected=ref(),calls=[],watched=[],errors=[];
 const ui=datasetAggregationUI({state:{},api:{},call:async(name,data)=>{calls.push({name,data:structuredClone(data)});if(name==='read')return {title:'Pinned aggregation',content:{aggregation}};if(name==='calculation-schema')return {columns:[{name:'Group',representation:'text',radix:10},{name:'Reading',representation:'rational',radix:10}],offset:0,total:2,next:null};return request(name,data);},frame:dom.frame,esc,field,guard(){},owner:()=>selected.id,inspect:async()=>{},watchJob:async job=>watched.push(job),notify:message=>errors.push(message)});t.after(()=>ui.clean());
 const act=(name,data={})=>ui.action('aggregation-'+name,control(name,data));return {...dom,ui,act,calls,selected,watched,errors,open:()=>act('repeat',{ref:JSON.stringify(selected)})};
}

test('quantile upgrade is explicit and refused requests preserve exact probability, notes, policy and native disabled states',async t=>{
 const original=recipe(),saved=structuredClone(original);let release,hold=true,refuse=true;const dom=author(t,{aggregation:original,request:async()=>{if(hold)await new Promise(resolve=>release=resolve);if(refuse){refuse=false;throw Error('Probability or resource limit refused');}return {columns:['Quarter'],rows:[{cells:['5/4'],valueKinds:['rational']}]};}});
 await dom.open();assert.doesNotMatch(dom.html(),/value="quantile"/);get(dom,'title').value='Exact quarter';get(dom,'note').value='Typed rationale';dom.query('[data-dataset-resource="maxBits"]').value='';await dom.act('upgrade-quantile');assert.equal(dom.query('[data-dataset-resource="maxBits"]').value,'');assert.equal(get(dom,'note').value,'Typed rationale');assert.match(dom.html(),/value="quantile"/);dom.query('[data-dataset-resource="maxBits"]').value='65536';
 change(get(dom,'operation',0),'quantile');assert.equal(dom.query('[data-aggregate-quantile]').hidden,false);get(dom,'name',0).value='Quarter';change(get(dom,'probability-representation',0),'radix-fraction');get(dom,'probability-radix',0).value='6';get(dom,'probability',0).value='0.13';change(get(dom,'missing'),'error');get(dom,'method',0).disabled=true;
 const pending=dom.act('preview');await settle();assert.equal(dom.ui.isBusy(),true);assert.equal(dom.query('[data-aggregation-form]').getAttribute('aria-busy'),'true');assert.ok(dom.query('[data-aggregation-form]').querySelectorAll('button,input,select,textarea').every(node=>node.disabled));assert.ok(dom.query('[data-aggregation-actions]').querySelectorAll('button').every(node=>node.disabled));assert.match(dom.query('[data-aggregation-status]').textContent,/in progress/);await dom.act('add');assert.equal(dom.all('[data-aggregate-value]').length,1);
 hold=false;release();await assert.rejects(pending,/refused/);assert.equal(dom.ui.isBusy(),false);assert.equal(get(dom,'method',0).disabled,true);assert.equal(get(dom,'probability',0).disabled,false);assert.equal(get(dom,'probability',0).value,'0.13');assert.equal(get(dom,'title').value,'Exact quarter');assert.equal(get(dom,'note').value,'Typed rationale');assert.equal(dom.query('[data-dataset-resource="maxBits"]').value,'65536');
 await dom.act('preview');const command=dom.calls.filter(c=>c.name==='dataset-preview').at(-1).data;assert.equal(command.aggregation.version,4);assert.deepEqual(command.aggregation.values[0],metric());assert.equal(command.aggregation.missing,'error');assert.equal(command.expectedRevision,dom.selected.revision);assert.deepEqual(original,saved);assert.match(dom.query('[data-aggregation-preview]').textContent,/5\/4/);
 change(get(dom,'operation',0),'mean');await dom.act('preview');assert.deepEqual(dom.calls.at(-1).data.aggregation.values[0],{column:1,name:'Quarter',operation:'mean'});
});

test('legacy policy upgrade remains version 3 until quantiles are explicitly enabled',async t=>{
 const original=recipe(2),dom=author(t,{aggregation:original});await dom.open();assert.equal(dom.query('[data-dataset-resource-policy]'),null);await dom.act('upgrade-policy');await dom.act('preview');assert.equal(dom.calls.at(-1).data.aggregation.version,3);assert.doesNotMatch(dom.html(),/value="quantile"/);await dom.act('upgrade-quantile');await dom.act('preview');assert.equal(dom.calls.at(-1).data.aggregation.version,4);assert.equal(original.version,2);
});

test('retained probability survives metric removal and hydrates only from its original authenticated field',async t=>{
 const full='0'.repeat(9000)+'.5',pointer=retainedScalar(full.length),aggregation=recipe(4);aggregation.resourcePolicy.resources.maxScalarCharacters=20000;aggregation.values.push({...metric(),probability:{spelling:pointer,representation:'decimal',radix:10}});let release;
 const dom=author(t,{aggregation,request:async(name,data)=>{if(name==='measurement-scalar'){await new Promise(resolve=>release=resolve);return {offset:data.offset,total:full.length,text:full,next:null};}return {columns:['Quarter'],rows:[]};}});await dom.open();await dom.act('remove',{index:'0'});const input=get(dom,'probability',0);assert.equal(input.readOnly,true);assert.equal(input.closest('[data-scalar-field]').dataset.scalarPath,'aggregation.values.1.probability.spelling');assert.equal(dom.calls.some(c=>c.name==='measurement-scalar'),false);await dom.act('preview');assert.deepEqual(dom.calls.at(-1).data.aggregation.values[0].probability.spelling,pointer);
 const root=dom.query('[data-aggregation-form]'),edit=root.querySelector('[data-scalar-edit]');root.dispatchEvent({type:'click',target:edit,preventDefault(){},stopPropagation(){}});await settle();assert.deepEqual(dom.calls.at(-1).data,{ref:dom.selected,field:'aggregation.values.1.probability.spelling',offset:0,limit:16384});let previewDone=false;const preview=dom.act('preview').then(()=>previewDone=true);await settle();assert.equal(previewDone,false);release();await preview;assert.equal(input.value,full);assert.equal(input.readOnly,false);assert.equal(dom.calls.at(-1).data.aggregation.values[0].probability.spelling,full);assert.equal(aggregation.values[1].probability.spelling,pointer);
});

test('late quantile preview and saved job cannot replace a newer dialog',async t=>{
 let release;const aggregation=recipe(4);aggregation.values=[metric()];const dom=author(t,{aggregation,request:async(name)=>{await new Promise(resolve=>release=resolve);return name==='dataset'?{job:{id:'late'}}:{columns:['Quarter'],rows:[]};}});
 for(const action of ['preview','save']){await dom.open();const pending=dom.act(action);await settle();assert.equal(dom.ui.isBusy(),true);dom.ui.clean();dom.frame('Newer view','<p data-newer>Newer view</p>');release();await pending;assert.ok(dom.query('[data-newer]'));assert.equal(dom.ui.isBusy(),false);}assert.deepEqual(dom.watched,[]);
});

const receipt=()=>{const source=ref(),cell=row=>({ref:source,selector:{kind:'cell',page:1,row,column:3}});return {operation:'quantile',metricIndex:2,method:'linear-n-minus-one-v1',probability:{spelling:retainedScalar(),representation:'radix-fraction',radix:6},source,note:'Exact quarter',counts:{total:6,included:4,excluded:1,missing:1},quantile:{version:1,method:'linear-n-minus-one-v1',lower:{rank:0,member:2,source:cell(2)},upper:{rank:1,member:0,source:cell(0)},weight:{spelling:retainedScalar(),representation:'rational',radix:10}},members:[{presence:'value',value:'1/1',status:'included',source:cell(2)},{presence:'missing',value:'',status:'missing',source:cell(3)}],previous:null,next:2};};
test('quantile receipt renders probability, exact weight, pinned brackets and existing membership',()=>{
 const a=receipt(),sources=[],html=aggregationInspection({aggregation:a},{esc,sourceButton:source=>{sources.push(source);return '<button>Inspect source</button>';}});assert.match(html,/aggregation.values.2.probability.spelling/);assert.match(html,/data-scalar-path="weight.spelling"/);assert.match(html,/Sorted position 1/);assert.match(html,/Sorted position 2/);assert.match(html,/Exact upper-bracket weight/);assert.match(html,/base 6/);assert.match(html,/Equal values keep their original source order/);assert.match(html,/data-quantile-bracket="lower"/);assert.match(html,/material-measurement-next/);assert.equal(sources.length,4);assert.deepEqual(sources.slice(0,2),[a.quantile.lower.source,a.quantile.upper.source]);assert.doesNotMatch(html,/object Object/);
 const empty=aggregationInspection({aggregation:{...a,quantile:null,counts:{...a.counts,included:0}}},{esc,sourceButton:()=>''});assert.match(empty,/No included readings/);assert.doesNotMatch(empty,/data-quantile-bracket/);
});

test('measurement inspector pages probability and weight through distinct authenticated contexts',async t=>{
 const dom=harness(t),a=receipt(),selected={ref:ref(),selector:{kind:'cell',page:4,row:7,column:5}},calls=[];const ui=measurementUI({call:async(name,data)=>{calls.push({name,data});if(name==='measurement-inspect')return {kind:'cell',value:{presence:'value',spelling:'1/2',representation:'rational',radix:10,unit:''},row:{id:'result'},surrounding:[],aggregation:a};return {offset:0,text:'0'.repeat(4096),total:9002,next:4096};},frame:dom.frame,esc,field,guard(){},owner:()=>selected.ref.id,inspect:async()=>{},notify(){},download(){},origin(){},readOnly:()=>true});t.after(()=>ui.clean());await ui.action('measurement-inspect',{dataset:{source:JSON.stringify(selected)}});
 const root=dom.query('[data-measurement-inspection]');for(const field of ['aggregation.values.2.probability.spelling','weight.spelling']){const node=root.querySelector('[data-scalar-path="'+field+'"]'),button=node.querySelector('[data-scalar-view]');root.dispatchEvent({type:'click',target:button,preventDefault(){},stopPropagation(){}});await settle();assert.deepEqual(calls.at(-1),{name:'measurement-scalar',data:{ref:selected.ref,...(field==='weight.spelling'?{selector:selected.selector}:{}),field,offset:0,limit:4096}});assert.match(node.querySelector('[data-scalar-page]').textContent,/4096/);}
});


test('aggregation request preflight counts exact serialized UTF-8 bytes at the HTTP boundary',()=>{
 const command={title:'\u00e9\ud83d\udc1d',aggregation:{note:'',escaped:'quote " and newline\n'}};
 command.aggregation.note='x'.repeat(MAX_BYTES-Buffer.byteLength(JSON.stringify(command),'utf8'));assert.equal(Buffer.byteLength(JSON.stringify(command),'utf8'),MAX_BYTES);assert.doesNotThrow(()=>assertAggregationRequestFits(command));
 command.aggregation.note=command.aggregation.note.slice(1)+'\u00e9';assert.equal(Buffer.byteLength(JSON.stringify(command),'utf8'),MAX_BYTES+1);assert.ok(JSON.stringify(command).length<MAX_BYTES);const note=command.aggregation.note;assert.throws(()=>assertAggregationRequestFits(command),/2097153 UTF-8 bytes.*2097152 bytes.*entries are retained/);assert.equal(command.aggregation.note,note);
});

test('oversized quantile preview and save are refused before requests and keep every authored field for retry',async t=>{
 const aggregation=recipe(4),probability='0.'+'0'.repeat(65533)+'1';aggregation.resourcePolicy.resources.maxScalarCharacters=65536;aggregation.values=Array.from({length:32},(_,index)=>({...metric(),name:'Quantile '+index,probability:{spelling:probability,representation:'decimal',radix:10}}));const dom=author(t,{aggregation});await dom.open();get(dom,'title').value='\u6f22\u5b57 probability collection';get(dom,'note').value='Keep this authored explanation';
 for(const action of ['preview','save']){await assert.rejects(dom.act(action),/request limit.*2 MiB.*entries are retained/);assert.equal(dom.calls.some(c=>c.name==='dataset'||c.name==='dataset-preview'),false);assert.equal(dom.ui.isBusy(),false);assert.equal(dom.query('[data-aggregation-form]').getAttribute('aria-busy'),'false');assert.equal(get(dom,'title').value,'\u6f22\u5b57 probability collection');assert.equal(get(dom,'note').value,'Keep this authored explanation');assert.equal(dom.query('[data-dataset-resource="maxScalarCharacters"]').value,'65536');for(let index=0;index<32;index++){assert.equal(get(dom,'probability',index).value,probability);assert.equal(get(dom,'name',index).value,'Quantile '+index);assert.equal(get(dom,'probability',index).disabled,false);}}
 get(dom,'probability',31).value='0.5';await dom.act('preview');const command=dom.calls.at(-1).data;assert.equal(dom.calls.at(-1).name,'dataset-preview');assert.ok(Buffer.byteLength(JSON.stringify(command),'utf8')<=MAX_BYTES);assert.equal(command.aggregation.values[0].probability.spelling,probability);assert.equal(command.aggregation.values[31].probability.spelling,'0.5');assert.equal(command.aggregation.values.length,32);
});
