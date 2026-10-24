import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment,serialize} from 'parse5';
import {randomUUID} from 'node:crypto';
import {datasetCalculationGraphUI} from '../src/web/dataset-calculation-graph-ui.js';
import {defaultDatasetResourcePolicy} from '../src/web/dataset-resource-policy.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,input)=>'<label>'+label+input+'</label>';
const ref=()=>({kind:'analysis',id:randomUUID(),revision:'a'.repeat(64)});
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


test('new graphs declare the current generation and default policy while historical opens remain unchanged',async t=>{
 const dom=harness(t),source={...ref(),kind:'dataset',workspaceId:randomUUID()},recordId=randomUUID(),created=ref(),historical=ref(),calls=[],policy=defaultDatasetResourcePolicy(),historicalPage={title:'Saved historical graph',graphVersion:2,counts:{bindings:1,nodes:0,outputs:0},items:[],offset:0,total:0,next:null},savedHistorical=structuredClone(historicalPage);
 const ui=datasetCalculationGraphUI({call:async(name,data)=>{calls.push({name,data:structuredClone(data)});if(name==='calculation-graph-create')return {ref:created};if(name==='calculation-graph-page')return data.ref.id===historical.id?historicalPage:{...historicalPage,title:'Calculation graph',graphVersion:16,policy};throw Error(name);},frame:dom.frame,esc,field,guard(){},owner:()=>recordId,inspect:async()=>{},watchJob:async()=>{}});t.after(()=>ui.clean());
 await ui.open(source);assert.deepEqual(calls[0],{name:'calculation-graph-create',data:{recordId,title:'Calculation graph',source,view:'observations',graphVersion:16,policy:defaultDatasetResourcePolicy()}});assert.deepEqual(calls[1].data.ref,created);
 const labels=dom.all('button').map(button=>button.textContent);for(const label of ['Add topology operation','Add sequence operation','Add affine coordinate transform','Add exact domain algebra','Add clock synchronization','Add exact reshape','Add axis permutation','Resource policy'])assert.ok(labels.includes(label),label);assert.ok(!labels.some(label=>label.startsWith('Enable ')));
 await ui.action('calculation-graph-policy',control('policy'));for(const [key,value] of Object.entries(policy.resources))assert.equal(dom.query('[data-dataset-resource="'+key+'"]').value,String(value));
 await ui.open(historical,{existing:true});assert.equal(calls.filter(call=>call.name==='calculation-graph-create').length,1);assert.equal(calls.some(call=>call.name==='calculation-graph-change'),false);assert.deepEqual(calls.at(-1).data.ref,historical);assert.deepEqual(historicalPage,savedHistorical);assert.match(dom.html(),/Enable axis permutation/);assert.match(dom.html(),/Enable tensors and reshape/);assert.match(dom.html(),/Enable clock synchronization/);assert.match(dom.html(),/Enable exact domain algebra/);assert.match(dom.html(),/Enable declaration resource limits/);assert.doesNotMatch(dom.html(),/Add axis permutation/);assert.doesNotMatch(dom.html(),/Add exact reshape/);
});

test('historical graphs explicitly enable per-value computation and preserve edited policy on refusal',async t=>{
 const dom=harness(t),reference=ref(),policy=defaultDatasetResourcePolicy(),calls=[];let version=13,refused=true;policy.resources.maxOperations=1234;const ui=datasetCalculationGraphUI({call:async(name,data)=>{calls.push({name,data:structuredClone(data)});if(name==='calculation-graph-page')return {title:'Prior frame graph',graphVersion:version,policy,counts:{bindings:1,nodes:0,outputs:0},items:[],offset:0,total:0,next:null};if(name==='calculation-graph-change'){if(refused)throw Error('Revision refused');version=data.graphVersion;return {ref:reference};}throw Error(name);},frame:dom.frame,esc,field,guard(){},owner:()=>reference.id,inspect:async()=>{},watchJob:async()=>{}});t.after(()=>ui.clean());await ui.open(reference,{existing:true});assert.match(dom.html(),/Enable computation for each value/);assert.equal(calls.some(c=>c.name==='calculation-graph-change'),false);await ui.action('calculation-graph-per-cell-upgrade',control('per-cell-upgrade'));const limit=dom.query('[data-dataset-resource="maxOperations"]');assert.equal(limit.value,'1234');limit.value='2345';await assert.rejects(ui.action('calculation-graph-apply-per-cell-upgrade',control('apply-per-cell-upgrade')),/Revision refused/);assert.equal(limit.value,'2345');refused=false;await ui.action('calculation-graph-apply-per-cell-upgrade',control('apply-per-cell-upgrade'));const mutation=calls.findLast(c=>c.name==='calculation-graph-change');assert.equal(mutation.data.graphVersion,14);assert.equal(mutation.data.policy.resources.maxOperations,2345);assert.doesNotMatch(dom.html(),/Enable computation for each value/);
});
