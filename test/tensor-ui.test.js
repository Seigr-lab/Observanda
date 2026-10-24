import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment,serialize} from 'parse5';
import {randomUUID} from 'node:crypto';
import {measurementDomainControls,readMeasurementDomain,wireMeasurementDomains,domainComponentPageView,readDomainShape} from '../src/web/measurement-domain-ui.js';
import {domainReshapeControls,readDomainReshape} from '../src/web/dataset-domain-algebra-ui.js';
import {datasetCalculationGraphUI} from '../src/web/dataset-calculation-graph-ui.js';
import {defaultDomain} from '../src/web/measurement-domain-model.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,input)=>'<label>'+label+input+'</label>';
const ref=()=>({kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)});
const retainedScalar=()=>({format:'dataset-cell',version:1,characters:10000,sha256:'b'.repeat(64),parts:{format:1,kind:'cell-text',count:1,chunkSize:16,root:{count:1,height:1,key:'c'.repeat(64),hash:'d'.repeat(64)}}});
// Parsed DOM and mocked requests only; no browser, database, or native runtime.
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
   matches(selector){return matches(node,selector);},contains(child){return descendants(node).some(n=>cache.get(n)===child);},closest(selector){let current=node;while(current){if(matches(current,selector))return wrap(current);current=current.parentNode;}return null;}
  };cache.set(node,out);raw.set(out,node);return out;
 }
 globalThis.document={querySelector:selector=>wrap(tree).querySelector(selector),querySelectorAll:selector=>wrap(tree).querySelectorAll(selector)};
 t.after(()=>{globalThis.document=old;});
 return {frame(title,body,actions){tree=parseFragment('<h2>'+esc(title)+'</h2>'+body+(actions??''));},query:selector=>document.querySelector(selector),all:selector=>document.querySelectorAll(selector),html:()=>serialize(tree)};
}
const control=(action,data={})=>({dataset:{action,...data}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function schema(t,value){const dom=harness(t);dom.frame('Schema','<div data-material-column="0">'+measurementDomainControls(value,{esc,field,active:true})+'</div>');const root=dom.query('[data-material-column]'),stop=wireMeasurementDomains(root);t.after(stop);return {...dom,root,get:key=>root.querySelector('[data-domain="'+key+'"]'),change(key,value){const input=root.querySelector('[data-domain="'+key+'"]');input.value=value;root.dispatchEvent({type:'change',target:input});}};}

test('tensor schema explicitly creates version 3 with required policy and preserved exact component context',t=>{
 const ui=schema(t,defaultDomain('vector'));ui.change('codec','tensor');const toggle=ui.root.querySelector('[data-scalar-policy-enabled]');assert.equal(toggle.checked,true);assert.equal(toggle.disabled,true);assert.equal(ui.root.querySelector('[data-scalar-policy-values]').disabled,false);
 ui.get('shape').value='2, 3, 7';ui.get('namespace').value='instrument components';ui.get('representation').value='radix-fraction';ui.get('radix').value='6';ui.root.dispatchEvent({type:'input',target:ui.get('shape')});assert.match(ui.root.querySelector('[data-domain-shape-summary]').textContent,/Rank 3; 42/);
 const value=readMeasurementDomain(ui.root);assert.equal(value.version,3);assert.deepEqual(value.shape,[2,3,7]);assert.deepEqual(value.component,{version:1,representation:'radix-fraction',radix:6});assert.deepEqual(value.resourcePolicy,defaultDatasetResourcePolicy());
 toggle.checked=false;assert.equal(readMeasurementDomain(ui.root).version,3);assert.deepEqual(readMeasurementDomain(ui.root).resourcePolicy,defaultDatasetResourcePolicy());ui.root.dispatchEvent({type:'change',target:toggle});assert.equal(toggle.checked,true);
 for(const shape of ['2,3',Array(17).fill('1').join(','),'2,,7','0,3,7','2,-3,7','2,1.5,7','2,3,1e2','9007199254740991,2,2']){ui.get('shape').value=shape;assert.throws(()=>readMeasurementDomain(ui.root));assert.equal(ui.get('shape').value,shape);}
 ui.get('shape').value=Array(16).fill('1').join(',');assert.equal(readMeasurementDomain(ui.root).shape.length,16);
 ui.root.querySelector('[data-dataset-resource="maxScalarCharacters"]').value='';assert.throws(()=>readMeasurementDomain(ui.root));assert.equal(ui.root.querySelector('[data-dataset-resource="maxScalarCharacters"]').value,'');
});

test('historical tensor declarations stay opaque until an explicit replacement is selected',t=>{
 const opaque={...defaultDomain('matrix'),codec:'observanda.tensor',shape:[2,3,7],namespace:'opaque original',version:2,resourcePolicy:defaultDatasetResourcePolicy()};const ui=schema(t,opaque);assert.equal(ui.get('codec').value,'preserve');assert.equal(ui.root.querySelector('[data-domain-fields]').disabled,true);ui.get('shape').value='9,9,9';assert.deepEqual(readMeasurementDomain(ui.root),opaque);assert.deepEqual(readMeasurementDomain(ui.root,{validate:false}),opaque);
 ui.change('codec','tensor');assert.equal(ui.root.querySelector('[data-domain-fields]').disabled,false);assert.equal(readMeasurementDomain(ui.root).version,3);assert.deepEqual(opaque.shape,[2,3,7]);
 const version1={...opaque,version:1};delete version1.resourcePolicy;const html=measurementDomainControls(version1,{esc,field,active:true});assert.match(html,/value="preserve" selected/);assert.match(html,/preserved exactly/);
});

test('reopened version 3 keeps its configured policy while legacy vectors keep version 1',t=>{
 const tensor={...defaultDomain('tensor'),shape:[1,2,3,4],component:{version:1,representation:'rational',radix:10},resourcePolicy:{...defaultDatasetResourcePolicy(),resources:{...defaultDatasetResourcePolicy().resources,maxScalarCharacters:16384}}};const ui=schema(t,tensor);assert.deepEqual(readMeasurementDomain(ui.root),tensor);ui.change('codec','vector');ui.root.querySelector('[data-scalar-policy-enabled]').checked=false;ui.get('shape').value='24';assert.equal(readMeasurementDomain(ui.root).version,1);assert.equal(readMeasurementDomain(ui.root).resourcePolicy,undefined);
 assert.deepEqual(readDomainShape('2,,7',{validate:false}),[2,'',7]);
});

test('reshape controls require the selected rank and serialize only the unary shape contract',t=>{
 const dom=harness(t),node={id:randomUUID(),kind:'domain-reshape',left:{id:randomUUID(),position:2},shape:[2,3,7]},address=(key,label,value)=>field(label,'<input data-graph-field="'+key+'" value="'+esc(JSON.stringify(value))+'">');dom.frame('Reshape','<div data-graph-edit>'+domainReshapeControls(node,{esc,field,address})+'</div>');const root=dom.query('[data-graph-edit]'),get=key=>root.querySelector('[data-graph-field="'+key+'"]');assert.equal(get('reshape-kind').value,'tensor');assert.deepEqual(readDomainReshape(root,node,3),node);assert.throws(()=>readDomainReshape(root,node,2),/before/);
 get('reshape-kind').value='matrix';assert.throws(()=>readDomainReshape(root,node,3),/exactly one dimension/);assert.equal(get('shape').value,'2, 3, 7');get('shape').value='6,7';const result=readDomainReshape(root,node,3);assert.deepEqual(result,{...node,shape:[6,7]});assert.deepEqual(Object.keys(result).sort(),['id','kind','left','shape']);
 get('reshape-kind').value='vector';get('shape').value='42';assert.deepEqual(readDomainReshape(root,node,3).shape,[42]);
});

test('paged tensor components display all coordinates and retained scalar controls without hydration',()=>{
 const definition={...defaultDomain('tensor'),shape:[2,3,7]},items=[{index:32,position:[1,1,4],spelling:'0.3',exact:'1/2'},{index:33,position:[1,1,5],spelling:null,exact:null},{index:34,position:[1,1,6],spelling:retainedScalar(),exact:null}],html=domainComponentPageView({definition,supported:true,offset:32,total:42,next:35,items},{esc});assert.match(html,/Components 33-35 of 42/);assert.match(html,/2, 2, 5/);assert.match(html,/JSON null/);assert.match(html,/data-scalar-component="34"/);assert.match(html,/data-offset="0"/);assert.match(html,/data-offset="35"/);assert.match(html,/last coordinate varies fastest/);assert.match(html,/<th scope="row">/);assert.doesNotMatch(html,/object Object/);
 const rank16={...definition,shape:Array(16).fill(1)};assert.match(domainComponentPageView({definition:rank16,supported:true,offset:0,total:1,next:null,items:[{index:0,position:Array(16).fill(0),spelling:'<unsafe>',exact:'0/1'}]},{esc}),new RegExp(Array(16).fill('1').join(', ')));assert.match(domainComponentPageView({definition,supported:false,offset:0,total:0,next:null,items:[]},{esc}),/Components 0-0 of 0/);
});

test('graph 10 reshape keeps failed input, pages earlier operands, and disables native controls during requests',async t=>{
 const dom=harness(t),graph=ref(),calls=[],changes=[],nodes=Array.from({length:18},(_,position)=>({id:randomUUID(),kind:'constant',value:{constant:String(position),unit:''}}));let version=9,hold=false,release,refuse=true;
 const ui=datasetCalculationGraphUI({call:async(name,data)=>{calls.push({name,data:structuredClone(data)});if(name==='calculation-graph-page'){if(hold)await new Promise(resolve=>release=resolve);const offset=data.offset??0,limit=data.limit??16;return {title:'Tensor graph',graphVersion:version,policy:defaultDatasetResourcePolicy(),counts:{bindings:1,nodes:nodes.length,outputs:0},items:nodes.slice(offset,offset+limit),offset,total:nodes.length,next:offset+limit<nodes.length?offset+limit:null};}if(name==='calculation-graph-change'){if(data.collection==='version'){version=data.graphVersion;changes.push(structuredClone(data));return {ref:graph};}changes.push(structuredClone(data));if(hold)await new Promise(resolve=>release=resolve);if(refuse){refuse=false;throw Error('Reshape cardinality differs');}nodes[data.offset]=data.item;return {ref:{...graph,revision:'b'.repeat(64)}};}throw Error(name);},frame:dom.frame,esc,field,guard(){},owner:()=> 'record',inspect:async()=>{},watchJob:async()=>{}});t.after(()=>ui.clean());const act=(name,data={})=>ui.action('calculation-graph-'+name,control(name,data));
 await ui.open(graph,{existing:true});assert.doesNotMatch(dom.html(),/Add exact reshape/);await act('tensor-upgrade');dom.query('[data-dataset-resource="maxBits"]').value='';await assert.rejects(act('apply-tensor-upgrade'));assert.equal(changes.length,0);assert.equal(dom.query('[data-dataset-resource="maxBits"]').value,'');dom.query('[data-dataset-resource="maxBits"]').value='65536';await act('apply-tensor-upgrade');assert.equal(changes[0].graphVersion,10);assert.match(dom.html(),/Add exact reshape/);
 await act('add',{kind:'domain-reshape'});await act('pick',{collection:'nodes',target:'left'});await act('pick-page',{offset:'16'});assert.deepEqual(calls.at(-1).data,{ref:graph,collection:'nodes',offset:16,limit:2});await act('choose',{index:'1'});dom.query('[data-graph-field="shape"]').value='41';hold=true;const pending=act('apply');await settle();assert.ok(dom.all('[data-graph-controls]').every(el=>el.disabled));assert.match(dom.query('[data-graph-status]').textContent,/operation in progress/);await act('cancel-edit');assert.equal(dom.query('[data-graph-field="shape"]').value,'41');hold=false;release();await assert.rejects(pending,/cardinality/);assert.ok(dom.all('[data-graph-controls]').every(el=>!el.disabled));assert.equal(dom.query('[data-graph-field="shape"]').value,'41');assert.equal(JSON.parse(dom.query('[data-graph-field="left"]').value).position,17);dom.query('[data-graph-field="shape"]').value='42';await act('apply');assert.deepEqual(changes[2].item.shape,[42]);assert.deepEqual(Object.keys(changes[2].item).sort(),['id','kind','left','shape']);assert.equal(changes[2].item.left.position,17);
 await act('page',{offset:'16'});await act('edit',{index:'2'});hold=true;const picking=act('pick',{collection:'nodes',target:'left'});await settle();ui.clean();dom.frame('Replacement','<p data-replacement>Replacement editor</p>');release();await picking;assert.ok(dom.query('[data-replacement]'));assert.equal(dom.query('[data-graph-picker]'),null);assert.equal(ui.isBusy(),false);
});
